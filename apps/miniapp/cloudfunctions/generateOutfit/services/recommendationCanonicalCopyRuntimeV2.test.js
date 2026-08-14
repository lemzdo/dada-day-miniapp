const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRecommendationNarrativePlanV2 } = require('./recommendationNarrativePlanV2');
const { materializeFixture, recommendationStylingShadowV2Fixtures } = require('./recommendationStylingShadowV2.fixtures');
const voice = require('./recommendationVoiceRendererShadowV2');
const runtime = require('./recommendationCanonicalCopyRuntimeV2');

function makeEntries(count = 3) {
  return recommendationStylingShadowV2Fixtures.slice(0, count).map((fixture) => {
    const recommendation = materializeFixture(fixture);
    return { fixture, recommendation, plan: buildRecommendationNarrativePlanV2(recommendation, { scene: fixture.scene }) };
  });
}

function invokeStub() {
  return async ({ request }) => {
    const inputs = JSON.parse(request.messages[1].content);
    return { status: 200, body: { model: 'qwen3.7-max', choices: [{ message: { content: JSON.stringify(inputs.map((input) => ({ planId: input.planId, insightId: input.primary?.insightId || null, text: `${input.garments[0]}搭配得很自然。` }))) } }] } };
  };
}

test('canonical batch fixes batchTotal to the complete returned outfit batch on first response', () => {
  const entries = makeEntries();
  const outfits = entries.map(({ recommendation }) => ({
    ...recommendation,
    reason: 'legacy',
    copyContract: { todayReason: 'legacy' },
  }));
  const batch = runtime.buildRecommendationCanonicalCopyBatchV2({ plans: entries.map((x) => x.plan), recommendations: outfits });
  const attached = runtime.attachRecommendationCanonicalCopiesV2(outfits, batch);
  assert.equal(attached.length, outfits.length);
  assert.deepEqual(attached.map((item) => item.canonicalRecommendationCopyV2.batchTotal), [3, 3, 3]);
  assert.deepEqual(attached.map((item) => item.canonicalRecommendationCopyV2.batchIndex), [0, 1, 2]);
  assert.deepEqual(
    attached.map((item) => item.copyContract.todayReason),
    attached.map((item) => item.canonicalRecommendationCopyV2.text),
  );
  assert.deepEqual(
    attached.map((item) => item.reason),
    attached.map((item) => item.canonicalRecommendationCopyV2.text),
  );
});

test('source precedence is ai_cache then safe then legacy emergency', async () => {
  voice.clearRecommendationVoiceRendererShadowCache();
  const entries = makeEntries(1);
  const [entry] = entries;
  const safeBatch = runtime.buildRecommendationCanonicalCopyBatchV2({ plans: [entry.plan], recommendations: [entry.recommendation] });
  assert.equal(safeBatch.copies[0].source, 'safe');

  await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: [entry.plan], recommendations: [entry.recommendation], apiKey: 'stub', cacheMode: 'use', invoke: invokeStub() });
  const cachedBatch = runtime.buildRecommendationCanonicalCopyBatchV2({ plans: [entry.plan], recommendations: [entry.recommendation], aiMaterializationRequested: true });
  assert.equal(cachedBatch.copies[0].source, 'ai_cache');
  assert.equal(cachedBatch.copies[0].aiState, 'ready');

  const failedBatch = runtime.buildRecommendationCanonicalCopyBatchV2({ plans: [{}], recommendations: [entry.recommendation] });
  assert.equal(failedBatch.copies.length, 0);
  assert.equal(failedBatch.status, 'partially_failed_open');
});

test('first safe result is a stable snapshot and later async cache materialization cannot rewrite it', async () => {
  voice.clearRecommendationVoiceRendererShadowCache();
  const [entry] = makeEntries(1);
  const first = runtime.buildRecommendationCanonicalCopyBatchV2({ plans: [entry.plan], recommendations: [entry.recommendation] });
  const attached = runtime.attachRecommendationCanonicalCopiesV2([entry.recommendation], first);
  const firstText = attached[0].canonicalRecommendationCopyV2.text;
  await voice.runRecommendationVoiceRendererShadowV2Safely({ plans: [entry.plan], recommendations: [entry.recommendation], apiKey: 'stub', cacheMode: 'use', invoke: invokeStub() });
  const later = runtime.buildRecommendationCanonicalCopyBatchV2({ plans: [entry.plan], recommendations: [entry.recommendation] });
  assert.equal(attached[0].canonicalRecommendationCopyV2.text, firstText);
  assert.notEqual(later.copies[0].source, first.copies[0].source);
});

test('partial plan failure is fail-open and never changes outfit count', () => {
  const entries = makeEntries(3);
  const outfits = entries.map(({ recommendation }) => ({ ...recommendation }));
  const batch = runtime.buildRecommendationCanonicalCopyBatchV2({ plans: entries.slice(0, 2).map((x) => x.plan), recommendations: outfits });
  const attached = runtime.attachRecommendationCanonicalCopiesV2(outfits, batch);
  assert.equal(batch.status, 'partially_failed_open');
  assert.equal(attached.length, outfits.length);
});
