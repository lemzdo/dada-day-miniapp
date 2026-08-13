'use strict';
const { buildRecommendationNarrativePlanV2 } = require('../../cloudfunctions/generateOutfit/services/recommendationNarrativePlanV2');
const { materializeFixture, recommendationStylingShadowV2Fixtures } = require('../../cloudfunctions/generateOutfit/services/recommendationStylingShadowV2.fixtures');
const { runRecommendationVoiceRendererBenchmarkV2Safely } = require('../../cloudfunctions/generateOutfit/services/recommendationVoiceRendererShadowV2');

function buildBenchmarkCases(ids = ['primary-pattern-focus', 'primary-silhouette-contrast', 'primary-monochromatic', 'scene-primary-work-structure', 'weak-formality-only', 'sparse-basic-no-evidence']) {
  return ids.map((id) => recommendationStylingShadowV2Fixtures.find((fixture) => fixture.id === id)).filter(Boolean).map((fixture) => { const recommendation = materializeFixture(fixture); return { plan: buildRecommendationNarrativePlanV2(recommendation, { scene: fixture.scene }), recommendation }; });
}

function createStubInvoke() {
  return async ({ request }) => {
    const inputs = JSON.parse(request.messages[1].content);
    return { status: 200, body: { model: 'qwen3.7-max', usage: { prompt_tokens: inputs.length * 10, completion_tokens: inputs.length * 5, total_tokens: inputs.length * 15 }, choices: [{ message: { content: JSON.stringify(inputs.map((input) => ({ planId: input.planId, insightId: input.primary?.insightId || null, text: input.primary?.meaning || `${input.garments[0]}是一套简单日常的搭配。` }))) } }] } };
  };
}

async function runLocalBenchmark() {
  const entries = buildBenchmarkCases();
  return runRecommendationVoiceRendererBenchmarkV2Safely({ plans: entries.map((e) => e.plan), recommendations: entries.map((e) => e.recommendation), apiKey: 'stub', cacheMode: 'bypass', invoke: createStubInvoke() });
}

if (require.main === module) runLocalBenchmark().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`));
module.exports = { buildBenchmarkCases, createStubInvoke, runLocalBenchmark };
