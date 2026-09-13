'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureDevToolsDirectSession } = require('./devtools-direct-session');
const { createAdmin } = require('./production-first-card-smoke/admin');
const { readContext } = require('./production-first-card-smoke/wechat');
const { extractAudit, buildAttribution } = require('./production-first-card-smoke/evidence');
const {
  TERMINAL_STATUSES,
  createCleanupPlan,
  hash,
  validateCleanupPlan,
} = require('./production-first-card-smoke/safety');

const ENV_ID = 'cloud1-d8gl3k1vkdf0b7f05';
const ROOT = path.resolve(__dirname, '../../..');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts/today-first-card-visible-acceptance');
const SAMPLE_COUNT = 3;
const MAX_ATTEMPTS = 5;
const ACCEPTANCE_MODES = new Set(['observed', 'hit', 'miss']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function roundOptional(value) {
  return Number.isFinite(Number(value)) ? round(value) : null;
}

function summarize(values) {
  const ordered = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (ordered.length !== SAMPLE_COUNT) throw new Error('VISIBLE_SAMPLE_COUNT_INVALID');
  return { min: round(ordered[0]), median: round(ordered[1]), p95: round(ordered[2]), max: round(ordered[2]) };
}

function rate(samples, predicate) {
  return samples.length ? round(samples.filter(predicate).length / samples.length) : null;
}

function auditTime(audit, stage) {
  const runtime = (audit.performanceStages || []).find((entry) => entry.stage === stage
    && Number.isFinite(entry.elapsedMs));
  if (runtime) return round(runtime.elapsedMs);
  const firstCard = (audit.stages || []).find((entry) => entry.stage === stage
    && Number.isFinite(entry.elapsedFromHandlerMs));
  return firstCard ? round(firstCard.elapsedFromHandlerMs) : null;
}

function summarizeAiFirst(samples) {
  const providerSamples = samples.filter((sample) => Number.isFinite(sample.providerStartMs));
  const planToProvider = providerSamples.filter((sample) => Number.isFinite(sample.plan0ReadyMs)
    && Number.isFinite(sample.providerStartMs));
  const providerToValidated = providerSamples.filter((sample) => Number.isFinite(sample.providerStartMs)
    && Number.isFinite(sample.firstValidatedMs));
  return {
    AI_REASON_FIRST_VISIBLE_RATE: rate(samples, (sample) => ['CANONICAL_HIT', 'PROVIDER_FRESH'].includes(sample.copySource)),
    SAFE_COPY_FALLBACK_RATE: rate(samples, (sample) => sample.copySource === 'SAFE_COPY'),
    CANONICAL_HIT_RATE_IN_TEST: rate(samples, (sample) => sample.copySource === 'CANONICAL_HIT'),
    PROVIDER_FRESH_RATE: rate(samples, (sample) => sample.copySource === 'PROVIDER_FRESH'),
    SAFE_DEADLINE_RATE: rate(samples, (sample) => sample.fallbackReason === 'SAFE_DEADLINE'),
    SAFE_PROVIDER_ERROR_RATE: rate(samples, (sample) => sample.fallbackReason === 'SAFE_PROVIDER_ERROR'),
    SAFE_VALIDATION_FAILED_RATE: rate(samples, (sample) => sample.fallbackReason === 'SAFE_VALIDATION_FAILED'),
    PLAN0_TO_PROVIDER_START: planToProvider.length === SAMPLE_COUNT
      ? summarize(planToProvider.map((sample) => sample.providerStartMs - sample.plan0ReadyMs))
      : null,
    PROVIDER_START_TO_FIRST_VALIDATED: providerToValidated.length === SAMPLE_COUNT
      ? summarize(providerToValidated.map((sample) => sample.firstValidatedMs - sample.providerStartMs))
      : null,
  };
}

function mergeJobTailTimings(sample, job) {
  if (!sample || !job || sample.auditId !== job.auditId || sample.batchId !== job.batchId) {
    throw new Error('VISIBLE_JOB_AUDIT_MISMATCH');
  }
  const path = job.runtimeAuditV1?.firstCardAiCriticalPath;
  if (!path || path.origin !== 'handler_monotonic' || path.schemaVersion !== 1) {
    throw new Error('VISIBLE_JOB_RUNTIME_AUDIT_MISSING');
  }
  const timings = path.timingsMs || {};
  return {
    ...sample,
    plan0ReadyMs: Number.isFinite(timings.plan0ReadyMs) ? round(timings.plan0ReadyMs) : sample.plan0ReadyMs,
    providerStartMs: Number.isFinite(timings.providerStartMs) ? round(timings.providerStartMs) : sample.providerStartMs,
    providerHeadersMs: Number.isFinite(timings.providerHeadersMs) ? round(timings.providerHeadersMs) : sample.providerHeadersMs,
    firstValidatedMs: Number.isFinite(timings.firstValidatedMs) ? round(timings.firstValidatedMs) : sample.firstValidatedMs,
    providerCompleteMs: Number.isFinite(timings.providerCompleteMs) ? round(timings.providerCompleteMs) : sample.providerCompleteMs,
    tailJobStatus: job.status,
    tailRuntimeAuditObserved: true,
  };
}

function parseCliArgs(args) {
  let mode = 'observed';
  let valid = args.shift() === '--live';
  while (valid && args.length > 0) {
    const option = args.shift();
    const value = args.shift();
    if (option === '--mode' && ACCEPTANCE_MODES.has(value)) mode = value;
    else valid = false;
  }
  return { valid, mode };
}

function validateExpectedMode(mode, server) {
  if (!ACCEPTANCE_MODES.has(mode)) throw new Error('VISIBLE_ACCEPTANCE_MODE_INVALID');
  const providerStarts = (server?.audit?.stages || [])
    .filter((entry) => entry.stage === 'PROVIDER_START' && entry.status === 'started').length;
  if (mode === 'hit' && (server?.summary?.copySource !== 'CANONICAL_HIT' || providerStarts !== 0)) {
    throw new Error('VISIBLE_EXPECTED_CANONICAL_HIT');
  }
  if (mode === 'miss' && (server?.summary?.copySource === 'CANONICAL_HIT' || providerStarts !== 1)) {
    throw new Error('VISIBLE_EXPECTED_CANONICAL_MISS');
  }
}

async function waitForBridge(mini, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const state = await mini.evaluate(() => {
      const bridge = globalThis.__d1dTodayDiagnostics;
      return {
        ready: bridge?.ready === true,
        visibleTimingReader: typeof bridge?.readRecommendationVisibleTimings === 'function',
        snapshot: bridge?.readCopyAcceptanceState?.() || null,
      };
    });
    if (state?.ready && state.visibleTimingReader) return state;
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error('VISIBLE_TIMING_BRIDGE_UNAVAILABLE');
}

async function waitForVisibleTiming(mini, { previousBatchId, seenBatchIds, startedAfter }, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const observation = await mini.evaluate(() => {
      const bridge = globalThis.__d1dTodayDiagnostics;
      return {
        timings: bridge?.readRecommendationVisibleTimings?.() || [],
        snapshot: bridge?.readCopyAcceptanceState?.() || null,
      };
    });
    const record = [...observation.timings].reverse().find((entry) => Number.isFinite(Number(entry.contentVisibleMs))
      && entry.batchId !== previousBatchId
      && !seenBatchIds.has(entry.batchId)
      && Number(entry.requestStart) >= startedAfter);
    const firstCard = observation.snapshot?.cards?.[0];
    if (record && observation.snapshot?.recommendationBatchId === record.batchId
      && firstCard?.outfitKey === record.outfitKey) return { record, snapshot: observation.snapshot };
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error('FIRST_CARD_VISIBLE_TIMING_TIMEOUT');
}

async function waitForServerReady(admin, auditId, startTime, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const logs = await admin.getAuditLogs({
      auditId,
      startTime: startTime - 5000,
      endTime: Date.now() + 1000,
    });
    const audit = extractAudit(logs, auditId);
    const attribution = buildAttribution(audit);
    const summary = audit.summaries.find((entry) => entry.snapshot === 'response') || audit.summaries.at(-1);
    if (summary?.copySource) {
      return {
        audit,
        summary,
        serverResponseReadyMs: roundOptional(attribution.serverResponseReadyMs),
        serverResponseReadyObserved: Number.isFinite(attribution.serverResponseReadyMs),
        requestId: logs[0]?.requestId || null,
      };
    }
    await sleep(4000);
  } while (Date.now() < deadline);
  throw new Error('SERVER_RESPONSE_READY_NOT_OBSERVED');
}

async function waitForTerminalJob(admin, openid, batchId, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const job = await admin.getJob({ openid, batchId });
    if (job && TERMINAL_STATUSES.has(job.status)) return job;
    await sleep(2000);
  } while (Date.now() < deadline);
  throw new Error('VISIBLE_JOB_NOT_TERMINAL');
}

async function prepareExactMiss({ admin, context, mini, observation, directory, resetIndex }) {
  const job = await waitForTerminalJob(admin, context.openid, observation.record.batchId);
  const firstEntry = job.entries?.find((entry) => entry.position === 0);
  if (!firstEntry) throw new Error('VISIBLE_FIRST_JOB_ENTRY_MISSING');
  const cache = await admin.getCache({ openid: context.openid, cacheId: firstEntry.cacheId });
  const jobs = await admin.listRelatedJobs({ openid: context.openid, cacheId: firstEntry.cacheId });
  const planInput = {
    openid: context.openid,
    batchId: observation.record.batchId,
    rendererVersion: job.rendererVersion,
    firstOutfitKey: observation.record.outfitKey,
    job,
    cache,
    jobs,
  };
  const plan = createCleanupPlan(planInput);
  const backup = { environmentId: ENV_ID, plan, document: cache };
  const backupName = `cache-backup-${resetIndex}.private.json`;
  fs.writeFileSync(path.join(directory, backupName), `${JSON.stringify(backup, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const currentContext = await readContext(mini, ENV_ID);
  if (currentContext.openid !== context.openid) throw new Error('VISIBLE_WECHAT_USER_CHANGED');
  const current = await admin.getCache({ openid: context.openid, cacheId: plan.target._id });
  const freshJob = await admin.getJob({ openid: context.openid, batchId: observation.record.batchId });
  const freshJobs = await admin.listRelatedJobs({ openid: context.openid, cacheId: plan.target._id });
  createCleanupPlan({ ...planInput, job: freshJob, cache: current, jobs: freshJobs });
  const validation = validateCleanupPlan(plan, { cache: current });
  let deleted = 0;
  if (validation.remove) {
    deleted = await admin.removeSingleCache({
      openid: context.openid,
      cacheId: plan.target._id,
      expectedDoc: current,
    });
    if (deleted !== 1) throw new Error('VISIBLE_CACHE_DELETE_NOT_EXACTLY_ONE');
  }
  if (await admin.getCache({ openid: context.openid, cacheId: plan.target._id })) {
    throw new Error('VISIBLE_CACHE_REAPPEARED_BEFORE_SAMPLE');
  }
  return {
    action: plan.action,
    backup: backupName,
    backupSha256: hash(JSON.stringify(backup)),
    deleted,
    verifiedAbsent: true,
  };
}

function validateCopyObservation(firstCard, summary) {
  const source = summary?.copySource;
  if (!['CANONICAL_HIT', 'PROVIDER_FRESH', 'SAFE_COPY'].includes(source)) {
    throw new Error('VISIBLE_COPY_SOURCE_INVALID');
  }
  const fallback = summary?.fallbackReason || null;
  if (source === 'SAFE_COPY') {
    if (!['SAFE_DEADLINE', 'SAFE_PROVIDER_ERROR', 'SAFE_VALIDATION_FAILED'].includes(fallback)
      || firstCard?.copySource !== 'safe') throw new Error('VISIBLE_SAFE_COPY_MISMATCH');
  } else if (fallback !== null || firstCard?.copySource !== 'ai_cache' || firstCard?.aiState !== 'ready') {
    throw new Error('VISIBLE_AI_COPY_MISMATCH');
  }
}

function validateTiming(record) {
  const contentOrdered = [
    record.clientResponseReceivedMs,
    record.stateCommitMs,
    record.contentVisibleMs,
  ];
  if (!record.auditId || !record.batchId || !record.outfitKey || !Number.isInteger(record.seq)
    || contentOrdered.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)
    || Number(record.stateCommitMs) < Number(record.clientResponseReceivedMs)
    || Number(record.contentVisibleMs) < Number(record.stateCommitMs)) {
    throw new Error('VISIBLE_TIMING_INVARIANT_FAILED');
  }
  const imageObserved = Number.isFinite(Number(record.imageLoadMs))
    || Number.isFinite(Number(record.imageVisibleMs));
  if (imageObserved && (!Number.isFinite(Number(record.imageLoadMs))
    || !Number.isFinite(Number(record.imageVisibleMs))
    || Number(record.imageVisibleMs) < Number(record.imageLoadMs))) {
    throw new Error('VISIBLE_TIMING_INVARIANT_FAILED');
  }
}

async function runAcceptance({ mode = 'observed' } = {}) {
  if (!ACCEPTANCE_MODES.has(mode)) throw new Error('VISIBLE_ACCEPTANCE_MODE_INVALID');
  const session = await ensureDevToolsDirectSession();
  const mini = session.mini;
  const directory = path.join(ARTIFACT_ROOT, runId('visible'));
  fs.mkdirSync(directory, { recursive: true });
  const report = {
    schemaVersion: 'today-first-card-visible-acceptance/v1',
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    mode,
    method: 'real Today + performance.now + wx.nextTick + SelectorQuery + Image.onLoad + correlated CLS audit',
    samples: [],
  };
  try {
    if (typeof mini.reLaunch !== 'function') throw new Error('DEVTOOLS_RELAUNCH_UNAVAILABLE');
    await mini.reLaunch('/pages/today/index');
    let bridge = await waitForBridge(mini);
    const context = await readContext(mini, ENV_ID);
    const admin = createAdmin({ envId: ENV_ID });
    const sceneKey = bridge.snapshot?.sceneKey;
    const seenBatchIds = new Set();
    let latestObservation = null;
    const observeRequest = async ({ attempt, counted }) => {
      bridge = await waitForBridge(mini);
      if (bridge.snapshot?.sceneKey !== sceneKey) throw new Error('VISIBLE_SCENE_CHANGED');
      const previousBatchId = bridge.snapshot?.recommendationBatchId || null;
      const acceptanceRunId = runId(`visible-${counted ? 'sample' : 'warmup'}-${attempt}`);
      const wallStart = Date.now();
      const clientStart = await mini.evaluate(() => {
        const perf = globalThis.performance;
        return typeof perf?.now === 'function' ? perf.now() : Date.now();
      });
      const triggered = await mini.evaluate(async (payload) => {
        const diagnostics = globalThis.__d1dTodayDiagnostics;
        if (!diagnostics?.ready || typeof diagnostics.triggerFullCompute !== 'function') return false;
        return diagnostics.triggerFullCompute(payload);
      }, {
        acceptanceRunId,
        captureId: `${acceptanceRunId}-capture`,
        performanceDiagnostics: true,
      });
      if (triggered !== true) throw new Error('VISIBLE_RECOMMENDATION_TRIGGER_REJECTED');
      const visible = await waitForVisibleTiming(mini, {
        previousBatchId,
        seenBatchIds,
        startedAfter: Number(clientStart),
      });
      validateTiming(visible.record);
      if (visible.snapshot.sceneKey !== sceneKey || visible.snapshot.cards?.length !== 8) {
        throw new Error('VISIBLE_BATCH_PRODUCT_STATE_INVALID');
      }
      const server = await waitForServerReady(admin, visible.record.auditId, wallStart);
      validateCopyObservation(visible.snapshot.cards?.[0], server.summary);
      seenBatchIds.add(visible.record.batchId);
      return { visible, server };
    };

    if (mode !== 'observed') {
      latestObservation = (await observeRequest({ attempt: 0, counted: false })).visible;
      if (mode === 'hit') await waitForTerminalJob(admin, context.openid, latestObservation.record.batchId);
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && report.samples.length < SAMPLE_COUNT; attempt += 1) {
      if (mode === 'miss') {
        const reset = await prepareExactMiss({
          admin,
          context,
          mini,
          observation: latestObservation,
          directory,
          resetIndex: report.samples.length + 1,
        });
        report.cacheResets ||= [];
        report.cacheResets.push(reset);
      }
      const observation = await observeRequest({ attempt, counted: true });
      const { visible, server } = observation;
      validateExpectedMode(mode, server);
      latestObservation = visible;
      let sample = {
        sample: report.samples.length + 1,
        auditId: visible.record.auditId,
        seq: visible.record.seq,
        sceneKey,
        batchId: visible.record.batchId,
        outfitKey: visible.record.outfitKey,
        serverResponseReadyMs: server.serverResponseReadyMs,
        serverResponseReadyObserved: server.serverResponseReadyObserved,
        clientResponseReceivedMs: round(visible.record.clientResponseReceivedMs),
        stateCommitMs: round(visible.record.stateCommitMs),
        contentVisibleMs: round(visible.record.contentVisibleMs),
        imageLoadMs: roundOptional(visible.record.imageLoadMs),
        imageVisibleMs: roundOptional(visible.record.imageVisibleMs),
        copySource: server.summary.copySource,
        fallbackReason: server.summary.fallbackReason || null,
        pageCopySource: visible.snapshot.cards[0].copySource,
        pageAiState: visible.snapshot.cards[0].aiState,
        firstVisibleReasonSha256: crypto.createHash('sha256')
          .update(String(visible.snapshot.cards[0].todayReason || ''))
          .digest('hex'),
        plan0ReadyMs: auditTime(server.audit, 'PLAN0_READY'),
        providerStartMs: auditTime(server.audit, 'PROVIDER_START'),
        providerHeadersMs: auditTime(server.audit, 'PROVIDER_HEADERS'),
        firstValidatedMs: auditTime(server.audit, 'FIRST_VALIDATED'),
        providerCompleteMs: auditTime(server.audit, 'PROVIDER_COMPLETE'),
        homeReadyMs: auditTime(server.audit, 'HOME_READY'),
        serverRequestId: server.requestId,
      };
      if (mode === 'miss') {
        const job = await waitForTerminalJob(admin, context.openid, visible.record.batchId);
        sample = mergeJobTailTimings(sample, job);
      }
      report.samples.push(sample);
    }
    if (report.samples.length !== SAMPLE_COUNT) throw new Error('VISIBLE_VALID_SAMPLE_LIMIT_REACHED');
    const content = summarize(report.samples.map((sample) => sample.contentVisibleMs));
    const imageValues = report.samples.map((sample) => sample.imageVisibleMs).filter(Number.isFinite);
    const image = imageValues.length === SAMPLE_COUNT ? summarize(imageValues) : null;
    const serverReadyValues = report.samples.map((sample) => sample.serverResponseReadyMs).filter(Number.isFinite);
    const serverToContent = serverReadyValues.length === SAMPLE_COUNT
      ? summarize(report.samples.map((sample) => sample.contentVisibleMs - sample.serverResponseReadyMs))
      : null;
    const contentToImage = imageValues.length === SAMPLE_COUNT
      ? summarize(report.samples.map((sample) => sample.imageVisibleMs - sample.contentVisibleMs))
      : null;
    report.summary = { content, image, serverToContent, contentToImage, ...summarizeAiFirst(report.samples) };
    report.productPerformanceResult = content.max < 3000
      && (contentToImage === null || contentToImage.max < 1000) ? 'PASS' : 'FAIL';
    report.clientPrimaryBottleneck = content.max >= 3000
      ? 'STATE_RENDER_PATH'
      : contentToImage?.max >= 1000 ? 'IMAGE_PIPELINE' : 'NONE';
    report.status = 'PASS';
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    return { ...report, evidence: path.join(directory, 'report.json') };
  } catch (error) {
    report.status = 'FAIL';
    report.errorCode = /^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'VISIBLE_ACCEPTANCE_FAILED';
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    throw Object.assign(error, { evidence: path.join(directory, 'report.json') });
  } finally {
    try { await mini.disconnect(); } catch { /* no-op */ }
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (!cli.valid) {
    process.stdout.write('Usage: node today-first-card-visible-acceptance.js --live [--mode observed|hit|miss]\n');
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  const lockPath = path.join(ARTIFACT_ROOT, 'run.lock');
  const lock = fs.openSync(lockPath, 'wx');
  try {
    const report = await runAcceptance({ mode: cli.mode });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\nEVIDENCE=${error?.evidence || 'NOT_WRITTEN'}\n`);
  process.exitCode = 1;
});

module.exports = {
  MAX_ATTEMPTS,
  SAMPLE_COUNT,
  ACCEPTANCE_MODES,
  auditTime,
  mergeJobTailTimings,
  parseCliArgs,
  prepareExactMiss,
  rate,
  round,
  roundOptional,
  runAcceptance,
  summarize,
  summarizeAiFirst,
  validateCopyObservation,
  validateExpectedMode,
  validateTiming,
  waitForTerminalJob,
};
