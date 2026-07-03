const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCandidatesV1 } = require('./outfitCompositionV1');
const { compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');

function item(id, category, extra = {}) {
  return {
    _id: id,
    category,
    subcategory: extra.subcategory || category,
    customName: extra.customName || extra.subcategory || id,
    styleTags: extra.styleTags || [],
    sceneTags: extra.sceneTags || [],
    colorPalette: [{ name: extra.color || '黑色', hex: '' }],
    confidence: extra.confidence ?? 0.86,
    warmthScore: extra.warmthScore,
    coolnessScore: extra.coolnessScore,
    thickness: extra.thickness,
    material: extra.material,
    usageCount: 0,
  };
}

function outfitKey(items) {
  return items.map((entry) => entry._id).sort().join('_');
}

function replay(scene, weather, wardrobe) {
  const candidates = buildOutfitCandidatesV1({
    clothes: wardrobe,
    scene,
    weather,
    maxResults: 3,
    recommendationProfile: {
      styleTags: [],
      colorPreference: [],
      avoidTags: [],
      fitPreference: 'unknown',
      genderPreference: 'unknown',
      temperatureSensitivity: 'normal',
    },
  }).slice(0, 3);
  return compileRecommendationLanguageV3({
    outfits: candidates.map((candidate, index) => ({
      id: `${scene}-${index}`,
      outfitKey: outfitKey(candidate.items),
      items: candidate.items,
      clothingIds: candidate.items.map((entry) => entry._id),
      scene,
      weatherSnapshot: weather,
      scores: { total: 8, weatherAdaptation: 8, styleUnity: 8, freshness: 8, preference: 8 },
      outfitItemRoles: candidate.outfitItemRoles,
      sceneIntent: candidate.sceneIntent,
      primaryBenefit: candidate.primaryBenefit,
      secondaryBenefit: candidate.secondaryBenefit,
      observationFocus: candidate.observationFocus,
    })),
    scene,
    weather,
  });
}

test('anonymous fixtures replay 3 batches for home work date and sport without AI or DB', () => {
  const fixtures = [
    {
      scene: '居家',
      weather: { temp: 27, weather: '晴' },
      wardrobe: [
        item('home-top', 'top', { subcategory: '居家上衣', sceneTags: ['居家'], styleTags: ['休闲'], color: '白色' }),
        item('home-bottom', 'bottom', { subcategory: '家居裤', sceneTags: ['居家'], styleTags: ['休闲'], color: '灰色' }),
        item('indoor-shoes', 'shoes', { subcategory: '室内鞋', sceneTags: ['居家'], color: '米色' }),
        item('walk-shoes', 'shoes', { subcategory: '运动鞋', sceneTags: ['出游', '日常'], color: '黑色' }),
        item('daily-top', 'top', { subcategory: 'T恤', sceneTags: ['日常'], styleTags: ['休闲'], color: '蓝色' }),
      ],
    },
    {
      scene: '上班',
      weather: { temp: 16, weather: '多云' },
      wardrobe: [
        item('shirt', 'top', { subcategory: '衬衫', sceneTags: ['上班', '通勤'], color: '白色' }),
        item('pants', 'bottom', { subcategory: '西裤', sceneTags: ['上班'], color: '黑色' }),
        item('loafers', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班', '通勤'], color: '棕色' }),
        item('coat', 'top', { subcategory: '薄外套', customName: '薄外套', sceneTags: ['上班'], warmthScore: 7 }),
        item('sneakers', 'shoes', { subcategory: '运动鞋', sceneTags: ['出游'], color: '白色' }),
      ],
    },
    {
      scene: '约会',
      weather: { temp: 24, weather: '晴' },
      wardrobe: [
        item('soft-knit', 'top', { subcategory: '针织上衣', sceneTags: ['约会'], styleTags: ['甜美'], color: '粉色' }),
        item('red-top', 'top', { subcategory: '亮色上衣', sceneTags: ['约会'], color: '红色' }),
        item('skirt', 'bottom', { subcategory: '半裙', sceneTags: ['约会'], color: '白色' }),
        item('jeans', 'bottom', { subcategory: '牛仔裤', sceneTags: ['日常'], color: '蓝色' }),
        item('date-shoes', 'shoes', { subcategory: '单鞋', sceneTags: ['约会'], color: '米色' }),
        item('bag', 'accessory', { subcategory: '小包', sceneTags: ['约会'], color: '红色' }),
      ],
    },
    {
      scene: '运动',
      weather: { temp: 22, weather: '阴' },
      wardrobe: [
        item('training-top', 'top', { subcategory: '训练上衣', sceneTags: ['运动'], styleTags: ['运动'], color: '黑色' }),
        item('daily-tee', 'top', { subcategory: 'T恤', sceneTags: ['日常'], styleTags: ['休闲'], color: '白色' }),
        item('training-pants', 'bottom', { subcategory: '训练裤', sceneTags: ['运动'], styleTags: ['运动'], color: '灰色' }),
        item('casual-pants', 'bottom', { subcategory: '休闲裤', sceneTags: ['日常'], color: '蓝色' }),
        item('running-shoes', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'], color: '黑色' }),
        item('walk-shoes', 'shoes', { subcategory: '运动鞋', sceneTags: ['出游'], color: '白色' }),
      ],
    },
  ];

  for (const fixture of fixtures) {
    const results = replay(fixture.scene, fixture.weather, fixture.wardrobe);
    assert.equal(results.length, 3, fixture.scene);
    assert.ok(new Set(results.map((entry) => entry.contentPlan.sceneIntent)).size >= 2, fixture.scene);
    for (const result of results) {
      const visible = [
        result.reason,
        result.reasoning,
        result.aiComment?.overallComment,
        result.aiComment?.advice,
      ].filter(Boolean).join('\n');
      assert.ok(result.contentPlanVersion, fixture.scene);
      assert.equal(result.reviewSource, 'rule_default');
      assert.doesNotMatch(visible, /\b(top|bottom|shoes|outerwear|accessory|onepiece|category|subcategory|slot)\b/i);
      assert.doesNotMatch(visible, /单品和单品很日常|想再明确一点/);
      assert.ok(result.contentPlan.items.length >= 2 && result.contentPlan.items.length <= 5);
    }
  }
});
