'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ensureDevToolsDirectSession,
  TODAY_PERFORMANCE_LEDGER_KEY,
} = require('./devtools-direct-session');

const ARTIFACT_ROOT = path.resolve(__dirname, '../../../artifacts/today-ttui-runtime-v2');
const TRANSPORT_KEY = 'generateOutfit:acceptance-transport:v1';
const PERFORMANCE_KEY = 'generateOutfit:performance-ledger:v1';

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
    clientStateMs: duration('responseAdapt', 'responseAdaptStart', 'responseAdaptEnd'),
    firstCardPaintMs: duration('onShowToFirstCard', 'todayOnShow', 'firstCardMounted'),
    firstImagePaintMs: duration('onShowToFirstImage', 'todayOnShow', 'firstImageLoaded'),
    usablePaintMs: Number(s.firstImageLoaded || s.firstCardMounted) - Number(s.todayOnShow) || 0,
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

async function clearMeasurementState(mini) {
  return mini.evaluate((keys) => {
    keys.forEach((key) => globalThis.wx?.removeStorageSync?.(key));
    return keys;
  }, [TRANSPORT_KEY, PERFORMANCE_KEY, TODAY_PERFORMANCE_LEDGER_KEY]);
}

async function prepareValidSnapshot(mini, timeoutMs = 30000) {
  const prepareStartedAt = Date.now();
  const existing = await readSnapshot(mini);
  if (isUsableSnapshot(existing, prepareStartedAt)) return { prepared: false, reason: 'existing_valid_snapshot' };
  if (existing) await invalidateRestoreSnapshot(mini);
  const bridge = await waitForBridge(mini, timeoutMs);
  const runId = nowId('ttui-prepare');
  await mini.evaluate(async (payload) => globalThis.__d1dTodayDiagnostics.triggerRefresh(payload), {
    acceptanceRunId: runId, captureId: `${runId}-capture`,
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readSnapshot(mini);
    if (isUsableSnapshot(snapshot, prepareStartedAt) && Number(snapshot.generatedAt) >= prepareStartedAt) {
      return { prepared: true, reason: 'refresh_completed', sceneKey: bridge.sceneKey };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('TTUI_VALID_SNAPSHOT_PREPARATION_TIMEOUT');
}

function isUsableSnapshot(snapshot, now = Date.now()) {
  if (!snapshot || Number(snapshot.version) !== 4) return false;
  if (!Number.isFinite(Number(snapshot.generatedAt)) || now - Number(snapshot.generatedAt) > 10 * 60 * 1000) return false;
  if (!Array.isArray(snapshot.outfits) || snapshot.outfits.length === 0) return false;
  if (snapshot.outfits.some((outfit) => !outfit?.canonicalRecommendationCopyV2?.text)) return false;
  return true;
}

async function runScenario({ scenario = 'A', mini, request = {}, timeoutMs = 30000 } = {}) {
  if (!mini) throw new Error('TTUI_MINI_REQUIRED');
  const runId = nowId(`ttui-${scenario}`);
  const startedAt = Date.now();
  await clearMeasurementState(mini);
  if (scenario === 'A') {
    await prepareValidSnapshot(mini, timeoutMs);
    await clearMeasurementState(mini);
  }
  if (scenario === 'C') await invalidateRestoreSnapshot(mini);
  if (typeof mini.reLaunch === 'function') await mini.reLaunch('/pages/today/index');
  const bridge = await waitForBridge(mini, timeoutMs);
  let triggerResult = null;
  if (scenario === 'B') {
    triggerResult = await mini.evaluate(async (payload) => globalThis.__d1dTodayDiagnostics.triggerRefresh(payload), {
      ...request, acceptanceRunId: runId, captureId: `${runId}-capture`,
    });
  }
  const deadline = Date.now() + timeoutMs;
  let ledger = null;
  while (Date.now() < deadline) {
    ledger = await readLedger(mini);
    if (ledger?.history?.some((entry) => entry?.complete) || ledger?.active?.complete) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const active = ledger?.active || ledger?.history?.at(-1) || null;
  const transport = await mini.evaluate((key) => globalThis.wx?.getStorageSync?.(key) || null, TRANSPORT_KEY);
  const performance = await mini.evaluate((key) => globalThis.wx?.getStorageSync?.(key) || null, PERFORMANCE_KEY);
  const artifact = {
    runId, scenario, startedAt, endedAt: Date.now(), triggerResult,
    bridge: { marker: bridge.marker, ready: bridge.ready, sceneKey: bridge.sceneKey },
    ledger: active, transport, performance, server: serverSegments(performance || {}), client: segmentDurations(active || {}),
    validation: {
      completeLedger: active?.complete === true,
      firstUsablePaint: Number(active?.stages?.firstImageLoaded || active?.stages?.firstCardMounted) > 0,
      requestCount: Number(active?.generateOutfitRequestCount) || 0,
      scenarioAZeroCloudRequests: scenario === 'A' ? (Number(active?.generateOutfitRequestCount) || 0) === 0 : true,
    },
  };
  if (!artifact.validation.completeLedger || !artifact.validation.firstUsablePaint || !artifact.validation.scenarioAZeroCloudRequests) {
    throw Object.assign(new Error('TTUI_SCENARIO_INVARIANT_FAILED'), { artifact });
  }
  return artifact;
}

async function runCli({ scenario = 'A', samples = 1, skipBuild = false } = {}) {
  if (!skipBuild) throw new Error('TTUI_RUNNER_REQUIRES_PREBUILT_MINIAPP_USE_SKIP_BUILD');
  const session = await ensureDevToolsDirectSession();
  const artifacts = [];
  try {
    for (let index = 0; index < Math.max(1, Number(samples) || 1); index += 1) {
      try {
        const artifact = await runScenario({ scenario, mini: session.mini });
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
      }))),
    };
  } finally {
    try { await session.mini.disconnect(); } catch {}
  }
}

module.exports = { ARTIFACT_ROOT, readLedger, readSnapshot, segmentDurations, serverSegments, summarize, summarizeArtifacts, writeArtifact, waitForBridge, invalidateRestoreSnapshot, isUsableSnapshot, runScenario, runCli };

if (require.main === module) {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('='); return [key, value];
  }));
  runCli({ scenario: String(args.get('scenario') || 'A').toUpperCase(), samples: Number(args.get('samples') || 1), skipBuild: args.get('skip-build') === 'true' })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
