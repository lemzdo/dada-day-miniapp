const assert = require('node:assert/strict');
const test = require('node:test');

const { compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');
const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');

function item(id, category, subcategory, extra = {}) {
  return { clothingId: id, category, subcategory, confidence: 0.95, ...extra };
}

function replay(scene) {
  const items = [
    item('top-1', 'top', scene === 'sport' ? '运动训练上衣' : '衬衫', {
      fit: '宽松', shoulderFit: '宽松', styleComplexity: '简洁',
      patternType: scene === 'date' ? '印花' : '纯色',
      productFacts: ['soft_material', 'movement', 'shoulder_mobility'],
      styleTags: scene === 'sport' ? ['运动'] : [],
      sceneTags: scene === 'sport' ? ['运动'] : [scene],
    }),
    item('bottom-1', 'bottom', scene === 'sport' ? '运动直筒裤' : '直筒裤', {
      fit: '直筒宽松', patternType: '纯色', styleComplexity: '简洁',
      pantsLength: 'long',
      styleTags: scene === 'sport' ? ['运动'] : [],
      sceneTags: scene === 'sport' ? ['运动'] : [scene],
      productFacts: ['flexible_fit', 'movement'],
    }),
    item('shoes-1', 'shoes', scene === 'sport' ? '运动鞋' : '乐福鞋', {
      styleComplexity: '简洁', productFacts: ['secure_fit'],
    }),
  ];
  const weather = { temp: 22, weather: '晴' };
  return compileRecommendationLanguageV3({
    outfits: [1, 2, 3].map((index) => {
      const selectedItems = items.map((entry) => ({ ...entry, clothingId: `${entry.clothingId}-${index}` }));
      return {
        id: `${scene}-${index}`,
        items: selectedItems,
        clothingIds: selectedItems.map((entry) => entry.clothingId),
        scene,
        weatherSnapshot: weather,
        eligibility: {
          weather: { pass: true },
          scene: evaluateSceneEligibilityV3({ scene, items: selectedItems, weather }),
        },
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      };
    }),
    scene,
    weather,
  });
}

test('synthetic Contract fixtures replay three recommendations for all scenes without AI or DB', () => {
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const results = replay(scene);
    assert.equal(results.length, 3, scene);
    for (const result of results) {
      assert.equal(result.copyContract.gateResult, 'PASS', `${scene}:${result.id}`);
      assert.deepEqual(result.riskFlags, [], `${scene}:${result.id}`);
      assert.ok(result.copyContract.todayReason.trim(), scene);
      assert.ok(result.eligibilityReason?.code, scene);
      assert.equal(result.reviewSource, 'rule_default');
    }
  }
});

test('repeated correct reasons are accepted rather than rejected for diversity', () => {
  const results = replay('home');
  assert.deepEqual(results.map((entry) => entry.copyContract.todayClaimId), ['H01-01', 'H01-01', 'H01-01']);
  assert.equal(results.every((entry) => entry.copyContract.gateResult === 'PASS'), true);
});
