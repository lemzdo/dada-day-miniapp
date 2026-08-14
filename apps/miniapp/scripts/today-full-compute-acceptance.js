'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertAcceptanceSingleRequest,
  ensureDevToolsDirectSession,
  extractPerformanceLedger,
  installAcceptanceSingleRequestGuard,
  jsonByteLength,
  readAcceptanceCapture,
  readAcceptanceCumulativeRequestCount,
  readAcceptanceSingleRequestGuard,
  resetAcceptanceSingleRequestGuard,
  unicodeInputPreflight,
  unwrapCloudResponse,
} = require('./devtools-direct-session');

const MINIAPP_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(MINIAPP_ROOT, '..', '..');
const ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, 'artifacts', 'today-full-compute-acceptance');
const TRANSPORT_STORAGE_KEY = 'generateOutfit:acceptance-transport:v1';
const DIAGNOSTIC_REQUEST_FIELDS = new Set([
  'acceptanceRunId',
  'captureId',
  'performanceDiagnostics',
  'diagnostics',
  'debugRecommendationAudit',
]);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function cloneJson(value) { return JSON.parse(JSON.stringify(value === undefined ? null : value)); }
function writeJson(directory, name, value) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sanitizeResponse(value, key = '') {
  if (Array.isArray(value)) return value.map((entry) => sanitizeResponse(entry, key));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /^(?:cloud|https?):\/\//i.test(value)) return '[REDACTED_URL]';
    return value;
  }
  const sanitized = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (/(?:openid|token|authorization|session|secret)/i.test(entryKey)) sanitized[entryKey] = '[REDACTED]';
    else sanitized[entryKey] = sanitizeResponse(entryValue, entryKey);
  }
  return sanitized;
}

function stripDiagnostics(data) {
  const business = cloneJson(data || {});
  delete business.diagnostics;
  return business;
}

function responsePayloadBreakdown(value, limit = 20) {
  const rows = [];
  const visit = (entry, currentPath) => {
    rows.push({ path: currentPath, bytes: jsonByteLength(entry) });
    if (Array.isArray(entry)) {
      entry.forEach((child, index) => visit(child, `${currentPath}[${index}]`));
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    Object.entries(entry).forEach(([entryKey, child]) => visit(child, `${currentPath}.${entryKey}`));
  };
  visit(value, '$');
  return rows.sort((left, right) => right.bytes - left.bytes).slice(0, limit);
}

function businessMutationPaths(requestDiff) {
  return (Array.isArray(requestDiff) ? requestDiff : [])
    .map((entry) => entry?.path)
    .filter((entryPath) => typeof entryPath === 'string')
    .filter((entryPath) => {
      const topLevelField = entryPath.replace(/^\$\.?/, '').split(/[.[]/, 1)[0];
      return !DIAGNOSTIC_REQUEST_FIELDS.has(topLevelField);
    });
}

function validateProductionRequest(request) {
  const businessRequest = Object.fromEntries(Object.entries(request || {})
    .filter(([key]) => !DIAGNOSTIC_REQUEST_FIELDS.has(key)));
  const forbiddenRefreshFields = ['recommendationBatchId', 'excludedOutfitKeys', 'excludeClothingIdSets']
    .filter((field) => Object.prototype.hasOwnProperty.call(businessRequest, field));
  const requiredFields = ['date', 'scene', 'timeOfDay', 'maxResults', 'auditId', 'weatherMode', 'trigger'];
  const missingFields = requiredFields.filter((field) => businessRequest[field] === undefined || businessRequest[field] === '');
  const unicodeJson = JSON.stringify(businessRequest);
  return {
    equivalentToRetryProductionBuilder: missingFields.length === 0
      && forbiddenRefreshFields.length === 0
      && businessRequest.trigger === 'retry'
      && businessRequest.maxResults === 8
      && !unicodeJson.includes('\ufffd'),
    businessRequest,
    missingFields,
    forbiddenRefreshFields,
    unicodeValid: !unicodeJson.includes('\ufffd'),
  };
}

function inferSnapshotMode(snapshot = {}, finalCardCount = 0) {
  const existing = Number(snapshot.existingRecordCount) || 0;
  const created = Number(snapshot.newRecordCount) || 0;
  if (finalCardCount > 0 && existing === finalCardCount && created === 0) return 'ALL_EXISTING';
  if (finalCardCount > 0 && existing === 0 && created === finalCardCount) return 'ALL_NEW';
  if (existing + created === finalCardCount && existing > 0 && created > 0) return 'MIXED';
  return 'NOT_OBSERVED';
}

function summarizeQuality(data, request) {
  const outfits = Array.isArray(data?.outfits) ? data.outfits : [];
  const outfitKeys = outfits.map((outfit) => outfit?.outfitKey).filter(Boolean);
  const copyGateFailures = outfits.filter((outfit) => {
    const gate = outfit?.copyGateResult || outfit?.copyContract?.gateResult;
    return gate !== 'PASS';
  }).length;
  const sceneMismatch = outfits.filter((outfit) => outfit?.scene && outfit.scene !== request?.scene).length;
  const cardConsistencyFailures = outfits.filter((outfit) => {
    const clothingIds = Array.isArray(outfit?.clothingIds) ? outfit.clothingIds.filter(Boolean) : [];
    const itemIds = Array.isArray(outfit?.items) ? outfit.items.map((item) => item?.clothingId).filter(Boolean) : [];
    return clothingIds.length < 2
      || new Set(clothingIds).size !== clothingIds.length
      || (itemIds.length > 0 && itemIds.some((itemId) => !clothingIds.includes(itemId)));
  }).length;
  const missingAesthetic = outfits.filter((outfit) => !outfit?.aestheticEvaluation || typeof outfit.aestheticEvaluation !== 'object').length;
  const missingScores = outfits.filter((outfit) => !outfit?.scores || typeof outfit.scores !== 'object').length;
  const missingSemanticCopy = outfits.filter((outfit) => {
    const copy = outfit?.reason || outfit?.todayReason || outfit?.todayClaim;
    return typeof copy !== 'string' || copy.trim().length === 0;
  }).length;
  const countContract = data?.countContract || {};
  const canonicalRuntimeEnabled = Boolean(data?.debug?.canonicalCopyRuntimeV2);
  const canonicalCopyFailures = canonicalRuntimeEnabled
    ? outfits.filter((outfit, index) => {
        const canonical = outfit?.canonicalRecommendationCopyV2;
        return !canonical
          || canonical.batchIndex !== index
          || canonical.batchTotal !== outfits.length
          || typeof canonical.text !== 'string'
          || canonical.text.trim().length === 0
          || canonical.text !== outfit?.copyContract?.todayReason;
      }).length
    : 0;
  const countContractPassed = outfits.length === 8
    && Number(countContract.expectedCardCount) === 8
    && Number(countContract.returnedCardCount) === 8;
  const checks = {
    countContract: countContractPassed,
    wearabilityAndCardConsistency: cardConsistencyFailures === 0,
    sceneEligibility: sceneMismatch === 0,
    aesthetic: missingAesthetic === 0,
    preferenceFreshnessScores: missingScores === 0,
    diversity: new Set(outfitKeys).size === outfits.length,
    semantic: missingSemanticCopy === 0,
    copyGate: copyGateFailures === 0,
    canonicalRuntimeV2: !canonicalRuntimeEnabled || canonicalCopyFailures === 0,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    unsupportedClaimCount: copyGateFailures,
    sceneMismatch,
    cardConsistencyFailures,
    missingAesthetic,
    missingScores,
    missingSemanticCopy,
    canonicalCopyFailures,
    uniqueOutfitCount: new Set(outfitKeys).size,
  };
}

function buildRuntimeV2Timing(performance = {}) {
  const phases = Array.isArray(performance.phases) ? performance.phases : [];
  const phaseByName = new Map(phases.map((phase) => [phase?.phase, phase]));
  const runtime = performance.runtimeV2 && typeof performance.runtimeV2 === 'object'
    ? performance.runtimeV2
    : {};
  return {
    enabled: runtime.enabled === true,
    tReadServerProxyMs: Number(runtime.tReadServerProxyMs)
      || Number(phaseByName.get('userAndWardrobeRead')?.duration)
      || 0,
    tCoreInclusiveMs: Number(runtime.tCoreInclusiveMs) || 0,
    tCorePhaseProxyMs: Number(runtime.tCorePhaseProxyMs)
      || (Number(phaseByName.get('candidateGeneration')?.duration) || 0)
        + (Number(phaseByName.get('cardCompilation')?.duration) || 0),
    tSafeMs: Number(runtime.tSafeMs) || 0,
    tAiNecessaryCriticalPathMs: Number(runtime.tAiNecessaryCriticalPathMs) || 0,
    aiOnNecessaryCriticalPath: runtime.aiOnNecessaryCriticalPath === true,
    aiMaterializationMode: runtime.aiMaterializationMode || '',
    canonicalCopy: runtime.canonicalCopy || {},
  };
}

function runBuild() {
  const result = childProcess.spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm build:weapp'], {
    cwd: MINIAPP_ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (result.status !== 0) {
    const error = new Error(`miniapp build failed (${result.status})`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return { status: 'PROJECT_BUILD_OK', stdoutTail: String(result.stdout || '').slice(-2000) };
}

async function waitUntil(read, predicate, timeoutMs, label, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await sleep(intervalMs);
  } while (Date.now() < deadline);
  const error = new Error(`${label} timed out`);
  error.lastValue = value;
  throw error;
}

async function waitForNetworkIdle(mini) {
  return waitUntil(
    () => readAcceptanceSingleRequestGuard(mini),
    (guard) => guard
      && guard.activeGenerateOutfitCalls === 0
      && typeof guard.quiescenceStartedAt === 'number'
      && Date.now() - guard.quiescenceStartedAt >= guard.quiescenceWindowMs,
    30000,
    'NETWORK_IDLE_READY',
  );
}

async function waitForBridge(mini) {
  return waitUntil(
    () => mini.evaluate(() => {
      const bridge = globalThis.__d1dTodayDiagnostics;
      return bridge ? { marker: bridge.marker, ready: bridge.ready, sceneKey: bridge.sceneKey } : null;
    }),
    (bridge) => bridge?.marker === 'd1d-today-production-handler-v1' && bridge.ready === true,
    30000,
    'TODAY_DIAGNOSTICS_BRIDGE_READY',
    250,
  );
}

async function installCleanObserver(mini, identifiers, baselineCumulativeRequestCount) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await resetAcceptanceSingleRequestGuard(mini);
    await installAcceptanceSingleRequestGuard(mini, { ...identifiers, baselineCumulativeRequestCount });
    const idle = await waitForNetworkIdle(mini);
    if (idle.observedRequestCount === 0 && idle.ordinaryRequestCount === 0) return idle;
  }
  throw new Error('NETWORK_IDLE_READY could not be established without an ordinary generateOutfit request');
}

async function triggerProductionFullCompute(mini, identifiers) {
  return mini.evaluate(async (request) => {
    const bridge = globalThis.__d1dTodayDiagnostics;
    if (!bridge || bridge.marker !== 'd1d-today-production-handler-v1') {
      throw new Error('Today production diagnostics bridge is unavailable');
    }
    return bridge.triggerFullCompute(request);
  }, identifiers);
}

async function triggerWhenBridgeReady(mini, identifiers) {
  let lastBusyError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const bridge = await waitForBridge(mini);
    try {
      const triggerResult = await triggerProductionFullCompute(mini, identifiers);
      return { bridge, triggerResult, attempt };
    } catch (error) {
      if (!String(error?.message || error).includes('Today recommendation handler is busy')) throw error;
      lastBusyError = error;
      await sleep(250);
    }
  }
  throw lastBusyError || new Error('Today recommendation handler remained busy');
}

async function readTransportTiming(mini) {
  return mini.evaluate((key) => globalThis.wx?.getStorageSync?.(key) || null, TRANSPORT_STORAGE_KEY);
}

function buildSummary({ capture, transport, performance, data, requestValidation, quality, guard }) {
  const businessData = stripDiagnostics(data);
  const snapshot = performance.snapshotPersistence || {};
  const snapshotMode = inferSnapshotMode(snapshot, data.outfits.length);
  const moduleAgeAtStartMs = Math.max(0, Number(performance.handlerStart) - Number(performance.moduleLoadedAt));
  return {
    acceptanceRunId: capture.acceptanceRunId,
    captureId: capture.captureId,
    auditId: capture.auditId,
    productionRequestEquivalent: requestValidation.equivalentToRetryProductionBuilder,
    requestBusinessMutationPaths: businessMutationPaths(capture.requestDiff),
    executionMode: data?.debug?.executionMode,
    finalCardCount: data.outfits.length,
    clientTotalMs: Number(transport?.clientTotalMs)
      || Math.max(0, Number(capture.callFunctionPromiseResolved) - Number(capture.immediatelyBeforeCallFunction)),
    serverTotalMs: Number(performance.serverTotalMs) || 0,
    snapshot: {
      mode: snapshotMode,
      reads: Number(snapshot.reads) || 0,
      writes: Number(snapshot.writes) || 0,
      maxConcurrency: Number(snapshot.maxConcurrency) || 0,
      durationMs: Number(snapshot.durationMs) || 0,
      ...snapshot,
    },
    rawResponseBytes: jsonByteLength(capture.rawResponse),
    businessResponseBytes: jsonByteLength(businessData),
    diagnosticsBytes: jsonByteLength(data.diagnostics || {}),
    module: {
      moduleInstanceId: performance.moduleInstanceId,
      moduleLoadedAt: performance.moduleLoadedAt,
      moduleAgeAtStartMs,
      state: moduleAgeAtStartMs <= 1500 ? 'cold' : 'warm',
    },
    candidateMetrics: performance.candidateMetrics || {},
    runtimeV2: buildRuntimeV2Timing(performance),
    quality,
    guard: {
      capturedRequestCount: guard.capturedRequestCount,
      observedRequestCount: guard.observedRequestCount,
      ordinaryRequestCount: guard.ordinaryRequestCount,
      contaminated: guard.contaminated,
    },
  };
}

async function runAcceptance({ skipBuild = false } = {}) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const nonce = crypto.randomBytes(4).toString('hex');
  const identifiers = {
    acceptanceRunId: `today-full-compute-${stamp}-${nonce}`,
    captureId: `capture-${stamp}-${nonce}`,
  };
  const artifactDirectory = path.join(ARTIFACT_ROOT, identifiers.captureId);
  let session;
  let build = { status: 'PROJECT_BUILD_SKIPPED' };
  try {
    if (!skipBuild) build = runBuild();
    process.stdout.write(`${build.status}\n`);
    session = await ensureDevToolsDirectSession();
    process.stdout.write('DEVTOOLS_BUILDER_RECOVERED\nDEVTOOLS_DIRECT_SESSION_READY\n');
    await resetAcceptanceSingleRequestGuard(session.mini);
    process.stdout.write('STALE_WRAPPER_CLEARED\n');
    const unicode = await unicodeInputPreflight(session.mini);
    process.stdout.write(`${unicode.status}\n`);
    await waitForBridge(session.mini);
    const baselineCumulativeRequestCount = await readAcceptanceCumulativeRequestCount(session.mini);
    await installCleanObserver(session.mini, identifiers, baselineCumulativeRequestCount);
    process.stdout.write('NETWORK_IDLE_READY\n');
    const triggered = await triggerWhenBridgeReady(session.mini, identifiers);
    const { bridge, triggerResult } = triggered;
    const guard = await waitForNetworkIdle(session.mini);
    const capture = await readAcceptanceCapture(session.mini);
    const finalCumulativeRequestCount = await readAcceptanceCumulativeRequestCount(session.mini);
    assertAcceptanceSingleRequest({
      baselineCumulativeRequestCount,
      finalCumulativeRequestCount,
      capturedRequestCount: guard.capturedRequestCount,
    });
    if (!capture || capture.status !== 'fulfilled') {
      writeJson(artifactDirectory, 'failed-capture.json', capture || { status: 'missing' });
      throw new Error(`acceptance capture did not fulfill: ${capture?.status || 'missing'}: ${capture?.error || 'no error detail'}`);
    }
    const expectedObservedRequestCount = 1 + (guard.backgroundMaterializationRequestCount || 0);
    if (guard.contaminated || guard.ordinaryRequestCount !== 0
      || guard.observedRequestCount !== expectedObservedRequestCount) {
      throw Object.assign(new Error('formal measurement was contaminated by another generateOutfit request'), { guard });
    }
    const requestValidation = validateProductionRequest(capture.originalRequestData);
    const mutationPaths = businessMutationPaths(capture.requestDiff);
    if (!requestValidation.equivalentToRetryProductionBuilder) {
      throw Object.assign(new Error('PRODUCTION_REQUEST_NOT_EQUIVALENT'), { requestValidation });
    }
    if (mutationPaths.length > 0) throw Object.assign(new Error('PRODUCTION_REQUEST_MUTATED'), { mutationPaths });
    const cloudResponse = unwrapCloudResponse(capture.rawResponse);
    const data = cloudResponse?.data;
    if (!data || !Array.isArray(data.outfits)) throw new Error('captured response has no business data.outfits');
    const performance = extractPerformanceLedger(capture.rawResponse);
    const transport = await readTransportTiming(session.mini);
    if (transport?.acceptanceRunId !== identifiers.acceptanceRunId || transport?.captureId !== identifiers.captureId) {
      throw Object.assign(new Error('client transport timing correlation failed'), { transport, identifiers });
    }
    const quality = summarizeQuality(data, capture.originalRequestData);
    const summary = buildSummary({ capture, transport, performance, data, requestValidation, quality, guard });
    const requestDiffArtifact = {
      acceptanceRunId: identifiers.acceptanceRunId,
      captureId: identifiers.captureId,
      auditId: capture.auditId,
      allowedDiagnosticFields: [...DIAGNOSTIC_REQUEST_FIELDS],
      structuralDiff: capture.requestDiff,
      businessMutationPaths: mutationPaths,
      productionRequestValidation: requestValidation,
    };
    writeJson(artifactDirectory, 'original-request.json', capture.originalRequestData);
    writeJson(artifactDirectory, 'sent-request.json', capture.sentRequestData);
    writeJson(artifactDirectory, 'request-diff.json', requestDiffArtifact);
    writeJson(artifactDirectory, 'raw-response.json', capture.rawResponse);
    writeJson(artifactDirectory, 'sanitized-response.json', sanitizeResponse(capture.rawResponse));
    writeJson(artifactDirectory, 'business-payload-breakdown.json', {
      rawResponseBytes: summary.rawResponseBytes,
      businessResponseBytes: summary.businessResponseBytes,
      diagnosticsBytes: summary.diagnosticsBytes,
      top20: responsePayloadBreakdown(stripDiagnostics(data), 20),
    });
    writeJson(artifactDirectory, 'performance-ledger.json', performance);
    writeJson(artifactDirectory, 'client-transport-timing.json', transport);
    writeJson(artifactDirectory, 'acceptance-summary.json', {
      ...summary,
      triggerResult,
      triggerAttempt: triggered.attempt,
      bridge,
      unicode,
      baselineCumulativeRequestCount,
      finalCumulativeRequestCount,
      artifactDirectory,
    });
    process.stdout.write(`${JSON.stringify({ ...summary, artifactDirectory }, null, 2)}\n`);
    if (summary.executionMode !== 'full_compute') throw new Error(`expected full_compute, got ${summary.executionMode}`);
    if (summary.finalCardCount !== 8) throw new Error(`REAL_RECOMMENDATION_CORRECTNESS_BUG: finalCardCount=${summary.finalCardCount}`);
    if (!summary.quality.passed) throw Object.assign(new Error('QUALITY_CONTRACT_FAILED'), { quality: summary.quality });
    return summary;
  } finally {
    if (session?.mini) {
      try { await resetAcceptanceSingleRequestGuard(session.mini); } catch {}
      try { session.mini.disconnect(); } catch {}
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => !['--skip-build'].includes(arg))) throw new Error('Usage: node today-full-compute-acceptance.js [--skip-build]');
  await runAcceptance({ skipBuild: args.has('--skip-build') });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    if (error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    if (error.guard) process.stderr.write(`${JSON.stringify(error.guard, null, 2)}\n`);
    if (error.quality) process.stderr.write(`${JSON.stringify(error.quality, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildRuntimeV2Timing,
  businessMutationPaths,
  inferSnapshotMode,
  responsePayloadBreakdown,
  sanitizeResponse,
  stripDiagnostics,
  summarizeQuality,
  validateProductionRequest,
};
