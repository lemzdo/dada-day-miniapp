'use strict';

const { assertRecommendationResult } = require('./recommendationResult');

function normalizeInput(input = {}) {
  return {
    ...input,
    ...(typeof input.scene === 'string' ? { scene: input.scene.trim() } : {}),
    maxResults: Math.max(0, Math.min(8, Number(input.maxResults) || 8)),
  };
}

async function runRecommendationCore(input = {}, context = {}) {
  const implementation = context.computeRecommendation;
  if (typeof implementation !== 'function') throw new Error('RECOMMENDATION_CORE_REQUIRED');
  return assertRecommendationResult(await implementation(input, context));
}

module.exports = { normalizeInput, runRecommendationCore, assertResult: assertRecommendationResult };
