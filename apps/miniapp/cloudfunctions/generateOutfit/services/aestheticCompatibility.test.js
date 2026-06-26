const assert = require('node:assert/strict');
const test = require('node:test');

const {
  attachAestheticEvaluation,
  evaluateAestheticCompatibility,
} = require('./aestheticCompatibility');

function item(id, fields = {}) {
  return {
    _id: id,
    category: fields.category || 'top',
    subcategory: fields.subcategory || fields.subCategory,
    subCategory: fields.subCategory,
    colorPalette: fields.colorPalette || [],
    aestheticFeatures: {
      version: 1,
      promptVersion: 'aesthetic-v1',
      fit: fields.fit || 'unknown',
      length: fields.length || 'unknown',
      silhouette: fields.silhouette || 'unknown',
      patternType: fields.patternType || 'unknown',
      designElements: fields.designElements || [],
      formalityLevel: fields.formalityLevel ?? null,
      confidence: {
        fit: fields.fitConfidence || 'high',
        length: fields.lengthConfidence || 'high',
        silhouette: fields.silhouetteConfidence || 'high',
        patternType: fields.patternConfidence || 'high',
        designElements: fields.designConfidence || 'high',
        formalityLevel: fields.formalityConfidence || 'high',
      },
      provider: 'test',
      model: 'test',
      recognizedAt: '2026-06-26T00:00:00.000Z',
    },
  };
}

function evidenceCodes(result) {
  return result.evidence.map((entry) => entry.code);
}

function dimension(result, key) {
  return result.dimensions[key];
}

test('empty item list returns null score and zero coverage', () => {
  const result = evaluateAestheticCompatibility([]);

  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
  assert.deepEqual(result.evidence, []);
  assert.equal(dimension(result, 'colorHarmony').score, null);
});

test('legacy clothes without aesthetic features are not judged as low score', () => {
  const result = evaluateAestheticCompatibility([
    { _id: 'top-1', category: 'top' },
    { _id: 'bottom-1', category: 'bottom' },
  ]);

  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
  assert.ok(!result.evidence.some((entry) => entry.polarity === 'negative'));
});

test('fitted top and wide-leg bottom produce positive silhouette evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', fit: 'fitted' }),
    item('bottom-1', { category: 'bottom', silhouette: 'wideLeg' }),
  ]);

  assert.ok(dimension(result, 'silhouetteBalance').score > 70);
  assert.ok(evidenceCodes(result).includes('SILHOUETTE_BALANCED_CONTRAST'));
});

test('oversized top and tapered bottom produce positive silhouette evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', fit: 'oversized' }),
    item('bottom-1', { category: 'bottom', silhouette: 'tapered' }),
  ]);

  assert.ok(dimension(result, 'silhouetteBalance').score > 70);
  assert.ok(evidenceCodes(result).includes('SILHOUETTE_BALANCED_CONTRAST'));
});

test('two extreme volume garments are only mildly negative', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', fit: 'oversized', silhouette: 'boxy' }),
    item('bottom-1', { category: 'bottom', silhouette: 'wideLeg' }),
  ]);

  const score = dimension(result, 'silhouetteBalance').score;
  assert.ok(score >= 55 && score < 70);
  assert.ok(evidenceCodes(result).includes('SILHOUETTE_EXTREME_VOLUME_STACK'));
});

test('cropped top and long bottom produce proportion evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', length: 'cropped' }),
    item('bottom-1', { category: 'bottom', length: 'long' }),
  ]);

  assert.ok(dimension(result, 'proportionBalance').score > 70);
  assert.ok(evidenceCodes(result).includes('PROPORTION_CLEAR_LAYERING'));
});

test('missing length does not reduce proportion score', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top' }),
    item('bottom-1', { category: 'bottom' }),
  ]);

  assert.equal(dimension(result, 'proportionBalance').score, null);
  assert.ok(!evidenceCodes(result).includes('PROPORTION_EXTREME_LENGTH_STACK'));
});

test('single obvious pattern focus is positive', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', patternType: 'stripe' }),
    item('bottom-1', { category: 'bottom', patternType: 'solid' }),
    item('shoe-1', { category: 'shoes', patternType: 'solid' }),
  ]);

  assert.ok(dimension(result, 'patternBalance').score > 70);
  assert.ok(evidenceCodes(result).includes('PATTERN_SINGLE_FOCUS'));
});

test('multiple distinct strong patterns produce negative pattern evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', patternType: 'stripe' }),
    item('bottom-1', { category: 'bottom', patternType: 'floral' }),
  ]);

  assert.ok(dimension(result, 'patternBalance').score < 70);
  assert.ok(evidenceCodes(result).includes('PATTERN_COMPETING_FOCUS'));
});

test('low confidence pattern does not produce negative evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', patternType: 'stripe', patternConfidence: 'low' }),
    item('bottom-1', { category: 'bottom', patternType: 'floral', patternConfidence: 'low' }),
  ]);

  assert.equal(dimension(result, 'patternBalance').score, null);
  assert.ok(!evidenceCodes(result).includes('PATTERN_COMPETING_FOCUS'));
});

test('formality gap of zero or one is aligned', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { formalityLevel: 3 }),
    item('bottom-1', { category: 'bottom', formalityLevel: 4 }),
  ]);

  assert.ok(dimension(result, 'formalityConsistency').score > 70);
  assert.ok(evidenceCodes(result).includes('FORMALITY_ALIGNED'));
});

test('formality gap of two is not heavily penalized', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { formalityLevel: 2 }),
    item('bottom-1', { category: 'bottom', formalityLevel: 4 }),
  ]);

  assert.ok(dimension(result, 'formalityConsistency').score >= 68);
  assert.ok(evidenceCodes(result).includes('FORMALITY_INTENTIONAL_MIX'));
});

test('formality gap of three or four is mildly negative', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { formalityLevel: 1 }),
    item('bottom-1', { category: 'bottom', formalityLevel: 5 }),
  ]);

  assert.ok(dimension(result, 'formalityConsistency').score < 70);
  assert.ok(evidenceCodes(result).includes('FORMALITY_LARGE_GAP'));
});

test('single design focus is positive detail evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { designElements: ['ruffle'] }),
    item('bottom-1', { category: 'bottom', designElements: [] }),
  ]);

  assert.ok(dimension(result, 'detailBalance').score > 70);
  assert.ok(evidenceCodes(result).includes('DETAIL_SINGLE_FOCUS'));
});

test('multiple strong design elements produce competing detail evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { patternType: 'graphic', designElements: ['hardware', 'cutout'] }),
    item('bottom-1', { category: 'bottom', patternType: 'plaid', designElements: ['distressed', 'lace'] }),
  ]);

  assert.ok(dimension(result, 'detailBalance').score < 70);
  assert.ok(evidenceCodes(result).includes('DETAIL_COMPETING_FOCUS'));
});

test('monochromatic colors are positive', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { colorPalette: [{ name: 'blue', hex: '#3366cc', role: 'primary' }] }),
    item('bottom-1', { category: 'bottom', colorPalette: [{ name: 'navy', hex: '#1f3b82', role: 'primary' }] }),
  ]);

  assert.ok(dimension(result, 'colorHarmony').score > 70);
  assert.ok(evidenceCodes(result).includes('COLOR_MONOCHROMATIC'));
});

test('analogous colors are positive', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { colorPalette: [{ name: 'blue', hex: '#3366cc' }] }),
    item('bottom-1', { category: 'bottom', colorPalette: [{ name: 'green', hex: '#33aa66' }] }),
  ]);

  assert.ok(dimension(result, 'colorHarmony').score > 70);
  assert.ok(evidenceCodes(result).includes('COLOR_ANALOGOUS'));
});

test('neutral plus accent colors are positive', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { colorPalette: [{ name: 'black', hex: '#111111' }] }),
    item('bottom-1', { category: 'bottom', colorPalette: [{ name: 'red', hex: '#cc3333' }] }),
  ]);

  assert.ok(dimension(result, 'colorHarmony').score > 70);
  assert.ok(evidenceCodes(result).includes('COLOR_NEUTRAL_ACCENT'));
});

test('multiple competing dominant hues are mildly negative', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { colorPalette: [{ name: 'red', hex: '#cc3333', ratio: 0.7 }] }),
    item('bottom-1', { category: 'bottom', colorPalette: [{ name: 'green', hex: '#33aa33', ratio: 0.7 }] }),
    item('shoe-1', { category: 'shoes', colorPalette: [{ name: 'blue', hex: '#3333cc', ratio: 0.7 }] }),
  ]);

  assert.ok(dimension(result, 'colorHarmony').score < 70);
  assert.ok(evidenceCodes(result).includes('COLOR_TOO_MANY_DOMINANT_HUES'));
});

test('missing hex does not create fake color evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { colorPalette: [{ name: 'mystery' }] }),
    item('bottom-1', { category: 'bottom', colorPalette: [{ name: 'unknown' }] }),
  ]);

  assert.equal(dimension(result, 'colorHarmony').score, null);
  assert.ok(!evidenceCodes(result).some((code) => code.startsWith('COLOR_')));
});

test('shoes do not participate in silhouette evaluation', () => {
  const result = evaluateAestheticCompatibility([
    item('shoe-1', { category: 'shoes', fit: 'oversized', silhouette: 'wideLeg' }),
    item('shoe-2', { category: 'shoes', fit: 'oversized', silhouette: 'wideLeg' }),
  ]);

  assert.equal(dimension(result, 'silhouetteBalance').score, null);
});

test('one-piece garment can independently form silhouette evidence', () => {
  const result = evaluateAestheticCompatibility([
    item('dress-1', { category: 'onepiece', fit: 'regular', silhouette: 'aLine' }),
  ]);

  assert.ok(dimension(result, 'silhouetteBalance').score > 70);
  assert.ok(evidenceCodes(result).includes('SILHOUETTE_BALANCED_CONTINUITY'));
});

test('unsupported aesthetic feature version is ignored', () => {
  const old = item('top-1', { fit: 'fitted' });
  old.aestheticFeatures.version = 2;

  const result = evaluateAestheticCompatibility([old]);

  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
});

test('item order changes do not change evaluation', () => {
  const items = [
    item('top-1', { category: 'top', fit: 'fitted', colorPalette: [{ name: 'black', hex: '#111111' }] }),
    item('bottom-1', { category: 'bottom', silhouette: 'wideLeg', colorPalette: [{ name: 'red', hex: '#cc3333' }] }),
    item('shoe-1', { category: 'shoes', colorPalette: [{ name: 'white', hex: '#f7f7f7' }] }),
  ];

  assert.deepEqual(evaluateAestheticCompatibility(items), evaluateAestheticCompatibility(items.slice().reverse()));
});

test('input items are not mutated', () => {
  const items = [
    item('top-1', { category: 'top', fit: 'fitted' }),
    item('bottom-1', { category: 'bottom', silhouette: 'wideLeg' }),
  ];
  const before = structuredClone(items);

  evaluateAestheticCompatibility(items);

  assert.deepEqual(items, before);
});

test('scores are always zero to one hundred or null', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', fit: 'fitted', formalityLevel: 99 }),
    item('bottom-1', { category: 'bottom', silhouette: 'wideLeg', formalityLevel: -1 }),
  ]);

  assert.ok(result.score === null || (result.score >= 0 && result.score <= 100));
  for (const value of Object.values(result.dimensions)) {
    assert.ok(value.score === null || (value.score >= 0 && value.score <= 100));
  }
});

test('coverage is always zero to one', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', fit: 'fitted' }),
    item('bottom-1', { category: 'bottom', silhouette: 'wideLeg' }),
  ]);

  assert.ok(result.coverage >= 0 && result.coverage <= 1);
  for (const value of Object.values(result.dimensions)) {
    assert.ok(value.coverage >= 0 && value.coverage <= 1);
  }
});

test('evidence codes are deduplicated', () => {
  const result = evaluateAestheticCompatibility([
    item('top-1', { category: 'top', patternType: 'stripe' }),
    item('top-1', { category: 'top', patternType: 'stripe' }),
    item('bottom-1', { category: 'bottom', patternType: 'solid' }),
  ]);

  assert.equal(evidenceCodes(result).filter((code) => code === 'PATTERN_SINGLE_FOCUS').length, 1);
});

test('evidence item ids are stable sorted unique ids', () => {
  const result = evaluateAestheticCompatibility([
    item('z-top', { category: 'top', fit: 'fitted' }),
    item('a-bottom', { category: 'bottom', silhouette: 'wideLeg' }),
  ]);
  const evidence = result.evidence.find((entry) => entry.code === 'SILHOUETTE_BALANCED_CONTRAST');

  assert.deepEqual(evidence.itemIds, ['a-bottom', 'z-top']);
});

test('shadow attachment adds optional evaluation without changing ranking fields', () => {
  const outfit = {
    outfitKey: 'bottom-1_top-1',
    scores: { total: 8.2, styleUnity: 7.5 },
    rankingScore: 8.8,
  };
  const attached = attachAestheticEvaluation(outfit, [
    item('top-1', { category: 'top', fit: 'fitted' }),
    item('bottom-1', { category: 'bottom', silhouette: 'wideLeg' }),
  ]);

  assert.equal(attached.outfitKey, outfit.outfitKey);
  assert.equal(attached.scores.total, outfit.scores.total);
  assert.equal(attached.rankingScore, outfit.rankingScore);
  assert.ok(attached.aestheticEvaluation);
  assert.equal(outfit.aestheticEvaluation, undefined);
});
