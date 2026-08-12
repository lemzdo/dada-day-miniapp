'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateCapturedRequest } = require('./collect-holdout');

function request(overrides = {}) {
  return {
    date: '2026-08-12',
    scene: '居家',
    timeOfDay: 'all_day',
    maxResults: 8,
    auditId: 'audit',
    weatherMode: 'cached',
    trigger: 'retry',
    ...overrides,
  };
}

test('holdout accepts the frozen production retry builder shape', () => {
  assert.equal(validateCapturedRequest(request(), 'home', 'initial').equivalentToRetryProductionBuilder, true);
});

test('holdout accepts production refresh only with exclusion state', () => {
  assert.doesNotThrow(() => validateCapturedRequest(request({
    trigger: 'refresh',
    recommendationBatchId: 'batch-1',
    excludedOutfitKeys: ['outfit-1'],
  }), 'home', 'refresh'));
  assert.throws(() => validateCapturedRequest(request({ trigger: 'refresh' }), 'home', 'refresh'), /not production refresh builder/);
});

test('weather fallback remains the production retry builder', () => {
  assert.doesNotThrow(() => validateCapturedRequest(request({ weatherMode: 'disabled' }), 'home', 'weather-fallback'));
  assert.throws(() => validateCapturedRequest(request(), 'home', 'weather-fallback'), /weather fallback/);
});
