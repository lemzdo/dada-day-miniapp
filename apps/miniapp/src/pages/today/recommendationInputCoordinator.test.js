const assert = require('node:assert/strict');
const test = require('node:test');
const { createRecommendationInputCoordinator } = require('./recommendationIntent');

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
