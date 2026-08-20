'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invalidateRestoreSnapshot, isUsableSnapshot, markHardInvalid, prepareHardInvalidAndRelaunch, readSnapshot, runScenario } = require('./today-ttui-runtime-v2');

function miniMock() {
  const copyContract = { copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', gateResult: 'PASS', riskFlags: [], naturalnessGateVersion: 'copy-naturalness-gate-v3', naturalnessGateResult: 'PASS', naturalnessRiskFlags: [], structuralNaturalnessResult: 'PASS', structuralNaturalnessRiskFlags: [], xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3' }, todayCopyProvenance: {}, todayReason: 'copy', coreEligibilityReason: 'reason', coreEligibilityReasonCode: 'code', coreEligibilityEvidence: ['e'] };
  const outfit = { id: 'outfit-1', copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', copyFinalizationMode: 'new_recommendation', copyContract };
  const store = new Map([
    ['d1d:userStorage:v1:user-a:today:outfitReturnSnapshot:recommendation-copy-contract-v8', { version: 4, generatedAt: Date.now(), outfits: [outfit] }],
    ['today:outfitReturnSnapshot:recommendation-copy-contract-v8', { bad: true }],
  ]);
  return {
    store,
    async evaluate(fn, arg) {
      const wx = { getStorageInfoSync: () => ({ keys: [...store.keys()] }), getStorageSync: (key) => store.get(key), setStorageSync: (key, value) => store.set(key, value), removeStorageSync: (key) => store.delete(key) };
      const old = globalThis.wx; globalThis.wx = wx;
      try { return fn(arg); } finally { globalThis.wx = old; }
    },
    async reLaunch() {},
    async switchTab() {},
  };
}

test('runner reads and invalidates only scoped v4 restore snapshots', async () => {
  const mini = miniMock();
  const snapshot = await readSnapshot(mini);
  assert.equal(snapshot.version, 4);
  assert.equal(snapshot.outfits[0].id, 'outfit-1');
  const result = await invalidateRestoreSnapshot(mini);
  assert.deepEqual(result.removedKeys, ['d1d:userStorage:v1:user-a:today:outfitReturnSnapshot:recommendation-copy-contract-v8']);
  assert.equal(mini.store.has('today:outfitReturnSnapshot:recommendation-copy-contract-v8'), true);
});

test('hard invalid marker derives the scoped user key from the restore snapshot', async () => {
  const mini = miniMock();
  const result = await markHardInvalid(mini);
  assert.equal(result.marked, true);
  assert.equal(result.key, 'd1d:userStorage:v1:user-a:today:recommendationInput:hardInvalid');
  assert.equal(mini.store.get(result.key), true);
});

test('hard invalid marker stores one-shot acceptance correlation for the real cold request', async () => {
  const mini = miniMock();
  const request = { acceptanceRunId: 'run-c', captureId: 'capture-c' };
  const result = await markHardInvalid(mini, request);
  assert.deepEqual(mini.store.get('today:ttui-hard-invalid-acceptance:v1'), request);
  assert.deepEqual(mini.store.get(result.key).acceptanceDiagnostics, request);
});

test('C preparation atomically marks hard invalid, correlates diagnostics, and removes restore', async () => {
  const mini = miniMock();
  const request = { acceptanceRunId: 'run-c', captureId: 'capture-c' };
  const result = await prepareHardInvalidAndRelaunch(mini, request);
  assert.equal(result.marked, true);
  assert.equal(result.removedKeys.length, 1);
  assert.equal(mini.store.has('d1d:userStorage:v1:user-a:today:outfitReturnSnapshot:recommendation-copy-contract-v8'), false);
  assert.deepEqual(mini.store.get('today:ttui-hard-invalid-acceptance:v1'), request);
  assert.deepEqual(mini.store.get(result.key).acceptanceDiagnostics, request);
});

test('scenario A enters Today through the real tab path without triggering cloud', async () => {
  const mini = miniMock();
  const switchedTabs = [];
  mini.switchTab = async (path) => { switchedTabs.push(path); };
  mini.evaluate = async (fn, arg) => {
    if (String(fn).includes('globalThis.wx.switchTab')) return { startedAt: Date.now(), observedUsableAt: Date.now() + 1, usableState: { batchIndex: 1, batchTotal: 8, hasOutfit: true, copyTextPresent: true, canSwipe: true, canFavorite: true, canOpenDetail: true } };
    if (String(fn).includes('__d1dTodayDiagnostics')) {
      if (String(fn).includes('triggerFullCompute')) return true;
      if (String(fn).includes('readUsableCardState')) return { batchIndex: 1, batchTotal: 8, hasOutfit: true, copyTextPresent: true, canSwipe: true, canFavorite: true, canOpenDetail: true };
      return { marker: 'd1d-today-production-handler-v1', ready: true, sceneKey: 'home' };
    }
    if (String(fn).includes('getStorageInfoSync')) return mini.store.get('d1d:userStorage:v1:user-a:today:outfitReturnSnapshot:recommendation-copy-contract-v8');
    if (arg === 'today:performance-ledger:v1') return { active: { complete: true, stages: { firstCardMounted: 1 }, generateOutfitRequestCount: 0, durations: {} } };
    if (arg === 'generateOutfit:performance-ledger:v1' || arg === 'generateOutfit:acceptance-transport:v1') return null;
    return fn(arg);
  };
  const artifact = await runScenario({ scenario: 'A', mini, timeoutMs: 100 });
  assert.equal(artifact.scenario, 'A');
  assert.equal(artifact.triggerResult, null);
  assert.deepEqual(switchedTabs, ['/pages/wardrobe/index']);
});

test('expired or incomplete v4 snapshots are rejected before A preparation', () => {
  const copyContract = { copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', gateResult: 'PASS', riskFlags: [], naturalnessGateVersion: 'copy-naturalness-gate-v3', naturalnessGateResult: 'PASS', naturalnessRiskFlags: [], structuralNaturalnessResult: 'PASS', structuralNaturalnessRiskFlags: [], xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3' }, todayCopyProvenance: {}, todayReason: 'copy', coreEligibilityReason: 'reason', coreEligibilityReasonCode: 'code', coreEligibilityEvidence: ['e'] };
  const base = { version: 4, generatedAt: Date.now() - 11 * 60 * 1000, outfits: [{ copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', copyFinalizationMode: 'new_recommendation', copyContract }] };
  assert.equal(isUsableSnapshot(base), false);
  assert.equal(isUsableSnapshot({ ...base, generatedAt: Date.now() }), true);
  assert.equal(isUsableSnapshot({ ...base, generatedAt: Date.now(), outfits: [] }), false);
});

test('A allows non-blocking background refresh but rejects a refresh completed before the valid batch is usable', async () => {
  const mini = miniMock();
  const run = async (refreshResolvedAt) => {
    mini.evaluate = async (fn, arg) => {
      if (String(fn).includes('globalThis.wx.switchTab')) return { startedAt: Date.now(), observedUsableAt: Date.now() + 1, usableState: { batchIndex: 1, batchTotal: 8, hasOutfit: true, copyTextPresent: true, canSwipe: true, canFavorite: true, canOpenDetail: true } };
      if (String(fn).includes('__d1dTodayDiagnostics')) {
        if (String(fn).includes('triggerFullCompute')) return true;
        if (String(fn).includes('readUsableCardState')) return { batchIndex: 1, batchTotal: 8, hasOutfit: true, copyTextPresent: true, canSwipe: true, canFavorite: true, canOpenDetail: true };
        return { marker: 'd1d-today-production-handler-v1', ready: true, sceneKey: 'home' };
      }
      if (String(fn).includes('getStorageInfoSync')) return { version: 4, generatedAt: Date.now(), outfits: [{ copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', copyFinalizationMode: 'new_recommendation', copyContract: { copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', gateResult: 'PASS', riskFlags: [], naturalnessGateVersion: 'copy-naturalness-gate-v3', naturalnessGateResult: 'PASS', naturalnessRiskFlags: [], structuralNaturalnessResult: 'PASS', structuralNaturalnessRiskFlags: [], xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3' }, todayCopyProvenance: {}, todayReason: 'copy', coreEligibilityReason: 'r', coreEligibilityReasonCode: 'c', coreEligibilityEvidence: ['e'] } }] };
      if (arg === 'today:performance-ledger:v1') return { active: { complete: true, stages: { firstImageLoaded: 100, generateOutfitRequestStart: 200 }, generateOutfitRequestCount: 1, durations: {} } };
      if (arg === 'generateOutfit:acceptance-transport:v1') return { callFunctionPromiseResolved: refreshResolvedAt };
      if (arg === 'generateOutfit:performance-ledger:v1') return null;
      return fn(arg);
    };
    return runScenario({ scenario: 'A', mini, timeoutMs: 100 });
  };
  assert.equal((await run(Date.now() + 1000)).validation.noCloudBeforeUsablePaint, true);
  await assert.rejects(() => run(1), /TTUI_SCENARIO_INVARIANT_FAILED/);
});

test('B selects the new REFRESH run and validates canonical V2 copy from the diagnostics bridge', async () => {
  const mini = miniMock();
  const baseline = { runId: 'page-entry', complete: true, executionMode: 'HOT', stages: { firstImageLoaded: 40 }, generateOutfitRequestCount: 0, durations: {} };
  const refresh = { runId: 'refresh-action', complete: true, executionMode: 'REFRESH', stages: { userActionStart: 100, firstCardMounted: 140, firstImageLoaded: 180 }, generateOutfitRequestCount: 1, durations: {} };
  let refreshTriggered = false;
  let acceptanceRunId = '';
  mini.evaluate = async (fn, arg) => {
    const source = String(fn);
    if (source.includes('triggerRefresh')) { refreshTriggered = true; acceptanceRunId = arg.acceptanceRunId; return true; }
    if (source.includes('readCopyAcceptanceState')) return { outfits: Array.from({ length: 8 }, (_, index) => ({ canonicalRecommendationCopyV2: { text: `safe copy ${index}`, source: 'safe', batchIndex: index, batchTotal: 8 } })) };
    if (source.includes('readUsableCardState')) return { batchIndex: 1, batchTotal: 8, hasOutfit: true, copyTextPresent: true, copySource: 'safe', canSwipe: true, canFavorite: true, canOpenDetail: true };
    if (source.includes('__d1dTodayDiagnostics')) return { marker: 'd1d-today-production-handler-v1', ready: true, sceneKey: 'home' };
    if (arg === 'today:performance-ledger:v1') return refreshTriggered ? { active: refresh, history: [baseline] } : { active: baseline, history: [] };
    if (arg === 'generateOutfit:performance-ledger:v1') return refreshTriggered ? { serverTotalMs: 10 } : null;
    if (arg === 'generateOutfit:acceptance-transport:v1') return refreshTriggered ? { acceptanceRunId, callFunctionPromiseResolved: Date.now(), clientTotalMs: 20 } : null;
    return null;
  };
  const artifact = await runScenario({ scenario: 'B', mini, timeoutMs: 100, expectedRuntimeV2: true });
  assert.equal(artifact.ledger.runId, 'refresh-action');
  assert.equal(artifact.validation.scenarioBRefreshRun, true);
  assert.equal(artifact.validation.canonicalCopyReady, true);
  assert.equal(artifact.client.firstImagePaintMs, 80);
  assert.ok(artifact.observedUsableAt >= artifact.actionStartedAt);
});
