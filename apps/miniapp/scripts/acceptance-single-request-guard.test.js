'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertAcceptanceSingleRequest,
  installAcceptanceSingleRequestGuard,
  resetAcceptanceSingleRequestGuard,
} = require('./devtools-direct-session');

test('historical cumulative count 0 plus one current request passes', () => {
  assert.deepEqual(assertAcceptanceSingleRequest({
    baselineCumulativeRequestCount: 0,
    finalCumulativeRequestCount: 1,
    capturedRequestCount: 1,
  }), { baselineCumulativeRequestCount: 0, finalCumulativeRequestCount: 1, capturedRequestCount: 1 });
});

test('historical cumulative count 2 plus one current request passes', () => {
  assert.doesNotThrow(() => assertAcceptanceSingleRequest({
    baselineCumulativeRequestCount: 2,
    finalCumulativeRequestCount: 3,
    capturedRequestCount: 1,
  }));
});

test('historical cumulative count 10 plus one current request passes', () => {
  assert.doesNotThrow(() => assertAcceptanceSingleRequest({
    baselineCumulativeRequestCount: 10,
    finalCumulativeRequestCount: 11,
    capturedRequestCount: 1,
  }));
});

test('any historical count plus two current requests fails', () => {
  assert.throws(() => assertAcceptanceSingleRequest({
    baselineCumulativeRequestCount: 10,
    finalCumulativeRequestCount: 12,
    capturedRequestCount: 2,
  }), { code: 'FINAL_SINGLE_REQUEST_VIOLATION' });
});

test('a new run replaces stale blocker state instead of inheriting its count', async () => {
  const calls = [];
  const original = async (options) => { calls.push(options); return { result: { data: { options } } }; };
  const oldWrapper = () => Promise.reject(new Error('stale blocker'));
  const previousWx = globalThis.wx;
  const previousGuard = globalThis.__d1dAcceptanceSingleRequestGuard;
  const businessStorage = { todaySnapshot: 'preserved', identity: 'preserved' };
  globalThis.wx = { cloud: { callFunction: oldWrapper } };
  globalThis.__d1dAcceptanceSingleRequestGuard = {
    marker: 'old',
    acceptanceRunId: 'old-run',
    capturedRequestCount: 99,
    targets: { 'wx.cloud.callFunction': { target: globalThis.wx.cloud, original, wrapper: oldWrapper } },
  };
  try {
    const mini = { evaluate: (fn, value) => Promise.resolve(fn(value)) };
    const installed = await installAcceptanceSingleRequestGuard(mini, {
      acceptanceRunId: 'new-run',
      baselineCumulativeRequestCount: 10,
    });
    assert.equal(installed.acceptanceRunId, 'new-run');
    assert.equal(globalThis.__d1dAcceptanceSingleRequestGuard.capturedRequestCount, 0);
    await globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: { acceptanceRunId: 'new-run' } });
    await globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: {} });
    const state = globalThis.__d1dAcceptanceSingleRequestGuard;
    assert.equal(state.explicitRequestCount, 1);
    assert.equal(state.ordinaryRequestCount, 1);
    assert.equal(state.contaminated, true);
    assert.equal(calls.length, 2);
    const reset = await resetAcceptanceSingleRequestGuard(mini);
    assert.equal(reset.businessStorageTouched, false);
    assert.equal(globalThis.__d1dAcceptanceSingleRequestGuard, undefined);
    assert.deepEqual(businessStorage, { todaySnapshot: 'preserved', identity: 'preserved' });
    assert.equal(globalThis.wx.cloud.callFunction, original);
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    if (previousGuard === undefined) delete globalThis.__d1dAcceptanceSingleRequestGuard;
    else globalThis.__d1dAcceptanceSingleRequestGuard = previousGuard;
  }
});

test('ordinary Today, weather, and scene requests always pass through without a user-visible error', async () => {
  const calls = [];
  const original = async (options) => { calls.push(options); return { ok: true }; };
  const previousWx = globalThis.wx;
  const previousGuard = globalThis.__d1dAcceptanceSingleRequestGuard;
  globalThis.wx = { cloud: { callFunction: original } };
  try {
    const mini = { evaluate: (fn, value) => Promise.resolve(fn(value)) };
    await installAcceptanceSingleRequestGuard(mini, { acceptanceRunId: 'run-observer', baselineCumulativeRequestCount: 10 });
    await assert.doesNotReject(globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: { trigger: 'weather' } }));
    await assert.doesNotReject(globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: { trigger: 'scene' } }));
    await assert.doesNotReject(globalThis.wx.cloud.callFunction({ name: 'getWeather', data: {} }));
    assert.equal(calls.length, 3);
    assert.equal(globalThis.__d1dAcceptanceSingleRequestGuard.contaminated, true);
  } finally {
    const mini = { evaluate: (fn, value) => Promise.resolve(fn(value)) };
    await resetAcceptanceSingleRequestGuard(mini);
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    if (previousGuard === undefined) delete globalThis.__d1dAcceptanceSingleRequestGuard;
    else globalThis.__d1dAcceptanceSingleRequestGuard = previousGuard;
  }
});

test('reset acceptance guard restores only callFunction and does not clear business storage', async () => {
  const original = async () => ({ ok: true });
  const previousWx = globalThis.wx;
  const previousGuard = globalThis.__d1dAcceptanceSingleRequestGuard;
  const storage = { wardrobe: ['item'], weather: { temp: 34 }, todaySnapshot: { cards: 8 } };
  globalThis.wx = { cloud: { callFunction: original } };
  try {
    const mini = { evaluate: (fn, value) => Promise.resolve(fn(value)) };
    await installAcceptanceSingleRequestGuard(mini, { acceptanceRunId: 'run-reset', baselineCumulativeRequestCount: 2 });
    const before = JSON.stringify(storage);
    const reset = await resetAcceptanceSingleRequestGuard(mini);
    assert.equal(reset.reset, true);
    assert.equal(reset.businessStorageTouched, false);
    assert.equal(JSON.stringify(storage), before);
    assert.equal(globalThis.wx.cloud.callFunction, original);
  } finally {
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    if (previousGuard === undefined) delete globalThis.__d1dAcceptanceSingleRequestGuard;
    else globalThis.__d1dAcceptanceSingleRequestGuard = previousGuard;
  }
});
