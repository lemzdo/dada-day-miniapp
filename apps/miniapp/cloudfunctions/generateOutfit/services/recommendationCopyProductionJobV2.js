'use strict';

const crypto = require('node:crypto');

const JOB_COLLECTION = 'recommendation_copy_jobs_v2';
const CACHE_COLLECTION = 'recommendation_canonical_copy_cache_v2';
const JOB_VERSION = 'recommendation-copy-job-v2.0';
const LEASE_MS = 60 * 1000;
const DISPATCH_LEASE_MS = 60 * 1000;
const STORAGE_COLLECTIONS = Object.freeze([JOB_COLLECTION, CACHE_COLLECTION]);

function buildJobIdentity({ openid, batchId, rendererVersion }) {
  return `rcj-${hash(`${openid}|${batchId}|${rendererVersion}`)}`;
}

function buildCacheIdentity({ openid, renderInputFingerprint, rendererVersion }) {
  return `rcc-${hash(`${openid}|${rendererVersion}|${renderInputFingerprint}`)}`;
}

async function ensureRecommendationCopyCollections(database) {
  if (!database || typeof database.createCollection !== 'function') {
    throw new Error('COPY_STORAGE_BOOTSTRAP_UNAVAILABLE');
  }
  const created = [];
  const existing = [];
  for (const name of STORAGE_COLLECTIONS) {
    try {
      await database.createCollection(name);
      created.push(name);
    } catch (error) {
      if (!/already exists|collection exists|DATABASE_COLLECTION_EXIST/i.test(String(error?.message || error))) {
        throw error;
      }
      existing.push(name);
    }
  }
  return { collections: [...STORAGE_COLLECTIONS], created, existing };
}

function normalizeJobEntries(entries, { openid, rendererVersion }) {
  const source = Array.isArray(entries) ? entries : [];
  if (source.length < 1 || source.length > 8) throw new Error('COPY_JOB_ENTRY_COUNT');
  return source.map((entry, position) => {
    const outfitKey = readText(entry?.outfitKey);
    const renderInputFingerprint = readText(entry?.renderInputFingerprint);
    const planId = readText(entry?.preparedEntry?.plan?.planId);
    if (!outfitKey || !renderInputFingerprint || !planId || entry.position !== position) {
      throw new Error('COPY_JOB_ENTRY_INVALID');
    }
    return {
      position,
      outfitKey,
      renderInputFingerprint,
      cacheId: buildCacheIdentity({ openid, renderInputFingerprint, rendererVersion }),
      preparedEntry: entry.preparedEntry,
    };
  });
}

async function prepareRecommendationCopyJob({
  database,
  openid,
  batchId,
  inputIdentityHash,
  rendererVersion,
  entries,
  dispatch,
  executionMode = 'event',
  now = new Date(),
} = {}) {
  const interactive = executionMode === 'interactive';
  if (!database || !openid || !batchId || !rendererVersion
    || (!interactive && typeof dispatch !== 'function')) {
    throw new Error('COPY_JOB_PREPARE_INPUT');
  }
  const normalizedEntries = normalizeJobEntries(entries, { openid, rendererVersion });
  const cached = await readCachedCopies(database, openid, rendererVersion, normalizedEntries);
  const cachedById = new Map(cached.map((copy) => [copy.cacheId, copy]));
  const misses = normalizedEntries.filter((entry) => !cachedById.has(entry.cacheId));
  const jobId = buildJobIdentity({ openid, batchId, rendererVersion });
  const timestamp = now.toISOString();
  const draft = {
    version: JOB_VERSION,
    rendererVersion,
    jobId,
    _openid: openid,
    batchId,
    inputIdentityHash: readText(inputIdentityHash),
    order: normalizedEntries.map((entry) => entry.outfitKey),
    entries: normalizedEntries,
    status: misses.length === 0 ? 'ready_cache_hit' : interactive ? 'interactive' : 'queued',
    cacheHitCount: cached.length,
    missCount: misses.length,
    readyCopies: normalizedEntries.flatMap((entry) => {
      const copy = cachedById.get(entry.cacheId);
      return copy ? [toOverlayCopy(entry, copy)] : [];
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const reservation = await reserveJob(database, draft);
  const job = reservation.job;
  const dispatchReservation = !interactive && job.missCount > 0
    ? await acquireDispatchReservation(database, jobId, now)
    : { acquired: false, status: job.status };
  let dispatchResult = { accepted: false, joined: reservation.created === false };
  if (dispatchReservation.acquired) {
    let accepted;
    try {
      accepted = await dispatch({
        action: 'materializeRecommendationCopyJobV2',
        jobId,
        dispatchToken: dispatchReservation.dispatchToken,
      });
    } catch (error) {
      await markDispatchFailure(database, jobId, dispatchReservation.dispatchToken, error);
      dispatchResult = { accepted: false, joined: reservation.created === false, failureCode: readErrorCode(error) };
    }
    if (accepted) {
      try {
        await markDispatchAccepted(database, jobId, dispatchReservation.dispatchToken, accepted.requestId);
      } catch { /* Event was accepted; bookkeeping failure must not cause a duplicate dispatch. */ }
      dispatchResult = { accepted: true, requestId: accepted.requestId, joined: reservation.created === false };
    }
  }
  return {
    version: JOB_VERSION,
    rendererVersion,
    jobId,
    batchId,
    status: misses.length === 0
      ? 'ready_cache_hit'
      : interactive ? 'interactive' : dispatchResult.accepted ? 'dispatched' : dispatchReservation.status,
    initialCopies: normalizedEntries.flatMap((entry) => {
      const copy = cachedById.get(entry.cacheId);
      return copy ? [toOverlayCopy(entry, copy)] : [];
    }),
    dispatch: dispatchResult,
    // Exposed for the interactive transport to use the same canonical writer;
    // this is the normalized job snapshot, not a second cache contract.
    entries: normalizedEntries,
    missEntries: normalizedEntries.filter((entry) => !cachedById.has(entry.cacheId)),
  };
}

async function acquireDispatchReservation(database, jobId, now = new Date()) {
  let result;
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(JOB_COLLECTION).doc(jobId);
    const job = await readDocument(reference);
    if (!job || job.version !== JOB_VERSION || readText(job.dispatchRequestId)) {
      result = { acquired: false, status: job?.status || 'not_found' };
      return;
    }
    const leaseUntil = Date.parse(job.dispatchLeaseUntil || '');
    const leaseActive = job.status === 'dispatching'
      && Number.isFinite(leaseUntil)
      && leaseUntil > now.getTime();
    if (leaseActive || !['queued', 'dispatch_failed', 'dispatching'].includes(job.status)) {
      result = { acquired: false, status: leaseActive ? 'joined' : job.status };
      return;
    }
    const dispatchToken = crypto.randomBytes(12).toString('hex');
    await reference.update({ data: {
      status: 'dispatching',
      dispatchToken,
      dispatchRequestedAt: job.dispatchRequestedAt || now.toISOString(),
      dispatchLeaseUntil: new Date(now.getTime() + DISPATCH_LEASE_MS).toISOString(),
      updatedAt: now.toISOString(),
    } });
    result = { acquired: true, status: 'dispatching', dispatchToken };
  });
  return result;
}

async function markDispatchAccepted(database, jobId, dispatchToken, requestId, now = new Date()) {
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(JOB_COLLECTION).doc(jobId);
    const current = await readDocument(reference);
    if (!current || current.dispatchToken !== dispatchToken) return;
    await reference.update({ data: {
      ...(current.status === 'dispatching' ? { status: 'dispatched' } : {}),
      dispatchRequestId: readText(requestId),
      dispatchAcceptedAt: now.toISOString(),
      dispatchLeaseUntil: '',
      updatedAt: now.toISOString(),
    } });
  });
}

async function reserveJob(database, draft) {
  let result;
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(JOB_COLLECTION).doc(draft.jobId);
    const current = await readDocument(reference);
    if (current) {
      if (current._openid !== draft._openid
        || current.batchId !== draft.batchId
        || current.rendererVersion !== draft.rendererVersion
        || current.inputIdentityHash !== draft.inputIdentityHash
        || JSON.stringify(current.order) !== JSON.stringify(draft.order)) {
        throw new Error('COPY_JOB_IDENTITY_CONFLICT');
      }
      const currentFingerprints = (current.entries || []).map((entry) => entry.renderInputFingerprint);
      const draftFingerprints = draft.entries.map((entry) => entry.renderInputFingerprint);
      if (JSON.stringify(currentFingerprints) !== JSON.stringify(draftFingerprints)) {
        throw new Error('COPY_JOB_IDENTITY_CONFLICT');
      }
      result = { created: false, job: current };
      return;
    }
    await reference.set({ data: draft });
    result = { created: true, job: draft };
  });
  return result;
}

async function acquireRecommendationCopyJob(database, jobId, dispatchToken, now = new Date()) {
  let result;
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(JOB_COLLECTION).doc(jobId);
    const job = await readDocument(reference);
    if (!job || job.version !== JOB_VERSION) {
      result = { acquired: false, status: 'not_found' };
      return;
    }
    if (!dispatchToken || job.dispatchToken !== dispatchToken) {
      result = { acquired: false, status: 'unauthorized' };
      return;
    }
    if (['completed', 'partially_completed', 'ready_cache_hit'].includes(job.status)) {
      result = { acquired: false, status: job.status, job };
      return;
    }
    const leaseUntil = Date.parse(job.leaseUntil || '');
    if (job.status === 'running' && Number.isFinite(leaseUntil) && leaseUntil > now.getTime()) {
      result = { acquired: false, status: 'joined', job };
      return;
    }
    const leaseToken = crypto.randomBytes(12).toString('hex');
    const next = {
      ...job,
      status: 'running',
      leaseToken,
      leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
      startedAt: job.startedAt || now.toISOString(),
      workerStartedAt: job.workerStartedAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await reference.set({ data: next });
    result = { acquired: true, status: 'running', leaseToken, job: next };
  });
  return result;
}

async function persistValidatedCanonicalCopy(database, job, entry, copy, now = new Date()) {
  if (!job || !entry || entry.cacheId !== buildCacheIdentity({
    openid: job._openid,
    rendererVersion: job.rendererVersion,
    renderInputFingerprint: entry.renderInputFingerprint,
  })) throw new Error('CANONICAL_CACHE_IDENTITY_INVALID');
  const document = {
    version: 'recommendation-canonical-copy-cache-v2.0',
    rendererVersion: job.rendererVersion,
    cacheId: entry.cacheId,
    _openid: job._openid,
    renderInputFingerprint: entry.renderInputFingerprint,
    planId: entry.preparedEntry.plan.planId,
    planHash: entry.preparedEntry.plan.planHash,
    text: readText(copy?.text),
    source: 'ai_cache',
    availableAt: now.toISOString(),
  };
  if (!document.text) throw new Error('CANONICAL_CACHE_TEXT_MISSING');
  let persisted;
  await database.runTransaction(async (transaction) => {
    const cacheReference = transaction.collection(CACHE_COLLECTION).doc(entry.cacheId);
    const currentCache = await readDocument(cacheReference);
    if (currentCache) {
      if (currentCache._openid !== document._openid
        || currentCache.rendererVersion !== document.rendererVersion
        || currentCache.renderInputFingerprint !== document.renderInputFingerprint) {
        throw new Error('CANONICAL_CACHE_IDENTITY_CONFLICT');
      }
      persisted = currentCache;
    } else {
      await cacheReference.set({ data: document });
      persisted = document;
    }
    if (job.jobId) {
      const jobReference = transaction.collection(JOB_COLLECTION).doc(job.jobId);
      const currentJob = await readDocument(jobReference);
      if (!currentJob || currentJob._openid !== job._openid
        || currentJob.rendererVersion !== job.rendererVersion) {
        throw new Error('COPY_JOB_IDENTITY_CONFLICT');
      }
      const readyCopies = mergeReadyCopies(currentJob.readyCopies, [toOverlayCopy(entry, persisted)]);
      await jobReference.update({ data: {
        readyCopies,
        firstCanonicalWrittenAt: currentJob.firstCanonicalWrittenAt || now.toISOString(),
        updatedAt: now.toISOString(),
      } });
    }
  });
  return persisted;
}

async function publishCachedCanonicalCopies(database, job, copies, now = new Date()) {
  const byCacheId = new Map((Array.isArray(copies) ? copies : []).map((copy) => [copy.cacheId, copy]));
  const ready = (job.entries || []).flatMap((entry) => {
    const copy = byCacheId.get(entry.cacheId);
    return copy ? [toOverlayCopy(entry, copy)] : [];
  });
  if (ready.length === 0) return [];
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(JOB_COLLECTION).doc(job.jobId);
    const current = await readDocument(reference);
    if (!current || current._openid !== job._openid || current.rendererVersion !== job.rendererVersion) {
      throw new Error('COPY_JOB_IDENTITY_CONFLICT');
    }
    await reference.update({ data: {
      readyCopies: mergeReadyCopies(current.readyCopies, ready),
      updatedAt: now.toISOString(),
    } });
  });
  return ready;
}

async function finishRecommendationCopyJob(database, job, leaseToken, summary, now = new Date()) {
  const reference = database.collection(JOB_COLLECTION).doc(job.jobId);
  const current = await readDocument(reference);
  if (!current || current.leaseToken !== leaseToken || current.rendererVersion !== job.rendererVersion) {
    return { updated: false, stale: true };
  }
  const readyCount = Math.max(0, Number(summary?.readyCount) || 0) + Math.max(0, Number(job.cacheHitCount) || 0);
  const invalidCount = Math.max(0, Number(summary?.invalidCount) || 0);
  const expectedCount = Array.isArray(job.entries) ? job.entries.length : 0;
  const status = readyCount === expectedCount
    ? 'completed'
    : readyCount > 0 ? 'partially_completed' : 'failed_open';
  const failedStage = status === 'completed' ? '' : readText(summary?.failedStage);
  const failureCode = status === 'completed' ? '' : readText(summary?.failureCode);
  await reference.update({ data: {
    status,
    readyCount,
    invalidCount,
    failedStage,
    failureCode,
    completedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    leaseUntil: '',
  } });
  return { updated: true, stale: false, status, readyCount, invalidCount };
}

async function markRecommendationCopyJobProgress(database, job, leaseToken, field, now = new Date()) {
  if (!['providerStartedAt', 'firstValidatedAt'].includes(field)) {
    throw new Error('COPY_JOB_PROGRESS_FIELD_INVALID');
  }
  let updated = false;
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(JOB_COLLECTION).doc(job.jobId);
    const current = await readDocument(reference);
    if (!current || current._openid !== job._openid
      || current.rendererVersion !== job.rendererVersion
      || current.leaseToken !== leaseToken) return;
    if (readText(current[field])) {
      updated = true;
      return;
    }
    await reference.update({ data: {
      [field]: now.toISOString(),
      updatedAt: now.toISOString(),
    } });
    updated = true;
  });
  return updated;
}

async function readRecommendationCopyOverlay(database, openid, batchId, rendererVersion) {
  const jobId = buildJobIdentity({ openid, batchId, rendererVersion });
  const job = await readDocument(database.collection(JOB_COLLECTION).doc(jobId));
  if (job && (job._openid !== openid || job.batchId !== batchId || job.rendererVersion !== rendererVersion)) {
    throw new Error('COPY_JOB_IDENTITY_CONFLICT');
  }
  if (!job) return { version: JOB_VERSION, rendererVersion, batchId, status: 'not_found', copies: [] };
  const overlay = mergeReadyCopies([], job.readyCopies).filter((copy) => (
    (job.entries || []).some((entry) => entry.outfitKey === copy.outfitKey && entry.position === copy.cardIndex)
  ));
  return {
    version: JOB_VERSION,
    rendererVersion,
    batchId,
    status: overlay.length === job.entries.length ? 'ready' : overlay.length > 0 ? 'partial' : 'pending',
    expectedCount: job.entries.length,
    readyCount: overlay.length,
    jobStage: deriveJobStage(job),
    copies: overlay,
  };
}

async function readCachedCopies(database, openid, rendererVersion, entries) {
  const cacheIds = (Array.isArray(entries) ? entries : []).map((entry) => entry.cacheId).filter(Boolean);
  if (cacheIds.length === 0) return [];
  const copies = await Promise.all(cacheIds.map((cacheId) => (
    readDocument(database.collection(CACHE_COLLECTION).doc(cacheId))
  )));
  return copies.filter((copy) => (
    copy
      && copy._openid === openid
      && copy.rendererVersion === rendererVersion
      && copy.source === 'ai_cache'
      && cacheIds.includes(copy.cacheId)
      && readText(copy.text)
  ));
}

async function markDispatchFailure(database, jobId, dispatchToken, error, now = new Date()) {
  try {
    await database.runTransaction(async (transaction) => {
      const reference = transaction.collection(JOB_COLLECTION).doc(jobId);
      const current = await readDocument(reference);
      if (!current || current.dispatchToken !== dispatchToken || current.status !== 'dispatching') return;
      await reference.update({ data: {
        status: 'dispatch_failed',
        dispatchFailureCode: readErrorCode(error),
        failedStage: 'dispatch',
        failureCode: readErrorCode(error),
        dispatchLeaseUntil: '',
        updatedAt: now.toISOString(),
      } });
    });
  } catch { /* Recommendation remains fail-open even if diagnostics cannot be updated. */ }
}

function deriveJobStage(job) {
  if (readText(job?.failedStage)) return `failed:${readText(job.failedStage)}`;
  if (readText(job?.completedAt)) return 'completed';
  if (readText(job?.firstCanonicalWrittenAt)) return 'first_canonical_written';
  if (readText(job?.firstValidatedAt)) return 'first_validated';
  if (readText(job?.providerStartedAt)) return 'provider_started';
  if (readText(job?.workerStartedAt || job?.startedAt)) return 'worker_started';
  if (readText(job?.dispatchAcceptedAt)) return 'dispatch_accepted';
  if (readText(job?.dispatchRequestedAt)) return 'dispatch_requested';
  return readText(job?.status) || 'created';
}

async function readDocument(reference) {
  try {
    const response = await reference.get();
    return response?.data || null;
  } catch (error) {
    if (/not exist|not found|DATABASE_REQUEST_FAILED/i.test(String(error?.message || error))) return null;
    throw error;
  }
}

function toOverlayCopy(entry, copy) {
  return {
    outfitKey: entry.outfitKey,
    cardIndex: entry.position,
    text: copy.text,
    source: 'ai_cache',
    availableAt: copy.availableAt,
    rendererVersion: copy.rendererVersion,
  };
}

function mergeReadyCopies(current, additions) {
  const byIdentity = new Map();
  for (const copy of [...(Array.isArray(current) ? current : []), ...(Array.isArray(additions) ? additions : [])]) {
    if (!copy || copy.source !== 'ai_cache' || !readText(copy.outfitKey)
      || !Number.isInteger(copy.cardIndex) || !readText(copy.text)) continue;
    byIdentity.set(`${copy.cardIndex}|${copy.outfitKey}`, copy);
  }
  return [...byIdentity.values()].sort((left, right) => left.cardIndex - right.cardIndex);
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function readText(value) { return typeof value === 'string' ? value.trim() : ''; }
function readErrorCode(error) {
  return readText(error?.code || error?.message || 'COPY_JOB_UNKNOWN')
    .replace(/[^A-Z0-9_:.-]/gi, '_')
    .slice(0, 80);
}

module.exports = {
  CACHE_COLLECTION,
  DISPATCH_LEASE_MS,
  JOB_COLLECTION,
  JOB_VERSION,
  LEASE_MS,
  STORAGE_COLLECTIONS,
  acquireRecommendationCopyJob,
  buildCacheIdentity,
  buildJobIdentity,
  finishRecommendationCopyJob,
  ensureRecommendationCopyCollections,
  markRecommendationCopyJobProgress,
  normalizeJobEntries,
  persistValidatedCanonicalCopy,
  publishCachedCanonicalCopies,
  prepareRecommendationCopyJob,
  readCachedCopies,
  readRecommendationCopyOverlay,
};
