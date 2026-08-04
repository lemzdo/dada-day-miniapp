const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRecommendationReasonQaSnapshot } = require('./recommendationReasonQa.fixture');

test('four-scene real-schema QA snapshot is deterministic and keeps subjects inside each outfit', () => {
  const first = buildRecommendationReasonQaSnapshot();
  const second = buildRecommendationReasonQaSnapshot();
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), ['home', 'work', 'date', 'sport']);
  for (const batch of Object.values(first)) {
    assert.equal(batch.fixtureKind, 'real-schema replay');
    assert.ok(batch.outfits.length > 0);
    for (const outfit of batch.outfits) {
      const selectedIds = new Set(outfit.outfitKey.split('|'));
      assert.ok(outfit.reasonCandidates.length > 0);
      assert.equal(outfit.selectedReason.qualityTier, Math.min(...outfit.reasonCandidates.map((reason) => reason.qualityTier)));
      assert.ok(selectedIds.size > 0);
      if (outfit.reasonCandidates.some((reason) => reason.qualityTier < 6)) {
        assert.notEqual(outfit.selectedReason.code, 'HOME_CASUAL_TWO_PIECE');
      }
    }
  }
});

test('QA reason code distribution is stable', () => {
  const snapshot = buildRecommendationReasonQaSnapshot();
  assert.deepEqual(
    Object.fromEntries(Object.entries(snapshot).map(([scene, batch]) => [scene, batch.outfits.map((outfit) => outfit.selectedReason.code)])),
    {
      home: ['HOME_LOOSE_TWO_PIECE'],
      work: ['WORK_SHIRT_STRAIGHT_PANTS'],
      date: ['DATE_PATTERN_TOP_SIMPLE_SUPPORT'],
      sport: ['SPORT_COMPLETE_SET'],
    },
  );
});
