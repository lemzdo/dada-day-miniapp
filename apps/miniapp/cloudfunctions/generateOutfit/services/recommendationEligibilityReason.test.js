const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');
const {
  ELIGIBILITY_REASON_CATALOG,
  assertEligibilityReasonCatalogCoverage,
  collectEligibilityReasonCandidates,
  getEligibilityReasonCatalogInventory,
  renderEligibilityReason,
  validateEligibilityReasonPayload,
} = require('./recommendationEligibilityReason');

function item(id, category, subCategory, extra = {}) {
  return { _id: id, category, subCategory, customName: subCategory, confidence: 0.88, ...extra };
}

test('31 degree legacy home outfit resolves the required sleeveless shorts reason without functional claims', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'home',
    weather: { temp: 31, weather: '晴' },
    items: [
      item('home-top', 'top', '无袖上衣', { sleeveLength: 'sleeveless' }),
      item('home-bottom', 'bottom', '短裤', { pantsLength: 'short' }),
      item('home-shoes', 'shoes', '家居拖鞋', { shoeType: 'home' }),
    ],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.eligibilityReason.code, 'HOME_HOT_SLEEVELESS_SHORTS');
  const text = renderEligibilityReason(result.eligibilityReason.code, { temp: 31 });
  assert.equal(text, '今天31℃，无袖上衣配短裤，宅家穿正合适，整身也不会显得厚重。');
  assert.equal(validateEligibilityReasonPayload(result.eligibilityReason, { scene: 'home', weather: { temp: 31 } }), true);
  assert.equal(/透气|柔软|弹性|速干|缓冲|抓地/.test(text), false);
});

test('every eligible scene rule result carries a catalog-backed reason code and provenance', () => {
  const cases = [
    ['home', { temp: 24 }, [
      item('h-top', 'top', '休闲上衣', { fit: '宽松', styleTags: ['休闲'] }),
      item('h-bottom', 'bottom', '休闲长裤', { fit: '宽松', styleTags: ['休闲'], pantsLength: 'long' }),
    ]],
    ['work', { temp: 22 }, [
      item('w-top', 'top', '通勤衬衫', { sceneTags: ['上班'] }),
      item('w-bottom', 'bottom', '直筒西裤', { fit: '直筒', sceneTags: ['上班'], pantsLength: 'long' }),
      item('w-shoes', 'shoes', '乐福鞋', { sceneTags: ['上班'] }),
    ]],
    ['date', { temp: 22 }, [
      item('d-top', 'top', '约会印花上衣', { patternType: '印花', sceneTags: ['约会'] }),
      item('d-bottom', 'bottom', '简约长裤', { styleTags: ['简约'], sceneTags: ['约会'], pantsLength: 'long', patternType: 'solid' }),
      item('d-shoes', 'shoes', '简约单鞋', { styleTags: ['简约'], sceneTags: ['约会'] }),
    ]],
    ['sport', { temp: 22 }, [
      item('s-top', 'top', '运动训练上衣', { styleTags: ['运动'], sceneTags: ['运动'] }),
      item('s-bottom', 'bottom', '运动训练裤', { styleTags: ['运动'], sceneTags: ['运动'], pantsLength: 'long' }),
      item('s-shoes', 'shoes', '运动鞋', { styleTags: ['运动'], sceneTags: ['运动'] }),
    ]],
  ];

  for (const [scene, weather, items] of cases) {
    const result = evaluateSceneEligibilityV3({ scene, weather, items });
    assert.equal(result.eligible, true, scene);
    assert.equal(typeof result.eligibilityReason.code, 'string', scene);
    assert.ok(result.eligibilityReason.code, scene);
    assert.ok(result.eligibilityReason.subjectItemIds.length > 0, scene);
    assert.ok(result.eligibilityReason.supportingFactIds.length > 0, scene);
    assert.equal(result.eligibilityReason.sourceRule, 'sceneEvidenceV4', scene);
    assert.equal(result.eligibilityReason.sourceVersion, 'scene-evidence-v4', scene);
    assert.match(result.eligibilityReason.sourceFingerprint, /^[0-9a-f]{20}$/, scene);
    assert.ok(result.eligibilityReason.sourceRuleReasons.length > 0, scene);
    assert.equal(validateEligibilityReasonPayload(result.eligibilityReason, { scene, weather }), true, scene);
  }
});

test('catalog is unique and has complete v6 four-scene inventory', () => {
  const codes = ELIGIBILITY_REASON_CATALOG.map((entry) => entry.reasonCode);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(assertEligibilityReasonCatalogCoverage(codes), true);
  assert.deepEqual(getEligibilityReasonCatalogInventory(), {
    version: 'eligibility-reason-v6',
    total: 38,
    scenes: { home: 14, work: 8, date: 8, sport: 8 },
  });
});

test('home relation reasons cover short-sleeve long-pants and dress-plus-normal-shoes without fallback', () => {
  const shortSleeveLongPants = evaluateSceneEligibilityV3({
    scene: 'home',
    weather: { mode: 'disabled' },
    items: [
      item('top', 'top', 'short sleeve tee', { sleeveLength: 'short_sleeve' }),
      item('bottom', 'bottom', 'long pants', { pantsLength: 'long' }),
    ],
  });
  assert.equal(shortSleeveLongPants.eligibilityReason.code, 'HOME_SHORT_SLEEVE_LONG_PANTS');
  assert.equal(shortSleeveLongPants.eligibilityReason.isGenericFallback, false);

  const dressWithShoes = evaluateSceneEligibilityV3({
    scene: 'home',
    weather: { mode: 'disabled' },
    items: [
      item('dress', 'onepiece', '连衣裙'),
      item('shoes', 'shoes', '日常单鞋'),
    ],
  });
  assert.equal(dressWithShoes.eligibilityReason.code, 'HOME_DRESS_NORMAL_SHOES');
  assert.equal(dressWithShoes.eligibilityReason.isGenericFallback, false);
});

test('candidate collection keeps every matching reason and generic fallback never wins over a specific tier', () => {
  const items = [
    item('top', 'top', 'tshirt', { sleeveLength: 'short_sleeve', fit: '宽松', styleTags: ['休闲'] }),
    item('bottom', 'bottom', '短裤', { pantsLength: 'short', fit: '宽松', styleTags: ['休闲'] }),
  ];
  const sceneResult = { eligible: true, hardRejected: false, acceptReasons: ['HOME_RELAXED_ALLOWED'], sceneStrength: 'medium' };
  const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
  const candidates = collectEligibilityReasonCandidates({
    scene: 'home',
    weather: { mode: 'disabled', temp: null },
    visibleFacts: adaptLegacyVisibleFacts(items),
    sceneResult,
  });
  assert.ok(candidates.length >= 4);
  assert.ok(candidates.some((candidate) => candidate.code === 'HOME_SHORT_SLEEVE_SHORTS'));
  assert.ok(candidates.some((candidate) => candidate.code === 'HOME_TSHIRT_LOOSE_PANTS'));
  assert.ok(candidates.some((candidate) => candidate.code === 'HOME_CASUAL_TWO_PIECE'));
  assert.equal(candidates.find((candidate) => candidate.code === 'HOME_CASUAL_TWO_PIECE').qualityTier, 6);
  assert.equal(candidates.find((candidate) => candidate.code === 'HOME_CASUAL_TWO_PIECE').isGenericFallback, true);
  assert.equal(Math.min(...candidates.map((candidate) => candidate.qualityTier)), 2);
  assert.ok(candidates.every((candidate) => candidate.subjectItemIds.every((id) => ['top', 'bottom'].includes(id))));
});

test('weather modes gate weather reasons and no-weather home reasons exactly', () => {
  const items = [
    item('top', 'top', '无袖上衣', { sleeveLength: 'sleeveless' }),
    item('bottom', 'bottom', '短裤', { pantsLength: 'short' }),
  ];
  const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
  const visibleFacts = adaptLegacyVisibleFacts(items);
  const sceneResult = { eligible: true, hardRejected: false, acceptReasons: ['HOME_RELAXED_ALLOWED'], sceneStrength: 'medium' };
  for (const mode of ['live', 'cached']) {
    const candidates = collectEligibilityReasonCandidates({ scene: 'home', weather: { mode, temp: 31 }, visibleFacts, sceneResult });
    assert.ok(candidates.some((candidate) => candidate.code === 'HOME_HOT_SLEEVELESS_SHORTS'), mode);
    assert.equal(candidates.some((candidate) => candidate.code === 'HOME_SLEEVELESS_SHORTS'), false, mode);
  }
  for (const mode of ['disabled', 'unavailable']) {
    const candidates = collectEligibilityReasonCandidates({ scene: 'home', weather: { mode, temp: null }, visibleFacts, sceneResult });
    assert.ok(candidates.some((candidate) => candidate.code === 'HOME_SLEEVELESS_SHORTS'), mode);
    assert.equal(candidates.some((candidate) => candidate.code.includes('_HOT_')), false, mode);
    assert.doesNotMatch(candidates.map((candidate) => candidate.text).join(''), /22℃|天气|今天\d+℃/);
  }
});

test('work simple trio, controlled pattern and sport dress matchers enforce all required facts', () => {
  const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
  const sceneResult = { eligible: true, hardRejected: false, acceptReasons: ['SCENE_OK'], sceneStrength: 'strong' };
  const collect = (scene, items) => collectEligibilityReasonCandidates({
    scene,
    weather: { mode: 'disabled', temp: null },
    visibleFacts: adaptLegacyVisibleFacts(items),
    sceneResult,
  }).map((candidate) => candidate.code);

  const simpleBase = [
    item('top', 'top', '基础上衣', { styleTags: ['简约'] }),
    item('bottom', 'bottom', '长裤', { pantsLength: 'long', styleTags: ['简约'] }),
    item('shoes', 'shoes', '乐福鞋', { styleTags: ['简约'] }),
  ];
  assert.ok(collect('work', simpleBase).includes('WORK_SIMPLE_TOP_PANTS_SHOES'));
  assert.equal(collect('work', simpleBase.map((entry) => entry._id === 'shoes' ? { ...entry, styleTags: [] } : entry)).includes('WORK_SIMPLE_TOP_PANTS_SHOES'), false);

  const patternCodes = collect('work', [
    item('pattern-top', 'top', '上衣', { patternType: 'plaid' }),
    item('solid-bottom', 'bottom', '长裤', { pantsLength: 'long', patternType: 'solid' }),
  ]);
  assert.ok(patternCodes.includes('WORK_PATTERN_TOP_SOLID_BOTTOM'));
  assert.equal(collect('work', [item('texture', 'top', '上衣', { patternType: 'texture' }), simpleBase[1]]).includes('WORK_PATTERN_TOP_SOLID_BOTTOM'), false);

  assert.ok(collect('sport', [
    item('dress', 'onepiece', 'tennis_dress'),
    item('sport-shoes', 'shoes', '运动鞋', { styleTags: ['运动'] }),
  ]).includes('SPORT_DRESS_SHOES'));
  assert.equal(collect('sport', [
    item('normal-dress', 'onepiece', 'dress'),
    item('sport-shoes', 'shoes', '运动鞋', { styleTags: ['运动'] }),
  ]).includes('SPORT_DRESS_SHOES'), false);
});

test('formal home core is rejected by hard evidence rather than explanation coverage', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'home',
    weather: { temp: 22 },
    items: [item('formal-dress', 'onepiece', '修身礼服')],
  });
  assert.equal(result.eligible, false);
  assert.ok(result.rejectReasons.includes('HOME_SPECIAL_PURPOSE_CONFLICT'));
  assert.equal(result.rejectReasons.includes('UNMAPPED_ELIGIBILITY_PATH'), false);
  assert.equal(result.eligibilityReason, undefined);
});
