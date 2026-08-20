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
const USER_STYLE_COLD_SCENARIO = 'D';
const USER_STYLE_WARDROBE_ROUTE = 'pages/wardrobe/index';
const USER_STYLE_DETAIL_ROUTE = 'pages/clothing-detail/index';
const USER_STYLE_FORM_ROUTE = 'pages/clothing-form/index';

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
    normalizeMs: duration('clientNormalize', 'clientNormalizeStart', 'clientNormalizeEnd'),
    stateCommitMs: duration('stateCommit', 'stateCommitStart', 'stateCommitEnd'),
    firstUsableRenderMs: duration('stateToFirstUsableRender', 'setOutfitsCalled', 'firstCardMounted'),
    reactCommitMs: duration('reactCommit', 'setOutfitsCalled', 'reactCommitAfterOutfits'),
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
  const snapshot = performance.snapshotPersistence || {};
  const response = performance.responseFinalization || {};
  const progressive = performance.progressiveMaterialization || {};
  return {
    readMs: read,
    coreMs: core,
    safeMs: safe,
    criticalPersistenceMs: persistence,
    snapshotBuildMs: Number(snapshot.snapshotBuildMs) || 0,
    snapshotSerializationMs: Number(snapshot.serializationMs) || 0,
    snapshotDbReadMs: Number(snapshot.queryReadMs) || 0,
    snapshotDbWriteMs: Number(snapshot.writeWallMs) || 0,
    snapshotCommitMs: Number(snapshot.commitMs) || 0,
    responseBuildMs: Number(response.buildMs) || 0,
    responseSerializationMs: Number(response.serializationMs) || phases.get('responseSerialization') || 0,
    totalMs: total,
    totalThroughResponseReadyMs: Number(performance.serverTotalThroughResponseReadyMs) || total,
    aiMs: Number(runtime.tAiNecessaryCriticalPathMs) || 0,
    tPlanMs: Number(progressive.tPlanMs) || 0,
    tCard1Ms: Number(progressive.tCard1Ms) || 0,
    tCard2Ms: Number(progressive.tCard2Ms) || 0,
    tTailMs: Number(progressive.tTailMs) || 0,
    card2IncrementalMs: Number(progressive.card2IncrementalMs) || 0,
    card3ToTailIncrementalMs: Number(progressive.card3ToTailIncrementalMs) || 0,
    homeLightPayloadBytes: Number(progressive.homeLightPayloadBytes) || 0,
  };
}

function hardInvalidActionSegments(artifact = {}) {
  const preparation = artifact.hardInvalidPreparation || {};
  const transport = artifact.transport || {};
  const milestones = transport.clientMilestones || {};
  const actionStartedAt = Number(artifact.actionStartedAt) || 0;
  const invalidationStartedAt = Number(preparation.invalidationStartedAt) || 0;
  const invalidationCompletedAt = Number(preparation.invalidationCompletedAt) || 0;
  const relaunchRequestedAt = Number(preparation.relaunchRequestedAt) || 0;
  const wrapperStartedAt = Number(transport.generateOutfitWrapperStart) || 0;
  const callStartedAt = Number(transport.immediatelyBeforeCallFunction) || 0;
  return {
    actionToInvalidationMs: invalidationStartedAt && actionStartedAt
      ? Math.max(0, invalidationStartedAt - actionStartedAt) : 0,
    invalidationMs: invalidationCompletedAt && invalidationStartedAt
      ? Math.max(0, invalidationCompletedAt - invalidationStartedAt) : 0,
    markerWriteMs: Number(preparation.markerWriteCompletedAt) && Number(preparation.markerWriteStartedAt)
      ? Math.max(0, Number(preparation.markerWriteCompletedAt) - Number(preparation.markerWriteStartedAt)) : 0,
    cacheResetMs: Number(preparation.cacheResetCompletedAt) && Number(preparation.cacheResetStartedAt)
      ? Math.max(0, Number(preparation.cacheResetCompletedAt) - Number(preparation.cacheResetStartedAt)) : 0,
    invalidationToRelaunchMs: relaunchRequestedAt && invalidationCompletedAt
      ? Math.max(0, relaunchRequestedAt - invalidationCompletedAt) : 0,
    relaunchToWrapperMs: wrapperStartedAt && relaunchRequestedAt
      ? Math.max(0, wrapperStartedAt - relaunchRequestedAt) : 0,
    wrapperToCallFunctionMs: callStartedAt && wrapperStartedAt
      ? Math.max(0, callStartedAt - wrapperStartedAt) : 0,
    relaunchToAcceptanceConsumeMs: Number(milestones.acceptanceConsumedAt) && relaunchRequestedAt
      ? Math.max(0, Number(milestones.acceptanceConsumedAt) - relaunchRequestedAt) : 0,
    acceptanceConsumeToHardInvalidDetectedMs: Number(milestones.hardInvalidDetectedAt)
      && Number(milestones.acceptanceConsumedAt)
      ? Math.max(0, Number(milestones.hardInvalidDetectedAt) - Number(milestones.acceptanceConsumedAt)) : 0,
    hardInvalidDetectedToRefreshMs: Number(milestones.hardRefreshStartedAt)
      && Number(milestones.hardInvalidDetectedAt)
      ? Math.max(0, Number(milestones.hardRefreshStartedAt) - Number(milestones.hardInvalidDetectedAt)) : 0,
    runtimeStateResetMs: Number(milestones.runtimeStateResetCompletedAt)
      && Number(milestones.runtimeStateResetStartedAt)
      ? Math.max(0, Number(milestones.runtimeStateResetCompletedAt) - Number(milestones.runtimeStateResetStartedAt)) : 0,
    resetToRequestStartMs: Number(milestones.requestRecommendationsStartedAt)
      && Number(milestones.runtimeStateResetCompletedAt)
      ? Math.max(0, Number(milestones.requestRecommendationsStartedAt) - Number(milestones.runtimeStateResetCompletedAt)) : 0,
    requestIdentityConstructionMs: Number(milestones.requestIdentityConstructedAt)
      && Number(milestones.requestRecommendationsStartedAt)
      ? Math.max(0, Number(milestones.requestIdentityConstructedAt) - Number(milestones.requestRecommendationsStartedAt)) : 0,
    registryDispatchMs: Number(milestones.registryExecuteStartedAt)
      && Number(milestones.requestIdentityConstructedAt)
      ? Math.max(0, Number(milestones.registryExecuteStartedAt) - Number(milestones.requestIdentityConstructedAt)) : 0,
    registryToFetchMs: Number(milestones.fetchRecommendationsStartedAt)
      && Number(milestones.registryExecuteStartedAt)
      ? Math.max(0, Number(milestones.fetchRecommendationsStartedAt) - Number(milestones.registryExecuteStartedAt)) : 0,
    cloudRequestConstructionMs: Number(milestones.cloudRequestConstructedAt)
      && Number(milestones.cloudRequestConstructionStartedAt)
      ? Math.max(0, Number(milestones.cloudRequestConstructedAt) - Number(milestones.cloudRequestConstructionStartedAt)) : 0,
    actionToCallFunctionMs: callStartedAt && actionStartedAt
      ? Math.max(0, callStartedAt - actionStartedAt) : 0,
  };
}

async function measureTransportCalibration(mini) {
  return mini.evaluate(function measureSmallTransportProbe() {
    var clientSendAt = Date.now();
    return globalThis.wx.cloud.callFunction({
      name: 'generateOutfit',
      data: { action: 'transport_probe_small', diagnostic: true },
    }).then(function onProbeResult(raw) {
      var clientReceiveAt = Date.now();
      var data = raw && raw.result && raw.result.data;
      var serverStartAt = Number(data && data.serverHandlerStart) || 0;
      var serverEndAt = Number(data && data.serverHandlerEnd) || serverStartAt;
      var clientMidpoint = clientSendAt + ((clientReceiveAt - clientSendAt) / 2);
      var serverMidpoint = serverStartAt + ((serverEndAt - serverStartAt) / 2);
      return {
        clientSendAt: clientSendAt,
        clientReceiveAt: clientReceiveAt,
        clientRoundTripMs: clientReceiveAt - clientSendAt,
        serverStartAt: serverStartAt,
        serverEndAt: serverEndAt,
        serverDurationMs: serverEndAt - serverStartAt,
        clockOffsetEstimateMs: serverMidpoint - clientMidpoint,
        moduleInstanceId: data && data.moduleInstanceId,
      };
    });
  });
}

function transportSegments(artifact = {}) {
  const transport = artifact.transport || {};
  const performance = artifact.performance || {};
  const calibration = artifact.transportCalibration || {};
  const clientSendAt = Number(transport.immediatelyBeforeCallFunction) || 0;
  const clientReceiveAt = Number(transport.callFunctionPromiseResolved) || 0;
  const handlerStart = Number(performance.handlerStart) || 0;
  const responseReadyAt = Number(performance.serverResponseReadyAt) || Number(performance.handlerEnd) || 0;
  const offset = Number(calibration.clockOffsetEstimateMs);
  if (!clientSendAt || !clientReceiveAt || !handlerStart || !responseReadyAt || !Number.isFinite(offset)) {
    return { clientToHandlerMs: 0, returnToClientMs: 0, transportResidualMs: Math.max(0, Number(transport.clientTotalMs) - Number(performance.serverTotalMs)) || 0 };
  }
  return {
    clientToHandlerMs: Math.max(0, (handlerStart - offset) - clientSendAt),
    returnToClientMs: Math.max(0, clientReceiveAt - (responseReadyAt - offset)),
    transportResidualMs: Math.max(0, Number(transport.clientTotalMs) - (responseReadyAt - handlerStart)),
  };
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
    snapshotBuildMs: Number(entry.snapshotBuildMs) || 0,
    snapshotSerializationMs: Number(entry.snapshotSerializationMs) || 0,
    snapshotDbReadMs: Number(entry.snapshotDbReadMs) || 0,
    snapshotDbWriteMs: Number(entry.snapshotDbWriteMs) || 0,
    snapshotCommitMs: Number(entry.snapshotCommitMs) || 0,
    responseBuildMs: Number(entry.responseBuildMs) || 0,
    responseSerializationMs: Number(entry.responseSerializationMs) || 0,
    clientToHandlerMs: Number(entry.clientToHandlerMs) || 0,
    returnToClientMs: Number(entry.returnToClientMs) || 0,
    normalizeMs: Number(entry.normalizeMs) || 0,
    stateCommitMs: Number(entry.stateCommitMs) || 0,
    firstUsableRenderMs: Number(entry.firstUsableRenderMs) || 0,
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
    const invalidationStartedAt = Date.now();
    const info = globalThis.wx?.getStorageInfoSync?.() || { keys: [] };
    const keys = info.keys || [];
    const snapshotKeys = keys.filter((entry) => String(entry).startsWith('d1d:userStorage:v1:') && String(entry).includes('today:outfitReturnSnapshot:recommendation-copy-contract-v8'));
    const existingKey = keys.find((entry) => String(entry).startsWith('d1d:userStorage:v1:') && String(entry).includes('today:recommendationInput:hardInvalid'));
    const snapshotKey = snapshotKeys[0];
    const key = existingKey || (snapshotKey
      ? `${String(snapshotKey).split(':today:outfitReturnSnapshot:')[0]}:today:recommendationInput:hardInvalid`
      : null);
    if (!key) throw new Error('TTUI_HARD_INVALID_SCOPED_KEY_MISSING');
    const markerWriteStartedAt = Date.now();
    globalThis.wx?.setStorageSync?.(key, {
      acceptanceDiagnostics: payload,
      markedAt: Date.now(),
    });
    globalThis.wx?.setStorageSync?.('today:ttui-hard-invalid-acceptance:v1', payload);
    const markerWriteCompletedAt = Date.now();
    const cacheResetStartedAt = Date.now();
    snapshotKeys.forEach((entry) => globalThis.wx?.removeStorageSync?.(entry));
    const cacheResetCompletedAt = Date.now();
    const invalidationCompletedAt = Date.now();
    const relaunchRequestedAt = Date.now();
    globalThis.wx?.reLaunch?.({ url: '/pages/today/index' });
    return {
      key,
      marked: Boolean(globalThis.wx?.getStorageSync?.(key)),
      removedKeys: snapshotKeys,
      invalidationStartedAt,
      markerWriteStartedAt,
      markerWriteCompletedAt,
      cacheResetStartedAt,
      cacheResetCompletedAt,
      invalidationCompletedAt,
      relaunchRequestedAt,
    };
  }, acceptanceRequest);
}

/**
 * Adapter boundary for a real wardrobe-change cold path. The runner never
 * writes a hard-invalid marker for this scenario; the adapter must drive the
 * existing reversible UI/cache invalidation chain and return recovery proof.
 */
async function prepareUserStyleCold(mini, adapter, payload) {
  if (typeof adapter !== 'function') throw new Error('TTUI_USER_STYLE_COLD_ADAPTER_REQUIRED');
  const result = await adapter({ mini, ...payload, scenario: 'user-style-cold', requireRecoveryEvidence: true });
  if (!result || result.changed !== true || (result.restored !== true && typeof result.restore !== 'function')
    || typeof result.method !== 'string' || typeof result.recoveryEvidence !== 'string') {
    throw new Error('TTUI_USER_STYLE_COLD_ADAPTER_INCOMPLETE');
  }
  return result;
}

async function waitForAutomatorRoute(mini, route, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await mini.currentPage();
    if (String(page?.path || '').replace(/^\//, '') === route) return page;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`TTUI_USER_STYLE_ROUTE_TIMEOUT:${route}`);
}

async function waitForAutomatorElement(page, selector, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = await page.$(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const candidates = ['.detail-edit-link', '.clothing-detail-page', '.detail-header', '.item-input', '.save-button'];
  const visible = await Promise.all(candidates.map(async (candidate) => ({ candidate, present: Boolean(await page.$(candidate)) })));
  throw new Error(`TTUI_USER_STYLE_SELECTOR_TIMEOUT:${selector}:route=${page.path}:visible=${JSON.stringify(visible.filter((entry) => entry.present).map((entry) => entry.candidate))}`);
}

async function installSaveObservation(mini) {
  await mini.evaluate(() => {
    const root = globalThis;
    const events = [];
    const record = (event) => events.push({ at: Date.now(), ...event });
    const wxObject = globalThis.wx;
    const originalToast = wxObject?.showToast;
    const originalCallFunction = wxObject?.cloud?.callFunction;
    const originalNavigateBack = wxObject?.navigateBack;
    if (typeof originalToast === 'function') wxObject.showToast = (options) => {
      record({ type: 'toast', title: String(options?.title || ''), icon: String(options?.icon || '') });
      return originalToast.call(wxObject, options);
    };
    if (typeof originalCallFunction === 'function') wxObject.cloud.callFunction = (options) => {
      const name = String(options?.name || '');
      if (name !== 'updateClothes') return originalCallFunction.call(wxObject.cloud, options);
      record({ type: 'updateClothes:start' });
      const result = originalCallFunction.call(wxObject.cloud, options);
      return Promise.resolve(result).then((value) => {
        record({ type: 'updateClothes:resolve', resultKeys: Object.keys(value?.result || value || {}) });
        return value;
      }, (error) => {
        record({ type: 'updateClothes:reject', error: String(error?.errMsg || error?.message || error) });
        throw error;
      });
    };
    if (typeof originalNavigateBack === 'function') wxObject.navigateBack = (options) => {
      record({ type: 'navigateBack:start', delta: Number(options?.delta) || 1 });
      const result = originalNavigateBack.call(wxObject, options);
      record({ type: 'navigateBack:called' });
      return result;
    };
    root.__d1dSaveObservation = { events, restore: () => {
      if (originalToast) wxObject.showToast = originalToast;
      if (originalCallFunction) wxObject.cloud.callFunction = originalCallFunction;
      if (originalNavigateBack) wxObject.navigateBack = originalNavigateBack;
    } };
  });
  return {
    read: () => mini.evaluate(() => ({ events: globalThis.__d1dSaveObservation?.events || [] })),
    restore: () => mini.evaluate(() => { globalThis.__d1dSaveObservation?.restore?.(); delete globalThis.__d1dSaveObservation; return true; }),
  };
}

async function readSaveUiState(page) {
  const input = await page.$('.item-input');
  const buttonText = await page.$('.save-button-text');
  return {
    note: input && typeof input.value === 'function' ? String(await input.value() || '') : null,
    saveButtonText: buttonText && typeof buttonText.text === 'function' ? String(await buttonText.text() || '') : null,
    route: String(page?.path || '').replace(/^\//, ''),
  };
}

async function waitForUserStylePostSaveRoute(mini, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const allowed = new Set([USER_STYLE_DETAIL_ROUTE, USER_STYLE_WARDROBE_ROUTE]);
  while (Date.now() < deadline) {
    const page = await mini.currentPage();
    const route = String(page?.path || '').replace(/^\//, '');
    if (allowed.has(route)) return page;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`TTUI_USER_STYLE_POST_SAVE_ROUTE_TIMEOUT:allowed=${[...allowed].join(',')}`);
}

async function prepareUserStyleColdSession(mini, timeoutMs = 30000) {
  if (!mini || typeof mini.reLaunch !== 'function') throw new Error('TTUI_USER_STYLE_SESSION_PREP_RELAUNCH_REQUIRED');
  const startedAt = Date.now();
  await mini.reLaunch('/pages/today/index');
  const bridge = await waitForBridge(mini, timeoutMs);
  await waitForTodayIdle(mini, timeoutMs);
  const runtime = await mini.evaluate(() => {
    const bridgeState = globalThis.__d1dTodayDiagnostics || {};
    const auth = globalThis.__d1dAuthRuntime || globalThis.__d1dAuthContext || null;
    return {
      runtimeKey: bridgeState.runtimeKey || auth?.runtimeKey || null,
      authReady: Boolean(auth?.isAuthenticated || auth?.openid || auth?.userId),
    };
  });
  return {
    method: 'batch-session-preparation:reLaunch-today+bridge-ready+today-idle',
    startedAt,
    completedAt: Date.now(),
    bridgeReady: bridge.ready === true,
    runtimeKey: runtime.runtimeKey || null,
    authReady: runtime.authReady === true,
  };
}

/** Built-in real UI adapter. It deliberately has no storage/cloud primitives. */
function createUserStyleColdAutomatorAdapter({ mini, timeoutMs = 15000, startInCurrentForm = false } = {}) {
  if (!mini || typeof mini.switchTab !== 'function' || typeof mini.currentPage !== 'function') {
    throw new Error('TTUI_USER_STYLE_AUTOMATOR_REQUIRED');
  }
  let originalName;
  let sampleNumber = 0;
  let useCurrentForm = startInCurrentForm;
  const openNameEditor = async () => {
    if (useCurrentForm) {
      useCurrentForm = false;
      const current = await mini.currentPage();
      if (String(current?.path || '').replace(/^\//, '') === USER_STYLE_FORM_ROUTE) {
        const inputs = await current.$$('.item-input');
        if (!inputs.length) throw new Error('TTUI_USER_STYLE_NAME_INPUT_SELECTOR_MISSING');
        return { page: current, input: inputs[0] };
      }
    }
    await mini.switchTab('/pages/wardrobe/index');
    let page = await waitForAutomatorRoute(mini, USER_STYLE_WARDROBE_ROUTE, timeoutMs);
    const cards = await page.$$('.grid-item');
    if (!cards.length) throw new Error('TTUI_USER_STYLE_VISIBLE_CLOTHING_REQUIRED');
    // Some DevTools builds do not dispatch a tap on a View with a nested
    // lazy image consistently. Keep the attempts UI-only and bounded; each
    // fallback is a real element from the wardrobe source tree.
    const tapTargets = [cards[0], await page.$('.grid-item .item-image-wrapper'), await page.$('.grid-item .item-name')].filter(Boolean);
    let detailRouteReached = false;
    for (const target of tapTargets.slice(0, 3)) {
      await target.tap();
      try {
        await waitForAutomatorRoute(mini, USER_STYLE_DETAIL_ROUTE, Math.min(timeoutMs, 5000));
        detailRouteReached = true;
        break;
      } catch (error) {
        if (!String(error?.message || error).includes('TTUI_USER_STYLE_ROUTE_TIMEOUT')) throw error;
      }
    }
    if (!detailRouteReached) throw new Error('TTUI_USER_STYLE_DETAIL_TAP_FAILED:attempts=3');
    page = await waitForAutomatorRoute(mini, USER_STYLE_DETAIL_ROUTE, timeoutMs);
    const editLink = await waitForAutomatorElement(page, '.detail-edit-link', timeoutMs);
    await editLink.tap();
    page = await waitForAutomatorRoute(mini, USER_STYLE_FORM_ROUTE, timeoutMs);
    const inputs = await page.$$('.item-input');
    if (!inputs.length) throw new Error('TTUI_USER_STYLE_NAME_INPUT_SELECTOR_MISSING');
    return { page, input: inputs[0] };
  };
  const saveNameThroughUi = async (value) => {
    const editor = await openNameEditor();
    await editor.input.input(value);
    const saveButton = await waitForAutomatorElement(editor.page, '.save-button', timeoutMs);
    await saveButton.tap();
    await waitForUserStylePostSaveRoute(mini, timeoutMs);
  };
  return async ({ runId }) => {
    const editor = await openNameEditor();
    if (originalName === undefined) originalName = String(await editor.input.value() || '');
    const before = await readSaveUiState(editor.page);
    const observation = await installSaveObservation(mini);
    sampleNumber += 1;
    const changedName = `${originalName || '诊断衣物'}·${String(runId).slice(-8)}-${sampleNumber}`;
    const actionStartedAt = Date.now();
    await editor.input.input(changedName);
    const afterInput = await readSaveUiState(editor.page);
    const saveButton = await waitForAutomatorElement(editor.page, '.save-button', timeoutMs);
    try {
      await saveButton.tap();
      const postSavePage = await waitForUserStylePostSaveRoute(mini, timeoutMs);
      const afterSave = await readSaveUiState(postSavePage).catch(() => ({ route: postSavePage?.path || null }));
      const saveObservation = { before, afterInput, afterSave, ...(await observation.read()) };
      await observation.restore();
      return {
        changed: true,
        restored: false,
        method: 'automator:wardrobe-grid-item>detail-edit-link>item-input>save-button',
        recoveryEvidence: `changed:${changedName}`,
        postSaveRoute: String(postSavePage?.path || '').replace(/^\//, ''),
        actionStartedAt,
        saveObservation,
        restore: async () => {
          await saveNameThroughUi(originalName);
          return { restored: true, recoveryEvidence: `restored:${originalName}` };
        },
      };
    } catch (error) {
      const saveObservation = { before, afterInput, ...(await observation.read()) };
      await observation.restore();
      throw Object.assign(error, { saveObservation });
    }
  };
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
  let triggerResult = await mini.evaluate(async (payload) => globalThis.__d1dTodayDiagnostics.triggerFullCompute(payload), {
    acceptanceRunId: runId, captureId: `${runId}-capture`,
  });
  // A freshly attached DevTools page can expose the diagnostics bridge before
  // the recommendation intent registry has mounted. Retry only the sampling
  // trigger after a real page lifecycle, without changing Today behavior.
  if (triggerResult === false) {
    if (typeof mini.reLaunch === 'function') await mini.reLaunch('/pages/today/index');
    await waitForBridge(mini, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, 250));
    triggerResult = await mini.evaluate(async (payload) => globalThis.__d1dTodayDiagnostics.triggerFullCompute(payload), {
      acceptanceRunId: runId, captureId: `${runId}-capture-retry`,
    });
  }
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

function isFixedEightCardBatch(usableState, copyState) {
  if (Number(usableState?.batchTotal) !== 8) return false;
  return !Array.isArray(copyState?.outfits) || copyState.outfits.length === 8;
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

async function runScenario({ scenario = 'A', mini, request = {}, timeoutMs = 30000, expectedRuntimeV2 = false, userStyleColdAdapter } = {}) {
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
    const hardInvalidPreparation = await prepareHardInvalidAndRelaunch(mini, {
      ...request,
      acceptanceRunId: runId,
      captureId: `${runId}-capture`,
      clientMilestones: { actionStartedAt },
    });
    request = { ...request, hardInvalidPreparation };
  }
  let userStyleColdPreparation = null;
  if (scenario === USER_STYLE_COLD_SCENARIO) {
    const currentPage = typeof mini.currentPage === 'function' ? await mini.currentPage() : null;
    const onFormRoute = String(currentPage?.path || '').replace(/^\//, '') === USER_STYLE_FORM_ROUTE;
    if (!onFormRoute) {
      await waitForBridge(mini, timeoutMs);
      await waitForTodayIdle(mini, timeoutMs);
      const previousState = await mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.readCopyAcceptanceState?.() || null);
      previousBatchId = previousState?.recommendationBatchId || null;
    }
    userStyleColdPreparation = await prepareUserStyleCold(mini, userStyleColdAdapter, {
      acceptanceRunId: runId,
      captureId: `${runId}-capture`,
    });
    // The user-style Cold measurement begins at the normal return-to-Today
    // action, after the real wardrobe mutation has completed. The edit/save
    // interval remains preparation evidence and is excluded from action→send.
    actionStartedAt = Date.now();
    userStyleColdPreparation = { ...userStyleColdPreparation, actionStartedAt, actionTimestampMethod: 'normal-return-to-today-before-switchTab' };
    if (typeof mini.switchTab !== 'function') throw new Error('TTUI_USER_STYLE_COLD_SWITCH_TAB_REQUIRED');
    await mini.switchTab('/pages/today/index');
  }
  if (scenario === 'A' && typeof mini.switchTab === 'function') {
    await mini.switchTab('/pages/wardrobe/index');
    const clientTiming = await switchToTodayWithClientTiming(mini, timeoutMs);
    actionStartedAt = Number(clientTiming?.startedAt) || Date.now();
    observedUsableAt = Number(clientTiming?.observedUsableAt) || 0;
    initialUsableState = clientTiming?.usableState || null;
  }
  else if (scenario !== 'C' && scenario !== USER_STYLE_COLD_SCENARIO && typeof mini.reLaunch === 'function') {
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
      ...request,
      acceptanceRunId: runId,
      captureId: `${runId}-capture`,
      clientMilestones: { actionStartedAt },
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
    runId, scenario, startedAt, actionStartedAt, observedUsableAt, endedAt: Date.now(), triggerResult, hardInvalidPreparation: request.hardInvalidPreparation || null, userStyleColdPreparation,
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
      scenarioDUserStyleCold: scenario !== USER_STYLE_COLD_SCENARIO || (userStyleColdPreparation?.changed === true && userStyleColdPreparation?.restored === true && userStyleColdPreparation?.method && userStyleColdPreparation?.recoveryEvidence),
      noCloudBeforeUsablePaint: scenario !== 'A' || !Number.isFinite(Number(transport?.callFunctionPromiseResolved)) || observedUsableAt <= Number(transport.callFunctionPromiseResolved),
      scenarioAZeroCloudRequests: scenario === 'A' ? (Number(active?.generateOutfitRequestCount) || 0) === 0 : true,
      canonicalCopyReady: !expectedRuntimeV2 || (Array.isArray(copyState?.outfits) && copyState.outfits.length > 0 && copyState.outfits.every((outfit, index, all) => outfit?.canonicalRecommendationCopyV2?.text && ['safe', 'ai_cache'].includes(outfit.canonicalRecommendationCopyV2.source) && outfit.canonicalRecommendationCopyV2.batchIndex === index && outfit.canonicalRecommendationCopyV2.batchTotal === all.length)),
      usableCard: isUsableCardState(usableState),
      fixedEightCardBatch: isFixedEightCardBatch(usableState, copyState),
    },
  };
  if (scenario === USER_STYLE_COLD_SCENARIO && typeof userStyleColdPreparation?.restore === 'function') {
    const restored = await userStyleColdPreparation.restore();
    if (!restored || restored.restored !== true || typeof restored.recoveryEvidence !== 'string') {
      throw Object.assign(new Error('TTUI_USER_STYLE_COLD_RESTORE_FAILED'), { artifact });
    }
    userStyleColdPreparation = {
      ...userStyleColdPreparation,
      restored: true,
      recoveryEvidence: restored.recoveryEvidence,
    };
    delete userStyleColdPreparation.restore;
    artifact.userStyleColdPreparation = userStyleColdPreparation;
    artifact.validation.scenarioDUserStyleCold = true;
  }
  artifact.actionToRequestBreakdown = hardInvalidActionSegments(artifact);
  if (!artifact.validation.completeLedger || !artifact.validation.firstUsablePaint || !artifact.validation.noCloudBeforeUsablePaint || !artifact.validation.canonicalCopyReady || !artifact.validation.usableCard || !artifact.validation.fixedEightCardBatch || !artifact.validation.scenarioBRefreshRun || !artifact.validation.scenarioCColdRun || !artifact.validation.scenarioCCorrelatedRequest || !artifact.validation.scenarioCNoStaleBatchPaint || !artifact.validation.hardInvalidRejected || !artifact.validation.scenarioDUserStyleCold) {
    if (scenario === USER_STYLE_COLD_SCENARIO && typeof userStyleColdPreparation?.restore === 'function') {
      try { await userStyleColdPreparation.restore(); } catch { /* retain the failed artifact for manual recovery */ }
    }
    throw Object.assign(new Error('TTUI_SCENARIO_INVARIANT_FAILED'), { artifact });
  }
  return artifact;
}

async function runCli({ scenario = 'A', samples = 1, skipBuild = false, expectedRuntimeV2 = false, userStyleColdAdapter } = {}) {
  if (!skipBuild) throw new Error('TTUI_RUNNER_REQUIRES_PREBUILT_MINIAPP_USE_SKIP_BUILD');
  const session = await ensureDevToolsDirectSession({ preserveCurrentPage: scenario === USER_STYLE_COLD_SCENARIO });
  let userStyleColdSessionPreparation = null;
  if (scenario === USER_STYLE_COLD_SCENARIO && !userStyleColdAdapter) {
    const currentPage = await session.mini.currentPage();
    const onFormRoute = String(currentPage?.path || '').replace(/^\//, '') === USER_STYLE_FORM_ROUTE;
    if (!onFormRoute) userStyleColdSessionPreparation = await prepareUserStyleColdSession(session.mini);
    userStyleColdAdapter = createUserStyleColdAutomatorAdapter({ mini: session.mini, startInCurrentForm: onFormRoute });
  }
  const artifacts = [];
  try {
    for (let index = 0; index < Math.max(1, Number(samples) || 1); index += 1) {
      try {
        const artifact = await runScenario({ scenario, mini: session.mini, expectedRuntimeV2, userStyleColdAdapter });
        if (userStyleColdSessionPreparation) artifact.sessionPreparation = userStyleColdSessionPreparation;
        if (scenario === 'B' || scenario === 'C' || scenario === USER_STYLE_COLD_SCENARIO) {
          artifact.transportCalibration = await measureTransportCalibration(session.mini);
          artifact.transportBreakdown = transportSegments(artifact);
        }
        artifact.directory = writeArtifact(scenario, artifact);
        artifacts.push(artifact);
      } catch (error) {
        const diagnostic = { runId: nowId(`ttui-${scenario}-failed`), scenario, valid: false, error: String(error?.stack || error), artifact: error?.artifact || null, saveObservation: error?.saveObservation || null };
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
        ...artifact.transportBreakdown,
        ...artifact.actionToRequestBreakdown,
        clientTotalMs: artifact.transport?.clientTotalMs,
        serverTotalMs: artifact.server?.totalMs,
      }))),
    };
  } finally {
    try { await session.mini.disconnect(); } catch {}
  }
}

module.exports = { ARTIFACT_ROOT, readLedger, readSnapshot, segmentDurations, serverSegments, hardInvalidActionSegments, measureTransportCalibration, transportSegments, summarize, summarizeArtifacts, writeArtifact, waitForBridge, waitForTodayIdle, invalidateRestoreSnapshot, markHardInvalid, prepareHardInvalidAndRelaunch, prepareUserStyleCold, prepareUserStyleColdSession, createUserStyleColdAutomatorAdapter, isUsableSnapshot, isFixedEightCardBatch, switchToTodayWithClientTiming, runScenario, runCli };

if (require.main === module) {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('='); return [key, value];
  }));
  runCli({ scenario: String(args.get('scenario') || 'A').toUpperCase(), samples: Number(args.get('samples') || 1), skipBuild: args.get('skip-build') === 'true', expectedRuntimeV2: args.get('expect-runtime-v2') === 'true' })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
