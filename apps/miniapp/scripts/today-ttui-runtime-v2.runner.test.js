'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invalidateRestoreSnapshot, readSnapshot, runScenario } = require('./today-ttui-runtime-v2');

function miniMock() {
  const store = new Map([
    ['d1d:userStorage:v1:user-a:today:outfitReturnSnapshot:recommendation-copy-contract-v8', { version: 4, outfits: [{ id: 'outfit-1' }] }],
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
  assert.deepEqual(await readSnapshot(mini), { version: 4, outfits: [{ id: 'outfit-1' }] });
  const result = await invalidateRestoreSnapshot(mini);
  assert.deepEqual(result.removedKeys, ['d1d:userStorage:v1:user-a:today:outfitReturnSnapshot:recommendation-copy-contract-v8']);
  assert.equal(mini.store.has('today:outfitReturnSnapshot:recommendation-copy-contract-v8'), true);
});

test('scenario A performs reLaunch and waits for a complete ledger without triggering cloud', async () => {
  const mini = miniMock();
  mini.evaluate = async (fn, arg) => {
    if (String(fn).includes('__d1dTodayDiagnostics')) return { marker: 'd1d-today-production-handler-v1', ready: true, sceneKey: 'home' };
    if (String(fn).includes('getStorageInfoSync')) return { version: 4, outfits: [{ id: 'outfit-1' }] };
    if (arg === 'today:performance-ledger:v1') return { active: { complete: true, stages: { firstCardMounted: 1 }, generateOutfitRequestCount: 0, durations: {} } };
    if (arg === 'generateOutfit:performance-ledger:v1' || arg === 'generateOutfit:acceptance-transport:v1') return null;
    return fn(arg);
  };
  const artifact = await runScenario({ scenario: 'A', mini, timeoutMs: 100 });
  assert.equal(artifact.scenario, 'A');
  assert.equal(artifact.triggerResult, null);
});
