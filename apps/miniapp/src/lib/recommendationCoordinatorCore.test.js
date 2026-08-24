'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRecommendationCoordinatorCore } = require('./recommendationCoordinatorCore');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

test('mutation prebuild starts without awaiting completion', async () => {
  const pending = deferred();
  const coordinator = createRecommendationCoordinatorCore({ execute: () => pending.promise });
  const run = coordinator.invalidateAndPrebuild({ identity: 'profile-v2', request: {} });

  assert.equal(run.source, 'prebuild');
  assert.equal(coordinator.isLatest('profile-v2'), true);
  pending.resolve('ready');
  assert.equal(await run.promise, 'ready');
});

test('Today joins the same identity prebuild once', async () => {
  const pending = deferred();
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({
    execute: () => {
      calls += 1;
      return pending.promise;
    },
  });
  const prebuild = coordinator.invalidateAndPrebuild({ identity: 'wardrobe-v2', request: {} });
  const today = coordinator.acquire({ identity: 'wardrobe-v2', request: {}, mode: 'today' });

  assert.equal(today.joined, true);
  assert.equal(today.source, 'prebuild-in-flight');
  assert.equal(today.promise, prebuild.promise);
  assert.equal(calls, 1);
  pending.resolve('batch-v2');
  assert.equal(await today.promise, 'batch-v2');
});

test('stale prebuild cannot overwrite the latest ready identity', async () => {
  const oldPending = deferred();
  const nextPending = deferred();
  const coordinator = createRecommendationCoordinatorCore({
    execute: (request) => request.version === 'old' ? oldPending.promise : nextPending.promise,
  });
  const oldRun = coordinator.invalidateAndPrebuild({ identity: 'old', request: { version: 'old' } });
  const nextRun = coordinator.invalidateAndPrebuild({ identity: 'next', request: { version: 'next' } });

  nextPending.resolve('next-batch');
  await nextRun.promise;
  oldPending.resolve('old-batch');
  await oldRun.promise;

  const today = coordinator.acquire({ identity: 'next', request: { version: 'next' }, mode: 'today' });
  assert.equal(today.source, 'ready');
  assert.equal(await today.promise, 'next-batch');
  assert.equal(coordinator.isLatest('next'), true);
});

test('failed prebuild is evicted so Today can full-compute', async () => {
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({
    execute: async () => {
      calls += 1;
      if (calls === 1) throw new Error('prebuild failed');
      return 'fallback-batch';
    },
  });
  await assert.rejects(
    coordinator.invalidateAndPrebuild({ identity: 'same', request: {} }).promise,
    /prebuild failed/,
  );
  const fallback = coordinator.acquire({ identity: 'same', request: {}, mode: 'today' });
  assert.equal(fallback.source, 'full-compute');
  assert.equal(await fallback.promise, 'fallback-batch');
  assert.equal(calls, 2);
});

test('request variants deduplicate independently without changing effective input owner', async () => {
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({
    execute: async (request) => {
      calls += 1;
      return request.kind;
    },
  });
  const initial = coordinator.acquire({
    identity: 'effective-input',
    requestKey: 'effective-input|initial',
    request: { kind: 'initial' },
  });
  const refresh = coordinator.acquire({
    identity: 'effective-input',
    requestKey: 'effective-input|refresh|batch-1',
    request: { kind: 'refresh' },
  });

  assert.deepEqual(await Promise.all([initial.promise, refresh.promise]), ['initial', 'refresh']);
  assert.equal(calls, 2);
  assert.equal(coordinator.isLatest('effective-input'), true);
});
