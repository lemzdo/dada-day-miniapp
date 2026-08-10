const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertFinalPresentation,
  buildCanonicalTitle,
  buildCanonicalTitleFacts,
  canonicalizeRecommendation,
  canonicalizeRecommendationBatch,
  canonicalizeTags,
  hasRepeatedTitleToken,
} = require('./recommendationPresentation');

function outfit(index, options = {}) {
  return {
    outfitKey: `outfit-${index}`,
    scene: options.scene || 'work',
    sceneIntent: options.sceneIntent,
    title: options.title || '通勤连衣裙连衣裙组合',
    displayTitle: options.displayTitle,
    styleTags: options.styleTags || ['通勤', '通勤', '关系组合', '简约'],
    snapshotItems: options.items || [
      { itemId: `top-${index}`, category: 'top', subcategory: '衬衫' },
      { itemId: `bottom-${index}`, category: 'bottom', subcategory: '长裤' },
    ],
    copyContract: {
      todayReason: options.reason || `第${index}套通勤理由。`,
      coreEligibilityReasonCode: 'WORK_BASELINE_PRESENTABLE',
    },
  };
}

test('canonical title removes duplicated item wording and placeholder titles', () => {
  assert.equal(buildCanonicalTitle([
    { category: 'onepiece', subcategory: '连衣裙' },
  ], 'work'), '通勤连衣裙组合');
  const result = canonicalizeRecommendation(outfit(1));
  assert.equal(result.title, '通勤衬衫搭配');
  assert.equal(result.displayTitle, '通勤衬衫搭配');
  assert.deepEqual(result.styleTags, ['通勤', '简约']);
});

test('canonical batch preserves factual copy without synthetic sequence suffixes', () => {
  const source = [
    outfit(1, {
      items: [{ itemId: 'top-1', category: 'top', subcategory: 'shirt' }, { itemId: 'bottom-1', category: 'bottom', subcategory: 'straight pants' }],
      reason: '事实理由 A',
    }),
    outfit(2, {
      items: [{ itemId: 'top-2', category: 'top', subcategory: 'hoodie' }, { itemId: 'bottom-2', category: 'bottom', subcategory: 'shorts' }],
      reason: '事实理由 B',
    }),
  ];
  const first = canonicalizeRecommendationBatch(source, { scene: 'work' });
  const second = canonicalizeRecommendationBatch(source, { scene: 'work' });
  assert.equal(new Set(first.map((entry) => entry.copyContract.todayReason)).size, 2);
  assert.deepEqual(first.map((entry) => entry.copyContract.todayReason), second.map((entry) => entry.copyContract.todayReason));
  assert.equal(first.every((entry) => entry.title === entry.displayTitle), true);
  assert.equal(first.some((entry) => /（\d+）|\(\d+\)$/.test(entry.copyContract.todayReason)), false);
});

test('home quick-outing archetype is bounded by the product ratio', () => {
  const allowed = Array.from({ length: 8 }, (_, index) => outfit(index, {
    scene: 'home',
    sceneIntent: index < 2 ? 'home:quick_outing' : 'home:indoor_relax',
    title: '关系组合',
    styleTags: ['休闲'],
    reason: `居家理由${index}。`,
    items: [
      { itemId: `top-${index}`, category: 'top', subcategory: index % 2 === 0 ? 'shirt' : 'hoodie' },
      { itemId: `bottom-${index}`, category: 'bottom', subcategory: index % 2 === 0 ? 'straight pants' : 'shorts' },
    ],
  }));
  assert.equal(canonicalizeRecommendationBatch(allowed, { scene: 'home' }).length, 8);
  const tooMany = allowed.map((entry) => ({ ...entry, sceneIntent: 'home:quick_outing' }));
  assert.throws(() => canonicalizeRecommendationBatch(tooMany, { scene: 'home' }), /ratio exceeded/);
});

test('tag allowlist is deterministic and deduplicated', () => {
  assert.deepEqual(canonicalizeTags(['关系组合', '通勤', '通勤', '未知', '简约'], 'work'), ['通勤', '简约']);
});

test('final presentation keeps identical factual titles visible for QA instead of throwing', () => {
  const first = canonicalizeRecommendation(outfit(1));
  const second = canonicalizeRecommendation(outfit(2));
  assert.doesNotThrow(() => assertFinalPresentation([first, second], 'work'));
});

test('final presentation does not block duplicate titles when item facts differ', () => {
  const first = canonicalizeRecommendation(outfit(1, {
    items: [{ itemId: 'top-1', category: 'top', subcategory: 'shirt', color: 'black' }],
  }));
  const second = canonicalizeRecommendation(outfit(2, {
    items: [{ itemId: 'top-2', category: 'top', subcategory: 'hoodie', color: 'white' }],
  }));
  assert.doesNotThrow(() => assertFinalPresentation([first, second], 'work'));
});

test('recoverable empty or non-string titles use the canonical fallback', () => {
  const result = canonicalizeRecommendation(outfit(1, {
    title: 42,
    displayTitle: { invalid: true },
    items: [{ itemId: 'top-1', category: 'top', subcategory: 'shirt' }],
  }));
  assert.equal(result.title, '通勤衬衫搭配');
  assert.equal(result.displayTitle, '通勤衬衫搭配');
  assert.doesNotThrow(() => assertFinalPresentation([result], 'work'));
});

test('title facts marked unauthorized remain a hard failure', () => {
  const card = canonicalizeRecommendation(outfit(1, {
    items: [{
      itemId: 'top-1',
      category: 'top',
      subcategory: 'shirt',
      color: 'purple',
      factRecords: [{ fact: 'color', authorized: false }],
    }],
  }));
  assert.throws(() => assertFinalPresentation([card], 'work'), /title authorization invariant failed/);
});

test('unrecoverable title or damaged card structure remains a hard failure', () => {
  assert.throws(() => assertFinalPresentation([{
    outfitKey: 'broken-title',
    items: [{ itemId: 'top-1', category: 'top', subcategory: 'shirt' }],
    title: '',
    displayTitle: '',
    styleTags: ['通勤'],
    copyContract: { todayReason: '有效理由', coreEligibilityReasonCode: 'WORK_BASELINE_PRESENTABLE' },
  }], 'work'), /canonical recommendation title invariant failed/);
  assert.throws(() => assertFinalPresentation([{
    outfitKey: 'broken-card',
    title: '通勤上衣搭配',
    displayTitle: '通勤上衣搭配',
    styleTags: ['通勤'],
    copyContract: { todayReason: '有效理由', coreEligibilityReasonCode: 'WORK_BASELINE_PRESENTABLE' },
  }], 'work'), /canonical recommendation card structure invariant failed/);
  assert.throws(() => assertFinalPresentation([{
    outfitKey: 'inconsistent-title',
    items: [{ itemId: 'top-1', category: 'top', subcategory: 'shirt' }],
    title: '通勤衬衫搭配',
    displayTitle: '其他标题',
    styleTags: ['通勤'],
    copyContract: { todayReason: '有效理由', coreEligibilityReasonCode: 'WORK_BASELINE_PRESENTABLE' },
  }], 'work'), /canonical recommendation title invariant failed/);
});

function sportFixtureOutfit(index, top, bottom, shoes) {
  const topColors = ['black', 'white', 'red', 'blue', 'gray', 'green', 'navy', 'pink'];
  const bottomColors = ['white', 'gray', 'black', 'green', 'beige', 'navy', 'red', 'yellow'];
  const shoeColors = ['gray', 'black', 'white', 'blue', 'white', 'gray', 'black', 'green'];
  return {
    outfitKey: `sport-${index}`,
    scene: 'sport',
    archetype: 'top+bottom+shoes',
    items: [
      { itemId: `top-${index}`, category: 'top', subcategory: top, colorPalette: [{ name: topColors[index] }], factRecords: [{ fact: 'color', value: topColors[index], authorized: true }, { fact: top.includes('sport') ? 'sport_top' : 'short_sleeve', value: true, authorized: true }] },
      { itemId: `bottom-${index}`, category: 'bottom', subcategory: bottom, colorPalette: [{ name: bottomColors[index] }], factRecords: [{ fact: 'color', value: bottomColors[index], authorized: true }, { fact: bottom.includes('sport') ? 'sport_bottom' : 'shorts', value: true, authorized: true }] },
      { itemId: `shoes-${index}`, category: 'shoes', subcategory: shoes, colorPalette: [{ name: shoeColors[index] }], factRecords: [{ fact: 'color', value: shoeColors[index], authorized: true }, { fact: 'sport_shoe', value: true, authorized: true }] },
    ],
    styleTags: ['运动'],
    copyContract: {
      coreEligibilityReasonCode: 'SPORT_LIGHT_ACTIVITY_SET',
      todayReason: '运动场景的有效事实理由。',
    },
  };
}

test('final presentation plan atomically owns copy, metadata, evidence, and source', () => {
  const source = {
    ...sportFixtureOutfit(0, 'sport top', 'shorts', 'sport shoe'),
    todayAction: 'old_action',
    todayDimension: 'old_dimension',
    todaySentenceClusterId: 'OLD-TODAY-CLUSTER',
    detailSentenceClusterId: 'OLD-DETAIL-CLUSTER',
    copyContract: {
      coreEligibilityReasonCode: 'SPORT_LIGHT_ACTIVITY_SET',
      riskFlags: [],
      todayClaim: { claimId: 'OLD-TODAY' },
      detailClaim: { claimId: 'OLD-DETAIL' },
      todayAction: 'old_action',
      todayDimension: 'old_dimension',
      todaySentenceClusterId: 'OLD-TODAY-CLUSTER',
      detailSentenceClusterId: 'OLD-DETAIL-CLUSTER',
      enhancedReason: '旧增强理由',
    },
    contentPlan: {
      version: 'xiaoda-content-plan-v1',
      sceneIntent: 'sport:light_activity',
      primaryBenefit: 'movement',
      items: [{ id: 'top-0', slot: 'top' }],
      todayAction: 'old_action',
      todaySentenceClusterId: 'OLD-TODAY-CLUSTER',
      detailSentenceClusterId: 'OLD-DETAIL-CLUSTER',
    },
  };
  const [card] = canonicalizeRecommendationBatch([source], { scene: 'sport' });
  const plan = card.presentationPlan;

  for (const field of [
    'titleConcept', 'todayReason', 'detailExplanation', 'primaryRelationCode',
    'todayAction', 'todayDimension', 'todaySubjectItemIds', 'todayEvidenceFactIds',
    'detailAction', 'detailDimension', 'detailSubjectItemIds', 'detailEvidenceFactIds',
    'selectedDifferentiator', 'source', 'planId', 'version',
  ]) assert.equal(Object.hasOwn(plan, field), true, field);
  assert.equal(plan.source, 'presentation_plan');
  assert.equal(card.source, 'presentation_plan');
  assert.equal(card.todayReasonSource, 'presentation_plan');
  assert.equal(card.copyContract.todayReasonSource, 'presentation_plan');
  assert.equal(card.copyContract.source, 'presentation_plan');
  assert.equal(card.contentPlan.source, 'presentation_plan');
  assert.equal(card.copyContract.todayReason, plan.todayReason);
  assert.equal(card.contentPlan.defaultTodayReason, plan.todayReason);
  assert.equal(card.copyContract.detailExplanation, plan.detailExplanation);
  assert.equal(card.contentPlan.defaultDetailExplanation, plan.detailExplanation);
  assert.deepEqual(card.todaySubjectItemIds, plan.todaySubjectItemIds);
  assert.deepEqual(card.copyContract.todayEvidenceFactIds, plan.todayEvidenceFactIds);
  assert.deepEqual(card.contentPlan.detailEvidenceFactIds, plan.detailEvidenceFactIds);
  assert.equal(card.todaySentenceClusterId, null);
  assert.equal(card.copyContract.todaySentenceClusterId, null);
  assert.equal(card.contentPlan.detailSentenceClusterId, null);
  assert.equal(card.copyContract.todayClaim, null);
  assert.equal(card.copyContract.detailClaim, null);
  assert.equal(Object.hasOwn(card.copyContract, 'enhancedReason'), false);
  assert.notEqual(plan.todayReason, plan.detailExplanation);
  assert.doesNotMatch(`${plan.todayReason}${plan.detailExplanation}`, /放在中间/);
});

test('detail is hidden when the plan has no second supported fact', () => {
  const card = canonicalizeRecommendation(outfit(9, {
    scene: 'home',
    items: [{ itemId: 'top-only', category: 'top', subcategory: 'shirt' }],
  }), { scene: 'home' });
  assert.equal(card.presentationPlan.detailDisplay, 'hidden');
  assert.equal(card.presentationPlan.detailExplanation, '');
  assert.equal(card.copyContract.detailExplanation, '');
  assert.equal(card.contentPlan.defaultDetailExplanation, '');
});

test('same-color top and bottom copy does not infer a shoe contrast', () => {
  const source = sportFixtureOutfit(0, 'sport top', 'sport pants', 'sport shoe');
  source.items[0].colorPalette = [{ name: 'black' }];
  source.items[0].factRecords[0] = { fact: 'color', value: 'black', authorized: true };
  source.items[1].colorPalette = [{ name: 'black' }];
  source.items[1].factRecords[0] = { fact: 'color', value: 'black', authorized: true };
  source.items[2].colorPalette = [{ name: 'white' }];
  source.items[2].factRecords[0] = { fact: 'color', value: 'white', authorized: true };

  const card = canonicalizeRecommendation(source, { scene: 'sport' });
  assert.equal(card.presentationPlan.primaryRelationCode, 'SAME_COLOR_TOP_BOTTOM');
  assert.match(card.copyContract.todayReason, /都用了黑色/);
  assert.doesNotMatch(card.copyContract.todayReason, /鞋.+对比|形成对比/);
});

test('full compute and pool hit use the same final presentation differentiation', () => {
  const source = [
    sportFixtureOutfit(1, 'sport top', 'shorts', 'sport shoe'),
    sportFixtureOutfit(2, 'sport top', 'shorts', 'sport shoe'),
  ];
  const full = canonicalizeRecommendationBatch(source.map((card) => ({ ...card, executionMode: 'full_compute' })), { scene: 'sport' });
  const hit = canonicalizeRecommendationBatch(source.map((card) => ({ ...card, executionMode: 'candidate_pool_hit' })), { scene: 'sport' });
  const semantics = (cards) => cards.map((card) => ({
    title: card.title,
    reason: card.copyContract.todayReason,
    detail: card.copyContract.detailExplanation,
    differentiator: card.presentationPlan.selectedDifferentiator,
  }));
  assert.deepEqual(semantics(hit), semantics(full));
});

test('real sport fixture uses authorized subtype and color facts for natural distinct titles', () => {
  const fixture = Array.from({ length: 8 }, (_, index) => sportFixtureOutfit(
    index,
    index % 2 === 0 ? 'tshirt' : 'sport top',
    index % 3 === 0 ? 'shorts' : 'joggers',
    index % 2 === 0 ? 'sport shoe' : 'running shoe',
  ));
  const facts = fixture.map((entry) => buildCanonicalTitleFacts(entry.items, entry));
  const titles = canonicalizeRecommendationBatch(fixture, { scene: 'sport' }).map((entry) => entry.title);

  assert.equal(facts.length, 8);
  assert.equal(facts[0].top.subtype, '短袖T恤');
  assert.equal(facts[0].top.color, '黑色');
  assert.equal(new Set(titles).size, 8);
  assert.equal(titles.some((title) => /关系组合|\(\d+\)|（\d+）|第\d+套/.test(title)), false);
});

test('duplicate fixed reasons consume the selected card visible difference without suffixes', () => {
  const fixture = Array.from({ length: 8 }, (_, index) => ({
    ...sportFixtureOutfit(index, 'sport top', 'sport pants', 'sport shoe'),
    copyContract: {
      coreEligibilityReasonCode: 'SPORT_LIGHT_ACTIVITY_SET',
      todayReason: 'T恤配活动方便的下装和稳定包脚鞋，用于日常轻运动正合适。',
    },
  }));
  const cards = canonicalizeRecommendationBatch(fixture, { scene: 'sport' });
  const reasons = cards.map((card) => card.copyContract.todayReason);

  assert.equal(new Set(reasons).size, 8);
  assert.equal(reasons.every((reason) => !reason.includes('可以直接这样穿')), true);
  assert.equal(reasons.every((reason) => !/活动方便|稳定包脚/.test(reason)), true);
  assert.equal(reasons.some((reason) => /\(\d+\)|（\d+）|第\d+套/.test(reason)), false);
});

test('identical sport facts stay identical without a synthetic suffix', () => {
  const source = Array.from({ length: 8 }, (_, index) => {
    const entry = sportFixtureOutfit(0, 'sport top', 'sport pants', 'sport shoe');
    return {
      ...entry,
      outfitKey: `sport-${index}`,
      items: entry.items.map((item) => ({ ...item, colorPalette: [], factRecords: [] })),
    };
  });
  const cards = canonicalizeRecommendationBatch(source, { scene: 'sport' });
  assert.equal(new Set(cards.map((card) => card.title)).size, 1);
  assert.equal(cards.every((card) => card.title === card.displayTitle), true);
  assert.equal(cards[0].title, '日常轻运动');
  assert.equal(hasRepeatedTitleToken(cards[0].title), false);
  assert.equal(/\(\d+\)|（\d+）|第\d+套/.test(cards[0].title), false);
});
