const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildStylistEvidenceV1,
  stableStringify,
} = require('./stylistEvidence');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function item(id, overrides = {}) {
  return {
    _id: id,
    clothingId: id,
    category: overrides.category || 'top',
    subcategory: overrides.subcategory || 'shirt',
    colorPalette: overrides.colorPalette || [{ name: 'black', role: 'primary', hex: '#111111' }],
    fit: overrides.fit || 'regular',
    length: overrides.length || 'regular',
    silhouette: overrides.silhouette || 'straight',
    patternType: overrides.patternType || 'solid',
    designElements: overrides.designElements || ['button'],
    formalityLevel: overrides.formalityLevel ?? 3,
    styleTags: overrides.styleTags || ['clean'],
    material: overrides.material || 'cotton',
    thickness: overrides.thickness || 'medium',
    imageUrl: 'cloud://secret-image',
    fileID: 'cloud://secret-file',
    city: 'Shanghai',
    nickname: 'Ada',
    aestheticFeatures: {
      version: 1,
      fit: overrides.fit || 'regular',
      length: overrides.length || 'regular',
      silhouette: overrides.silhouette || 'straight',
      patternType: overrides.patternType || 'solid',
      designElements: overrides.designElements || ['button'],
      formalityLevel: overrides.formalityLevel ?? 3,
    },
  };
}

function aesthetic(overrides = {}) {
  return {
    version: 1,
    engineVersion: 'aesthetic-compat-v1',
    score: overrides.score === undefined ? 82 : overrides.score,
    coverage: overrides.coverage === undefined ? 0.75 : overrides.coverage,
    dimensions: {
      colorHarmony: { score: 84, coverage: 1, evidenceCodes: ['COLOR_MONOCHROMATIC'] },
      silhouetteBalance: { score: 86, coverage: 1, evidenceCodes: ['SILHOUETTE_BALANCED_CONTRAST'] },
    },
    evidence: overrides.evidence || [
      { code: 'COLOR_MONOCHROMATIC', polarity: 'positive', strength: 3, itemIds: ['b', 'a'], data: { family: 'black' } },
      { code: 'COLOR_MONOCHROMATIC', polarity: 'positive', strength: 2, itemIds: ['a'], data: { ignored: 'duplicate' } },
      { code: 'SILHOUETTE_BALANCED_CONTRAST', polarity: 'positive', strength: 3, itemIds: ['a', 'b'] },
    ],
  };
}

function outfit(overrides = {}) {
  return {
    clothingIds: ['a', 'b'],
    scene: 'work',
    items: [item('b', { category: 'bottom', subcategory: 'pants' }), item('a')],
    scores: {
      total: 8.6,
      weatherAdaptation: 8,
      styleUnity: 8.5,
      freshness: 7,
      preference: 8,
    },
    aestheticEvaluation: aesthetic(overrides.aesthetic || {}),
    generatedAt: '2026-06-26T00:00:00.000Z',
    recommendationBatchId: 'batch-secret',
    ...overrides,
  };
}

test('buildStylistEvidenceV1 handles empty outfit safely', () => {
  const result = buildStylistEvidenceV1({});
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.evidenceVersion, 'stylist-evidence-v1');
  assert.equal(result.outfit.itemCount, 0);
  assert.deepEqual(result.evidence, []);
  assert.match(result.inputDigest, /^[a-f0-9]{64}$/);
});

test('buildStylistEvidenceV1 keeps legal aesthetic evidence and coverage high', () => {
  const result = buildStylistEvidenceV1({ outfit: outfit(), scene: 'work', weather: { temp: 22, weather: 'cloudy' } });
  assert.equal(result.aesthetic.score, 82);
  assert.equal(result.aesthetic.coverage, 0.75);
  assert.deepEqual(result.limitations, []);
  assert.deepEqual(result.evidence.map((entry) => entry.code), ['COLOR_MONOCHROMATIC', 'SILHOUETTE_BALANCED_CONTRAST']);
});

test('buildStylistEvidenceV1 dedupes evidence with stable order', () => {
  const first = buildStylistEvidenceV1({ outfit: outfit() });
  const second = buildStylistEvidenceV1({
    outfit: {
      ...outfit(),
      aestheticEvaluation: aesthetic({
        evidence: clone(aesthetic().evidence).reverse(),
      }),
    },
  });
  assert.deepEqual(first.evidence.map((entry) => entry.code), second.evidence.map((entry) => entry.code));
  assert.equal(first.evidence[0].strength, 3);
});

test('buildStylistEvidenceV1 input digest is invariant to item order', () => {
  const base = outfit();
  const reversed = { ...clone(base), items: clone(base.items).reverse(), clothingIds: clone(base.clothingIds).reverse() };
  assert.equal(
    buildStylistEvidenceV1({ outfit: base }).inputDigest,
    buildStylistEvidenceV1({ outfit: reversed }).inputDigest,
  );
});

test('buildStylistEvidenceV1 input digest changes when item attributes change', () => {
  const base = outfit();
  const changed = clone(base);
  changed.items[0].material = 'wool';
  assert.notEqual(
    buildStylistEvidenceV1({ outfit: base }).inputDigest,
    buildStylistEvidenceV1({ outfit: changed }).inputDigest,
  );
});

test('buildStylistEvidenceV1 input digest changes when scene changes', () => {
  const base = outfit();
  assert.notEqual(
    buildStylistEvidenceV1({ outfit: base, scene: 'work' }).inputDigest,
    buildStylistEvidenceV1({ outfit: base, scene: 'date' }).inputDigest,
  );
});

test('buildStylistEvidenceV1 input digest changes when weather changes', () => {
  const base = outfit();
  assert.notEqual(
    buildStylistEvidenceV1({ outfit: base, weather: { temp: 12, weather: 'rain' } }).inputDigest,
    buildStylistEvidenceV1({ outfit: base, weather: { temp: 28, weather: 'sunny' } }).inputDigest,
  );
});

test('buildStylistEvidenceV1 input digest changes when scores change', () => {
  const base = outfit();
  const changed = clone(base);
  changed.scores.total = 7.1;
  assert.notEqual(
    buildStylistEvidenceV1({ outfit: base }).inputDigest,
    buildStylistEvidenceV1({ outfit: changed }).inputDigest,
  );
});

test('buildStylistEvidenceV1 applies medium coverage limitation', () => {
  const result = buildStylistEvidenceV1({ outfit: outfit({ aesthetic: { coverage: 0.35 } }) });
  assert.deepEqual(result.limitations, ['LIMITED_AESTHETIC_COVERAGE']);
});

test('buildStylistEvidenceV1 applies insufficient limitation for low coverage', () => {
  const result = buildStylistEvidenceV1({ outfit: outfit({ aesthetic: { coverage: 0.1 } }) });
  assert.deepEqual(result.limitations, ['INSUFFICIENT_AESTHETIC_EVIDENCE']);
});

test('buildStylistEvidenceV1 applies insufficient limitation when score is null', () => {
  const result = buildStylistEvidenceV1({ outfit: outfit({ aesthetic: { score: null, coverage: 0.8 } }) });
  assert.deepEqual(result.limitations, ['INSUFFICIENT_AESTHETIC_EVIDENCE']);
});

test('buildStylistEvidenceV1 removes unsupported evidence', () => {
  const result = buildStylistEvidenceV1({
    outfit: outfit({
      aesthetic: {
        evidence: [{ code: '', polarity: 'positive', strength: 2, itemIds: ['a'] }],
      },
    }),
  });
  assert.deepEqual(result.evidence, []);
});

test('buildStylistEvidenceV1 normalizes illegal strength and polarity', () => {
  const result = buildStylistEvidenceV1({
    outfit: outfit({
      aesthetic: {
        evidence: [{ code: 'FORMALITY_ALIGNED', polarity: 'loud', strength: 99, itemIds: ['a'], data: { gap: Infinity } }],
      },
    }),
  });
  assert.equal(result.evidence[0].polarity, 'neutral');
  assert.equal(result.evidence[0].strength, 3);
  assert.deepEqual(result.evidence[0].facts.data, {});
});

test('buildStylistEvidenceV1 does not expose image file user or location fields', () => {
  const json = JSON.stringify(buildStylistEvidenceV1({
    outfit: outfit(),
    weather: { temp: 22, city: 'Shanghai', latitude: 31.2, longitude: 121.4, weather: 'cloudy' },
  }));
  assert.equal(json.includes('cloud://secret-image'), false);
  assert.equal(json.includes('cloud://secret-file'), false);
  assert.equal(json.includes('"Ada"'), false);
  assert.equal(json.includes('nickname'), false);
  assert.equal(json.includes('Shanghai'), false);
  assert.equal(json.includes('latitude'), false);
});

test('buildStylistEvidenceV1 does not mutate input and is serializable without non-finite values', () => {
  const input = outfit();
  const before = JSON.stringify(input);
  const result = buildStylistEvidenceV1({ outfit: input, weather: { temp: NaN, weather: 'cloudy' } });
  assert.equal(JSON.stringify(input), before);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(JSON.stringify(result).includes('NaN'), false);
  assert.equal(JSON.stringify(result).includes('Infinity'), false);
});

test('stableStringify sorts object keys recursively', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});
