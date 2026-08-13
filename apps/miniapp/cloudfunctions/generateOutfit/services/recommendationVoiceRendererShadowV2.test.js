const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRecommendationNarrativePlanV2 } = require('./recommendationNarrativePlanV2');
const { materializeFixture, recommendationStylingShadowV2Fixtures } = require('./recommendationStylingShadowV2.fixtures');
const voice = require('./recommendationVoiceRendererShadowV2');

function cases() {
  return ['primary-pattern-focus', 'primary-silhouette-contrast', 'primary-monochromatic', 'scene-primary-work-structure', 'weak-formality-only', 'sparse-basic-no-evidence']
    .map((id) => recommendationStylingShadowV2Fixtures.find((fixture) => fixture.id === id))
    .map((fixture) => ({ plan: buildRecommendationNarrativePlanV2(materializeFixture(fixture), { scene: fixture.scene }), recommendation: materializeFixture(fixture) }));
}

function invokeStub(counter) {
  return async ({ request }) => {
    counter.count += 1;
    const inputs = JSON.parse(request.messages[1].content);
    return { status: 200, body: { model: 'qwen3.7-max', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, choices: [{ message: { content: JSON.stringify(inputs.map((input) => ({ planId: input.planId, insightId: input.primary?.insightId || null, text: input.primary?.meaning || `${input.garments[0]}是一套简单日常的搭配。` }))) } }] } };
  };
}

test('production-shaped plans become minimal primary/baseline renderer inputs', async () => {
  const entries = cases();
  const result = await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: entries.map((entry) => entry.plan), recommendations: entries.map((entry) => entry.recommendation), apiKey: 'stub', cacheMode: 'bypass', includeReview: true, invoke: invokeStub({ count: 0 }) });
  assert.equal(result.status, 'completed');
  assert.ok(result.reviewSamples.some((sample) => sample.expressionMode === 'primary'));
  assert.ok(result.reviewSamples.some((sample) => sample.expressionMode === 'baseline'));
});

test('renderer projection cannot see legacy copy, candidates, secondary, profile, or raw wardrobe', () => {
  const [entry] = cases();
  entry.recommendation.reason = 'legacy reason must not enter renderer';
  entry.recommendation.detailExplanation = 'legacy detail must not enter renderer';
  entry.recommendation.profile = { nickname: 'private' };
  entry.recommendation.wardrobe = [{ imageUrl: 'private' }];
  const input = voice.buildRendererInputFromNarrativePlan(entry.plan, entry.recommendation);
  const serialized = JSON.stringify(input);
  for (const forbidden of ['legacy reason', 'legacy detail', 'nickname', 'imageUrl', 'candidates', 'selectedSecondary']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(Object.keys(input).sort(), [
    'allowedClaims', 'expressionMode', 'garments', 'inputVersion', 'languageConstraints',
    'planId', 'primary', 'surface', 'task', 'personaVersion',
  ].sort());
});

test('fail-open and cache reuse preserve plan identity', async () => {
  voice.clearRecommendationVoiceRendererShadowCache();
  const [entry] = cases(); const counter = { count: 0 };
  const first = await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: [entry.plan], recommendations: [entry.recommendation], apiKey: 'stub', invoke: invokeStub(counter) });
  const second = await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: [entry.plan], recommendations: [entry.recommendation], apiKey: 'stub', invoke: invokeStub(counter) });
  assert.equal(first.requestCount, 1); assert.equal(second.requestCount, 0); assert.equal(second.cacheHitCount, 1); assert.equal(counter.count, 1);
  const failed = await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: [entry.plan], recommendations: [entry.recommendation], apiKey: null, cacheMode: 'bypass' });
  assert.equal(failed.status, 'failed_open');
});

test('single and batch bind exact plans and aggregate requests/tokens', async () => {
  voice.clearRecommendationVoiceRendererShadowCache(); const entries = cases().slice(0, 3); const singleCounter = { count: 0 }; const batchCounter = { count: 0 };
  const single = await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: entries.map((e) => e.plan), recommendations: entries.map((e) => e.recommendation), apiKey: 'stub', mode: 'single', cacheMode: 'bypass', invoke: invokeStub(singleCounter) });
  const batch = await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: entries.map((e) => e.plan), recommendations: entries.map((e) => e.recommendation), apiKey: 'stub', mode: 'batch', cacheMode: 'bypass', invoke: invokeStub(batchCounter) });
  assert.equal(single.requestCount, 3); assert.equal(batch.requestCount, 1); assert.equal(singleCounter.count, 3); assert.equal(batchCounter.count, 1);
  assert.deepEqual(single.planIdentities.map((x) => x.planHash), batch.planIdentities.map((x) => x.planHash));
  assert.equal(batch.usage.totalTokens, 15);
  const benchmark = await voice.runRecommendationVoiceRendererBenchmarkV2Safely({ plans: entries.map((e) => e.plan), recommendations: entries.map((e) => e.recommendation), apiKey: 'stub', cacheMode: 'bypass', invoke: invokeStub({ count: 0 }) });
  assert.equal(benchmark.samePlanSet, true);
  assert.equal(benchmark.qualityNotDegraded, true);
  assert.equal(benchmark.single.automatedContract.failCount, 0);
  assert.equal(benchmark.batch.automatedContract.failCount, 0);
  assert.equal(benchmark.cacheProbe.requestCount, 0);
  assert.equal(benchmark.cacheProbe.cacheHitCount, entries.length);
});

test('feature flag and authorization are explicit', () => {
  const event = {}; assert.equal(voice.isRecommendationVoiceRendererShadowEnabled(event, {}), false);
  voice.authorizeRecommendationVoiceRendererBenchmark(event, { compare: true });
  assert.equal(voice.isRecommendationVoiceRendererShadowEnabled(event, {}), true);
});

test('benchmark preserves independently failed-open single, batch, and cache probe diagnostics', async () => {
  const [entry] = cases();
  const result = await voice.runRecommendationVoiceRendererBenchmarkV2Safely({
    plans: [entry.plan], recommendations: [entry.recommendation], apiKey: null,
  });
  assert.equal(result.status, 'partially_failed_open');
  assert.equal(result.single.status, 'failed_open');
  assert.equal(result.batch.status, 'failed_open');
  assert.equal(result.cacheProbe.status, 'failed_open');
  assert.equal(Object.keys(result.single.failureCodes).length, 1);
});

test('cross-plan check ignores overlapping garment labels such as T恤 and 短袖T恤', async () => {
  const entries = cases().slice(0, 2);
  entries[0].recommendation.items[0].customName = 'T恤';
  entries[1].recommendation.items[0].customName = '短袖T恤';
  const result = await voice.runRecommendationVoiceRendererShadowV2Safely({
    plans: entries.map((entry) => entry.plan), recommendations: entries.map((entry) => entry.recommendation),
    apiKey: 'stub', mode: 'batch', cacheMode: 'bypass', invoke: invokeStub({ count: 0 }),
  });
  assert.equal(result.automatedContract.failureCounts.CROSS_PLAN_CONTAMINATION, undefined);
});

test('home relaxed paraphrases preserve the authorized scene meaning', async () => {
  assert.deepEqual(voice.validateMeaningPreservation(
    'SCENE_HOME_RELAXED_STRUCTURE:items:evidence',
    '吊带裙组成适合居家的放松组合。',
    '吊带裙很适合居家放松时穿。',
  ), []);
});
