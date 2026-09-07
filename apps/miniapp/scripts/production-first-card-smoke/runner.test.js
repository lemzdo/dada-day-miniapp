'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCacheIdentity, buildJobIdentity, JOB_VERSION } = require('../../cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2');
const { runProductionSmoke } = require('./runner');

const openid = 'runner-user'; const rendererVersion = 'renderer-v2'; const fingerprint = 'c'.repeat(64); const outfitKey = 'look-1';
function harness(initialCache, options = {}) {
  let cachePresent = initialCache; let deletes = 0; let currentUser = openid;
  const admin = {
    getJob: async ({ batchId }) => ({ _id: buildJobIdentity({ openid, batchId, rendererVersion }), jobId: buildJobIdentity({ openid, batchId, rendererVersion }), _openid: openid, batchId, version: JOB_VERSION, rendererVersion, status: 'completed', entries: [{ position: 0, outfitKey, renderInputFingerprint: fingerprint, cacheId: buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint }) }] }),
    getCache: async () => cachePresent ? ({ _id: buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint }), cacheId: buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint }), _openid: openid, rendererVersion, renderInputFingerprint: fingerprint, source: 'ai_cache', text: '真实文案' }) : null,
    listRelatedJobs: async () => options.activeRelated ? [{ _id: buildJobIdentity({ openid, batchId: 'other', rendererVersion }), jobId: buildJobIdentity({ openid, batchId: 'other', rendererVersion }), _openid: openid, batchId: 'other', version: JOB_VERSION, rendererVersion, status: 'running', entries: [{ position: 0, outfitKey, renderInputFingerprint: fingerprint, cacheId: buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint }) }] }] : [],
    removeSingleCache: async () => { deletes += 1; cachePresent = false; return 1; },
  };
  let contextReads = 0;
  const mini = { evaluate: async (fn, args) => { const previous = global.wx; contextReads += 1; const observedOpenid = options.userChanged && contextReads > 1 ? 'changed-user' : openid; global.wx = { getStorageSync: () => observedOpenid, getStorageInfoSync: () => ({ keys: [`d1d:user:cloud:${args}:user:${observedOpenid}:probe`] }), cloud: { callHTTPFunction() {} }, getAccountInfoSync: () => ({ miniProgram: { appId: 'test-app' } }) }; try { return await fn(args); } finally { global.wx = previous; } } };
  const invoke = async (_mini, context, input) => ({ statusCode: 200, batchId: input.v2BatchId, firstCard: { outfitKey, todayReason: '真实文案' }, context });
  const wait = async (_admin, context, result) => {
    const hit = cachePresent;
    if (!hit) cachePresent = true;
    const stages = [{ stage: 'CACHE_LOOKUP_DONE', status: hit ? 'hit' : 'miss' }];
    if (!hit) stages.push(
      { stage: 'FIRST_CARD_AI_ADMITTED', status: 'admitted', elapsedFromHandlerMs: 1 },
      { stage: 'PROVIDER_START', status: 'started', elapsedFromHandlerMs: 2 },
      { stage: 'FULL_BATCH_READY', status: 'completed', elapsedFromHandlerMs: 3 },
      { stage: 'PROVIDER_COMPLETE', status: 'completed', elapsedFromHandlerMs: 4 },
      { stage: 'VALIDATOR_COMPLETE', status: 'accepted', elapsedFromHandlerMs: 5 },
      { stage: 'CANONICAL_PERSISTED', status: 'completed', elapsedFromHandlerMs: 6 },
    );
    return { result, job: await admin.getJob({ openid: context.openid, batchId: result.batchId }), cache: hit ? await admin.getCache({}) : { _id: buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint }), cacheId: buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint }), _openid: openid, rendererVersion, renderInputFingerprint: fingerprint, source: 'ai_cache', text: '真实文案' }, audit: { stages, summaries: [{ executionOutcome: 'succeeded', failure: null, validated: true, persisted: true, providerCalled: hit ? false : true, firstCardAiStarted: hit ? false : true }], unparsed: 0 } };
  };
  return { admin, mini, invoke, wait, get deletes() { return deletes; }, set currentUser(value) { currentUser = value; }, get user() { return currentUser; } };
}
function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-smoke-')); }
function cleanup(directory) { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); }

test('natural MISS then HIT does not delete cache', async () => {
  const h = harness(false); const dir = tempDir();
  const report = await runProductionSmoke({ admin: h.admin, mini: h.mini, directory: dir, invoke: h.invoke, wait: h.wait, progress: () => {} });
  assert.equal(report.status, 'PASS'); assert.equal(h.deletes, 0); assert.deepEqual(report.requests.map((r) => r.mode), ['miss', 'hit']); cleanup(dir);
});

test('fixed comparison date is reused by every bounded MISS/HIT request without a force flag', async () => {
  const h = harness(true); const dir = tempDir(); const inputs = [];
  try {
    const report = await runProductionSmoke({ admin: h.admin, mini: h.mini, directory: dir, date: '2026-09-03',
      invoke: async (...args) => { inputs.push(args[2]); return h.invoke(...args); }, wait: h.wait });
    assert.equal(report.status, 'PASS');
    assert.equal(inputs.length, 3);
    assert.ok(inputs.every((input) => input.date === '2026-09-03' && input.forceMiss === undefined));
    assert.ok(report.requests.every((request) => request.visibility.status === 'unavailable'
      && request.timeline.FIRST_CARD_VISIBLE === null));
  } finally { cleanup(dir); }
});

test('invalid fixed date fails before any production context access', async () => {
  await assert.rejects(runProductionSmoke({ date: '2026-02-30', mini: { evaluate() { throw new Error('unexpected access'); } } }), /SMOKE_DATE_INVALID/);
});

test('baseline HIT backs up then removes exactly one cache before MISS then HIT', async () => {
  const h = harness(true); const dir = tempDir();
  const report = await runProductionSmoke({ admin: h.admin, mini: h.mini, directory: dir, invoke: h.invoke, wait: h.wait, progress: () => {} });
  assert.equal(report.status, 'PASS'); assert.equal(h.deletes, 1); assert.equal(report.deletedCacheDocuments, 1); assert.deepEqual(report.requests.map((r) => r.mode), ['hit', 'miss', 'hit']); assert.ok(fs.existsSync(path.join(dir, 'cache-backup.private.json'))); cleanup(dir);
});

test('invalid exact deletion response fails smoke', async () => {
  const h = harness(true); h.admin.removeSingleCache = async () => 0; const dir = tempDir();
  const report = await runProductionSmoke({ admin: h.admin, mini: h.mini, directory: dir, invoke: h.invoke, wait: h.wait, progress: () => {} });
  assert.equal(report.status, 'FAIL'); assert.equal(report.errorCode, 'CACHE_DELETE_NOT_EXACTLY_ONE'); cleanup(dir);
});

test('active related job rejects before deletion or smoke continuation', async () => {
  const h = harness(true, { activeRelated: true }); const dir = tempDir();
  const report = await runProductionSmoke({ admin: h.admin, mini: h.mini, directory: dir, invoke: h.invoke, wait: h.wait, progress: () => {} });
  assert.equal(report.status, 'FAIL'); assert.equal(report.errorCode, 'PRODUCTION_SMOKE_FAILED'); assert.equal(h.deletes, 0); assert.equal(report.requests.length, 1); cleanup(dir);
});

test('user change after backup stops before deletion or smoke continuation', async () => {
  const h = harness(true, { userChanged: true }); const dir = tempDir();
  const report = await runProductionSmoke({ admin: h.admin, mini: h.mini, directory: dir, invoke: h.invoke, wait: h.wait, progress: () => {} });
  assert.equal(report.status, 'FAIL'); assert.equal(report.errorCode, 'WECHAT_USER_CHANGED'); assert.equal(h.deletes, 0); assert.equal(report.requests.length, 1); cleanup(dir);
});
