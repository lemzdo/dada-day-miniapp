const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyWearabilityAndSceneEligibility,
  evaluateSceneEligibilityV3,
} = require('./sceneEligibilityV3');

function item(id, category, extra = {}) {
  return {
    _id: id,
    category,
    subcategory: extra.subcategory || category,
    customName: extra.customName || extra.name || id,
    styleTags: extra.styleTags || [],
    sceneTags: extra.sceneTags || [],
    seasonTags: extra.seasonTags || [],
    colorPalette: extra.colorPalette || [],
    material: extra.material,
    thickness: extra.thickness,
    confidence: extra.confidence ?? 0.86,
    ...extra,
  };
}

function confirmedClothing(id, category, subcategory, extra = {}) {
  return {
    _id: id,
    userId: 'openid',
    category,
    subcategory,
    subCategory: subcategory,
    type: category,
    colors: [],
    colorPalette: [],
    aestheticFeatures: {
      fit: 'regular',
      length: 'regular',
      silhouette: 'straight',
      patternType: 'solid',
      designElements: [],
      formalityLevel: null,
      confidence: {},
    },
    styleTags: [],
    seasonTags: [],
    sceneTags: [],
    material: '',
    materialGuess: '',
    thickness: '',
    confidence: 0.86,
    ...extra,
  };
}

test('work hard rejects slippers crocs and home shoes', () => {
  for (const shoeName of ['拖鞋', '洞洞鞋', '家居鞋']) {
    const result = evaluateSceneEligibilityV3({
      scene: 'work',
      items: [
        item('shirt', 'top', { subcategory: '衬衫', sceneTags: ['上班'] }),
        item('pants', 'bottom', { subcategory: '西裤', sceneTags: ['上班'] }),
        item('shoe', 'shoes', { subcategory: shoeName, sceneTags: ['居家'] }),
      ],
    });

    assert.equal(result.eligible, false, shoeName);
    assert.equal(result.hardRejected, true, shoeName);
    assert.ok(result.rejectReasons.includes('WORK_INVALID_SHOE'), shoeName);
  }
});

test('date hard rejects slippers crocs and home shoes', () => {
  for (const shoeName of ['拖鞋', '洞洞鞋', '家居鞋']) {
    const result = evaluateSceneEligibilityV3({
      scene: 'date',
      items: [
        item('top', 'top', { subcategory: '针织上衣', sceneTags: ['约会'], colorPalette: [{ name: '粉色' }] }),
        item('skirt', 'bottom', { subcategory: '半裙', sceneTags: ['约会'] }),
        item('shoe', 'shoes', { subcategory: shoeName, sceneTags: ['居家'] }),
      ],
    });

    assert.equal(result.eligible, false, shoeName);
    assert.equal(result.hardRejected, true, shoeName);
    assert.ok(result.rejectReasons.includes('DATE_INVALID_SHOE'), shoeName);
  }
});

test('work rejects plain tee shorts sneaker and accepts a catalog-mapped work outfit', () => {
  const plain = evaluateSceneEligibilityV3({
    scene: 'work',
    items: [
      item('tee', 'top', { subcategory: 'T恤', sceneTags: ['日常'] }),
      item('shorts', 'bottom', { subcategory: '短裤', sceneTags: ['日常'] }),
      item('sneaker', 'shoes', { subcategory: '运动鞋', sceneTags: ['日常'] }),
    ],
  });
  const supported = evaluateSceneEligibilityV3({
    scene: 'work',
    items: [
      item('clean-top', 'top', { subcategory: '通勤衬衫', sceneTags: ['上班'], styleTags: ['通勤'] }),
      item('pants', 'bottom', { subcategory: '直筒西裤', fit: '直筒', pantsLength: 'long', sceneTags: ['上班'], styleTags: ['通勤'] }),
      item('shoe', 'shoes', { subcategory: '乐福鞋', sceneTags: ['上班', '通勤'] }),
    ],
  });

  assert.equal(plain.eligible, false);
  assert.ok(plain.rejectReasons.includes('WORK_TOO_CASUAL_SHORTS_TEE'));
  assert.equal(supported.eligible, true);
  assert.equal(supported.eligibilityReason.code, 'WORK_SHIRT_STRAIGHT_PANTS');
});

test('confirmed work structures use the fact-bound baseline reason instead of being rejected as unmapped', () => {
  const separates = [
    confirmedClothing('baseline-top', 'top', 'basic knit top'),
    confirmedClothing('baseline-bottom', 'bottom', 'tailored pants', {
      aestheticFeatures: {
        fit: 'regular', length: 'long', silhouette: 'regular', patternType: 'solid', designElements: [], formalityLevel: null, confidence: {},
      },
    }),
    confirmedClothing('baseline-shoes', 'shoes', 'office shoes'),
  ];
  const result = evaluateSceneEligibilityV3({
    scene: 'work',
    weather: { mode: 'disabled', temp: null },
    items: separates,
  });
  const guarded = applyWearabilityAndSceneEligibility([
    { items: separates, rankingScore: 91 },
  ], {
    scene: 'work',
    weather: { mode: 'disabled', temp: null },
  });

  assert.equal(result.eligible, true);
  assert.equal(result.hardRejected, false);
  assert.equal(result.eligibilityReason.code, 'WORK_BASELINE_PRESENTABLE');
  assert.equal(result.eligibilityReason.isGenericFallback, true);
  assert.equal(result.eligibilityDiagnostic.code, 'UNMAPPED_ELIGIBILITY_PATH');
  assert.equal(result.rejectReasons.includes('UNMAPPED_ELIGIBILITY_PATH'), false);
  assert.equal(guarded.accepted.length, 1);
  assert.equal(guarded.rejected.length, 0);
  assert.equal(guarded.accepted[0].rankingScore, 91);
  assert.equal(guarded.debug.eligibilityReasonCoverageGapCount, 1);
  assert.equal(guarded.debug.rejectReasonCounts.UNMAPPED_ELIGIBILITY_PATH, undefined);

  const dress = evaluateSceneEligibilityV3({
    scene: 'work',
    weather: { mode: 'disabled', temp: null },
    items: [
      confirmedClothing('baseline-dress', 'onepiece', 'weekday dress'),
      confirmedClothing('baseline-dress-shoes', 'shoes', 'office shoes'),
    ],
  });
  assert.equal(dress.eligible, true);
  assert.equal(dress.eligibilityReason.code, 'WORK_BASELINE_PRESENTABLE');
});

test('guard rejection evidence records the real production stage', () => {
  const weatherRejected = applyWearabilityAndSceneEligibility([
    { items: [
      item('warm-top', 'top', { subcategory: 'sweater', material: 'wool' }),
      item('shorts', 'bottom', { subcategory: 'shorts' }),
      item('sport-shoe', 'shoes', { subcategory: 'running shoes', sceneTags: ['sport'] }),
    ] },
  ], { scene: 'sport', weather: { mode: 'live', temp: 31 } });
  assert.equal(weatherRejected.rejected.length, 1);
  assert.equal(weatherRejected.rejected[0].rejectionStage, 'wearability_guard');

  const sceneRejected = applyWearabilityAndSceneEligibility([
    { items: [
      item('tee', 'top', { subcategory: 'tee' }),
      item('shorts', 'bottom', { subcategory: 'shorts' }),
      item('home-shoe', 'shoes', { subcategory: 'slipper', sceneTags: ['home'] }),
    ] },
  ], { scene: 'sport', weather: { mode: 'disabled', temp: null } });
  assert.equal(sceneRejected.rejected.length, 1);
  assert.equal(sceneRejected.rejected[0].rejectionStage, 'scene_eligibility');
});

test('confirmed-shape work hard rejects remain ahead of the baseline fallback', () => {
  const base = [
    confirmedClothing('top', 'top', 'basic top'),
    confirmedClothing('bottom', 'bottom', 'tailored pants'),
  ];
  const cases = [
    ['slipper', [...base, confirmedClothing('shoe', 'shoes', 'slippers')], 'WORK_INVALID_SHOE'],
    [
      'home dominant',
      [
        confirmedClothing('home-top', 'top', 'home lounge top'),
        confirmedClothing('home-bottom', 'bottom', 'home lounge pants'),
        confirmedClothing('shoe', 'shoes', 'office shoes'),
      ],
      'WORK_HOME_DOMINANT',
    ],
    [
      'tee shorts',
      [
        confirmedClothing('tee', 'top', 'tee', { sleeveLength: 'short_sleeve' }),
        confirmedClothing('shorts', 'bottom', 'shorts'),
        confirmedClothing('shoe', 'shoes', 'training shoes'),
      ],
      'WORK_TOO_CASUAL_SHORTS_TEE',
    ],
  ];

  for (const [name, items, rejectReason] of cases) {
    const result = evaluateSceneEligibilityV3({
      scene: 'work',
      weather: { mode: 'disabled', temp: null },
      items,
    });
    assert.equal(result.eligible, false, name);
    assert.equal(result.hardRejected, true, name);
    assert.ok(result.rejectReasons.includes(rejectReason), name);
    assert.equal(result.eligibilityReason, undefined, name);
  }
});

test('date rejects plain tee shorts sneaker that only has color facts', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'date',
    items: [
      item('tee', 'top', { subcategory: '白色T恤', sceneTags: ['日常'], colorPalette: [{ name: '白色' }] }),
      item('shorts', 'bottom', { subcategory: '灰色短裤', sceneTags: ['日常'], colorPalette: [{ name: '灰色' }] }),
      item('sneaker', 'shoes', { subcategory: '白色运动鞋', sceneTags: ['日常'], colorPalette: [{ name: '白色' }] }),
    ],
  });

  assert.equal(result.eligible, false);
  assert.ok(result.rejectReasons.includes('DATE_TOO_CASUAL_SHORTS_TEE'));
});

test('sport requires sport apparel and sport shoes together', () => {
  const dress = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      item('dress', 'onepiece', { subcategory: '普通连衣裙', sceneTags: ['日常'] }),
      item('running-shoe', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'] }),
    ],
  });
  const athletic = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      item('top', 'top', { subcategory: '速干训练上衣', sceneTags: ['运动'], styleTags: ['运动'] }),
      item('pants', 'bottom', { subcategory: '训练裤', sceneTags: ['运动'], styleTags: ['运动'] }),
      item('running-shoe', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'] }),
    ],
  });

  assert.equal(dress.eligible, false);
  assert.ok(dress.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'));
  assert.equal(athletic.eligible, true);
});

test('confirmed legacy-shape clothes with empty sceneTags remain eligible for work from existing fields', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'work',
    items: [
      confirmedClothing('top', 'top', '衬衫', { styleTags: ['简约'] }),
      confirmedClothing('bottom', 'bottom', '长裤', {
        styleTags: ['简约'],
        aestheticFeatures: {
          fit: 'regular', length: 'long', silhouette: 'straight', patternType: 'solid', designElements: [], formalityLevel: null, confidence: {},
        },
      }),
      confirmedClothing('shoes', 'shoes', '乐福鞋'),
    ],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.hardRejected, false);
  assert.equal(result.eligibilityReason.code, 'WORK_SHIRT_STRAIGHT_PANTS');
});

test('confirmed legacy-shape clothes derive sport eligibility without sceneTags', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      confirmedClothing('top', 'top', 'T恤', { styleTags: ['休闲'] }),
      confirmedClothing('bottom', 'bottom', '运动短裤', {
        aestheticFeatures: {
          fit: 'regular', length: 'short', silhouette: 'straight', patternType: 'solid', designElements: [], formalityLevel: null, confidence: {},
        },
      }),
      confirmedClothing('shoes', 'shoes', '训练鞋'),
    ],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.hardRejected, false);
  assert.equal(result.eligibilityReason.code, 'SPORT_COMPLETE_SET');
});

test('confirmed ordinary casual fields do not become sport eligible without sport evidence', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      confirmedClothing('top', 'top', 'T恤', { styleTags: ['休闲'] }),
      confirmedClothing('bottom', 'bottom', '休闲短裤', {
        aestheticFeatures: {
          fit: 'regular', length: 'short', silhouette: 'straight', patternType: 'solid', designElements: [], formalityLevel: null, confidence: {},
        },
      }),
      confirmedClothing('shoes', 'shoes', '帆布鞋'),
    ],
  });

  assert.equal(result.eligible, false);
  assert.ok(result.rejectReasons.includes('SPORT_INVALID_SHOE'));
  assert.ok(result.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'));
});

test('confirmed work outfit with a slipper remains hard rejected', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'work',
    items: [
      confirmedClothing('top', 'top', '衬衫'),
      confirmedClothing('bottom', 'bottom', '长裤'),
      confirmedClothing('shoes', 'shoes', '拖鞋'),
    ],
  });

  assert.equal(result.eligible, false);
  assert.ok(result.rejectReasons.includes('WORK_INVALID_SHOE'));
});

test('confirmed dress or a non-sport shoe remains ineligible for sport', () => {
  const dress = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      confirmedClothing('dress', 'onepiece', '连衣裙'),
      confirmedClothing('shoes', 'shoes', '训练鞋'),
    ],
  });
  const nonSportShoe = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      confirmedClothing('top', 'top', 'T恤'),
      confirmedClothing('bottom', 'bottom', '运动短裤'),
      confirmedClothing('shoes', 'shoes', '乐福鞋'),
    ],
  });

  assert.ok(dress.rejectReasons.includes('SPORT_DRESS_OR_SKIRT_NOT_ALLOWED'));
  assert.ok(nonSportShoe.rejectReasons.includes('SPORT_INVALID_SHOE'));
});
