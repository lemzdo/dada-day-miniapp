'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertAcceptanceSingleRequest,
  ensureDevToolsDirectSession,
  installAcceptanceSingleRequestGuard,
  readAcceptanceCapture,
  readAcceptanceCumulativeRequestCount,
  readAcceptanceSingleRequestGuard,
  resetAcceptanceSingleRequestGuard,
  unicodeInputPreflight,
  unwrapCloudResponse,
} = require('../devtools-direct-session');
const { validateProductionRequest } = require('../today-full-compute-acceptance');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCENES = Object.freeze(['home', 'work', 'date', 'sport']);
const SCENE_LABELS = Object.freeze({ home: '居家', work: '上班', date: '约会', sport: '运动' });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function writeJson(directory, name, value) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function waitUntil(read, predicate, timeoutMs, label, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await sleep(intervalMs);
  } while (Date.now() < deadline);
  throw Object.assign(new Error(`${label} timed out`), { lastValue: value });
}

async function readBridge(mini) {
  return mini.evaluate(() => {
    const bridge = globalThis.__d1dTodayDiagnostics;
    return bridge ? { marker: bridge.marker, ready: bridge.ready, sceneKey: bridge.sceneKey } : null;
  });
}

async function selectScene(session, scene) {
  const page = await session.mini.currentPage();
  const tabs = await page.$$('.scene-tab');
  const index = SCENES.indexOf(scene);
  if (!tabs[index]) throw new Error(`scene tab unavailable: ${scene}`);
  const bridge = await readBridge(session.mini);
  if (bridge?.sceneKey !== scene) await tabs[index].tap();
  await waitUntil(
    () => readBridge(session.mini),
    (value) => value?.marker === 'd1d-today-production-handler-v1' && value.ready === true && value.sceneKey === scene,
    60000,
    `TODAY_${scene.toUpperCase()}_READY`,
  );
}

async function trigger(mini, identifiers, kind) {
  return mini.evaluate(async (payload) => {
    const bridge = globalThis.__d1dTodayDiagnostics;
    if (!bridge || bridge.marker !== 'd1d-today-production-handler-v1') throw new Error('Today production diagnostics bridge unavailable');
    return payload.kind === 'refresh' ? bridge.triggerRefresh(payload.identifiers) : bridge.triggerFullCompute(payload.identifiers);
  }, { identifiers, kind });
}

async function waitForNetworkIdle(mini) {
  return waitUntil(
    () => readAcceptanceSingleRequestGuard(mini),
    (guard) => guard && guard.activeGenerateOutfitCalls === 0
      && typeof guard.quiescenceStartedAt === 'number'
      && Date.now() - guard.quiescenceStartedAt >= guard.quiescenceWindowMs,
    90000,
    'NETWORK_IDLE_READY',
  );
}

function validateCapturedRequest(request, scene, kind) {
  const validation = validateProductionRequest(request);
  const business = validation.businessRequest;
  const common = business.scene === SCENE_LABELS[scene] && business.maxResults === 8
    && validation.missingFields.length === 0 && validation.unicodeValid;
  if (kind === 'initial' || kind === 'weather-fallback') {
    if (!common || !validation.equivalentToRetryProductionBuilder) throw Object.assign(new Error('not production retry builder'), { validation });
    if (kind === 'weather-fallback' && business.weatherMode !== 'disabled') {
      throw Object.assign(new Error('weather fallback must use the production retry builder with weather disabled'), { validation });
    }
  } else if (!common || business.trigger !== 'refresh' || !business.recommendationBatchId
    || !Array.isArray(business.excludedOutfitKeys) || business.excludedOutfitKeys.length === 0) {
    throw Object.assign(new Error('not production refresh builder'), { validation });
  }
  return validation;
}

async function captureOne(session, runId, scene, kind) {
  await resetAcceptanceSingleRequestGuard(session.mini);
  const baseline = await readAcceptanceCumulativeRequestCount(session.mini);
  const identifiers = {
    acceptanceRunId: `${runId}-${scene}-${kind}`,
    captureId: `voice-spike-${scene}-${kind}-${crypto.randomBytes(3).toString('hex')}`,
    ...(kind === 'weather-fallback' ? { weatherModeOverride: 'disabled' } : {}),
  };
  await installAcceptanceSingleRequestGuard(session.mini, { ...identifiers, baselineCumulativeRequestCount: baseline });
  await waitForNetworkIdle(session.mini);
  const triggered = await trigger(session.mini, identifiers, kind === 'refresh' ? 'refresh' : 'initial');
  if (kind === 'refresh' && !triggered) throw new Error(`${scene} production refresh unavailable`);
  const guard = await waitForNetworkIdle(session.mini);
  const capture = await readAcceptanceCapture(session.mini);
  const final = await readAcceptanceCumulativeRequestCount(session.mini);
  assertAcceptanceSingleRequest({ baselineCumulativeRequestCount: baseline, finalCumulativeRequestCount: final, capturedRequestCount: guard.capturedRequestCount });
  if (!capture || capture.status !== 'fulfilled') throw Object.assign(new Error(`${scene} ${kind} request failed`), { capture });
  const validation = validateCapturedRequest(capture.originalRequestData, scene, kind);
  const response = unwrapCloudResponse(capture.rawResponse);
  if (response?.code !== 0 || !Array.isArray(response?.data?.outfits) || response.data.outfits.length !== 8) {
    throw Object.assign(new Error(`${scene} ${kind} response must contain exactly 8 outfits`), {
      response,
      incompleteCapture: {
        scene,
        kind,
        capturedAt: new Date().toISOString(),
        requestValidation: validation,
        request: capture.originalRequestData,
        sentRequest: capture.sentRequestData,
        requestDiff: capture.requestDiff,
        response: capture.rawResponse,
      },
    });
  }
  return {
    scene,
    kind,
    capturedAt: new Date().toISOString(),
    requestValidation: validation,
    request: capture.originalRequestData,
    sentRequest: capture.sentRequestData,
    requestDiff: capture.requestDiff,
    response: capture.rawResponse,
    wallLatencyMs: Number(capture.callFunctionPromiseResolved) - Number(capture.immediatelyBeforeCallFunction),
    productionBuilderVerified: true,
  };
}

async function collect(outputDirectory) {
  const runId = `xiaoda-voice-holdout-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const directory = outputDirectory || path.join(REPOSITORY_ROOT, 'artifacts', 'xiaoda-ai-voice-spike', runId);
  let session;
  const batches = [];
  const persist = (status = 'in_progress', failures = []) => writeJson(directory, 'holdout-capture.json', {
    version: 'xiaoda-voice-holdout-capture-v1',
    runId,
    status,
    capturedAt: new Date().toISOString(),
    source: 'real Today production request builder via wx.cloud.callFunction observer',
    batchCount: batches.length,
    outfitCount: batches.reduce((sum, batch) => sum + unwrapCloudResponse(batch.response).data.outfits.length, 0),
    scenes: Object.fromEntries(SCENES.map((scene) => [scene, batches.filter((batch) => batch.scene === scene).length])),
    failures,
    batches,
  });
  try {
    session = await ensureDevToolsDirectSession();
    await session.mini.reLaunch('/pages/today/index');
    await waitUntil(
      () => readBridge(session.mini),
      (bridge) => bridge?.marker === 'd1d-today-production-handler-v1' && bridge.ready === true,
      60000,
      'TODAY_FRESH_BUILD_READY',
    );
    await unicodeInputPreflight(session.mini);
    for (const scene of SCENES) {
      await selectScene(session, scene);
      const initial = await captureOne(session, runId, scene, 'initial');
      batches.push(initial);
      persist();
      process.stdout.write(`CAPTURED ${scene} initial 8\n`);
      try {
        const refresh = await captureOne(session, runId, scene, 'refresh');
        batches.push(refresh);
        persist();
        process.stdout.write(`CAPTURED ${scene} refresh 8\n`);
      } catch (error) {
        if (error.incompleteCapture) {
          writeJson(directory, `${scene}-refresh-incomplete.json`, error.incompleteCapture);
        }
        const fallback = await captureOne(session, runId, scene, 'weather-fallback');
        fallback.refreshFailure = String(error.message || error);
        batches.push(fallback);
        persist('in_progress', [{ scene, kind: 'refresh', message: String(error.message || error), preserved: true }]);
        process.stdout.write(`CAPTURED ${scene} weather-fallback 8\n`);
      }
    }
    const manifest = {
      version: 'xiaoda-voice-holdout-capture-v1',
      runId,
      capturedAt: new Date().toISOString(),
      source: 'real Today production request builder via wx.cloud.callFunction observer',
      batchCount: batches.length,
      outfitCount: batches.reduce((sum, batch) => sum + unwrapCloudResponse(batch.response).data.outfits.length, 0),
      scenes: Object.fromEntries(SCENES.map((scene) => [scene, batches.filter((batch) => batch.scene === scene).length])),
      batches,
    };
    persist('complete');
    process.stdout.write(`HOLDOUT_CAPTURE_READY ${directory}\n`);
    return { directory, manifest };
  } finally {
    if (session?.mini) {
      try { await resetAcceptanceSingleRequestGuard(session.mini); } catch {}
      try { await session.mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.releaseCaptureLock?.()); } catch {}
      try { session.mini.disconnect(); } catch {}
    }
  }
}

if (require.main === module) {
  collect(process.argv[2]).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    if (error.validation) process.stderr.write(`${JSON.stringify(error.validation, null, 2)}\n`);
    if (error.capture) process.stderr.write(`${JSON.stringify(error.capture, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { collect, validateCapturedRequest };
