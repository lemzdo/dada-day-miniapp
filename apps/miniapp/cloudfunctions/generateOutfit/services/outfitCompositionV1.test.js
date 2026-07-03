const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildOutfitCandidatesV1,
  deriveItemCapabilitiesV1,
} = require('./outfitCompositionV1');

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
    confidence: extra.confidence ?? 0.86,
    aiConfidence: extra.aiConfidence,
    warmthScore: extra.warmthScore,
    coolnessScore: extra.coolnessScore,
    thickness: extra.thickness,
    material: extra.material,
    usageCount: 0,
    ...extra,
  };
}

function ids(candidate) {
  return candidate.items.map((entry) => entry._id);
}

function roles(candidate) {
  return Object.fromEntries(candidate.items.map((entry) => [entry._id, entry.outfitRole]));
}

function candidatesFor(scene, temp, wardrobe, options = {}) {
  return buildOutfitCandidatesV1({
    clothes: wardrobe,
    scene,
    weather: { temp, weather: options.weather || '晴' },
    maxResults: options.maxResults || 8,
    excludedOutfitKeys: options.excludedOutfitKeys || [],
    excludeClothingIdSets: options.excludeClothingIdSets || [],
    recommendationProfile: {
      styleTags: [],
      colorPreference: [],
      avoidTags: [],
      fitPreference: 'unknown',
      genderPreference: 'unknown',
      temperatureSensitivity: 'normal',
    },
  });
}

test('dress plus shoes is complete without forcing outerwear', () => {
  const wardrobe = [
    item('dress', 'onepiece', { subcategory: '连衣裙', sceneTags: ['约会'], styleTags: ['优雅'] }),
    item('shoes', 'shoes', { subcategory: '单鞋', sceneTags: ['约会'], styleTags: ['优雅'] }),
    item('coat', 'top', { subcategory: '外套', customName: '薄外套', warmthScore: 7, thickness: '厚' }),
  ];

  const [candidate] = candidatesFor('约会', 31, wardrobe);

  assert.deepEqual(ids(candidate), ['dress', 'shoes']);
  assert.equal(candidate.items.length, 2);
  assert.equal(candidate.items.every((entry) => roles(candidate)[entry._id] === 'core'), true);
  assert.equal(candidate.structureType, 'onepiece_shoes');
});

test('top bottom and shoes are the base complete outfit', () => {
  const wardrobe = [
    item('top', 'top', { subcategory: '衬衫', sceneTags: ['上班'] }),
    item('bottom', 'bottom', { subcategory: '长裤', sceneTags: ['上班'] }),
    item('shoes', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班'] }),
  ];

  const [candidate] = candidatesFor('上班', 24, wardrobe);

  assert.deepEqual(ids(candidate), ['top', 'bottom', 'shoes']);
  assert.deepEqual(roles(candidate), { top: 'core', bottom: 'core', shoes: 'core' });
  assert.equal(candidate.structureType, 'separates_shoes');
});

test('outerwear is functional in cold commute and forbidden in high heat filler outfits', () => {
  const wardrobe = [
    item('top', 'top', { subcategory: '衬衫', sceneTags: ['上班'] }),
    item('bottom', 'bottom', { subcategory: '长裤', sceneTags: ['上班'] }),
    item('shoes', 'shoes', { subcategory: '通勤鞋', sceneTags: ['上班'] }),
    item('coat', 'top', { subcategory: '风衣', customName: '风衣外套', sceneTags: ['上班'], warmthScore: 8 }),
  ];

  const cold = candidatesFor('上班', 10, wardrobe)[0];
  const hot = candidatesFor('上班', 33, wardrobe)[0];

  assert.ok(ids(cold).includes('coat'));
  assert.equal(roles(cold).coat, 'functional');
  assert.equal(ids(hot).includes('coat'), false);
});

test('accessories are optional only when reliable and useful', () => {
  const base = [
    item('top', 'top', { subcategory: 'T恤', sceneTags: ['约会'] }),
    item('bottom', 'bottom', { subcategory: '半裙', sceneTags: ['约会'] }),
    item('shoes', 'shoes', { subcategory: '单鞋', sceneTags: ['约会'] }),
  ];
  const withAccent = candidatesFor('约会', 24, [
    ...base,
    item('bag', 'accessory', { subcategory: '小包', sceneTags: ['约会'], color: '红色', confidence: 0.91 }),
  ])[0];
  const withoutAccessory = candidatesFor('约会', 24, base)[0];
  const unreliable = candidatesFor('约会', 24, [
    ...base,
    item('unknown-bag', 'accessory', { subcategory: '配饰', sceneTags: ['约会'], confidence: 0.31 }),
  ])[0];

  assert.equal(ids(withAccent).includes('bag'), true);
  assert.equal(roles(withAccent).bag, 'optional');
  assert.equal(withoutAccessory.items.length, 3);
  assert.equal(ids(unreliable).includes('unknown-bag'), false);
});

test('scene intents are selected from real wardrobe capabilities and diversify batches', () => {
  const wardrobe = [
    item('soft-top', 'top', { subcategory: '针织上衣', sceneTags: ['约会'], styleTags: ['甜美'], color: '粉色' }),
    item('highlight-top', 'top', { subcategory: '亮色上衣', sceneTags: ['约会'], styleTags: ['街头'], color: '红色' }),
    item('casual-top', 'top', { subcategory: 'T恤', sceneTags: ['约会'], styleTags: ['休闲'] }),
    item('skirt', 'bottom', { subcategory: '半裙', sceneTags: ['约会'], color: '白色' }),
    item('jeans', 'bottom', { subcategory: '牛仔裤', sceneTags: ['约会'], color: '蓝色' }),
    item('soft-shoe', 'shoes', { subcategory: '单鞋', sceneTags: ['约会'] }),
    item('walk-shoe', 'shoes', { subcategory: '运动鞋', sceneTags: ['约会', '出游'] }),
  ];

  const results = candidatesFor('约会', 23, wardrobe, { maxResults: 6 });
  const identity = results.map((candidate) => [
    candidate.sceneIntent,
    candidate.primaryBenefit,
    candidate.shoePurpose,
    candidate.observationFocus,
  ].join('|'));

  assert.ok(results.some((candidate) => candidate.sceneIntent === 'date:soft'));
  assert.ok(results.some((candidate) => candidate.sceneIntent === 'date:highlight'));
  assert.ok(results.some((candidate) => candidate.sceneIntent === 'date:casual'));
  assert.equal(new Set(identity).size, identity.length);
});

test('home can produce indoor and quick outing plans when matching shoes exist', () => {
  const wardrobe = [
    item('home-top', 'top', { subcategory: '居家上衣', sceneTags: ['居家'], styleTags: ['休闲'] }),
    item('home-bottom', 'bottom', { subcategory: '家居裤', sceneTags: ['居家'], styleTags: ['休闲'] }),
    item('indoor-shoe', 'shoes', { subcategory: '室内鞋', sceneTags: ['居家'] }),
    item('outing-shoe', 'shoes', { subcategory: '运动鞋', sceneTags: ['出游', '日常'] }),
  ];

  const results = candidatesFor('居家', 27, wardrobe, { maxResults: 4 });

  assert.ok(results.some((candidate) => candidate.sceneIntent === 'home:indoor_relax'));
  assert.ok(results.some((candidate) => candidate.sceneIntent === 'home:quick_outing'));
});

test('sport training and light activity are not conflated', () => {
  const wardrobe = [
    item('training-top', 'top', { subcategory: '训练上衣', sceneTags: ['运动'], styleTags: ['运动'] }),
    item('daily-top', 'top', { subcategory: 'T恤', sceneTags: ['日常'], styleTags: ['休闲'] }),
    item('training-bottom', 'bottom', { subcategory: '训练裤', sceneTags: ['运动'], styleTags: ['运动'] }),
    item('daily-bottom', 'bottom', { subcategory: '休闲裤', sceneTags: ['日常'], styleTags: ['休闲'] }),
    item('training-shoe', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'] }),
    item('walking-shoe', 'shoes', { subcategory: '运动鞋', sceneTags: ['日常', '出游'] }),
  ];

  const results = candidatesFor('运动', 22, wardrobe, { maxResults: 5 });
  const training = results.find((candidate) => candidate.sceneIntent === 'sport:training');
  const light = results.find((candidate) => candidate.sceneIntent === 'sport:light_activity');

  assert.ok(training);
  assert.ok(light);
  assert.equal(ids(training).includes('training-shoe'), true);
  assert.equal(training.primaryBenefit, 'formal_training');
  assert.notEqual(light.primaryBenefit, 'formal_training');
});

test('candidate layering keeps late but suitable items instead of blind slicing', () => {
  const shoes = Array.from({ length: 7 }, (_, index) =>
    item(`casual-shoe-${index}`, 'shoes', { subcategory: '休闲鞋', sceneTags: ['日常'] }),
  );
  const wardrobe = [
    item('top', 'top', { subcategory: '衬衫', sceneTags: ['上班'] }),
    item('bottom', 'bottom', { subcategory: '西裤', sceneTags: ['上班'] }),
    ...shoes,
    item('commute-shoe', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班', '通勤'] }),
  ];

  const results = candidatesFor('上班', 20, wardrobe, { maxResults: 3 });

  assert.equal(results.some((candidate) => ids(candidate).includes('commute-shoe')), true);
});

test('capabilities are generic and do not depend on a slipper special-case', () => {
  const indoor = deriveItemCapabilitiesV1(item('indoor', 'shoes', { subcategory: '室内鞋', sceneTags: ['居家'] }));
  const commute = deriveItemCapabilitiesV1(item('commute', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班', '通勤'] }));

  assert.ok(indoor.includes('indoor'));
  assert.ok(commute.includes('commute'));
  assert.equal(indoor.includes('slipper'), false);
});
