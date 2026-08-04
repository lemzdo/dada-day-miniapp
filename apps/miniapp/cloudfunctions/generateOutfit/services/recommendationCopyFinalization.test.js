const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');
const { compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');
const {
  FINALIZATION_MODES,
  finalizeAcceptedRecommendations,
  hasAcceptedCoreEligibilityReason,
  hasAcceptedDefaultCopy,
} = require('./recommendationCopyFinalization');

function homeRecommendation(id, extra = {}) {
  const weather = { temp: 31, weather: '晴' };
  const items = [
    { _id: `${id}-top`, clothingId: `${id}-top`, category: 'top', subCategory: '无袖上衣', sleeveLength: 'sleeveless' },
    { _id: `${id}-bottom`, clothingId: `${id}-bottom`, category: 'bottom', subCategory: '短裤', pantsLength: 'short' },
    { _id: `${id}-shoe`, clothingId: `${id}-shoe`, category: 'shoes', subCategory: '家居拖鞋', shoeType: 'home' },
  ];
  const eligibility = {
    weather: { pass: true },
    scene: evaluateSceneEligibilityV3({ scene: 'home', weather, items }),
  };
  const [compiled] = compileRecommendationLanguageV3({
    scene: 'home',
    weather,
    outfits: [{
      id,
      outfitKey: id,
      scene: 'home',
      weatherSnapshot: weather,
      clothingIds: items.map((item) => item.clothingId),
      items,
      eligibility,
      ...extra,
    }],
  });
  return compiled;
}

test('new recommendation keeps a qualified outfit visible when every enhanced claim rejects', () => {
  const compiled = Array.from({ length: 7 }, (_, index) => homeRecommendation(`core-${index}`));
  const result = finalizeAcceptedRecommendations(compiled, {
    mode: FINALIZATION_MODES.NEW_RECOMMENDATION,
    requestedCount: 7,
  });

  assert.equal(result.finalRecommendations.length, 7);
  assert.equal(result.coreReasonAcceptedCount, 7);
  assert.equal(result.enhancedReasonAcceptedCount, 0);
  assert.equal(result.coreReasonCoverageGapCount, 0);
  assert.equal(result.copyHiddenCount, 0);
  assert.deepEqual(result.coreReasonCodeCounts, { HOME_HOT_SLEEVELESS_SHORTS: 7 });
  assert.deepEqual(result.enhancementRejectReasonCounts, { COPY_EVIDENCE_INSUFFICIENT: 7 });
  assert.equal(result.finalRecommendations.every(hasAcceptedCoreEligibilityReason), true);
  assert.equal(result.finalRecommendations.every(hasAcceptedDefaultCopy), true);
  assert.equal(result.finalRecommendations.every((item) => item.copyContract.todayReason.trim().length > 0), true);
});

test('coverage gaps are skipped and later eligible candidates fill requestedCount', () => {
  const gap = homeRecommendation('gap');
  gap.eligibilityReason = null;
  const later = [homeRecommendation('later-1'), homeRecommendation('later-2')];
  const result = finalizeAcceptedRecommendations([gap, ...later], { requestedCount: 2 });

  assert.deepEqual(result.finalRecommendations.map((item) => item.id), ['later-1', 'later-2']);
  assert.equal(result.outfitAcceptedCount, 3);
  assert.equal(result.coreReasonAcceptedCount, 2);
  assert.equal(result.coreReasonCoverageGapCount, 1);
  assert.deepEqual(result.coverageGaps, [{
    outfitKey: 'gap',
    code: 'CORE_REASON_COVERAGE_GAP',
    eligibilityReasonCode: '',
  }]);
});

test('outfit hard rejects remain excluded before core-reason finalization', () => {
  const rejected = { ...homeRecommendation('outfit-rejected'), outfitGateResult: 'REJECT' };
  const accepted = homeRecommendation('accepted');
  const result = finalizeAcceptedRecommendations([rejected, accepted]);

  assert.deepEqual(result.finalRecommendations.map((item) => item.id), ['accepted']);
  assert.equal(result.outfitRejectedCount, 1);
  assert.equal(result.coreReasonAcceptedCount, 1);
});

test('saved snapshot mode preserves rejected records and hides every default-copy surface', () => {
  const current = homeRecommendation('saved-rejected');
  const rejected = {
    ...current,
    copyContract: { ...current.copyContract, gateResult: 'REJECT', riskFlags: ['CLAIM_FACT_NOT_EVIDENCED'] },
    title: '保留标题',
    snapshotItems: [{ itemId: 'deleted-item', imageUrl: 'snapshot.jpg' }],
    isFavorite: true,
    isWornToday: true,
    reason: '旧 128 条首页文案',
    reasoning: '旧 128 条详情文案',
    contentPlan: {
      keep: 'metadata',
      defaultTodayReason: '旧 128 条首页文案',
      defaultDetailExplanation: '旧 128 条详情文案',
    },
    detailNarrativeViewModel: { keep: 'metadata', defaultText: '旧 128 条详情文案' },
  };
  const result = finalizeAcceptedRecommendations([rejected], { mode: FINALIZATION_MODES.SAVED_SNAPSHOT });
  const [saved] = result.finalRecommendations;

  assert.equal(result.finalRecommendations.length, 1);
  assert.equal(result.preservedCount, 1);
  assert.equal(saved.title, '保留标题');
  assert.deepEqual(saved.snapshotItems, rejected.snapshotItems);
  assert.equal(saved.isFavorite, true);
  assert.equal(saved.isWornToday, true);
  assert.equal(saved.reason, '');
  assert.equal(saved.reasoning, undefined);
  assert.equal(saved.copyContract.todayReason, '');
  assert.equal(saved.copyContract.coreEligibilityReason, '');
  assert.equal(Object.hasOwn(saved.copyContract, 'detailExplanation'), false);
  assert.equal(saved.contentPlan.defaultTodayReason, '');
  assert.equal(saved.contentPlan.defaultDetailExplanation, undefined);
  assert.equal(saved.detailNarrativeViewModel.defaultText, '');
  assert.equal(JSON.stringify(saved).includes('旧 128 条'), false);
});

test('correct repeated core reasons remain accepted for independent outfits', () => {
  const result = finalizeAcceptedRecommendations([
    homeRecommendation('one'),
    homeRecommendation('two'),
  ]);
  assert.equal(result.acceptedCount, 2);
  assert.deepEqual(result.finalRecommendations.map((item) => item.id), ['one', 'two']);
  assert.equal(result.finalRecommendations.every(hasAcceptedDefaultCopy), true);
});
