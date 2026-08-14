const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRecommendationNarrativePlanV2 } = require('./recommendationNarrativePlanV2');
const { materializeFixture, recommendationStylingShadowV2Fixtures } = require('./recommendationStylingShadowV2.fixtures');
const { renderRecommendationSafeCopyV2, renderRecommendationSafeCopyV2Safely } = require('./recommendationSafeRendererV2');

const IDS = [
  'primary-pattern-focus', 'primary-silhouette-contrast', 'primary-monochromatic',
  'scene-primary-work-structure', 'weak-formality-only', 'sparse-low-confidence-pattern',
  'sparse-basic-no-evidence', 'competing-pattern-and-silhouette',
];

function entries() {
  return IDS.map((id) => {
    const fixture = recommendationStylingShadowV2Fixtures.find((item) => item.id === id);
    assert.ok(fixture, `missing fixture ${id}`);
    const recommendation = materializeFixture(fixture);
    return { fixture, recommendation, plan: buildRecommendationNarrativePlanV2(recommendation, { scene: fixture.scene }) };
  });
}

test('safe renderer is deterministic and covers primary, baseline, sparse, and competing fixtures', () => {
  for (const { plan, recommendation } of entries()) {
    const first = renderRecommendationSafeCopyV2(plan, recommendation);
    const second = renderRecommendationSafeCopyV2(plan, recommendation);
    assert.deepEqual(first, second);
    assert.ok(first.text.trim());
    assert.ok(first.garments.length > 0);
    assert.ok(first.garments.some((name) => first.text.includes(name)), `${plan.planId} is not garment grounded`);
    assert.match(first.text, /[\u4e00-\u9fff]/u);
  }
});

test('safe renderer only consumes canonical primary input and never legacy or secondary fields', () => {
  const { plan, recommendation } = entries()[0];
  const noisy = { ...recommendation, reason: 'legacy-copy', detailExplanation: 'legacy-detail', selectedSecondary: { meaning: 'forbidden' }, profile: { secret: true } };
  const copy = renderRecommendationSafeCopyV2(plan, noisy);
  assert.equal(copy.text.includes('legacy-copy'), false);
  assert.equal(copy.text.includes('forbidden'), false);
  assert.equal(JSON.stringify(copy).includes('secret'), false);
  assert.equal(copy.insightId, plan.insights.primary?.insightId || null);
});

test('safe renderer fail-open is explicit for malformed plans', () => {
  const result = renderRecommendationSafeCopyV2Safely({}, {});
  assert.equal(result.status, 'failed_open');
  assert.equal(result.copy, null);
});
