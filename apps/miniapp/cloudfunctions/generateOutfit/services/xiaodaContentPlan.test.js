const assert = require('node:assert/strict');
const test = require('node:test');

const {
  XIAODA_CONTENT_PLAN_VERSION,
  buildXiaodaContentPlanV1,
  buildXiaodaDefaultReviewV1,
  hasQualifiedAiReviewIncrementV1,
  normalizeXiaodaSuggestionV1,
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
    copyContractVersion: 'recommendation-copy-contract-v8',
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

test('Style Insight semantic matching accepts natural color-relation synonyms', () => {
  const plan = buildXiaodaContentPlanV1(outfit({
    xiaodaStyleInsight: {
      version: 'xiaoda-style-insight-v1',
      primary: { code: 'SAME_COLOR_CORE' },
      secondary: [],
      optional: [],
    },
  }), {
    canonicalCopy: {
      todayReason: '灰色上衣和灰色下装用了同一个颜色。',
      detailExplanation: '灰色上衣和灰色下装保持同色。',
      xiaodaStyleInsight: {
        version: 'xiaoda-style-insight-v1',
        primary: { code: 'SAME_COLOR_CORE' },
        secondary: [],
        optional: [],
      },
    },
  });
  const result = hasQualifiedAiReviewIncrementV1({
    reason: '灰色上衣和灰色下装形成统一基调，鞋子留一点变化，整身干净利落又有层次。',
    tip: '',
    source: 'ai',
  }, plan, buildXiaodaDefaultReviewV1(plan));
  assert.equal(result.rejectReasons.includes('semantic_drift'), false);
});

test('color-focus semantic matching does not treat a negated support-item phrase as focal-role drift', () => {
  const plan = buildXiaodaContentPlanV1(outfit({
    scene: 'date',
    sceneIntent: 'date:clear_highlight',
    primaryBenefit: 'clear_highlight',
    outfitItemRoles: [
      { id: 'top-1', slot: 'top', role: 'core', displayName: '米白色印花T恤' },
      { id: 'bottom-1', slot: 'bottom', role: 'core', displayName: '军绿色阔腿裤' },
      { id: 'bag-1', slot: 'accessory', role: 'optional', displayName: '蓝色手提袋' },
    ],
    xiaodaStyleInsight: {
      version: 'xiaoda-style-insight-v1',
      primary: {
        code: 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT',
        subjectItemIds: ['bottom-1', 'top-1'],
      },
      secondary: [],
      optional: [],
    },
  }), {
    canonicalCopy: {
      todayReason: '军绿色阔腿裤是颜色重点，米白色印花T恤保持简单。',
      detailExplanation: '军绿色阔腿裤负责颜色重点，米白色印花T恤托住它。',
    },
  });
  const result = hasQualifiedAiReviewIncrementV1({
    reason: '军绿色阔腿裤是这身的颜色重点，米白色印花T恤保持简单，蓝色手提袋没有抢走焦点。',
    tip: '',
    source: 'ai',
  }, plan, buildXiaodaDefaultReviewV1(plan));

  assert.equal(result.rejectReasons.includes('semantic_drift'), false);
});

test('Style Insight semantic matching covers bottom-to-shoe color continuity', () => {
  const plan = buildXiaodaContentPlanV1(outfit({
    scene: 'sport',
    sceneIntent: 'sport:light_activity',
    primaryBenefit: 'light_activity',
    outfitItemRoles: [
      { id: 'top-1', slot: 'top', role: 'core', displayName: '米白色短袖T恤' },
      { id: 'bottom-1', slot: 'bottom', role: 'core', displayName: '白色短裤' },
      { id: 'shoes-1', slot: 'shoes', role: 'core', displayName: '白色运动鞋' },
    ],
    xiaodaStyleInsight: {
      version: 'xiaoda-style-insight-v1',
      primary: {
        code: 'BOTTOM_SHOE_COLOR_CONTINUITY',
        subjectItemIds: ['bottom-1', 'shoes-1'],
      },
      secondary: [],
      optional: [],
    },
  }), {
    canonicalCopy: {
      todayReason: '白色短裤和白色运动鞋的颜色接得上。',
      detailExplanation: '白色短裤配白色运动鞋，下半身颜色保持连续。',
    },
  });
  const result = hasQualifiedAiReviewIncrementV1({
    reason: '白色短裤和白色运动鞋颜色一致，让下身到脚部的过渡很顺，米白色短袖T恤保留一点变化。',
    tip: '',
    source: 'ai',
  }, plan, buildXiaodaDefaultReviewV1(plan));

  assert.equal(result.rejectReasons.includes('semantic_drift'), false);
});

test('Detail advice may refine the current combination but cannot replace or reselect garments', () => {
  const plan = buildXiaodaContentPlanV1(outfit({
    outfitItemRoles: [
      { id: 'top-1', slot: 'top', role: 'core', displayName: '白色短袖T恤' },
      { id: 'bottom-1', slot: 'bottom', role: 'core', displayName: '灰色短裤' },
      { id: 'shoes-1', slot: 'shoes', role: 'core', displayName: '白色运动鞋' },
    ],
  }));

  assert.equal(normalizeXiaodaSuggestionV1('可以把灰色短裤换成白色短裤。', plan), null);
  assert.equal(normalizeXiaodaSuggestionV1('可以另选一双灰白拼接运动鞋。', plan), null);
  assert.equal(
    normalizeXiaodaSuggestionV1('可以保留白色短袖T恤和白色运动鞋的呼应，不再增加其他亮色。', plan)?.text,
    '可以保留白色短袖T恤和白色运动鞋的呼应，不再增加其他亮色。',
  );
});
