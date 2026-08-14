'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invalidateRestoreSnapshot, isUsableSnapshot, readSnapshot, runScenario } = require('./today-ttui-runtime-v2');

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
      const wx = { getStorageInfoSync: () => ({ keys: [...store.keys()] }), getStorageSync: (key) => store.get(key), removeStorageSync: (key) => store.delete(key) };
      const old = globalThis.wx; globalThis.wx = wx;
      try { return fn(arg); } finally { globalThis.wx = old; }
    },
    async reLaunch() {},
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

test('scenario A performs reLaunch and waits for a complete ledger without triggering cloud', async () => {
  const mini = miniMock();
  mini.evaluate = async (fn, arg) => {
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
});

test('expired or incomplete v4 snapshots are rejected before A preparation', () => {
  const copyContract = { copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', gateResult: 'PASS', riskFlags: [], naturalnessGateVersion: 'copy-naturalness-gate-v3', naturalnessGateResult: 'PASS', naturalnessRiskFlags: [], structuralNaturalnessResult: 'PASS', structuralNaturalnessRiskFlags: [], xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3' }, todayCopyProvenance: {}, todayReason: 'copy', coreEligibilityReason: 'reason', coreEligibilityReasonCode: 'code', coreEligibilityEvidence: ['e'] };
  const base = { version: 4, generatedAt: Date.now() - 11 * 60 * 1000, outfits: [{ copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', copyFinalizationMode: 'new_recommendation', copyContract }] };
  assert.equal(isUsableSnapshot(base), false);
  assert.equal(isUsableSnapshot({ ...base, generatedAt: Date.now() }), true);
  assert.equal(isUsableSnapshot({ ...base, generatedAt: Date.now(), outfits: [] }), false);
});

test('A allows background refresh after first usable paint but rejects pre-paint requests', async () => {
  const mini = miniMock();
  const run = async (requestStart, paint) => {
    mini.evaluate = async (fn, arg) => {
      if (String(fn).includes('__d1dTodayDiagnostics')) {
        if (String(fn).includes('triggerFullCompute')) return true;
        if (String(fn).includes('readUsableCardState')) return { batchIndex: 1, batchTotal: 8, hasOutfit: true, copyTextPresent: true, canSwipe: true, canFavorite: true, canOpenDetail: true };
        return { marker: 'd1d-today-production-handler-v1', ready: true, sceneKey: 'home' };
      }
      if (String(fn).includes('getStorageInfoSync')) return { version: 4, generatedAt: Date.now(), outfits: [{ copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', copyFinalizationMode: 'new_recommendation', copyContract: { copyContractVersion: 'recommendation-copy-contract-v8', voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2', gateResult: 'PASS', riskFlags: [], naturalnessGateVersion: 'copy-naturalness-gate-v3', naturalnessGateResult: 'PASS', naturalnessRiskFlags: [], structuralNaturalnessResult: 'PASS', structuralNaturalnessRiskFlags: [], xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3' }, todayCopyProvenance: {}, todayReason: 'copy', coreEligibilityReason: 'r', coreEligibilityReasonCode: 'c', coreEligibilityEvidence: ['e'] } }] };
      if (arg === 'today:performance-ledger:v1') return { active: { complete: true, stages: { firstImageLoaded: paint, generateOutfitRequestStart: requestStart }, generateOutfitRequestCount: 1, durations: {} } };
      if (arg === 'generateOutfit:performance-ledger:v1' || arg === 'generateOutfit:acceptance-transport:v1') return null;
      return fn(arg);
    };
    return runScenario({ scenario: 'A', mini, timeoutMs: 100 });
  };
  assert.equal((await run(200, 100)).validation.noCloudBeforeUsablePaint, true);
  await assert.rejects(() => run(100, 200), /TTUI_SCENARIO_INVARIANT_FAILED/);
});
