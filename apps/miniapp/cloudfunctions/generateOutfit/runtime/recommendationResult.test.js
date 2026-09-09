'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertRecommendationResult, createRecommendationResult } = require('./recommendationResult');

function fixture() {
  return {
    identity: {}, executionState: {}, outfits: [], narrativePlans: [], evidence: {}, metadata: {},
  };
}

test('recommendation result preserves the six-field core boundary', () => {
  assert.deepEqual(Object.keys(createRecommendationResult(fixture())), [
    'identity', 'executionState', 'outfits', 'narrativePlans', 'evidence', 'metadata',
  ]);
});

test('recommendation result rejects transport and persistence-shaped partial values', () => {
  assert.throws(() => assertRecommendationResult({ response: {}, batchId: 'batch-1' }), /RECOMMENDATION_CORE_RESULT_INVALID/);
  assert.throws(() => assertRecommendationResult({ ...fixture(), response: {} }), /RECOMMENDATION_CORE_RESULT_INVALID/);
});
