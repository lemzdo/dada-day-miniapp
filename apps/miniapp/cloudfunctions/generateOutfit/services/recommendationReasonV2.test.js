const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RECOMMENDATION_REASON_VERSION,
  buildReasonCandidates,
  compileRecommendationReasonsV2,
} = require('./recommendationReasonV2');

function item(overrides = {}) {
  return {
    clothingId: overrides.clothingId || overrides.id || 'item-1',
    id: overrides.id || overrides.clothingId || 'item-1',
    category: overrides.category || 'top',
    subcategory: overrides.subcategory || overrides.type || '衬衫',
    colorPalette: overrides.colorPalette || (overrides.color ? [{ name: overrides.color, hex: '' }] : []),
    color: overrides.color || '',
    styleTags: overrides.styleTags || [],
    material: overrides.material || '',
    thickness: overrides.thickness || '',
    aestheticFeatures: overrides.aestheticFeatures || {},
    ...overrides,
  };
}

function outfit(overrides = {}) {
  const items = overrides.items || [
    item({
      clothingId: 'top-1',
      category: 'top',
      subcategory: '短衬衫',
      color: '白色',
      styleTags: ['通勤'],
      aestheticFeatures: { fit: 'fitted', length: 'short', formalityLevel: 3 },
    }),
    item({
      clothingId: 'bottom-1',
      category: 'bottom',
      subcategory: '阔腿裤',
      color: '黑色',
      styleTags: ['通勤'],
      aestheticFeatures: { silhouette: 'wideLeg', length: 'long', formalityLevel: 3 },
    }),
    item({
      clothingId: 'shoe-1',
      category: 'shoes',
      subcategory: '乐福鞋',
      color: '黑色',
      styleTags: ['通勤'],
      aestheticFeatures: { formalityLevel: 3 },
    }),
  ];
  return {
    id: overrides.id || `outfit-${items.map((entry) => entry.clothingId || entry.id).join('-')}`,
    clothingIds: items.map((entry) => entry.clothingId || entry.id),
    items,
    scene: overrides.scene || 'work',
    weatherSnapshot: overrides.weatherSnapshot || { temp: 23, condition: '晴' },
    scores: overrides.scores || { total: 8.7, weatherAdaptation: 8, sceneMatch: 8.5, styleUnity: 8.4 },
    aestheticEvaluation: overrides.aestheticEvaluation || {
      version: 1,
      engineVersion: 'aesthetic-compat-v1',
      score: 82,
      coverage: 0.75,
      dimensions: {},
      evidence: [
        {
          code: 'SILHOUETTE_BALANCED_CONTRAST',
          dimension: 'silhouetteBalance',
          polarity: 'positive',
          strength: 3,
          itemIds: ['top-1', 'bottom-1'],
        },
        {
          code: 'PROPORTION_CLEAR_LAYERING',
          dimension: 'proportionBalance',
          polarity: 'positive',
          strength: 3,
          itemIds: ['top-1', 'bottom-1'],
        },
        {
          code: 'FORMALITY_ALIGNED',
          dimension: 'formalityConsistency',
          polarity: 'positive',
          strength: 2,
          itemIds: ['top-1', 'bottom-1', 'shoe-1'],
        },
      ],
    },
    reason: overrides.reason || '旧推荐理由',
    reasoning: overrides.reasoning || '旧详情解释',
    ...overrides,
  };
}

function compile(inputOutfits, options = {}) {
  return compileRecommendationReasonsV2({
    outfits: inputOutfits,
    scene: options.scene || 'work',
    weather: options.weather || { temp: 23, condition: '晴' },
  });
}

test('buildReasonCandidates returns aesthetic evidence candidates first with expected dimensions', () => {
  const candidates = buildReasonCandidates(outfit());
  assert.ok(candidates.length >= 3);
  assert.equal(candidates[0].dimension, 'silhouette');
  assert.ok(candidates.some((entry) => entry.dimension === 'proportion'));
  assert.ok(candidates.some((entry) => entry.dimension === 'formality'));
  assert.deepEqual(candidates.slice(0, 3).map((entry) => entry.code), [
    'SILHOUETTE_BALANCED_CONTRAST',
    'PROPORTION_CLEAR_LAYERING',
    'FORMALITY_ALIGNED',
  ]);
});

test('buildReasonCandidates supports all required dimensions when facts are present', () => {
  const source = outfit({
    items: [
      item({
        clothingId: 'dress-1',
        category: 'onepiece',
        subcategory: '印花连衣裙',
        color: '蓝色',
        material: '棉',
        styleTags: ['法式'],
        aestheticFeatures: {
          fit: 'relaxed',
          length: 'long',
          patternType: 'floral',
          designElements: ['褶皱'],
          formalityLevel: 2,
        },
      }),
      item({
        clothingId: 'shoe-1',
        category: 'shoes',
        subcategory: '凉鞋',
        color: '米色',
        material: '皮革',
        styleTags: ['休闲'],
        aestheticFeatures: { formalityLevel: 2 },
      }),
    ],
    scores: { total: 8, weatherAdaptation: 9, sceneMatch: 8, styleUnity: 8 },
    aestheticEvaluation: {
      version: 1,
      engineVersion: 'aesthetic-compat-v1',
      score: 78,
      coverage: 0.8,
      dimensions: {},
      evidence: [
        { code: 'COLOR_ANALOGOUS', dimension: 'colorHarmony', polarity: 'positive', strength: 2, itemIds: ['dress-1'] },
        { code: 'SILHOUETTE_BALANCED_CONTINUITY', dimension: 'silhouetteBalance', polarity: 'positive', strength: 2, itemIds: ['dress-1'] },
        { code: 'PROPORTION_BALANCED_LENGTH', dimension: 'proportionBalance', polarity: 'neutral', strength: 1, itemIds: ['dress-1'] },
        { code: 'PATTERN_SINGLE_FOCUS', dimension: 'patternBalance', polarity: 'positive', strength: 3, itemIds: ['dress-1'] },
        { code: 'FORMALITY_ALIGNED', dimension: 'formalityConsistency', polarity: 'positive', strength: 2, itemIds: ['dress-1', 'shoe-1'] },
        { code: 'DETAIL_SINGLE_FOCUS', dimension: 'detailBalance', polarity: 'positive', strength: 3, itemIds: ['dress-1'] },
      ],
    },
  });
  const dimensions = new Set(buildReasonCandidates(source).map((entry) => entry.dimension));
  for (const dimension of ['color', 'silhouette', 'proportion', 'pattern', 'formality', 'detail', 'weather', 'scene', 'style']) {
    assert.equal(dimensions.has(dimension), true, dimension);
  }
});

test('compileRecommendationReasonsV2 adds versioned concise card reason and richer detail reasoning', () => {
  const [result] = compile([outfit()]);
  assert.equal(result.reasonVersion, RECOMMENDATION_REASON_VERSION);
  assert.equal(result.primaryDimension, 'silhouette');
  assert.equal(result.evidenceCodes.includes('SILHOUETTE_BALANCED_CONTRAST'), true);
  assert.ok(result.reason.length >= 10);
  assert.ok(result.reason.length <= 44);
  assert.ok(result.reasoning.length >= 30);
  assert.ok(result.reasoning.length <= 150);
  assert.notEqual(result.reasoning, result.reason);
});

test('compiled card reason avoids fixed old openings, list markers, scores, and body language', () => {
  const [result] = compile([outfit()]);
  assert.doesNotMatch(result.reason, /^这套搭配/);
  assert.doesNotMatch(result.reason, /适合今天|舒适自然|风格统一|日常好穿/);
  assert.doesNotMatch(result.reason, /[0-9](\.[0-9])?分|、|1\.|2\./);
  assert.doesNotMatch(`${result.reason}${result.reasoning}`, /显瘦|遮肉|身材|腿长|腰线|肉感/);
});

test('detail reasoning includes a supporting dimension beyond the card primary dimension', () => {
  const [result] = compile([outfit()]);
  assert.equal(result.primaryDimension, 'silhouette');
  assert.match(result.reasoning, /比例|正式度|场合|色|图案|细节|温度|风格/);
});

test('same batch deduplicates primary dimensions and reason text deterministically', () => {
  const inputs = [
    outfit({ id: 'a' }),
    outfit({
      id: 'b',
      items: [
        item({ clothingId: 'top-2', category: 'top', subcategory: '针织衫', color: '灰色', aestheticFeatures: { fit: 'fitted', length: 'short', formalityLevel: 3 } }),
        item({ clothingId: 'bottom-2', category: 'bottom', subcategory: '直筒裤', color: '深蓝', aestheticFeatures: { silhouette: 'straight', length: 'long', formalityLevel: 3 } }),
        item({ clothingId: 'shoe-2', category: 'shoes', subcategory: '短靴', color: '黑色', aestheticFeatures: { formalityLevel: 3 } }),
      ],
    }),
    outfit({
      id: 'c',
      aestheticEvaluation: {
        version: 1,
        engineVersion: 'aesthetic-compat-v1',
        score: 80,
        coverage: 0.75,
        dimensions: {},
        evidence: [
          { code: 'COLOR_MONOCHROMATIC', dimension: 'colorHarmony', polarity: 'positive', strength: 3, itemIds: ['top-1', 'bottom-1'] },
          { code: 'SILHOUETTE_BALANCED_CONTRAST', dimension: 'silhouetteBalance', polarity: 'positive', strength: 3, itemIds: ['top-1', 'bottom-1'] },
        ],
      },
    }),
  ];
  const first = compile(inputs);
  const second = compile(inputs);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((entry) => entry.reason)).size, first.length);
  assert.ok(new Set(first.map((entry) => entry.primaryDimension)).size > 1);
});

test('weather and scene are not primary for every card when stronger clothing evidence exists', () => {
  const results = compile([outfit({ id: 'a' }), outfit({ id: 'b' }), outfit({ id: 'c' })]);
  assert.notEqual(results.every((entry) => ['weather', 'scene'].includes(entry.primaryDimension)), true);
});

test('falls back to real clothing facts when aesthetic coverage is low', () => {
  const [result] = compile([
    outfit({
      aestheticEvaluation: {
        version: 1,
        engineVersion: 'aesthetic-compat-v1',
        score: null,
        coverage: 0.1,
        dimensions: {},
        evidence: [],
      },
    }),
  ]);
  assert.equal(result.reasonVersion, RECOMMENDATION_REASON_VERSION);
  assert.match(result.reason, /短衬衫|阔腿裤|乐福鞋|白色|黑色|通勤/);
  assert.doesNotMatch(result.reason, /棉|羊毛|皮革/);
});

test('does not hallucinate missing color or material facts', () => {
  const [result] = compile([
    outfit({
      items: [
        item({ clothingId: 'plain-1', category: 'top', subcategory: '上衣', color: '', material: '' }),
        item({ clothingId: 'plain-2', category: 'bottom', subcategory: '长裤', color: '', material: '' }),
      ],
      aestheticEvaluation: { version: 1, engineVersion: 'aesthetic-compat-v1', score: null, coverage: 0, dimensions: {}, evidence: [] },
    }),
  ]);
  assert.doesNotMatch(`${result.reason}${result.reasoning}`, /黑|白|蓝|灰|棉|羊毛|皮革|丝/);
});

test('item order does not change generated language for the same outfit facts', () => {
  const firstItems = [
    item({ clothingId: 'a', category: 'top', subcategory: '短衬衫', color: '白色', aestheticFeatures: { fit: 'fitted', length: 'short' } }),
    item({ clothingId: 'b', category: 'bottom', subcategory: '阔腿裤', color: '黑色', aestheticFeatures: { silhouette: 'wideLeg', length: 'long' } }),
  ];
  const secondItems = firstItems.slice().reverse();
  const [first] = compile([outfit({ items: firstItems })]);
  const [second] = compile([outfit({ items: secondItems })]);
  assert.equal(first.reason, second.reason);
  assert.equal(first.reasoning, second.reasoning);
});

test('does not mutate inputs and preserves order, scores, aesthetic evaluation, keys, favorite and worn flags', () => {
  const source = [
    outfit({
      id: 'one',
      outfitKey: 'one-key',
      recommendationBatchId: 'batch-1',
      isFavorite: true,
      isWornToday: true,
    }),
    outfit({ id: 'two', outfitKey: 'two-key' }),
  ];
  const before = JSON.parse(JSON.stringify(source));
  const results = compile(source);
  assert.deepEqual(source, before);
  assert.deepEqual(results.map((entry) => entry.id), ['one', 'two']);
  assert.equal(results[0].outfitKey, 'one-key');
  assert.equal(results[0].recommendationBatchId, 'batch-1');
  assert.equal(results[0].isFavorite, true);
  assert.equal(results[0].isWornToday, true);
  assert.deepEqual(results[0].scores, before[0].scores);
  assert.deepEqual(results[0].aestheticEvaluation, before[0].aestheticEvaluation);
});

test('compiled result is JSON serializable and contains no NaN or Infinity', () => {
  const result = compile([outfit({ scores: { total: Number.NaN, sceneMatch: Number.POSITIVE_INFINITY } })]);
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /NaN|Infinity/);
  assert.deepEqual(JSON.parse(json), result);
});

test('empty and legacy inputs keep old reason compatibility through a safe fallback', () => {
  assert.deepEqual(compile([]), []);
  const [legacy] = compile([{ id: 'legacy', clothingIds: ['x'], reason: '旧卡片理由', reasoning: '旧详情理由' }]);
  assert.equal(legacy.reasonVersion, RECOMMENDATION_REASON_VERSION);
  assert.ok(legacy.reason);
  assert.ok(legacy.reasoning);
});
