const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCandidatesV1 } = require('./outfitCompositionV1');
const { applyWearabilityAndSceneEligibility } = require('./sceneEligibilityV3');
const { compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');

function item(id, category, extra = {}) {
  return {
    _id: id,
    category,
    subcategory: extra.subcategory || category,
    customName: extra.customName || extra.name || id,
    styleTags: extra.styleTags || [],
    sceneTags: extra.sceneTags || [],
    seasonTags: extra.seasonTags || [],
    colorPalette: extra.colorPalette || [{ name: extra.color || '黑色', hex: '' }],
    material: extra.material,
    thickness: extra.thickness,
    confidence: extra.confidence ?? 0.86,
    usageCount: 0,
    ...extra,
  };
}

function recommendationsFor(scene, wardrobe) {
  const weather = { temp: 29, weather: '晴' };
  const raw = buildOutfitCandidatesV1({
    clothes: wardrobe,
    scene,
    weather,
    maxResults: 24,
    returnRawCandidates: true,
    recommendationProfile: {
      styleTags: [],
      colorPreference: [],
      avoidTags: [],
      fitPreference: 'unknown',
      genderPreference: 'unknown',
      temperatureSensitivity: 'normal',
    },
  });
  const guarded = applyWearabilityAndSceneEligibility(raw, { scene, weather });
  const sorted = guarded.accepted
    .slice()
    .sort((a, b) => (b.rankingScore || 0) - (a.rankingScore || 0))
    .slice(0, 8);
  const withCopy = compileRecommendationLanguageV3({
    outfits: sorted.map((candidate, index) => ({
      id: `candidate-${index}`,
      clothingIds: candidate.items.map((entry) => entry._id),
      items: candidate.items,
      snapshotItems: candidate.items.map((entry) => ({
        itemId: entry._id,
        name: entry.subcategory || entry.customName || entry.category,
        category: entry.category,
        isDeleted: false,
      })),
      scene,
      weatherSnapshot: weather,
      scores: { weatherAdaptation: 8, sceneMatch: 8, total: 8 },
      outfitItemRoles: candidate.outfitItemRoles,
      sceneIntent: candidate.sceneIntent,
      primaryBenefit: candidate.primaryBenefit,
      secondaryBenefit: candidate.secondaryBenefit,
      observationFocus: candidate.observationFocus,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    })),
    scene,
    weather,
  });
  return {
    scene,
    weather,
    items: sorted.map((candidate) => candidate.items.map((entry) => entry.subcategory || entry.customName || entry._id)),
    acceptReasons: sorted.flatMap((candidate) => candidate.eligibility?.scene?.acceptReasons || []),
    rejectReasons: guarded.rejected.flatMap((entry) => [
      ...(entry.weather?.rejectReasons || []),
      ...(entry.scene?.rejectReasons || []),
    ]),
    archetype: sorted.map((candidate) => candidate.structureType),
    todayReason: withCopy.map((outfit) => outfit.reason || ''),
    detailExplanation: withCopy.map((outfit) => outfit.reasoning || ''),
    riskFlags: sorted.flatMap((candidate) => candidate.riskFlags || []),
  };
}

const baseHotWardrobe = [
  item('tee', 'top', { subcategory: 'T恤', sceneTags: ['居家', '日常'], thickness: '薄' }),
  item('shorts', 'bottom', { subcategory: '短裤', sceneTags: ['居家', '日常'], thickness: '薄' }),
  item('sneaker', 'shoes', { subcategory: '干净运动鞋', sceneTags: ['日常', '出游'] }),
  item('slipper', 'shoes', { subcategory: '拖鞋', sceneTags: ['居家'] }),
  item('crocs', 'shoes', { subcategory: '洞洞鞋', sceneTags: ['居家'] }),
  item('hoodie', 'top', { subcategory: '卫衣', thickness: '厚', sceneTags: ['居家'] }),
  item('sweater', 'top', { subcategory: '厚针织毛衣', thickness: '厚', material: '羊毛' }),
  item('shirt', 'top', { subcategory: '通勤衬衫', sceneTags: ['上班'], styleTags: ['通勤'] }),
  item('trousers', 'bottom', { subcategory: '西裤', sceneTags: ['上班'], styleTags: ['通勤'] }),
  item('loafer', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班', '约会'] }),
  item('date-knit', 'top', { subcategory: '轻薄针织上衣', thickness: '轻薄', sceneTags: ['约会'], styleTags: ['优雅'] }),
  item('skirt', 'bottom', { subcategory: '半裙', sceneTags: ['约会'], styleTags: ['优雅'] }),
  item('dress', 'onepiece', { subcategory: '普通连衣裙', sceneTags: ['约会'], styleTags: ['优雅'] }),
  item('sport-top', 'top', { subcategory: '速干训练上衣', sceneTags: ['运动'], styleTags: ['运动'] }),
  item('sport-bottom', 'bottom', { subcategory: '训练短裤', sceneTags: ['运动'], styleTags: ['运动'] }),
  item('running-shoe', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'], styleTags: ['运动'] }),
];

test('home 29C snapshot excludes heavy warm items', () => {
  const snapshot = recommendationsFor('home', baseHotWardrobe);

  assert.equal(snapshot.items.flat().some((name) => /卫衣|毛衣|厚针织/.test(name)), false);
  assert.ok(snapshot.rejectReasons.includes('HOT_WEATHER_WARM_ITEM'));
  assert.deepEqual(snapshot.riskFlags, []);
  assert.equal(snapshot.todayReason.every(Boolean), true);
  assert.equal(snapshot.detailExplanation.every(Boolean), true);
});

test('work 29C snapshot excludes heavy items and invalid home shoes', () => {
  const snapshot = recommendationsFor('work', baseHotWardrobe);

  assert.equal(snapshot.items.flat().some((name) => /卫衣|毛衣|厚针织|拖鞋|洞洞鞋|家居鞋/.test(name)), false);
  assert.ok(snapshot.rejectReasons.includes('HOT_WEATHER_WARM_ITEM'));
  assert.ok(snapshot.rejectReasons.includes('WORK_INVALID_SHOE'));
});

test('date 29C snapshot excludes home shoes and plain tee shorts slipper combinations', () => {
  const snapshot = recommendationsFor('date', baseHotWardrobe);

  assert.equal(snapshot.items.flat().some((name) => /拖鞋|洞洞鞋|家居鞋/.test(name)), false);
  assert.ok(snapshot.rejectReasons.includes('DATE_INVALID_SHOE'));
  assert.equal(snapshot.items.some((names) => /T恤/.test(names.join(' ')) && /短裤/.test(names.join(' ')) && /拖鞋|洞洞鞋/.test(names.join(' '))), false);
});

test('sport 29C snapshot excludes ordinary dresses and skirts', () => {
  const snapshot = recommendationsFor('sport', baseHotWardrobe);

  assert.equal(snapshot.items.flat().some((name) => /普通连衣裙|半裙/.test(name)), false);
  assert.ok(snapshot.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'));
  assert.ok(snapshot.items.flat().some((name) => /训练|速干|跑步/.test(name)));
});
