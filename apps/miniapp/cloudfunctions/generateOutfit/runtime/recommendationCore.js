'use strict';

function normalizeInput(input = {}) {
  return {
    ...input,
    ...(typeof input.scene === 'string' ? { scene: input.scene.trim() } : {}),
    maxResults: Math.max(0, Math.min(8, Number(input.maxResults) || 8)),
  };
}

function assertResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('RECOMMENDATION_CORE_RESULT_INVALID');
  const required = [
    ['identity', (value) => value && typeof value === 'object' && !Array.isArray(value)],
    ['executionState', (value) => value && typeof value === 'object' && !Array.isArray(value)],
    ['outfits', Array.isArray],
    ['narrativePlans', Array.isArray],
    ['evidence', (value) => value && typeof value === 'object' && !Array.isArray(value)],
    ['metadata', (value) => value && typeof value === 'object' && !Array.isArray(value)],
  ];
  if (required.some(([key, predicate]) => !Object.prototype.hasOwnProperty.call(result, key) || !predicate(result[key]))) {
    throw new Error('RECOMMENDATION_CORE_RESULT_INVALID');
  }
  return result;
}

async function runRecommendationCore(input = {}, context = {}) {
  const implementation = context.computeRecommendation;
  if (typeof implementation !== 'function') throw new Error('RECOMMENDATION_CORE_REQUIRED');
  return assertResult(await implementation(input, context));
}

module.exports = { normalizeInput, runRecommendationCore, assertResult };
