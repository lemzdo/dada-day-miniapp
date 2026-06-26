const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAestheticRankingPreview,
  calculateAestheticDelta,
} = require('./aestheticRankingPreview');

function outfit(id, total, aestheticEvaluation) {
  return {
    outfitKey: id,
    scores: { total },
    aestheticEvaluation,
  };
}

test('score=null returns zero delta', () => {
  assert.equal(calculateAestheticDelta({ score: null, coverage: 0.8 }), 0);
});

test('coverage below threshold returns zero delta', () => {
  assert.equal(calculateAestheticDelta({ score: 95, coverage: 0.49 }), 0);
});

test('score=70 returns zero delta', () => {
  assert.equal(calculateAestheticDelta({ score: 70, coverage: 0.8 }), 0);
});

test('score above 70 returns positive delta', () => {
  assert.equal(calculateAestheticDelta({ score: 95, coverage: 0.8 }), 6);
});

test('score below 70 returns negative delta', () => {
  assert.equal(calculateAestheticDelta({ score: 45, coverage: 0.8 }), -6);
});

test('delta is clamped to -6..6', () => {
  assert.equal(calculateAestheticDelta({ score: 999, coverage: 1 }), 6);
  assert.equal(calculateAestheticDelta({ score: -999, coverage: 1 }), -6);
});

test('coverage=0.80 reaches full reliability', () => {
  assert.equal(calculateAestheticDelta({ score: 82.5, coverage: 0.8 }), 3);
});

test('invalid score safely degrades to zero', () => {
  assert.equal(calculateAestheticDelta({ score: 'pretty', coverage: 0.8 }), 0);
});

test('invalid coverage safely degrades to zero', () => {
  assert.equal(calculateAestheticDelta({ score: 90, coverage: 'wide' }), 0);
});

test('more than 12 original total points cannot be inverted', () => {
  const preview = buildAestheticRankingPreview([
    outfit('high', 90, { score: 45, coverage: 0.8 }),
    outfit('low', 77.9, { score: 95, coverage: 0.8 }),
  ]);

  assert.equal(preview[0].previewRank, 1);
  assert.equal(preview[1].previewRank, 2);
});

test('within 12 original total points allows aesthetic distinction', () => {
  const preview = buildAestheticRankingPreview([
    outfit('steady', 90, { score: 45, coverage: 0.8 }),
    outfit('lifted', 79, { score: 95, coverage: 0.8 }),
  ]);

  assert.equal(preview[0].previewRank, 2);
  assert.equal(preview[1].previewRank, 1);
});

test('same ranking score falls back to original order', () => {
  const preview = buildAestheticRankingPreview([
    outfit('first', 80, { score: 70, coverage: 0.8 }),
    outfit('second', 80, { score: 70, coverage: 0.8 }),
  ]);

  assert.equal(preview[0].previewRank, 1);
  assert.equal(preview[1].previewRank, 2);
});

test('preview does not mutate input outfits', () => {
  const input = [
    outfit('a', 80, { score: 95, coverage: 0.8 }),
    outfit('b', 79, { score: 45, coverage: 0.8 }),
  ];
  const before = structuredClone(input);

  buildAestheticRankingPreview(input);

  assert.deepEqual(input, before);
});

test('preview calculation is deterministic', () => {
  const input = [
    outfit('a', 80, { score: 95, coverage: 0.8 }),
    outfit('b', 79, { score: 45, coverage: 0.8 }),
  ];

  assert.deepEqual(buildAestheticRankingPreview(input), buildAestheticRankingPreview(input));
});

test('empty outfits are safe', () => {
  assert.deepEqual(buildAestheticRankingPreview([]), []);
});
