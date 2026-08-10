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
    weatherMode: options.weatherMode || 'live',
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
    item('dress', 'onepiece', { subcategory: '简洁连衣裙', styleComplexity: '简洁', sceneTags: ['约会'], styleTags: ['优雅'] }),
    item('shoes', 'shoes', { subcategory: '简洁单鞋', styleComplexity: '简洁', sceneTags: ['约会'], styleTags: ['优雅'] }),
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
    item('bottom', 'bottom', { subcategory: '直筒长裤', fit: '直筒', pantsLength: 'long', sceneTags: ['上班'] }),
    item('shoes', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班'] }),
  ];

  const [candidate] = candidatesFor('上班', 24, wardrobe);

  assert.deepEqual(ids(candidate), ['top', 'bottom', 'shoes']);
  assert.deepEqual(roles(candidate), { top: 'core', bottom: 'core', shoes: 'core' });
  assert.equal(candidate.structureType, 'separates_shoes');
});

test('core composition never enumerates outerwear before final semantic attachment', () => {
  const wardrobe = [
    item('top', 'top', { subcategory: '衬衫', sceneTags: ['上班'] }),
    item('bottom', 'bottom', { subcategory: '直筒长裤', fit: '直筒', pantsLength: 'long', sceneTags: ['上班'] }),
    item('shoes', 'shoes', { subcategory: '通勤鞋', sceneTags: ['上班'] }),
    item('coat', 'top', { subcategory: '风衣', customName: '风衣外套', sceneTags: ['上班'], warmthScore: 8 }),
  ];

  const cold = candidatesFor('上班', 10, wardrobe)[0];
  const hot = candidatesFor('上班', 33, wardrobe)[0];

  assert.equal(ids(cold).includes('coat'), false);
  assert.equal(ids(hot).includes('coat'), false);
});

test('raw candidate construction keeps all eligible cores without outerwear cartesian expansion', () => {
  const wardrobe = [
    item('top', 'top', { subcategory: 'shirt', sceneTags: ['work'] }),
    item('bottom', 'bottom', { subcategory: 'straight pants', pantsLength: 'long', sceneTags: ['work'] }),
    item('shoes', 'shoes', { subcategory: 'office shoes', sceneTags: ['work'] }),
    ...Array.from({ length: 7 }, (_, index) => item(`coat-${index + 1}`, 'outerwear', {
      subcategory: `work jacket ${index + 1}`,
      sceneTags: ['work'],
    })),
  ];
  const raw = buildOutfitCandidatesV1({
    clothes: wardrobe,
    scene: 'work',
    weather: { temp: 10, weather: 'clear' },
    weatherMode: 'live',
    returnRawCandidates: true,
  });
  const outerwearIds = new Set(raw
    .flatMap((candidate) => candidate.items)
    .filter((entry) => entry.outfitSlot === 'outerwear')
    .map((entry) => entry._id));
  assert.deepEqual([...outerwearIds], []);
});

test('core candidate construction defers accessories until after batch selection', () => {
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

  assert.equal(ids(withAccent).includes('bag'), false);
  assert.equal(withoutAccessory.items.length, 3);
  assert.equal(ids(unreliable).includes('unknown-bag'), false);
});

test('scene intents are selected from real wardrobe capabilities and diversify batches', () => {
  const wardrobe = [
    item('soft-top', 'top', { subcategory: '针织上衣', styleComplexity: '简洁', sceneTags: ['约会'], styleTags: ['甜美'], color: '粉色' }),
    item('highlight-top', 'top', { subcategory: '亮色上衣', styleComplexity: '简洁', sceneTags: ['约会'], styleTags: ['街头'], color: '红色' }),
    item('casual-top', 'top', { subcategory: 'T恤', styleComplexity: '简洁', sceneTags: ['约会'], styleTags: ['休闲'] }),
    item('skirt', 'bottom', { subcategory: '半裙', styleComplexity: '简洁', sceneTags: ['约会'], color: '白色' }),
    item('jeans', 'bottom', { subcategory: '牛仔裤', styleComplexity: '简洁', sceneTags: ['约会'], color: '蓝色' }),
    item('soft-shoe', 'shoes', { subcategory: '单鞋', styleComplexity: '简洁', sceneTags: ['约会'] }),
    item('walk-shoe', 'shoes', { subcategory: '运动鞋', styleComplexity: '简洁', sceneTags: ['约会', '出游'] }),
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

test('sport training keeps the formal training intent when all three core items support it', () => {
  const wardrobe = [
    item('training-top', 'top', { subcategory: '训练上衣', sceneTags: ['运动'], styleTags: ['运动'] }),
    item('daily-top', 'top', { subcategory: 'light athletic top', sceneTags: ['运动'], styleTags: ['运动'] }),
    item('training-bottom', 'bottom', { subcategory: '训练裤', sceneTags: ['运动'], styleTags: ['运动'] }),
    item('daily-bottom', 'bottom', { subcategory: 'light athletic pants', sceneTags: ['运动'], styleTags: ['运动'] }),
    item('training-shoe', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'] }),
    item('walking-shoe', 'shoes', { subcategory: '运动鞋', sceneTags: ['日常', '出游'] }),
  ];

  const results = candidatesFor('运动', 22, wardrobe, { maxResults: 5 });
  const training = results.find((candidate) => candidate.sceneIntent === 'sport:training');

  assert.ok(training);
  assert.equal(ids(training).includes('training-shoe'), true);
  assert.equal(training.primaryBenefit, 'formal_training');
});

test('light sport accepts a tee, activity-ready bottoms, and stable sneakers', () => {
  const results = candidatesFor('sport', 22, [
    item('tee', 'top', { subcategory: 'short sleeve tee', styleTags: ['casual'] }),
    item('joggers', 'bottom', { subcategory: 'athletic joggers', styleTags: ['casual'] }),
    item('sneaker', 'shoes', { subcategory: 'clean sneaker' }),
  ]);

  const light = results.find((candidate) => candidate.sceneIntent === 'sport:light_activity');
  assert.ok(light);
  assert.equal(light.primaryBenefit, 'light_activity');
  assert.equal(light.eligibilityReason.code, 'SPORT_LIGHT_ACTIVITY_SET');
});

test('sport rejects ordinary onepiece even when paired with running shoes', () => {
  const wardrobe = [
    item('daily-dress', 'onepiece', { subcategory: 'dress', sceneTags: ['daily'], styleTags: ['casual'] }),
    item('running-shoe', 'shoes', { subcategory: 'running shoes', sceneTags: ['sport'], styleTags: ['sport'] }),
  ];

  const results = candidatesFor('sport', 22, wardrobe, { maxResults: 8 });

  assert.equal(results.some((candidate) => ids(candidate).includes('daily-dress')), false);
  assert.equal(results.length, 0);
});

test('sport onepiece with explicit sport facts uses the fixed V4 explanation path', () => {
  const wardrobe = [
    item('tennis-dress', 'onepiece', { subcategory: 'tennis athletic dress', sceneTags: ['sport'], styleTags: ['tennis', 'sport'] }),
    item('training-shoe', 'shoes', { subcategory: 'training shoes', sceneTags: ['sport'], styleTags: ['sport'] }),
  ];

  const results = candidatesFor('sport', 22, wardrobe, { maxResults: 8 });

  assert.equal(results.length, 1);
  assert.equal(results.debug.rejectReasonCounts.UNMAPPED_ELIGIBILITY_PATH, undefined);
  assert.equal(results[0].eligibilityReason.code, 'SPORT_V4_EVIDENCE_SUPPORTED');
});

test('sport does not pass ordinary separates only because shoes are athletic', () => {
  const wardrobe = [
    item('daily-top', 'top', { subcategory: 'plain tee', sceneTags: ['daily'], styleTags: ['casual'] }),
    item('daily-bottom', 'bottom', { subcategory: 'casual skirt', sceneTags: ['daily'], styleTags: ['casual'] }),
    item('training-shoe', 'shoes', { subcategory: 'training shoes', sceneTags: ['sport'], styleTags: ['sport'] }),
  ];

  const results = candidatesFor('sport', 22, wardrobe, { maxResults: 8 });

  assert.equal(results.length, 0);
});

test('work rejects pure home outfits instead of retitling the home pool', () => {
  const wardrobe = [
    item('home-tee', 'top', { subcategory: '宽松居家T恤', sceneTags: ['居家'], styleTags: ['休闲'] }),
    item('home-shorts', 'bottom', { subcategory: '家居短裤', sceneTags: ['居家'], styleTags: ['休闲'] }),
    item('red-sneaker', 'shoes', { subcategory: '红色运动鞋', sceneTags: ['日常'], styleTags: ['运动'] }),
  ];

  const results = candidatesFor('上班', 24, wardrobe, { maxResults: 8 });

  assert.equal(results.length, 0);
  assert.equal(results.limited, true);
  assert.match(results.debug.limitedReason, /work_scene_hard_conflict/);
});

test('date keeps ordinary tee shorts sneakers as a negative-ranked candidate', () => {
  const wardrobe = [
    item('daily-tee', 'top', { subcategory: '白色T恤', sceneTags: ['日常'], styleTags: ['休闲'], color: '白色' }),
    item('daily-shorts', 'bottom', { subcategory: '灰色短裤', sceneTags: ['日常'], styleTags: ['休闲'], color: '灰色' }),
    item('daily-sneaker', 'shoes', { subcategory: '运动鞋', sceneTags: ['日常'], styleTags: ['运动'], color: '白色' }),
  ];

  const results = candidatesFor('约会', 26, wardrobe, { maxResults: 8 });

  assert.equal(results.length, 1);
  assert.equal(results[0].eligibility.scene.hardRejected, false);
  assert.ok(results[0].eligibility.scene.warnings.includes('DATE_CASUAL_NO_INTENT_NEGATIVE'));
});

test('final batch caps repeated core top bottom shoes scene intent and archetype when inventory allows', () => {
  const wardrobe = [
    item('commute-shirt-1', 'top', { subcategory: '衬衫', styleComplexity: '简洁', sceneTags: ['上班', '通勤'], styleTags: ['通勤'] }),
    item('commute-shirt-2', 'top', { subcategory: '利落针织上衣', styleComplexity: '简洁', sceneTags: ['上班'], styleTags: ['简约'] }),
    item('commute-shirt-3', 'top', { subcategory: '通勤短袖', styleComplexity: '简洁', sceneTags: ['上班'], styleTags: ['通勤'] }),
    item('commute-shirt-4', 'top', { subcategory: 'office clean top', styleComplexity: '简洁', sceneTags: ['work'], styleTags: ['简约'] }),
    item('trouser-1', 'bottom', { subcategory: '西裤', styleComplexity: '简洁', pantsLength: 'long', sceneTags: ['上班'] }),
    item('trouser-2', 'bottom', { subcategory: '直筒长裤', styleComplexity: '简洁', pantsLength: 'long', sceneTags: ['上班'] }),
    item('trouser-3', 'bottom', { subcategory: '通勤长裤', styleComplexity: '简洁', pantsLength: 'long', sceneTags: ['上班'] }),
    item('trouser-4', 'bottom', { subcategory: 'clean pants', styleComplexity: '简洁', pantsLength: 'long', sceneTags: ['work'] }),
    item('blazer-1', 'outerwear', { subcategory: '西装外套', sceneTags: ['上班'], styleTags: ['通勤'] }),
    item('jacket-1', 'outerwear', { subcategory: 'clean work jacket', sceneTags: ['work'], styleTags: ['简约'] }),
    item('loafer-1', 'shoes', { subcategory: '乐福鞋', styleComplexity: '简洁', sceneTags: ['上班', '通勤'] }),
    item('loafer-2', 'shoes', { subcategory: '通勤鞋', styleComplexity: '简洁', sceneTags: ['上班'] }),
    item('sneaker-1', 'shoes', { subcategory: '白色通勤运动鞋', styleComplexity: '简洁', sceneTags: ['上班', '通勤'] }),
    item('sneaker-2', 'shoes', { subcategory: '黑色通勤运动鞋', styleComplexity: '简洁', sceneTags: ['上班', '通勤'] }),
  ];

  const results = candidatesFor('上班', 24, wardrobe, { maxResults: 8 });
  const countSlot = (slot) => {
    const counts = {};
    for (const candidate of results) {
      const id = candidate.items.find((entry) => entry.outfitSlot === slot)?._id;
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
    return Math.max(...Object.values(counts));
  };
  const maxSceneIntent = Math.max(...Object.values(results.debug.batchDiagnostics.sceneIntentCounts));
  const maxArchetype = Math.max(...Object.values(results.debug.batchDiagnostics.archetypeCounts));

  assert.ok(results.length <= 8);
  assert.ok(countSlot('top') <= 3);
  assert.ok(countSlot('bottom') <= 3);
  assert.ok(countSlot('shoes') <= 3);
  assert.ok(maxSceneIntent <= 3);
  assert.ok(maxArchetype <= 4);
  assert.match(results.debug.batchDiagnostics.limitedReason, /^(|relaxed_archetype_diversity)$/);
});

test('candidate layering keeps late but suitable items instead of blind slicing', () => {
  const shoes = Array.from({ length: 7 }, (_, index) =>
    item(`casual-shoe-${index}`, 'shoes', { subcategory: '休闲鞋', styleComplexity: '简洁', sceneTags: ['日常'] }),
  );
  const wardrobe = [
    item('top', 'top', { subcategory: '衬衫', styleComplexity: '简洁', sceneTags: ['上班'] }),
    item('bottom', 'bottom', { subcategory: '西裤', styleComplexity: '简洁', pantsLength: 'long', sceneTags: ['上班'] }),
    ...shoes,
    item('commute-shoe', 'shoes', { subcategory: '乐福鞋', styleComplexity: '简洁', sceneTags: ['上班', '通勤'] }),
  ];

  const results = candidatesFor('上班', 20, wardrobe, { maxResults: 3 });

  assert.equal(results.some((candidate) => ids(candidate).includes('commute-shoe')), true);
});

test('27 degree weather excludes warm knit cores without lightness evidence', () => {
  const results = candidatesFor('work', 27, [
    item('warm-knit', 'top', { subcategory: 'heavy knit sweater', warmthScore: 8, thickness: 'thick', sceneTags: ['work'] }),
    item('light-shirt', 'top', { subcategory: 'lightweight shirt', sceneTags: ['work'] }),
    item('pants', 'bottom', { subcategory: 'straight long pants', pantsLength: 'long', sceneTags: ['work'] }),
    item('shoes', 'shoes', { subcategory: 'office shoes', sceneTags: ['work'] }),
  ]);

  assert.equal(results.some((candidate) => ids(candidate).includes('warm-knit')), false);
  assert.equal(results.some((candidate) => ids(candidate).includes('light-shirt')), true);
});

test('capabilities are generic and do not depend on a slipper special-case', () => {
  const indoor = deriveItemCapabilitiesV1(item('indoor', 'shoes', { subcategory: '室内鞋', sceneTags: ['居家'] }));
  const commute = deriveItemCapabilitiesV1(item('commute', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班', '通勤'] }));

  assert.ok(indoor.includes('indoor'));
  assert.ok(commute.includes('commute'));
  assert.equal(indoor.includes('slipper'), false);
});

function noWeatherHomeWardrobe() {
  return [
    item('sleeveless-top', 'top', {
      subcategory: '无袖上衣',
      sleeveLength: 'sleeveless',
      sceneTags: ['居家'],
      styleTags: ['休闲'],
    }),
    item('shorts', 'bottom', {
      subcategory: '家居短裤',
      pantsLength: 'short',
      sceneTags: ['居家'],
      styleTags: ['休闲'],
    }),
  ];
}

test('disabled and unavailable skip every temperature branch and use no-weather eligibility reasons', () => {
  for (const weatherMode of ['disabled', 'unavailable']) {
    const results = candidatesFor('居家', null, noWeatherHomeWardrobe(), { weatherMode });
    const serialized = JSON.stringify(results);

    assert.ok(results.length > 0);
    assert.equal(results.debug.weatherMode, weatherMode);
    assert.equal(results.debug.hasUsableWeather, false);
    assert.equal(results.debug.temperatureBandApplied, false);
    assert.equal(results.debug.temperatureFilterSkippedReason, 'NO_USABLE_WEATHER');
    assert.equal(
      results.debug.candidateCountBeforeTemperatureFilter,
      results.debug.candidateCountAfterTemperatureFilter,
    );
    assert.equal(results.debug.weatherRejectedCount, 0);
    assert.equal(results.every((candidate) => candidate.eligibility.weather.rejectReasons.length === 0), true);
    assert.equal(results.every((candidate) => candidate.eligibility.weather.warningReasons.length === 0), true);
    assert.equal(results.every((candidate) => candidate.eligibility.weather.evidence.length === 0), true);
    assert.equal(results.some((candidate) => candidate.eligibilityReason.code === 'HOME_SLEEVELESS_SHORTS'), true);
    assert.equal(results.every((candidate) => candidate.primaryBenefit !== 'hot_weather'), true);
    assert.equal(results.every((candidate) => candidate.secondaryBenefit !== 'hot_weather'), true);
    assert.equal(results.every((candidate) => candidate.observationFocus !== 'temperature'), true);
    assert.doesNotMatch(serialized, /"temp(?:erature)?":22|WEATHER_BAND_(?:HOT|MILD|COOL|COLD)|humid/i);
    assert.doesNotMatch(serialized, /上海|Shanghai/i);
  }
});

test('a real live 22 degrees remains distinct from missing weather and keeps mild behavior', () => {
  const live = candidatesFor('居家', 22, noWeatherHomeWardrobe(), { weatherMode: 'live' });
  const disabled = candidatesFor('居家', null, noWeatherHomeWardrobe(), { weatherMode: 'disabled' });

  assert.ok(live.length > 0);
  assert.equal(live.debug.weatherMode, 'live');
  assert.equal(live.debug.hasUsableWeather, true);
  assert.equal(live.debug.temperatureBandApplied, true);
  assert.equal(live.debug.temperatureFilterSkippedReason, '');
  assert.equal(live.debug.candidateCountBeforeTemperatureFilter, live.debug.candidateCountAfterTemperatureFilter);
  assert.equal(live[0].rankingScore, disabled[0].rankingScore + 1);
  assert.equal(live.every((candidate) => candidate.primaryBenefit !== 'hot_weather'), true);
});

test('cached weather continues to apply the existing cool band and reason selection', () => {
  const wardrobe = [
    item('long-top', 'top', {
      subcategory: '长袖上衣',
      sleeveLength: 'long',
      sceneTags: ['居家'],
      styleTags: ['休闲'],
    }),
    item('long-bottom', 'bottom', {
      subcategory: '家居长裤',
      pantsLength: 'long',
      sceneTags: ['居家'],
      styleTags: ['休闲'],
    }),
  ];
  const results = candidatesFor('居家', 16, wardrobe, { weatherMode: 'cached' });

  assert.ok(results.length > 0);
  assert.equal(results.debug.weatherMode, 'cached');
  assert.equal(results.debug.hasUsableWeather, true);
  assert.equal(results.debug.temperatureBandApplied, true);
  assert.equal(results.some((candidate) => candidate.eligibilityReason.code === 'HOME_COOL_LONG_SLEEVE'), true);
});

test('disabled and unavailable retain a 22-degree-rejected raw candidate before final copy selection', () => {
  const wardrobe = [
    item('warm-loose-dress', 'onepiece', {
      subcategory: '羽绒连衣裙',
      fit: '宽松',
      sceneTags: ['居家'],
      styleTags: ['休闲'],
    }),
  ];
  const live = candidatesFor('居家', 22, wardrobe, { weatherMode: 'live' });

  assert.equal(live.debug.guardCandidateCount, 1);
  assert.equal(live.debug.weatherRejectedCount, 1);
  assert.equal(live.length, 0);
  for (const weatherMode of ['disabled', 'unavailable']) {
    const noWeather = candidatesFor('居家', null, wardrobe, { weatherMode });
    assert.equal(noWeather.debug.guardCandidateCount, 1);
    assert.equal(noWeather.debug.guardAcceptedCount, 1);
    assert.equal(noWeather.debug.weatherRejectedCount, 0);
    assert.equal(noWeather.debug.candidateCountBeforeTemperatureFilter, 1);
    assert.equal(noWeather.debug.candidateCountAfterTemperatureFilter, 1);
    assert.equal(noWeather.length, 1);
    assert.deepEqual(ids(noWeather[0]), ['warm-loose-dress']);
    assert.equal(noWeather[0].eligibilityReason.code, 'HOME_LOOSE_DRESS');
  }
});

test('legacy calls normalize real numeric weather to live and missing weather to unavailable', () => {
  const wardrobe = noWeatherHomeWardrobe();
  const legacyLive = buildOutfitCandidatesV1({
    clothes: wardrobe,
    scene: '居家',
    weather: { temp: 22, weather: '晴' },
    returnRawCandidates: true,
  });
  const legacyUnavailable = buildOutfitCandidatesV1({
    clothes: wardrobe,
    scene: '居家',
    weather: {},
    returnRawCandidates: true,
  });

  assert.equal(legacyLive.debug.weatherMode, 'live');
  assert.equal(legacyLive.debug.hasUsableWeather, true);
  assert.equal(legacyUnavailable.debug.weatherMode, 'unavailable');
  assert.equal(legacyUnavailable.debug.hasUsableWeather, false);
  assert.equal(legacyUnavailable.debug.temperatureFilterSkippedReason, 'NO_USABLE_WEATHER');
});
