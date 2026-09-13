'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCacheIdentity, buildJobIdentity, JOB_VERSION } = require('../../cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2');
const { createCleanupPlan, validateCleanupPlan } = require('./safety');

const now = new Date('2026-09-02T00:00:00.000Z');
const openid = 'smoke-user'; const batchId = 'batch-1'; const rendererVersion = 'renderer-v2'; const fingerprint = 'a'.repeat(64);
const cacheId = buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint });
const jobId = buildJobIdentity({ openid, batchId, rendererVersion });
function fixture(overrides = {}) {
  return { _id: jobId, jobId, _openid: openid, batchId, version: JOB_VERSION, rendererVersion, status: 'completed', entries: [{ position: 0, outfitKey: 'outfit-1', renderInputFingerprint: fingerprint, cacheId }], ...overrides };
}
function cache(overrides = {}) { return { _id: cacheId, cacheId, _openid: openid, rendererVersion, renderInputFingerprint: fingerprint, source: 'ai_cache', text: 'copy', ...overrides }; }
function planInput(overrides = {}) { return { now, openid, batchId, rendererVersion, firstOutfitKey: 'outfit-1', job: fixture(), cache: cache(), jobs: [fixture()], ...overrides }; }

test('normal exact target creates removable plan', () => { const plan = createCleanupPlan(planInput()); assert.equal(plan.action, 'remove_cache'); assert.equal(validateCleanupPlan(plan, { now, cache: cache() }).remove, true); });
test('cross-user cache is rejected', () => { assert.throws(() => createCleanupPlan(planInput({ cache: cache({ _openid: 'other' }) })), /CACHE_DOCUMENT_INVALID/); });
test('wrong fingerprint and cache id are rejected', () => { assert.throws(() => createCleanupPlan(planInput({ job: fixture({ entries: [{ position: 0, outfitKey: 'outfit-1', renderInputFingerprint: 'b'.repeat(64), cacheId }] }) })), /CACHE_IDENTITY_MISMATCH/); assert.throws(() => createCleanupPlan(planInput({ job: fixture({ entries: [{ position: 0, outfitKey: 'outfit-1', renderInputFingerprint: fingerprint, cacheId: 'wrong' }] }) })), /CACHE_IDENTITY_MISMATCH/); });
test('active or unknown jobs and live leases reject', () => { for (const status of ['queued', 'interactive', 'dispatching', 'running', 'dispatched', 'unknown']) assert.throws(() => createCleanupPlan(planInput({ jobs: [fixture({ status })] })), /JOB_NOT_TERMINAL/); assert.throws(() => createCleanupPlan(planInput({ jobs: [fixture({ leaseUntil: new Date(now.getTime() + 1).toISOString() })] })), /JOB_LEASE_ACTIVE/); });
test('only a stale related interactive job without a live lease is safe to ignore', () => {
  const stale = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  assert.doesNotThrow(() => createCleanupPlan(planInput({
    jobs: [fixture({ status: 'interactive', updatedAt: stale })],
  })));
  assert.throws(() => createCleanupPlan(planInput({
    jobs: [fixture({ status: 'interactive', updatedAt: stale,
      leaseUntil: new Date(now.getTime() + 1).toISOString() })],
  })), /JOB_LEASE_ACTIVE/);
});
test('stale plan and changed cache reject', () => { const plan = createCleanupPlan(planInput()); assert.throws(() => validateCleanupPlan(plan, { now: new Date(now.getTime() + 10 * 60 * 1000 + 1), cache: cache() }), /PLAN_STALE/); assert.throws(() => validateCleanupPlan(plan, { now, cache: cache({ text: 'changed' }) }), /CACHE_DOCUMENT_CHANGED/); });
test('empty cache is an explicit already-miss plan', () => { const plan = createCleanupPlan(planInput({ cache: null })); assert.equal(plan.action, 'already_miss'); assert.equal(validateCleanupPlan(plan, { now }).remove, false); });
test('invalid fingerprint and malformed lease fail closed', () => { assert.throws(() => createCleanupPlan(planInput({ job: fixture({ entries: [{ position: 0, outfitKey: 'outfit-1', renderInputFingerprint: 'short', cacheId }] }) })), /ENTRY_FINGERPRINT_INVALID/); assert.throws(() => createCleanupPlan(planInput({ jobs: [fixture({ leaseUntil: 'later' })] })), /JOB_LEASE_INVALID/); });
test('already-miss plan rejects a cache appearing on reread', () => { const plan = createCleanupPlan(planInput({ cache: null })); assert.throws(() => validateCleanupPlan(plan, { now, cache: cache() }), /CACHE_DOCUMENT_CHANGED/); });
