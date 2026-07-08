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

const MECHANICAL_COPY_PATTERN = /主线|清楚的亮点|亮点已经落在|更稳|保持简单|单品和单品|想再明确一点|能确认的主要|已有单品本身|不需要强行/;

function outfit(overrides = {}) {
  return {
    outfitKey: 'top_bottom_shoes',
    scene: '上班',
    sceneIntent: 'work:walkable',
    primaryBenefit: 'walkable_commute',
    secondaryBenefit: 'temperature_buffer',
    weatherSnapshot: { temp: 18, weather: '多云' },
    outfitItemRoles: [
      { id: 'top', slot: 'top', role: 'core', displayName: '白衬衫' },
      { id: 'bottom', slot: 'bottom', role: 'core', displayName: '黑色长裤' },
      { id: 'shoes', slot: 'shoes', role: 'core', displayName: '乐福鞋' },
    ],
    snapshotItems: [
      { itemId: 'top', category: 'top', name: '白衬衫' },
      { itemId: 'bottom', category: 'bottom', name: '黑色长裤' },
      { itemId: 'shoes', category: 'shoes', name: '乐福鞋' },
    ],
    ...overrides,
  };
}

function visible(plan) {
  return [
    ...renderXiaodaPlanTextV1(plan).bodyParagraphs,
    renderXiaodaPlanTextV1(plan).suggestion?.text,
  ].filter(Boolean).join('\n');
}

test('content plan has stable structure, item roles and default readable copy', () => {
  const plan = buildXiaodaContentPlanV1(outfit());
  const text = renderXiaodaPlanTextV1(plan);

  assert.equal(plan.version, XIAODA_CONTENT_PLAN_VERSION);
  assert.equal(plan.sceneIntent, 'work:walkable');
  assert.deepEqual(plan.items.map((item) => item.role), ['core', 'core', 'core']);
  assert.ok(text.bodyParagraphs.length > 0);
  assert.doesNotMatch(visible(plan), /\b(top|bottom|shoes|outerwear|accessory|onepiece|category|subcategory|slot)\b/i);
  assert.doesNotMatch(visible(plan), MECHANICAL_COPY_PATTERN);
});

test('home T-shirt shorts sneakers default review is short and natural', () => {
  const plan = buildXiaodaContentPlanV1(outfit({
    scene: 'home',
    sceneIntent: 'home:quick_outing',
    primaryBenefit: 'walkable',
    secondaryBenefit: '',
    outfitItemRoles: [
      { id: 'top', slot: 'top', role: 'core', displayName: 'T恤' },
      { id: 'bottom', slot: 'bottom', role: 'core', displayName: '短裤' },
      { id: 'shoes', slot: 'shoes', role: 'core', displayName: '运动鞋' },
    ],
  }));
  const fallback = buildXiaodaDefaultReviewV1(plan);

  assert.equal(fallback.reason, 'T恤、短裤和运动鞋都偏日常，在家穿不费心，临时出门也不用重新换鞋。');
  assert.doesNotMatch(fallback.reason, MECHANICAL_COPY_PATTERN);
});

test('home soft mood fallback does not leak date scene language', () => {
  const plan = buildXiaodaContentPlanV1(outfit({
    scene: 'home',
    sceneIntent: 'home:clean_daily',
    primaryBenefit: 'soft_mood',
    secondaryBenefit: '',
    outfitItemRoles: [
      { id: 'top', slot: 'top', role: 'core', displayName: '米白 T恤' },
      { id: 'bottom', slot: 'bottom', role: 'core', displayName: '军绿色阔腿裤' },
      { id: 'shoes', slot: 'shoes', role: 'core', displayName: '白色运动鞋' },
    ],
  }));
  const text = visible(plan);

  assert.doesNotMatch(text, /约会|能确认的主要|已有单品本身|不需要强行/);
  assert.match(text, /居家|日常|轻松|柔和/);
});

test('suggestion is hidden when it lacks a grounded target action and object', () => {
  const noSuggestion = buildXiaodaContentPlanV1(outfit({ primaryBenefit: 'clean_daily', secondaryBenefit: '' }));
  const vague = normalizeXiaodaSuggestionV1('想再明确一点，可以调整一下。', noSuggestion);

  assert.equal(noSuggestion.suggestion, null);
  assert.equal(vague, null);
  assert.equal(renderXiaodaPlanTextV1(noSuggestion).suggestion, null);
});

test('grounded suggestion names the target action and real object', () => {
  const plan = buildXiaodaContentPlanV1(outfit({
    secondaryBenefit: 'temperature_buffer',
    outfitItemRoles: [
      { id: 'top', slot: 'top', role: 'core', displayName: '白衬衫' },
      { id: 'bottom', slot: 'bottom', role: 'core', displayName: '黑色长裤' },
      { id: 'shoes', slot: 'shoes', role: 'core', displayName: '乐福鞋' },
      { id: 'coat', slot: 'outerwear', role: 'functional', displayName: '薄外套' },
    ],
  }));

  assert.ok(plan.suggestion);
  assert.match(plan.suggestion.text, /薄外套/);
  assert.match(plan.suggestion.text, /带|拿|穿|换|留/);
});

test('default review and AI review use the same plan and only AI with information gain replaces it', () => {
  const plan = buildXiaodaContentPlanV1(outfit());
  const fallback = buildXiaodaDefaultReviewV1(plan);
  const emptyAi = {
    reason: '白衬衫和黑色长裤很日常，想再明确一点也可以。',
    tip: '想再明确一点，可以调整一下。',
    source: 'ai',
  };
  const usefulAi = {
    reason: '这套可以把白衬衫作为干净的上半身重点，黑色长裤负责压住通勤感，乐福鞋让走动时也不显得太随意。',
    tip: '如果今天走动比较多，可以保留乐福鞋作为主要鞋子，不再临时换不熟悉的新鞋。',
    source: 'ai',
  };

  assert.equal(hasQualifiedAiReviewIncrementV1(emptyAi, plan, fallback).qualified, false);
  assert.equal(hasQualifiedAiReviewIncrementV1(usefulAi, plan, fallback).qualified, true);
});

test('rejected AI leaves the default review available and accepted AI can replace it', () => {
  const plan = buildXiaodaContentPlanV1(outfit());
  const fallback = buildXiaodaDefaultReviewV1(plan);
  const rejectedAi = {
    reason: '',
    tip: '',
    source: 'ai',
  };
  const acceptedAi = {
    reason: '白衬衫、黑色长裤和乐福鞋都服务通勤场景，白衬衫看起来清楚，乐福鞋也方便今天多走几步。',
    tip: '如果今天走动比较多，可以保留乐福鞋，不临时换新鞋。',
    source: 'ai',
  };
  const rejected = hasQualifiedAiReviewIncrementV1(rejectedAi, plan, fallback);
  const accepted = hasQualifiedAiReviewIncrementV1(acceptedAi, plan, fallback);

  assert.equal(rejected.qualified, false);
  assert.equal(fallback.reason.length > 0, true);
  assert.equal(accepted.qualified, true);
  assert.equal(accepted.aiComment.reason, acceptedAi.reason);
});

test('old cached mechanical comments are not qualified until regenerated by user action', () => {
  const plan = buildXiaodaContentPlanV1(outfit());
  const fallback = buildXiaodaDefaultReviewV1(plan);
  const oldCache = {
    reason: '单品和单品很日常，整体比较完整，场景适配度比较高。',
    tip: '想再明确一点，可以优化配饰。',
    source: 'cached_ai',
  };
  const result = hasQualifiedAiReviewIncrementV1(oldCache, plan, fallback);

  assert.equal(result.qualified, false);
  assert.ok(result.rejectReasons.includes('empty_phrase'));
});

test('four scene families replay at least three batches with distinct content angles', () => {
  const plans = ['home', 'work', 'date', 'sport'].flatMap((scene) =>
    Array.from({ length: 3 }, (_, index) => buildXiaodaContentPlanV1(outfit({
      scene,
      sceneIntent: {
        home: ['home:indoor_relax', 'home:quick_outing', 'home:clean_daily'],
        work: ['work:polished', 'work:walkable', 'work:layered'],
        date: ['date:soft', 'date:highlight', 'date:casual'],
        sport: ['sport:training', 'sport:light_activity', 'sport:walk'],
      }[scene][index],
      primaryBenefit: `${scene}_benefit_${index}`,
      observationFocus: `focus_${index}`,
    }))),
  );
  const keys = plans.map((plan) => `${plan.sceneIntent}|${plan.primaryBenefit}|${plan.observations.join('|')}`);

  assert.equal(plans.length, 12);
  assert.equal(new Set(keys).size, 12);
});
