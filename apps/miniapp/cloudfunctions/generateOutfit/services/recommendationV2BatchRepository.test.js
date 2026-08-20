'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { persistRecommendationBatchV2, stableReferenceId } = require('./recommendationV2BatchRepository');

function fixture(mode) {
  const batchId = `batch-${mode}`;
  const order = Array.from({ length: 8 }, (_, index) => `${mode}-key-${index}`);
  const batch = { runtimeVersion: 'today-runtime-v2', schemaVersion: 'today-v2', batchId, commitToken: `commit-${mode}`, contentHash: `hash-${mode}`, sceneKey: 'home', scene: '居家', targetDate: '2026-08-20', timeOfDay: 'all_day', weatherMode: 'live', weatherSnapshot: { temp: 28, humidity: 60, weather: '多云', wind: 2, uv: 3 }, weatherFingerprint: 'weather', inputIdentityHash: 'input', generatedAt: '2026-08-20T00:00:00.000Z', cardCount: 8, order, countContract: { expected: 8, actual: 8 } };
  const refs = order.map((outfitKey, position) => ({ runtimeVersion: 'today-runtime-v2', schemaVersion: 'today-v2', batchId, outfitKey, referenceId: `unstable-${position}`, position, clothingIds: [`clothing-${position}`] }));
  return { batch, refs };
}

function createDatabase(existingKeys = [], options = {}) {
  const records = { recommendation_batches_v2: [], recommendation_outfit_refs_v2: existingKeys.map((outfitKey) => ({ _id: `old-${outfitKey}`, _openid: 'user-1', outfitKey, batchId: 'old-batch', referenceId: `stable-${outfitKey}`, position: 0 })) };
  const operations = { transactions: 0, adds: 0, updates: 0, rollbacks: 0 };
  let transactionTail = Promise.resolve();
  const makeDatabase = () => ({
    collection(name) {
      const rows = records[name];
      const query = { filters: {}, where(filters) { this.filters = filters; return this; }, limit() { return this; }, async get() { return { data: rows.filter((row) => Object.entries(this.filters).every(([key, value]) => row[key] === value)) }; }, async add({ data }) { if (options.failRefAdd && name === 'recommendation_outfit_refs_v2') throw new Error('injected write failure'); operations.adds += 1; const entries = Array.isArray(data) ? data : [data]; entries.forEach((entry, index) => rows.push({ ...entry, _id: entry._id || `${name}-${rows.length + index}` })); return { _id: rows.at(-1)._id }; } };
      query.doc = (id) => ({ async update({ data }) { operations.updates += 1; const index = rows.findIndex((row) => row._id === id); if (index < 0) throw new Error('V2_TEST_REF_NOT_FOUND'); rows[index] = { ...rows[index], ...data }; } });
      return query;
    },
    async runTransaction(callback) { const execute = async () => { operations.transactions += 1; const snapshot = JSON.parse(JSON.stringify(records)); try { return await callback(makeDatabase()); } catch (error) { records.recommendation_batches_v2 = snapshot.recommendation_batches_v2; records.recommendation_outfit_refs_v2 = snapshot.recommendation_outfit_refs_v2; operations.rollbacks += 1; throw error; } }; const result = transactionTail.then(execute, execute); transactionTail = result.then(() => undefined, () => undefined); return result; },
  });
  return { database: makeDatabase(), records, operations };
}

for (const [mode, existingCount] of [['all-existing', 8], ['mixed', 4], ['all-new', 0]]) {
  test(`V2 repository uses one atomic path and stable identities for ${mode}`, async () => {
    const input = fixture(mode);
    const existingKeys = input.refs.slice(0, existingCount).map((ref) => ref.outfitKey);
    const { database, records, operations } = createDatabase(existingKeys);
    const first = await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
    assert.equal(first.idempotent, false);
    assert.equal(records.recommendation_batches_v2.length, 1);
    assert.equal(records.recommendation_outfit_refs_v2.length, 8);
    assert.equal(operations.transactions, 1);
    assert.deepEqual(first.refs.map((ref) => ref.referenceId), input.refs.map((ref) => existingKeys.includes(ref.outfitKey) ? `stable-${ref.outfitKey}` : stableReferenceId('user-1', ref.outfitKey)));
    const retry = await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
    assert.equal(retry.idempotent, true);
    assert.equal(retry.writes, 0);
    assert.equal(operations.transactions, 2);
  });
}

test('V2 repository concurrent same-hash calls return one write and one idempotent result', async () => {
  const input = fixture('concurrent');
  const { database, records } = createDatabase();
  const results = await Promise.all([persistRecommendationBatchV2({ database, openid: 'user-1', ...input }), persistRecommendationBatchV2({ database, openid: 'user-1', ...input })]);
  assert.deepEqual(results.map((result) => result.idempotent).sort(), [false, true]);
  assert.equal(records.recommendation_batches_v2.length, 1);
  assert.equal(records.recommendation_outfit_refs_v2.length, 8);
});

test('V2 repository rolls back partial writes and fails closed', async () => {
  const input = fixture('rollback');
  const { database, records, operations } = createDatabase([], { failRefAdd: true });
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', ...input }), /injected write failure/);
  assert.equal(records.recommendation_batches_v2.length, 0);
  assert.equal(records.recommendation_outfit_refs_v2.length, 0);
  assert.equal(operations.rollbacks, 1);
});

test('V2 repository rejects a partial batch before writing', async () => {
  const input = fixture('partial');
  const { database, records } = createDatabase();
  records.recommendation_batches_v2.push({ ...input.batch, _openid: 'user-1' });
  records.recommendation_outfit_refs_v2.push({ ...input.refs[0], _id: 'partial-ref', _openid: 'user-1' });
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', ...input }), /V2_BATCH_REFS_INCOMPLETE/);
});

test('V2 repository rejects same batch id with a different hash', async () => {
  const input = fixture('conflict');
  const { database } = createDatabase();
  await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', batch: { ...input.batch, contentHash: 'different' }, refs: input.refs }), /V2_BATCH_COMMIT_VALIDATION_FAILED/);
});
