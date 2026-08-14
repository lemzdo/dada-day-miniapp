'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hasCurrentNewRecommendationCopy } = require('../src/utils/recommendationCopyContract');
const {
  ensureDevToolsDirectSession,
  TODAY_PERFORMANCE_LEDGER_KEY,
} = require('./devtools-direct-session');

const ARTIFACT_ROOT = path.resolve(__dirname, '../../../artifacts/today-ttui-runtime-v2');
const TRANSPORT_KEY = 'generateOutfit:acceptance-transport:v1';
const PERFORMANCE_KEY = 'generateOutfit:performance-ledger:v1';
const HARD_INVALID_ACCEPTANCE_KEY = 'today:ttui-hard-invalid-acceptance:v1';

function nowId(prefix = 'ttui') {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
}

function readLedger(mini) {
  return mini.evaluate((key) => globalThis.wx?.getStorageSync?.(key) || null, TODAY_PERFORMANCE_LEDGER_KEY);
}

function readSnapshot(mini) {
  return mini.evaluate(() => {
    const info = globalThis.wx?.getStorageInfoSync?.() || { keys: [] };
    const key = (info.keys || []).find((entry) => String(entry).startsWith('d1d:userStorage:v1:') && String(entry).includes('today:outfitReturnSnapshot:recommendation-copy-contract-v8'));
    return key ? globalThis.wx?.getStorageSync?.(key) || null : null;
  });
}

function segmentDurations(record = {}) {
  const s = record.stages || {};
  const d = record.durations || {};
  const duration = (name, start, end) => Number(d[name]) || (Number(s[end]) - Number(s[start])) || 0;
  return {
    clientToCloudMs: duration('generateOutfitRequest', 'generateOutfitRequestStart', 'generateOutfitResponseEnd'),
    clientStateMs: duration('responseToStateUpdate', 'responseAdaptStart', 'setOutfitsCalled') || duration('responseAdapt', 'responseAdaptStart', 'responseAdaptEnd'),
    firstCardPaintMs: duration('actionToFirstCard', 'userActionStart', 'firstCardMounted') || duration('onShowToFirstCard', 'todayOnShow', 'firstCardMounted'),
    firstImagePaintMs: duration('actionToFirstImage', 'userActionStart', 'firstImageLoaded') || duration('onShowToFirstImage', 'todayOnShow', 'firstImageLoaded'),
    usablePaintMs: Number(s.firstImageLoaded || s.firstCardMounted) - Number(s.userActionStart || s.todayOnShow) || 0,
    snapshotReadMs: duration('snapshotRead', 'snapshotReadStart', 'snapshotReadEnd'),
    snapshotValidationMs: duration('snapshotValidation', 'snapshotValidationStart', 'snapshotValidationEnd'),
  };
}

function serverSegments(performance = {}) {
  const runtime = performance.runtimeV2 || {};
  const phases = new Map((performance.phases || []).map((phase) => [phase.phase, Number(phase.duration) || 0]));
  const read = Number(runtime.tReadServerProxyMs) || phases.get('userAndWardrobeRead') || 0;
  const core = Number(runtime.tCorePhaseProxyMs) || (phases.get('candidateGeneration') || 0) + (phases.get('cardCompilation') || 0);
  const safe = Number(runtime.tSafeMs) || 0;
  const total = Number(performance.serverTotalMs) || 0;
  const persistence = Number(performance.snapshotPersistence?.durationMs) || phases.get('snapshotPersistence') || 0;
  return { readMs: read, coreMs: core, safeMs: safe, criticalPersistenceMs: persistence, totalMs: total, aiMs: Number(runtime.tAiNecessaryCriticalPathMs) || 0 };
}

function summarize(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const pick = (p) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : 0;
  return { sampleCount: sorted.length, p50Ms: pick(0.5), p95Ms: pick(0.95), minMs: sorted[0] || 0, maxMs: sorted.at(-1) || 0 };
}

function summarizeArtifacts(artifacts) {
  const rows = artifacts.map((entry) => ({
    clientToCloudMs: Number(entry.clientToCloudMs) || 0,
    readMs: Number(entry.readMs) || 0,
    coreMs: Number(entry.coreMs) || 0,
    safeMs: Number(entry.safeMs) || 0,
    criticalPersistenceMs: Number(entry.criticalPersistenceMs) || 0,
    cloudToClientMs: Math.max(0, (Number(entry.clientTotalMs) || 0) - (Number(entry.serverTotalMs) || 0)),
    clientStateMs: Number(entry.clientStateMs) || 0,
    usablePaintMs: Number(entry.usablePaintMs) || 0,
  }));
  return Object.fromEntries(Object.keys(rows[0] || {}).map((key) => [key, summarize(rows.map((row) => row[key]))]));
}

function writeArtifact(scenario, artifact) {
  const directory = path.join(ARTIFACT_ROOT, scenario, artifact.runId || nowId(scenario));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'measurement.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return directory;
}

async function waitForBridge(mini, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bridge = await mini.evaluate(() => globalThis.__d1dTodayDiagnostics || null);
    if (bridge?.marker === 'd1d-today-production-handler-v1' && bridge.ready === true) return bridge;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('TODAY_DIAGNOSTICS_BRIDGE_TIMEOUT');
}

async function invalidateRestoreSnapshot(mini) {
  return mini.evaluate(() => {
    const info = globalThis.wx?.getStorageInfoSync?.() || { keys: [] };
    const keys = (info.keys || []).filter((key) => String(key).startsWith('d1d:userStorage:v1:') && String(key).includes('today:outfitReturnSnapshot:recommendation-copy-contract-v8'));
    keys.forEach((key) => globalThis.wx?.removeStorageSync?.(key));
    return { removedKeys: keys };
  });
}

async function markHardInvalid(mini, acceptanceRequest) {
  return mini.evaluate((payload) => {
    const info = globalThis.wx?.getStorageInfoSync?.() || { keys: [] };
    const keys = info.keys || [];
    const existingKey = keys.find((entry) => String(entry).startsWith('d1d:userStorage:v1:') && String(entry).includes('today:recommendationInput:hardInvalid'));
    const snapshotKey = keys.find((entry) => String(entry).startsWith('d1d:userStorage:v1:') && String(entry).includes('today:outfitReturnSnapshot:recommendation-copy-contract-v8'));
    const key = existingKey || (snapshotKey
      ? `${String(snapshotKey).split(':today:outfitReturnSnapshot:')[0]}:today:recommendationInput:hardInvalid`
      : null);
    if (key) globalThis.wx?.setStorageSync?.(key, payload?.acceptanceRunId && payload?.captureId
      ? { acceptanceDiagnostics: payload, markedAt: Date.now() }
      : true);
    if (payload?.acceptanceRunId && payload?.captureId) {
      globalThis.wx?.setStorageSync?.('today:ttui-hard-invalid-acceptance:v1', payload);
    }
    return { key, marked: Boolean(key) };
  }, acceptanceRequest);
}

async function prepareHardInvalidAndRelaunch(mini, acceptanceRequest) {
  return mini.evaluate((payload) => {
    const info = globalThis.wx?.getStorageInfoSync?.() || { keys: [] };
    const keys = info.keys || [];
    const snapshotKeys = keys.filter((entry) => String(entry).startsWith('d1d:userStorage:v1:') && String(entry).includes('today:outfitReturnSnapshot:recommendation-copy-contract-v8'));
    const existingKey = keys.find((entry) => String(entry).startsWith('d1d:userStorage:v1:') && String(entry).includes('today:recommendationInput:hardInvalid'));
    const snapshotKey = snapshotKeys[0];
    const key = existingKey || (snapshotKey
      ? `${String(snapshotKey).split(':today:outfitReturnSnapshot:')[0]}:today:recommendationInput:hardInvalid`
      : null);
    if (!key) throw new Error('TTUI_HARD_INVALID_SCOPED_KEY_MISSING');
    globalThis.wx?.setStorageSync?.(key, {
      acceptanceDiagnostics: payload,
      markedAt: Date.now(),
    });
    globalThis.wx?.setStorageSync?.('today:ttui-hard-invalid-acceptance:v1', payload);
    snapshotKeys.forEach((entry) => globalThis.wx?.removeStorageSync?.(entry));
    globalThis.wx?.reLaunch?.({ url: '/pages/today/index' });
    return { key, marked: Boolean(globalThis.wx?.getStorageSync?.(key)), removedKeys: snapshotKeys };
  }, acceptanceRequest);
}

async function waitForTodayIdle(mini, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await mini.evaluate(() => {
      const bridge = globalThis.__d1dTodayDiagnostics;
      return { present: Boolean(bridge), ready: bridge?.ready === true };
    });
    if (!state?.present || state.ready) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('TODAY_DIAGNOSTICS_IDLE_TIMEOUT');
}

async function clearMeasurementState(mini) {
  return mini.evaluate((keys) => {
    keys.forEach((key) => globalThis.wx?.removeStorageSync?.(key));
    return keys;
  }, [TRANSPORT_KEY, PERFORMANCE_KEY, TODAY_PERFORMANCE_LEDGER_KEY, HARD_INVALID_ACCEPTANCE_KEY]);
}

async function prepareValidSnapshot(mini, timeoutMs = 30000) {
  const prepareStartedAt = Date.now();
  const existing = await readSnapshot(mini);
  if (isUsableSnapshot(existing, prepareStartedAt)) return { prepared: false, reason: 'existing_valid_snapshot' };
  if (existing) await invalidateRestoreSnapshot(mini);
  const bridge = await waitForBridge(mini, timeoutMs);
  const runId = nowId('ttui-prepare');
  const triggerResult = await mini.evaluate(async (payload) => globalThis.__d1dTodayDiagnostics.triggerFullCompute(payload), {
    acceptanceRunId: runId, captureId: `${runId}-capture`,
  });
  if (triggerResult === false) {
    const bridgeState = await mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.readCopyAcceptanceState?.() || null);
    throw Object.assign(new Error('TTUI_VALID_SNAPSHOT_PREPARATION_REJECTED'), { bridgeState, triggerResult });
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(mini);
    if (isUsableSnapshot(snapshot, prepareStartedAt) && Number(snapshot.generatedAt) >= prepareStartedAt) {
      return { prepared: true, reason: 'full_compute_completed', sceneKey: bridge.sceneKey };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('TTUI_VALID_SNAPSHOT_PREPARATION_TIMEOUT');
}

function isUsableSnapshot(snapshot, now = Date.now()) {
  if (!snapshot || Number(snapshot.version) !== 4) return false;
  if (!Number.isFinite(Number(snapshot.generatedAt)) || now - Number(snapshot.generatedAt) > 10 * 60 * 1000) return false;
  if (!Array.isArray(snapshot.outfits) || snapshot.outfits.length === 0) return false;
  if (snapshot.outfits.some((outfit) => !hasCurrentNewRecommendationCopy(outfit))) return false;
  return true;
}

function isUsableCardState(state) {
  return state?.batchIndex === 1
    && Number(state?.batchTotal) > 0
    && state?.hasOutfit === true
    && state?.copyTextPresent === true
    && state?.canFavorite === true
    && state?.canOpenDetail === true
    && (Number(state?.batchTotal) !== 8 || state?.canSwipe === true);
}

async function switchToTodayWithClientTiming(mini, timeoutMs) {
  return mini.evaluate(function measureTodayTabEntry(payload) {
    var startedAt = Date.now();
    return new Promise(function runSwitch(resolve, reject) {
      globalThis.wx.switchTab({
        url: '/pages/today/index',
        success: function onSwitchSuccess() {
          var deadline = Date.now() + payload.timeout;
          function poll() {
            var diagnostics = globalThis.__d1dTodayDiagnostics;
            var state = diagnostics && diagnostics.readUsableCardState ? diagnostics.readUsableCardState() : null;
            var usable = state && state.batchIndex === 1
              && Number(state.batchTotal) > 0
              && state.hasOutfit === true
              && state.copyTextPresent === true
              && state.canFavorite === true
              && state.canOpenDetail === true
              && (Number(state.batchTotal) !== 8 || state.canSwipe === true);
            if (usable) {
              resolve({ startedAt: startedAt, observedUsableAt: Date.now(), usableState: state });
              return;
            }
            if (Date.now() >= deadline) {
              resolve({ startedAt: startedAt, observedUsableAt: 0, usableState: null });
              return;
            }
            setTimeout(poll, 16);
          }
          poll();
        },
        fail: reject
      });
    });
  }, { timeout: timeoutMs });
}

async function runScenario({ scenario = 'A', mini, request = {}, timeoutMs = 30000, expectedRuntimeV2 = false } = {}) {
  if (!mini) throw new Error('TTUI_MINI_REQUIRED');
  const runId = nowId(`ttui-${scenario}`);
  const startedAt = Date.now();
  let actionStartedAt = startedAt;
  let previousBatchId = null;
  let observedUsableAt = 0;
  let initialUsableState = null;
  await clearMeasurementState(mini);
  if (scenario === 'A') {
    await prepareValidSnapshot(mini, timeoutMs);
    await clearMeasurementState(mini);
  }
  if (scenario === 'C') {
    await waitForBridge(mini, timeoutMs);
    await waitForTodayIdle(mini, timeoutMs);
    const previousState = await mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.readCopyAcceptanceState?.() || null);
    previousBatchId = previousState?.recommendationBatchId || null;
    if (typeof mini.switchTab === 'function') await mini.switchTab('/pages/wardrobe/index');
    actionStartedAt = Date.now();
    const hardInvalidPreparation = await prepareHardInvalidAndRelaunch(mini, { ...request, acceptanceRunId: runId, captureId: `${runId}-capture` });
    request = { ...request, hardInvalidPreparation };
  }
  if (scenario === 'A' && typeof mini.switchTab === 'function') {
    await mini.switchTab('/pages/wardrobe/index');
    const clientTiming = await switchToTodayWithClientTiming(mini, timeoutMs);
    actionStartedAt = Number(clientTiming?.startedAt) || Date.now();
    observedUsableAt = Number(clientTiming?.observedUsableAt) || 0;
    initialUsableState = clientTiming?.usableState || null;
  }
  else if (scenario !== 'C' && typeof mini.reLaunch === 'function') {
    await mini.reLaunch('/pages/today/index');
  }
  const bridge = await waitForBridge(mini, timeoutMs);
  const baselineLedger = await readLedger(mini);
  const baselineRunId = baselineLedger?.active?.runId || null;
  let triggerResult = null;
  if (scenario === 'B') {
    const previousState = await mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.readCopyAcceptanceState?.() || null);
    previousBatchId = previousState?.recommendationBatchId || null;
    actionStartedAt = Date.now();
    triggerResult = await mini.evaluate(async (payload) => globalThis.__d1dTodayDiagnostics.triggerRefresh(payload), {
      ...request, acceptanceRunId: runId, captureId: `${runId}-capture`,
    });
  }
  const deadline = Date.now() + timeoutMs;
  let ledger = null;
  let active = null;
  let transport = null;
  let performance = null;
  let copyState = null;
  let usableState = initialUsableState;
  while (Date.now() < deadline) {
    ledger = await readLedger(mini);
    const candidates = [ledger?.active, ...(ledger?.history || [])].filter(Boolean);
    active = scenario === 'B'
      ? candidates.find((entry) => entry?.runId !== baselineRunId && entry?.executionMode === 'REFRESH' && Number.isFinite(Number(entry?.stages?.userActionStart)) && entry?.complete)
      : candidates.find((entry) => entry?.complete) || null;
    transport = await mini.evaluate((key) => globalThis.wx?.getStorageSync?.(key) || null, TRANSPORT_KEY);
    performance = await mini.evaluate((key) => globalThis.wx?.getStorageSync?.(key) || null, PERFORMANCE_KEY);
    copyState = await mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.readCopyAcceptanceState?.() || null);
    usableState = await mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.readUsableCardState?.() || null);
    const usable = isUsableCardState(usableState);
    const correlatedRequest = transport?.acceptanceRunId === runId && Number(performance?.serverTotalMs) > 0;
    const batchTransitioned = !previousBatchId || (copyState?.recommendationBatchId && copyState.recommendationBatchId !== previousBatchId);
    const ready = scenario === 'A'
      ? usable
      : scenario === 'B'
        ? Boolean(active?.complete && correlatedRequest && usable)
        : Boolean(correlatedRequest && batchTransitioned && usable && Number(transport?.callFunctionPromiseResolved) > 0);
    if (ready) {
      if (observedUsableAt === 0) observedUsableAt = Date.now();
      if (active) ledger = { ...ledger, active };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  active = active || ledger?.active || ledger?.history?.at(-1) || null;
  const clientSegments = segmentDurations(active || {});
  const measuredTtuiMs = observedUsableAt > 0 ? observedUsableAt - actionStartedAt : 0;
  const correlatedClientRoundTripMs = Number(transport?.clientTotalMs);
  if (Number.isFinite(correlatedClientRoundTripMs) && correlatedClientRoundTripMs > 0) {
    clientSegments.clientToCloudMs = correlatedClientRoundTripMs;
  }
  clientSegments.usablePaintMs = measuredTtuiMs;
  clientSegments.postResponseUsableMs = observedUsableAt > 0 && Number(transport?.callFunctionPromiseResolved) > 0
    ? Math.max(0, observedUsableAt - Number(transport.callFunctionPromiseResolved))
    : 0;
  if (clientSegments.postResponseUsableMs > 0) {
    clientSegments.clientStateMs = clientSegments.postResponseUsableMs;
  }
  const artifact = {
    runId, scenario, startedAt, actionStartedAt, observedUsableAt, endedAt: Date.now(), triggerResult, hardInvalidPreparation: request.hardInvalidPreparation || null,
    bridge: { marker: bridge.marker, ready: bridge.ready, sceneKey: bridge.sceneKey },
    previousBatchId, ledger: active, transport, performance, copyState, usableState, server: serverSegments(performance || {}), client: clientSegments,
    validation: {
      completeLedger: scenario === 'A' || scenario === 'C' ? observedUsableAt > 0 : active?.complete === true,
      firstUsablePaint: observedUsableAt > 0,
      requestCount: Number(active?.generateOutfitRequestCount) || 0,
      executionMode: active?.executionMode || active?.stages?.executionMode || '',
      scenarioBRefreshRun: scenario !== 'B' || (active?.executionMode === 'REFRESH' && (Number(active?.generateOutfitRequestCount) || 0) === 1),
      scenarioCColdRun: scenario !== 'C' || (transport?.acceptanceRunId === runId && Number(performance?.serverTotalMs) > 0),
      scenarioCCorrelatedRequest: scenario !== 'C' || (transport?.acceptanceRunId === runId && Number(performance?.serverTotalMs) > 0),
      scenarioCNoStaleBatchPaint: scenario !== 'C' || (observedUsableAt >= Number(transport?.callFunctionPromiseResolved) && (!previousBatchId || copyState?.recommendationBatchId !== previousBatchId)),
      hardInvalidRejected: scenario !== 'C' || (transport?.acceptanceRunId === runId && (!previousBatchId || copyState?.recommendationBatchId !== previousBatchId)),
      noCloudBeforeUsablePaint: scenario !== 'A' || !Number.isFinite(Number(transport?.callFunctionPromiseResolved)) || observedUsableAt <= Number(transport.callFunctionPromiseResolved),
      scenarioAZeroCloudRequests: scenario === 'A' ? (Number(active?.generateOutfitRequestCount) || 0) === 0 : true,
      canonicalCopyReady: !expectedRuntimeV2 || (Array.isArray(copyState?.outfits) && copyState.outfits.length > 0 && copyState.outfits.every((outfit, index, all) => outfit?.canonicalRecommendationCopyV2?.text && ['safe', 'ai_cache'].includes(outfit.canonicalRecommendationCopyV2.source) && outfit.canonicalRecommendationCopyV2.batchIndex === index && outfit.canonicalRecommendationCopyV2.batchTotal === all.length)),
      usableCard: isUsableCardState(usableState),
    },
  };
  if (!artifact.validation.completeLedger || !artifact.validation.firstUsablePaint || !artifact.validation.noCloudBeforeUsablePaint || !artifact.validation.canonicalCopyReady || !artifact.validation.usableCard || !artifact.validation.scenarioBRefreshRun || !artifact.validation.scenarioCColdRun || !artifact.validation.scenarioCCorrelatedRequest || !artifact.validation.scenarioCNoStaleBatchPaint || !artifact.validation.hardInvalidRejected) {
    throw Object.assign(new Error('TTUI_SCENARIO_INVARIANT_FAILED'), { artifact });
  }
  return artifact;
}

async function runCli({ scenario = 'A', samples = 1, skipBuild = false, expectedRuntimeV2 = false } = {}) {
  if (!skipBuild) throw new Error('TTUI_RUNNER_REQUIRES_PREBUILT_MINIAPP_USE_SKIP_BUILD');
  const session = await ensureDevToolsDirectSession();
  const artifacts = [];
  try {
    for (let index = 0; index < Math.max(1, Number(samples) || 1); index += 1) {
      try {
        const artifact = await runScenario({ scenario, mini: session.mini, expectedRuntimeV2 });
        artifact.directory = writeArtifact(scenario, artifact);
        artifacts.push(artifact);
      } catch (error) {
        const diagnostic = { runId: nowId(`ttui-${scenario}-failed`), scenario, valid: false, error: String(error?.stack || error), artifact: error?.artifact || null };
        diagnostic.directory = writeArtifact(scenario, diagnostic);
        throw Object.assign(error, { diagnosticArtifact: diagnostic.directory });
      }
    }
    return {
      scenario,
      samples: artifacts.length,
      artifacts,
      summary: summarizeArtifacts(artifacts.map((artifact) => ({
        ...artifact.server,
        ...artifact.client,
        clientTotalMs: artifact.transport?.clientTotalMs,
        serverTotalMs: artifact.server?.totalMs,
      }))),
    };
  } finally {
    try { await session.mini.disconnect(); } catch {}
  }
}

module.exports = { ARTIFACT_ROOT, readLedger, readSnapshot, segmentDurations, serverSegments, summarize, summarizeArtifacts, writeArtifact, waitForBridge, waitForTodayIdle, invalidateRestoreSnapshot, markHardInvalid, prepareHardInvalidAndRelaunch, isUsableSnapshot, switchToTodayWithClientTiming, runScenario, runCli };

if (require.main === module) {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('='); return [key, value];
  }));
  runCli({ scenario: String(args.get('scenario') || 'A').toUpperCase(), samples: Number(args.get('samples') || 1), skipBuild: args.get('skip-build') === 'true', expectedRuntimeV2: args.get('expect-runtime-v2') === 'true' })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
