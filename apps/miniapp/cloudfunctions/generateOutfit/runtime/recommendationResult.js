'use strict';

const REQUIRED_FIELDS = Object.freeze([
  ['identity', isRecord],
  ['executionState', isRecord],
  ['outfits', Array.isArray],
  ['narrativePlans', Array.isArray],
  ['evidence', isRecord],
  ['metadata', isRecord],
]);

function createRecommendationResult(fields = {}) {
  return assertRecommendationResult({
    identity: fields.identity,
    executionState: fields.executionState,
    outfits: fields.outfits,
    narrativePlans: fields.narrativePlans,
    evidence: fields.evidence,
    metadata: fields.metadata,
  });
}

function assertRecommendationResult(result) {
  if (!isRecord(result)
    || Object.keys(result).length !== REQUIRED_FIELDS.length
    || REQUIRED_FIELDS.some(([key, predicate]) => !Object.hasOwn(result, key) || !predicate(result[key]))) {
    throw new Error('RECOMMENDATION_CORE_RESULT_INVALID');
  }
  return result;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = { assertRecommendationResult, createRecommendationResult };
