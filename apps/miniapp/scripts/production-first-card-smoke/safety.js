'use strict';

const crypto = require('node:crypto');
const {
  JOB_VERSION,
  buildCacheIdentity,
  buildJobIdentity,
} = require('../../cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2');

const CACHE_COLLECTION = 'recommendation_canonical_copy_cache_v2';
const TERMINAL_STATUSES = new Set([
  'ready_cache_hit', 'completed', 'partially_completed', 'failed_open', 'dispatch_failed',
]);
const PLAN_MAX_AGE_MS = 10 * 60 * 1000;

function createCleanupPlan(input = {}) {
  const now = asDate(input.now, 'PLAN_NOW_INVALID');
  const openid = text(input.openid);
  const batchId = text(input.batchId);
  const rendererVersion = text(input.rendererVersion);
  const firstOutfitKey = text(input.firstOutfitKey);
  const job = input.job;
  if (!openid || !batchId || !rendererVersion || !firstOutfitKey || !job) throw new Error('PLAN_INPUT_INVALID');
  const expectedJobId = buildJobIdentity({ openid, batchId, rendererVersion });
  if (text(job._id || job.jobId) !== expectedJobId || text(job.jobId) !== expectedJobId) throw new Error('JOB_IDENTITY_MISMATCH');
  if (job._openid !== openid || job.version !== JOB_VERSION || job.rendererVersion !== rendererVersion || job.batchId !== batchId) throw new Error('JOB_METADATA_MISMATCH');
  rejectJobState(job, now);
  const entry = (Array.isArray(job.entries) ? job.entries : []).find((candidate) => candidate?.position === 0);
  if (!entry || entry.outfitKey !== firstOutfitKey) throw new Error('FIRST_ENTRY_MISMATCH');
  const fingerprint = text(entry.renderInputFingerprint);
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error('ENTRY_FINGERPRINT_INVALID');
  const expectedCacheId = buildCacheIdentity({ openid, rendererVersion, renderInputFingerprint: fingerprint });
  if (entry.cacheId !== expectedCacheId) throw new Error('CACHE_IDENTITY_MISMATCH');
  const cache = input.cache;
  const plan = {
    version: 'production-first-card-smoke-cleanup-v1',
    createdAt: now.toISOString(),
    action: cache ? 'remove_cache' : 'already_miss',
    collection: CACHE_COLLECTION,
    cache: cache ? cacheMetadata(cache, { openid, rendererVersion, fingerprint, expectedCacheId }) : null,
    job: jobMetadata(job),
    target: { _id: expectedCacheId, _openid: openid, renderInputFingerprint: fingerprint, rendererVersion },
  };
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  for (const candidate of jobs) {
    if (candidate?._openid !== openid) continue;
    const hasTarget = (Array.isArray(candidate.entries) ? candidate.entries : []).some((e) => e?.cacheId === expectedCacheId);
    if (!hasTarget) continue;
    if (!candidate.jobId || !text(candidate.batchId) || candidate._openid !== openid || candidate.rendererVersion !== rendererVersion
      || candidate.version !== JOB_VERSION || candidate.batchId !== text(candidate.batchId)
      || buildJobIdentity({ openid, batchId: candidate.batchId, rendererVersion }) !== text(candidate.jobId)) {
      throw new Error('RELATED_JOB_INVALID');
    }
    rejectJobState(candidate, now);
  }
  return plan;
}

function validateCleanupPlan(plan, input = {}) {
  if (!plan || plan.version !== 'production-first-card-smoke-cleanup-v1') throw new Error('PLAN_VERSION_INVALID');
  const now = asDate(input.now, 'PLAN_NOW_INVALID');
  const created = Date.parse(plan.createdAt || '');
  if (!Number.isFinite(created) || now.getTime() - created > PLAN_MAX_AGE_MS || created > now.getTime()) throw new Error('PLAN_STALE');
  if (plan.collection !== CACHE_COLLECTION || plan.target?._id !== buildCacheIdentity({ openid: plan.target?._openid, rendererVersion: plan.target?.rendererVersion, renderInputFingerprint: plan.target?.renderInputFingerprint })) throw new Error('PLAN_TARGET_INVALID');
  if (plan.action === 'already_miss') {
    if (input.cache) throw new Error('CACHE_DOCUMENT_CHANGED');
    return { valid: true, action: plan.action, remove: false };
  }
  if (plan.action !== 'remove_cache' || !plan.cache) throw new Error('PLAN_ACTION_INVALID');
  const cache = input.cache;
  const target = plan.target;
  if (!cache || text(cache._id || cache.cacheId) !== target._id) throw new Error('CACHE_DOCUMENT_CHANGED');
  const current = cacheMetadata(cache, target);
  if (current.hash !== plan.cache.hash) throw new Error('CACHE_DOCUMENT_CHANGED');
  return { valid: true, action: plan.action, remove: true, collection: plan.collection, docId: target._id };
}

function rejectJobState(job, now) {
  if (!TERMINAL_STATUSES.has(job.status)) throw new Error(`JOB_NOT_TERMINAL:${text(job.status) || 'unknown'}`);
  if (future(job.leaseUntil, now) || future(job.dispatchLeaseUntil, now)) throw new Error('JOB_LEASE_ACTIVE');
}

function cacheMetadata(cache, target) {
  const expectedId = target.expectedCacheId || target._id;
  if (text(cache._id || cache.cacheId) !== expectedId) throw new Error('CACHE_DOCUMENT_ID_MISMATCH');
  if (cache._openid !== (target.openid || target._openid) || cache.cacheId !== expectedId || cache.renderInputFingerprint !== (target.fingerprint || target.renderInputFingerprint) || cache.rendererVersion !== target.rendererVersion || cache.source !== 'ai_cache' || !text(cache.text)) throw new Error('CACHE_DOCUMENT_INVALID');
  return { _id: cache._id || cache.cacheId, _openid: cache._openid, renderInputFingerprint: cache.renderInputFingerprint, rendererVersion: cache.rendererVersion, cacheId: cache.cacheId, source: cache.source, textHash: hash(text(cache.text)), hash: hash(stable(cache)) };
}

function jobMetadata(job) { return { _id: job._id || job.jobId, jobId: job.jobId, _openid: job._openid, batchId: job.batchId, version: job.version, rendererVersion: job.rendererVersion, status: job.status }; }
function asDate(value, code) { const date = value instanceof Date ? value : new Date(value || Date.now()); if (!Number.isFinite(date.getTime())) throw new Error(code); return date; }
function future(value, now) {
  if (!text(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('JOB_LEASE_INVALID');
  return timestamp > now.getTime();
}
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function stable(value) { return JSON.stringify(sort(value)); }
function sort(value) { if (Array.isArray(value)) return value.map(sort); if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = sort(value[key]); return out; }, {}); return value; }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

module.exports = { CACHE_COLLECTION, PLAN_MAX_AGE_MS, TERMINAL_STATUSES, createCleanupPlan, validateCleanupPlan, hash };
