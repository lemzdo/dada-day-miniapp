const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getMissingRequiredFacts,
  getMissingRequiredRoles,
  getPartialRecommendationNotice,
  resolveRecommendationAvailability,
} = require('./recommendationAvailability');
const { buildOutfitCandidatesV1 } = require('./outfitCompositionV1');

function clothing(id, category) {
  return { _id: id, category };
}

test('home outfits do not require shoes while outside scenes do', () => {
  const wardrobe = [clothing('top', 'top'), clothing('bottom', 'bottom')];
  assert.deepEqual(getMissingRequiredRoles(wardrobe, '居家'), []);
  assert.deepEqual(getMissingRequiredRoles(wardrobe, '上班'), ['shoes']);
  assert.deepEqual(getMissingRequiredRoles([clothing('dress', 'onepiece')], '居家'), []);

  const indoorCandidates = buildOutfitCandidatesV1({
    clothes: [
      { ...clothing('top', 'top'), subcategory: '家居上衣', confidence: 0.9 },
      { ...clothing('bottom', 'bottom'), subcategory: '家居长裤', confidence: 0.9 },
    ],
    scene: '居家',
    weather: { temp: 22, weather: '晴' },
    weatherMode: 'live',
    returnRawCandidates: true,
  });
  assert.ok(indoorCandidates.some((candidate) => candidate.structureType === 'separates_indoor'));
});
test('missing required categories are reported independently from wardrobe size', () => {
  assert.deepEqual(
    getMissingRequiredRoles([clothing('top', 'top'), clothing('shoe', 'shoes')], '约会'),
    ['bottom'],
  );
  assert.deepEqual(getMissingRequiredRoles([], '运动'), ['top', 'bottom', 'onepiece', 'shoes']);
  assert.deepEqual(
    getMissingRequiredRoles([
      clothing('coat', 'outerwear'), clothing('bottom', 'bottom'), clothing('shoe', 'shoes'),
    ], '上班'),
    ['top'],
  );
});
test('sport distinguishes an absent category from an unsuitable activity fact', () => {
  assert.deepEqual(getMissingRequiredFacts([
    { _id: 'tee', category: 'top', subcategory: 'plain tee' },
    { _id: 'jeans', category: 'bottom', subcategory: 'casual jeans' },
    { _id: 'loafer', category: 'shoes', subcategory: 'loafer shoes' },
  ], 'sport'), ['sport_activity_bottom', 'sport_stable_shoe']);
});

test('full batches with all copy hidden are not limited', () => {
  assert.deepEqual(resolveRecommendationAvailability({
    requestedCount: 8,
    finalRecommendationCount: 8,
    candidateCount: 20,
    guardAcceptedCount: 20,
    generatedCount: 8,
    copyHiddenCount: 8,
  }), {
    limited: false,
    limitedReason: null,
    missingRoles: [],
    missingFacts: [],
    exhausted: false,
    copyDiagnosticReason: 'COPY_EVIDENCE_INSUFFICIENT',
  });
});

test('limited reason is classified at the stage that reduced outfits', () => {
  assert.equal(resolveRecommendationAvailability({
    requestedCount: 8, finalRecommendationCount: 0, missingRoles: ['bottom'],
  }).limitedReason, 'MISSING_REQUIRED_CATEGORY');
  assert.equal(resolveRecommendationAvailability({
    requestedCount: 8, finalRecommendationCount: 0, candidateCount: 20,
    weatherRejectedCount: 15, guardAcceptedCount: 5,
  }).limitedReason, 'WEATHER_ELIGIBLE_FEW');
  assert.equal(resolveRecommendationAvailability({
    requestedCount: 8, finalRecommendationCount: 3, candidateCount: 20,
    weatherRejectedCount: 0, guardAcceptedCount: 3, generatedCount: 3,
  }).limitedReason, 'SCENE_ELIGIBLE_FEW');
  assert.equal(resolveRecommendationAvailability({
    requestedCount: 8, finalRecommendationCount: 0, excludedOutfitKeyCount: 8,
  }).limitedReason, 'DIVERSITY_EXHAUSTED');
});

test('partial recommendation notices describe the actual non-empty count', () => {
  assert.equal(getPartialRecommendationNotice(1), '这次先给你找到一套合适的。');
  assert.equal(getPartialRecommendationNotice(2), '这次先给你找到两套合适的。');
  assert.equal(getPartialRecommendationNotice(7), '这次先给你找到这几套合适的。');
  assert.equal(getPartialRecommendationNotice(0), '');
});

test('candidate pool exhaustion semantics: remaining 0 candidates returns exhausted', () => {
  const result = resolveRecommendationAvailability({
    requestedCount: 8,
    finalRecommendationCount: 0,
    candidateCount: 8,
    guardAcceptedCount: 8,
    generatedCount: 8,
    excludedOutfitKeyCount: 8,
  });
  assert.equal(result.limited, true);
  assert.equal(result.limitedReason, 'DIVERSITY_EXHAUSTED');
  assert.equal(result.exhausted, true);
});

test('candidate pool exhaustion semantics: normal full batch is not limited', () => {
  const result = resolveRecommendationAvailability({
    requestedCount: 8,
    finalRecommendationCount: 8,
    candidateCount: 20,
    guardAcceptedCount: 20,
    generatedCount: 8,
    excludedOutfitKeyCount: 0,
  });
  assert.equal(result.limited, false);
  assert.equal(result.limitedReason, null);
  assert.equal(result.exhausted, false);
});
