'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */

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

test('next prefetch is one slot, duplicate prepares join, and ready promotes without compute', async () => {
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({ execute: async () => { calls += 1; return 'next'; } });
  const first = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: {} });
  const duplicate = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: {} });
  assert.equal(calls, 1);
  assert.equal(duplicate.joined, true);
  await first.promise;
  const promoted = coordinator.acquireNext({ identity: 'input-a', requestKey: 'next-a' });
  assert.equal(promoted.source, 'next-ready');
  assert.equal(await promoted.promise, 'next');
  assert.equal(calls, 1);
});

test('running next promotion joins the same request and failed next falls back', async () => {
  const pending = deferred();
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({ execute: () => { calls += 1; return pending.promise; } });
  const running = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: {} });
  const joined = coordinator.acquireNext({ identity: 'input-a', requestKey: 'next-a' });
  assert.equal(joined.source, 'next-running');
  assert.equal(joined.promise, running.promise);
  pending.resolve('joined');
  assert.equal(await joined.promise, 'joined');

  const failed = createRecommendationCoordinatorCore({ execute: async () => { throw new Error('prefetch'); } });
  await assert.rejects(failed.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: {} }).promise);
  assert.equal(failed.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: {} }).source, 'next-failed');
  const failedAcquire = failed.acquireNext({ identity: 'input-a', requestKey: 'next-a' });
  assert.equal(failedAcquire.source, 'next-failed');
  await failedAcquire.promise;
  assert.equal(calls, 1);
});

test('concurrent running next consumers both join before promotion settles', async () => {
  const pending = deferred();
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({ execute: () => { calls += 1; return pending.promise; } });
  const prepared = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: {} });
  const first = coordinator.acquireNext({ identity: 'input-a', requestKey: 'next-a' });
  const second = coordinator.acquireNext({ identity: 'input-a', requestKey: 'next-a' });
  assert.equal(first.source, 'next-running');
  assert.equal(second.source, 'next-running');
  assert.equal(first.promise, prepared.promise);
  assert.equal(second.promise, prepared.promise);
  assert.equal(calls, 1);
  pending.resolve('promoted');
  assert.equal(await first.promise, 'promoted');
  const successor = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-b', request: {} });
  assert.equal(successor.joined, false);
  pending.resolve('ignored');
});

test('input mutation invalidates next ready and stale running cannot promote', async () => {
  const pending = deferred();
  const coordinator = createRecommendationCoordinatorCore({ execute: (request) => request.version === 'a' ? pending.promise : Promise.resolve('b') });
  const stale = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: { version: 'a' } });
  coordinator.setLatestIdentity('input-b');
  pending.resolve('stale-a');
  await stale.promise;
  const missing = coordinator.acquireNext({ identity: 'input-b', requestKey: 'next-a' });
  assert.equal(missing.source, 'next-missing');
  await missing.promise;
  const fresh = coordinator.prepareNext({ identity: 'input-b', requestKey: 'next-b', request: { version: 'b' } });
  assert.equal(await fresh.promise, 'b');
  assert.equal((await coordinator.acquireNext({ identity: 'input-b', requestKey: 'next-b' }).promise), 'b');
});

test('input mutation invalidates an already settled next-ready slot', async () => {
  const coordinator = createRecommendationCoordinatorCore({ execute: async () => 'ready-a' });
  const prepared = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: {} });
  assert.equal(await prepared.promise, 'ready-a');
  assert.equal(coordinator.getNextState().status, 'ready');
  coordinator.setLatestIdentity('input-b');
  const invalidated = coordinator.acquireNext({ identity: 'input-b', requestKey: 'next-a' });
  assert.equal(invalidated.source, 'next-missing');
  await invalidated.promise;
});

test('same input with a new current-batch key replaces the old successor', async () => {
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({ execute: (request) => { calls += 1; return request.batch; } });
  await coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-batch-a', request: { batch: 'a' } }).promise;
  const replacement = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-batch-b', request: { batch: 'b' } });
  assert.equal(replacement.joined, false);
  assert.equal(await replacement.promise, 'b');
  assert.equal(calls, 2);
  assert.equal(coordinator.acquireNext({ identity: 'input-a', requestKey: 'next-batch-a' }).source, 'next-missing');
  assert.equal(coordinator.acquireNext({ identity: 'input-a', requestKey: 'next-batch-b' }).source, 'next-ready');
});

test('successful promotion permits exactly one successor prefetch', async () => {
  let calls = 0;
  const coordinator = createRecommendationCoordinatorCore({ execute: (request) => { calls += 1; return request.id; } });
  await coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-a', request: { id: 'batch-2' } }).promise;
  const promoted = coordinator.acquireNext({ identity: 'input-a', requestKey: 'next-a' });
  assert.equal(await promoted.promise, 'batch-2');
  const next = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-b', request: { id: 'batch-3' } });
  const duplicate = coordinator.prepareNext({ identity: 'input-a', requestKey: 'next-b', request: { id: 'ignored' } });
  assert.equal(duplicate.joined, true);
  assert.equal(await next.promise, 'batch-3');
  assert.equal(calls, 2);
});
