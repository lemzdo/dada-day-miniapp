const assert = require('node:assert/strict');
const test = require('node:test');
const { createRecommendationInputCoordinator, createRecommendationIntentRegistry, shouldPreserveRecommendationLifecycle } = require('./recommendationIntent');

test('deferred input does not dispatch, ready releases exactly once', () => {
  const coordinator = createRecommendationInputCoordinator();
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'deferred' }).dispatch, false);
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'ready' }).dispatch, true);
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'ready' }).dispatch, false);
});

test('unavailable input releases exactly once and same identity remains deduplicated', () => {
  const coordinator = createRecommendationInputCoordinator();
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'unavailable' }).dispatch, true);
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'unavailable' }).dispatch, false);
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'ready' }).dispatch, false);
});

test('identity change permits a new release and reset permits a new lifecycle', () => {
  const coordinator = createRecommendationInputCoordinator();
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'ready' }).dispatch, true);
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|2', readiness: 'ready' }).dispatch, true);
  coordinator.reset();
  assert.equal(coordinator.report({ inputIdentity: 'u|scene|1', readiness: 'ready' }).dispatch, true);
});

test('pending registry survives same-identity authenticated adoption', async () => {
  const registry = require('./recommendationIntent').createRecommendationIntentRegistry();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = registry.run({ intentId: 'entry', inputSignature: 'same', execute: async () => pending });
  assert.equal(registry.hasInFlight(), true);
  assert.equal(registry.run({ intentId: 'entry', inputSignature: 'same', execute: async () => false }).joined, true);
  release();
  await first.promise;
  assert.equal(registry.hasInFlight(), false);
});

test('same identity dispatch=false still joins pending registry execution once', async () => {
  const coordinator = createRecommendationInputCoordinator();
  const registry = createRecommendationIntentRegistry();
  let executeCount = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  assert.equal(coordinator.report({ inputIdentity: 'same', readiness: 'ready' }).dispatch, true);
  const first = registry.run({ intentId: 'same', inputSignature: 'same', execute: async () => { executeCount += 1; return pending; } });
  assert.equal(coordinator.report({ inputIdentity: 'same', readiness: 'ready' }).dispatch, false);
  const joined = registry.run({ intentId: 'same', inputSignature: 'same', execute: async () => { executeCount += 1; return false; } });
  assert.equal(joined.joined, true);
  assert.equal(executeCount, 1);
  release();
  await first.promise;
});

test('same identity after settled failure can retry despite coordinator dispatch=false', async () => {
  const coordinator = createRecommendationInputCoordinator();
  const registry = createRecommendationIntentRegistry();
  assert.equal(coordinator.report({ inputIdentity: 'same', readiness: 'ready' }).dispatch, true);
  await registry.run({ intentId: 'same', inputSignature: 'same', execute: async () => { throw new Error('failed'); } }).promise.catch(() => {});
  assert.equal(coordinator.report({ inputIdentity: 'same', readiness: 'ready' }).dispatch, false);
  let calls = 0;
  await registry.run({ intentId: 'same', inputSignature: 'same', execute: async () => { calls += 1; return true; } }).promise;
  assert.equal(calls, 1);
});

test('adoption policy preserves only first authenticated pending lifecycle', () => {
  assert.equal(shouldPreserveRecommendationLifecycle(null, true), true);
  assert.equal(shouldPreserveRecommendationLifecycle('userA', true), false);
  assert.equal(shouldPreserveRecommendationLifecycle(null, false), false);
});
