const assert = require('node:assert/strict');
const test = require('node:test');

const {
  XIAODA_CONTENT_PLAN_VERSION,
  buildXiaodaContentPlanV1,
  buildXiaodaDefaultReviewV1,
  hasQualifiedAiReviewIncrementV1,
  renderXiaodaPlanTextV1,
} = require('./xiaodaContentPlan');

function outfit(overrides = {}) {
  return {
    outfitKey: 'top_bottom_shoes',
    scene: 'work',
    sceneIntent: 'work:walkable',
    primaryBenefit: 'commute_polish',
    outfitItemRoles: [
      { id: 'top-1', slot: 'top', role: 'core', displayName: 'White shirt' },
      { id: 'bottom-1', slot: 'bottom', role: 'core', displayName: 'Black trousers' },
      { id: 'shoes-1', slot: 'shoes', role: 'core', displayName: 'Loafers' },
    ],
    ...overrides,
  };
}

test('public content-plan functions remain structural and create no default sentence', () => {
  const plan = buildXiaodaContentPlanV1(outfit());

  assert.equal(plan.version, XIAODA_CONTENT_PLAN_VERSION);
  assert.equal(plan.sceneIntent, 'work:walkable');
  assert.deepEqual(plan.items.map((item) => item.role), ['core', 'core', 'core']);
  assert.equal(plan.suggestion, null);
  assert.equal(plan.defaultTodayReason, '');
  assert.equal(plan.defaultDetailExplanation, '');
  assert.deepEqual(renderXiaodaPlanTextV1(plan), {
    bodyParagraphs: [],
    suggestion: null,
  });
  assert.deepEqual(buildXiaodaDefaultReviewV1(plan), {
    source: 'rule_default',
    reason: '',
    tip: '',
    contentPlanVersion: XIAODA_CONTENT_PLAN_VERSION,
    sceneIntent: 'work:walkable',
    primaryBenefitCode: 'commute_polish',
  });
});

test('content plan copies canonical Contract text byte-for-byte without suggestions', () => {
  const canonicalCopy = {
    copyContractVersion: 'recommendation-copy-contract-v3',
    voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2',
    todayReason: '衬衫配直筒裤，上班穿比较利落。',
    detailExplanation: '这条裤子弹性不错，坐着办公久一点也不容易勒。',
    todayAction: 'W01-01',
    todayDimension: 'scene',
    todayEvidenceIds: ['item:top-1:shirt', 'item:bottom-1:straight_pants'],
    todaySentenceClusterId: 'W01-01',
    detailAction: 'W02-01',
    detailDimension: 'comfort',
    detailEvidenceIds: ['item:bottom-1:flexible'],
    detailSentenceClusterId: 'W02-01',
    riskFlags: [],
  };
  const plan = buildXiaodaContentPlanV1(outfit(), { canonicalCopy });

  assert.equal(plan.defaultTodayReason, canonicalCopy.todayReason);
  assert.equal(plan.defaultDetailExplanation, canonicalCopy.detailExplanation);
  assert.equal(plan.defaultCopy.todayReason, canonicalCopy.todayReason);
  assert.equal(plan.defaultCopy.detailExplanation, canonicalCopy.detailExplanation);
  assert.deepEqual(plan.defaultCopy, canonicalCopy);
  assert.deepEqual(renderXiaodaPlanTextV1(plan), {
    bodyParagraphs: [canonicalCopy.detailExplanation],
    suggestion: null,
  });
  assert.equal(buildXiaodaDefaultReviewV1(plan).reason, canonicalCopy.detailExplanation);
  assert.equal(buildXiaodaDefaultReviewV1(plan).tip, '');
});

test('compatibility renderers return empty text when canonical fields are absent', () => {
  const plan = {
    version: XIAODA_CONTENT_PLAN_VERSION,
    sceneIntent: 'home:clean_daily',
    primaryBenefit: 'clean_daily',
    items: [{ id: 'top-1', slot: 'top', role: 'core', displayName: 'T-shirt' }],
    suggestion: { text: 'Legacy generated suggestion must not escape.' },
  };

  assert.deepEqual(renderXiaodaPlanTextV1(plan), { bodyParagraphs: [], suggestion: null });
  assert.equal(buildXiaodaDefaultReviewV1(plan).reason, '');
  assert.equal(buildXiaodaDefaultReviewV1(plan).tip, '');
});

test('AI qualification helper can preserve a real grounded AI review independently', () => {
  const plan = buildXiaodaContentPlanV1(outfit(), {
    canonicalCopy: {
      todayReason: 'Contract today.',
      detailExplanation: 'Contract default explanation for this outfit.',
    },
  });
  const aiReview = {
    reason: 'White shirt把上半身重点交代清楚，Black trousers稳住通勤状态，Loafers也方便今天多走几步。',
    tip: '',
    source: 'cached_ai',
  };

  const result = hasQualifiedAiReviewIncrementV1(aiReview, plan, buildXiaodaDefaultReviewV1(plan));

  assert.equal(result.qualified, true);
  assert.equal(result.aiComment.reason, aiReview.reason.replace(/\s+/g, ''));
  assert.equal(result.aiComment.tip, '');
  assert.equal(result.aiComment.source, aiReview.source);
});
