'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureDevToolsDirectSession } = require('./devtools-direct-session');
const { createAdmin } = require('./production-first-card-smoke/admin');
const { readContext } = require('./production-first-card-smoke/wechat');
const { extractAudit, buildAttribution } = require('./production-first-card-smoke/evidence');

const ENV_ID = 'cloud1-d8gl3k1vkdf0b7f05';
const ROOT = path.resolve(__dirname, '../../..');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts/today-first-card-visible-acceptance');
const SAMPLE_COUNT = 3;
const MAX_ATTEMPTS = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function summarize(values) {
  const ordered = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (ordered.length !== SAMPLE_COUNT) throw new Error('VISIBLE_SAMPLE_COUNT_INVALID');
  return { min: round(ordered[0]), median: round(ordered[1]), max: round(ordered[2]) };
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
    const record = [...observation.timings].reverse().find((entry) => entry.complete === true
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
    if (Number.isFinite(attribution.serverResponseReadyMs)) {
      return { serverResponseReadyMs: round(attribution.serverResponseReadyMs), requestId: logs[0]?.requestId || null };
    }
    await sleep(4000);
  } while (Date.now() < deadline);
  throw new Error('SERVER_RESPONSE_READY_NOT_OBSERVED');
}

function validateTiming(record) {
  const ordered = [
    record.clientResponseReceivedMs,
    record.stateCommitMs,
    record.contentVisibleMs,
    record.imageLoadMs,
    record.imageVisibleMs,
  ];
  if (!record.auditId || !record.batchId || !record.outfitKey || !Number.isInteger(record.seq)
    || ordered.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)
    || Number(record.stateCommitMs) < Number(record.clientResponseReceivedMs)
    || Number(record.contentVisibleMs) < Number(record.stateCommitMs)
    || Number(record.imageVisibleMs) < Number(record.imageLoadMs)) {
    throw new Error('VISIBLE_TIMING_INVARIANT_FAILED');
  }
}

async function runAcceptance() {
  const session = await ensureDevToolsDirectSession();
  const mini = session.mini;
  const directory = path.join(ARTIFACT_ROOT, runId('visible'));
  fs.mkdirSync(directory, { recursive: true });
  const report = {
    schemaVersion: 'today-first-card-visible-acceptance/v1',
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    method: 'real Today + performance.now + wx.nextTick + SelectorQuery + Image.onLoad + correlated CLS audit',
    samples: [],
  };
  try {
    if (typeof mini.reLaunch !== 'function') throw new Error('DEVTOOLS_RELAUNCH_UNAVAILABLE');
    await mini.reLaunch('/pages/today/index');
    let bridge = await waitForBridge(mini);
    await readContext(mini, ENV_ID);
    const admin = createAdmin({ envId: ENV_ID });
    const sceneKey = bridge.snapshot?.sceneKey;
    const seenBatchIds = new Set();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && report.samples.length < SAMPLE_COUNT; attempt += 1) {
      bridge = await waitForBridge(mini);
      if (bridge.snapshot?.sceneKey !== sceneKey) throw new Error('VISIBLE_SCENE_CHANGED');
      const previousBatchId = bridge.snapshot?.recommendationBatchId || null;
      const acceptanceRunId = runId(`visible-${attempt}`);
      const wallStart = Date.now();
      const clientStart = await mini.evaluate(() => {
        const perf = globalThis.performance;
        return typeof perf?.now === 'function' ? perf.now() : Date.now();
      });
      const triggered = await mini.evaluate(async (payload) => {
        const bridge = globalThis.__d1dTodayDiagnostics;
        if (!bridge?.ready || typeof bridge.triggerFullCompute !== 'function') return false;
        return bridge.triggerFullCompute(payload);
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
      seenBatchIds.add(visible.record.batchId);
      report.samples.push({
        sample: report.samples.length + 1,
        auditId: visible.record.auditId,
        seq: visible.record.seq,
        sceneKey,
        batchId: visible.record.batchId,
        outfitKey: visible.record.outfitKey,
        serverResponseReadyMs: server.serverResponseReadyMs,
        clientResponseReceivedMs: round(visible.record.clientResponseReceivedMs),
        stateCommitMs: round(visible.record.stateCommitMs),
        contentVisibleMs: round(visible.record.contentVisibleMs),
        imageLoadMs: round(visible.record.imageLoadMs),
        imageVisibleMs: round(visible.record.imageVisibleMs),
        serverRequestId: server.requestId,
      });
    }
    if (report.samples.length !== SAMPLE_COUNT) throw new Error('VISIBLE_VALID_SAMPLE_LIMIT_REACHED');
    const content = summarize(report.samples.map((sample) => sample.contentVisibleMs));
    const image = summarize(report.samples.map((sample) => sample.imageVisibleMs));
    const serverToContent = summarize(report.samples.map((sample) => sample.contentVisibleMs - sample.serverResponseReadyMs));
    const contentToImage = summarize(report.samples.map((sample) => sample.imageVisibleMs - sample.contentVisibleMs));
    report.summary = { content, image, serverToContent, contentToImage };
    report.productPerformanceResult = content.max < 3000 && contentToImage.max < 1000 ? 'PASS' : 'FAIL';
    report.clientPrimaryBottleneck = content.max >= 3000
      ? 'STATE_RENDER_PATH'
      : contentToImage.max >= 1000 ? 'IMAGE_PIPELINE' : 'NONE';
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

if (require.main === module) {
  runAcceptance()
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.stack || error}\nEVIDENCE=${error?.evidence || 'NOT_WRITTEN'}\n`);
      process.exitCode = 1;
    });
}

module.exports = { MAX_ATTEMPTS, SAMPLE_COUNT, round, summarize, validateTiming, runAcceptance };
