'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildCacheIdentity,
  finishRecommendationCopyJob,
  ensureRecommendationCopyCollections,
  normalizeJobEntries,
  persistValidatedCanonicalCopy,
  prepareRecommendationCopyJob,
  acquireRecommendationCopyJob,
  readRecommendationCopyOverlay,
} = require('./recommendationCopyProductionJobV2');

function fakeDatabase() {
  const collections = new Map(); let transactionTail = Promise.resolve();
  const command = { in: (values) => ({ __in: values.slice() }) };
  const matches = (doc, query) => Object.entries(query || {}).every(([key, expected]) => expected?.__in ? expected.__in.includes(doc[key]) : doc[key] === expected);
  const collection = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    const store = collections.get(name);
    return {
      doc: (id) => {
        const ref = {
          async get() { const data = store.get(id); return { data: data ? { ...data } : null }; },
          async set({ data }) { store.set(id, { ...data }); },
          async update({ data }) { store.set(id, { ...(store.get(id) || {}), ...data }); },
        }; return ref;
      },
      where(query) { let limit = Infinity; return { limit(value) { limit = value; return this; }, async get() { return { data: [...store.values()].filter((doc) => matches(doc, query)).slice(0, limit).map((doc) => ({ ...doc })) }; } }; },
    };
  };
  return {
    command,
    collection,
    async runTransaction(callback) { let result; const run = transactionTail.then(() => callback({ collection })); transactionTail = run.catch(() => {}); result = await run; return result; },
    _all(name) { return [...(collections.get(name) || new Map()).values()]; },
  };
}

function entries(count, openid = 'openid-a', rendererVersion = 'renderer-v2') {
  return Array.from({ length: count }, (_, position) => ({
    position, outfitKey: `outfit-${position}`, renderInputFingerprint: `fingerprint-${position}`,
    preparedEntry: { version: 'recommendation-voice-materialization-input-v2.0', plan: { planId: `plan-${position}`, planHash: `hash-${position}` }, input: { planId: `plan-${position}` } },
    cacheId: buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: `fingerprint-${position}` }),
  }));
}
const now = new Date('2026-08-24T00:00:00.000Z');

for (const count of [1, 3, 7, 8]) test(`${count} entries normalize with stable positions`, () => {
  const normalized = normalizeJobEntries(entries(count), { openid: 'openid-a', rendererVersion: 'renderer-v2' });
  assert.equal(normalized.length, count); assert.deepEqual(normalized.map((entry) => entry.position), [...Array(count).keys()]);
});

test('zero entries are rejected', () => assert.throws(() => normalizeJobEntries([], { openid: 'openid-a', rendererVersion: 'renderer-v2' }), /COPY_JOB_ENTRY_COUNT/));

test('storage bootstrap creates only the fixed job and canonical cache collections', async () => {
  const calls = [];
  const result = await ensureRecommendationCopyCollections({
    async createCollection(name) {
      calls.push(name);
      if (name === 'recommendation_canonical_copy_cache_v2') throw new Error('collection already exists');
    },
  });
  assert.deepEqual(calls, ['recommendation_copy_jobs_v2', 'recommendation_canonical_copy_cache_v2']);
  assert.deepEqual(result.created, ['recommendation_copy_jobs_v2']);
  assert.deepEqual(result.existing, ['recommendation_canonical_copy_cache_v2']);
});

test('all cache hits do not dispatch', async () => {
  const database = fakeDatabase(); const input = entries(3); const jobEntries = normalizeJobEntries(input, { openid: 'openid-a', rendererVersion: 'renderer-v2' });
  for (const entry of jobEntries) await persistValidatedCanonicalCopy(database, { _openid: 'openid-a', rendererVersion: 'renderer-v2' }, entry, { text: `copy-${entry.position}` }, now);
  let calls = 0; const result = await prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-a', rendererVersion: 'renderer-v2', entries: input, dispatch: async () => { calls += 1; } , now });
  assert.equal(calls, 0); assert.equal(result.status, 'ready_cache_hit'); assert.equal(result.initialCopies.length, 3);
});

test('same batch concurrent prepare dispatches once and second joins', async () => {
  const database = fakeDatabase(); const input = entries(3); let calls = 0; let release; const gate = new Promise((resolve) => { release = resolve; });
  const dispatch = async () => { calls += 1; await gate; return { requestId: 'request-1' }; };
  const first = prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-concurrent', rendererVersion: 'renderer-v2', entries: input, dispatch, now });
  const second = prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-concurrent', rendererVersion: 'renderer-v2', entries: input, dispatch, now });
  await new Promise((resolve) => setImmediate(resolve)); release(); const results = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(results.filter((result) => result.dispatch.accepted).length, 1); assert.ok(results.some((result) => result.dispatch.joined));
});

test('dispatch errors fail open and persist dispatch_failed', async () => {
  const database = fakeDatabase(); const result = await prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-fail', rendererVersion: 'renderer-v2', entries: entries(1), dispatch: async () => { throw new Error('PROVIDER_DOWN'); }, now });
  assert.equal(result.dispatch.accepted, false); assert.match(result.dispatch.failureCode, /PROVIDER_DOWN/);
});

test('dispatch token authorizes worker lease', async () => {
  const database = fakeDatabase(); const result = await prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-token', rendererVersion: 'renderer-v2', entries: entries(1), dispatch: async () => ({ requestId: 'request-token' }), now });
  assert.equal((await acquireRecommendationCopyJob(database, result.jobId, 'wrong-token', now)).status, 'unauthorized');
  const job = database._all('recommendation_copy_jobs_v2')[0]; const acquired = await acquireRecommendationCopyJob(database, result.jobId, job.dispatchToken, now);
  assert.equal(acquired.acquired, true);
});

test('worker lease with same token allows only one concurrent acquire', async () => {
  const database = fakeDatabase(); const result = await prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-lease', rendererVersion: 'renderer-v2', entries: entries(1), dispatch: async () => ({ requestId: 'request-lease' }), now });
  const job = database._all('recommendation_copy_jobs_v2')[0]; const [left, right] = await Promise.all([acquireRecommendationCopyJob(database, result.jobId, job.dispatchToken, now), acquireRecommendationCopyJob(database, result.jobId, job.dispatchToken, now)]);
  assert.equal([left, right].filter((value) => value.acquired).length, 1); assert.equal([left, right].filter((value) => value.status === 'joined').length, 1);
});

test('incremental cache writes produce partial then ready overlay', async () => {
  const database = fakeDatabase(); const input = entries(3); const prepared = await prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-overlay', rendererVersion: 'renderer-v2', entries: input, dispatch: async () => ({ requestId: 'request-overlay' }), now });
  const normalized = normalizeJobEntries(input, { openid: 'openid-a', rendererVersion: 'renderer-v2' }); const job = database._all('recommendation_copy_jobs_v2')[0];
  await persistValidatedCanonicalCopy(database, job, normalized[0], { text: 'first' }, now); assert.equal((await readRecommendationCopyOverlay(database, 'openid-a', 'batch-overlay', 'renderer-v2')).status, 'partial');
  await persistValidatedCanonicalCopy(database, job, normalized[1], { text: 'second' }, now); await persistValidatedCanonicalCopy(database, job, normalized[2], { text: 'third' }, now);
  const overlay = await readRecommendationCopyOverlay(database, 'openid-a', 'batch-overlay', 'renderer-v2'); assert.equal(overlay.status, 'ready'); assert.equal(overlay.readyCount, 3); assert.equal(prepared.jobId, job.jobId);
});

test('repeated cache write is idempotent', async () => {
  const database = fakeDatabase(); const normalized = normalizeJobEntries(entries(1), { openid: 'openid-a', rendererVersion: 'renderer-v2' }); const job = { _openid: 'openid-a', rendererVersion: 'renderer-v2' };
  const first = await persistValidatedCanonicalCopy(database, job, normalized[0], { text: 'same' }, now); const second = await persistValidatedCanonicalCopy(database, job, normalized[0], { text: 'different' }, now);
  assert.deepEqual(second, first); assert.equal(database._all('recommendation_canonical_copy_cache_v2').length, 1);
});

test('different openid or batch cannot read the job overlay', async () => {
  const database = fakeDatabase(); await prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-isolated', rendererVersion: 'renderer-v2', entries: entries(1), dispatch: async () => ({ requestId: 'request-isolated' }), now });
  assert.equal((await readRecommendationCopyOverlay(database, 'openid-b', 'batch-isolated', 'renderer-v2')).status, 'not_found'); assert.equal((await readRecommendationCopyOverlay(database, 'openid-a', 'batch-other', 'renderer-v2')).status, 'not_found');
});

test('stale lease finish does not overwrite current worker', async () => {
  const database = fakeDatabase(); const result = await prepareRecommendationCopyJob({ database, openid: 'openid-a', batchId: 'batch-stale', rendererVersion: 'renderer-v2', entries: entries(1), dispatch: async () => ({ requestId: 'request-stale' }), now }); const job = database._all('recommendation_copy_jobs_v2')[0];
  const acquired = await acquireRecommendationCopyJob(database, result.jobId, job.dispatchToken, now); const stale = await finishRecommendationCopyJob(database, acquired.job, 'stale-token', { readyCount: 1 }, now);
  assert.equal(stale.updated, false); assert.equal(database._all('recommendation_copy_jobs_v2')[0].status, 'running');
});
