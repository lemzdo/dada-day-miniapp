const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateOptionalItemPolicy,
  evaluateSceneEvidenceV4,
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_VERSION,
  selectEvidenceBoundReasons,
} = require('./sceneEvidenceV4');
const {
  SCENE_EVIDENCE_REGISTRY,
  scoreEvidence,
} = require('./sceneEvidenceRegistryV4');
const {
  SCENE_V4_BRANCH_CASES,
  SCENE_V4_FIXTURE_CATALOG: C,
  fixtureItem,
} = require('./sceneEvidenceV4.fixtures');
const { deriveSceneEligibilityFacts } = require('./itemWearabilityFacts');

function evaluateCase(entry) {
  return evaluateSceneEvidenceV4({
    scene: entry.scene,
    items: entry.items,
    recommendationProfile: entry.recommendationProfile,
    weather: entry.weather,
  });
}

test('fixture catalog covers the complete product clothing families', () => {
  const required = [
    'tshirt', 'polo', 'shirt', 'sweatshirt', 'sweater', 'knit', 'shorts', 'casualPants',
    'tailoredPants', 'jeans', 'sportPants', 'dress', 'simpleDress', 'formalDress', 'lolita',
    'sportDress', 'blazer', 'trench', 'coat', 'down', 'sportJacket', 'sneaker', 'casualShoe',
    'businessShoe', 'leatherShoe', 'highHeel', 'dressShoe', 'boots', 'slipper', 'cosplay',
    'performance', 'sleepwear', 'homewear', 'swimwear', 'professionalTraining', 'hat',
    'sunglasses', 'bag', 'formalBag', 'patternTop', 'simpleSupport', 'brightTop', 'sportTop',
    'formalTop', 'complexTop', 'cleanSneaker', 'homeTaggedTop',
  ];
  assert.deepEqual(required.filter((key) => !C[key]), []);
});

test('every registry branch has a matching and non-matching fixture', () => {
  const evaluated = SCENE_V4_BRANCH_CASES.map((entry) => ({ entry, result: evaluateCase(entry) }));
  for (const rule of SCENE_EVIDENCE_REGISTRY) {
    const sameScene = evaluated.filter(({ entry }) => entry.scene === rule.scene);
    assert.ok(sameScene.some(({ result }) => result.sceneEvidence.some((evidence) => evidence.id === rule.id)), `missing positive fixture: ${rule.id}`);
    assert.ok(sameScene.some(({ result }) => !result.sceneEvidence.some((evidence) => evidence.id === rule.id)), `missing negative fixture: ${rule.id}`);
  }
});

test('explanation coverage never decides scene admission', () => {
  const result = evaluateSceneEvidenceV4({
    scene: 'home',
    items: [fixtureItem('plain-onepiece', 'onepiece', '连衣裙', { styleTags: [], sceneTags: [] })],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.canEnterScene, true);
  assert.equal(result.hardRejected, false);
  assert.equal(result.rejectReasons.includes('UNMAPPED_ELIGIBILITY_PATH'), false);
});

test('explanation selection never falls back to an unregistered catalog reason', () => {
  const catalog = [
    { code: 'AUTHORIZED', family: 'category' },
    { code: 'GENERIC', family: 'scene_evidence' },
    { code: 'WEATHER', family: 'weather' },
  ];
  assert.deepEqual(selectEvidenceBoundReasons(catalog, [{ explanationCodes: ['AUTHORIZED'], evidenceFamily: 'completeness' }]), [catalog[0]]);
  assert.deepEqual(selectEvidenceBoundReasons(catalog, []), []);
  assert.deepEqual(selectEvidenceBoundReasons(catalog, [{ explanationCodes: [], evidenceFamily: 'weather_layering' }]), [catalog[2]]);
});

test('copy and presentation mutations do not change fit or admission', () => {
  const base = evaluateSceneEvidenceV4({ scene: 'date', items: [C.patternTop, C.simpleSupport, C.casualShoe] });
  const changed = { ...base, eligibilityReason: { code: 'PRESENTATION_ONLY_CHANGE', text: 'changed' } };
  assert.equal(changed.sceneFitScore, base.sceneFitScore);
  assert.equal(changed.canEnterScene, base.canEnterScene);
});

test('sparse attributes are not negative facts or hard rejection', () => {
  const result = evaluateSceneEvidenceV4({
    scene: 'work',
    items: [
      { _id: 'top', category: 'top', subcategory: '上衣' },
      { _id: 'bottom', category: 'bottom', subcategory: '长裤' },
      { _id: 'shoe', category: 'shoes', subcategory: '休闲鞋' },
    ],
  });
  assert.equal(result.canEnterScene, true);
  assert.equal(result.hardRejected, false);
});

test('weak evidence is ranking evidence and never a hard gate', () => {
  const result = evaluateSceneEvidenceV4({ scene: 'date', items: [C.tshirt, C.casualPants, C.casualShoe] });
  assert.equal(result.canEnterScene, true);
  assert.equal(result.sceneEvidence.some((entry) => entry.severity === 'WEAK_POSITIVE'), true);
  assert.equal(result.hardRejected, false);
});

test('negative evidence lowers fit without becoming a hard conflict', () => {
  const casual = evaluateSceneEvidenceV4({ scene: 'work', items: [C.tshirt, C.shorts, C.sneaker] });
  const structured = evaluateSceneEvidenceV4({ scene: 'work', items: [C.shirt, C.tailoredPants, C.leatherShoe] });
  assert.equal(casual.eligible, true);
  assert.equal(casual.hardRejected, false);
  assert.ok(casual.warnings.includes('WORK_CASUAL_SHORTS_NEGATIVE'));
  assert.ok(structured.sceneFitScore > casual.sceneFitScore);
});

test('strong medium and weak Work evidence preserve the product ranking order', () => {
  const strong = evaluateSceneEvidenceV4({ scene: 'work', items: [C.shirt, C.tailoredPants, C.leatherShoe] });
  const medium = evaluateSceneEvidenceV4({ scene: 'work', items: [C.tshirt, C.casualPants, C.casualShoe] });
  const weak = evaluateSceneEvidenceV4({ scene: 'work', items: [C.tshirt, C.shorts, C.sneaker] });
  assert.ok(strong.sceneEvidence.some((entry) => entry.id === 'WORK_STRUCTURED_SET' && entry.severity === 'STRONG_POSITIVE'));
  assert.ok(medium.sceneEvidence.some((entry) => entry.id === 'WORK_DAILY_LONG_PANTS_SET' && entry.severity === 'MEDIUM_POSITIVE'));
  assert.ok(weak.sceneEvidence.some((entry) => entry.id === 'WORK_COMPLETE_DAILY_SET' && entry.severity === 'WEAK_POSITIVE'));
  assert.ok(strong.sceneFitScore > medium.sceneFitScore);
  assert.ok(medium.sceneFitScore > weak.sceneFitScore);
});

test('formal top is a negative Sport signal rather than a suit-core hard conflict', () => {
  const sport = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.formalTop, C.sportPants, C.sneaker] });
  const home = evaluateSceneEvidenceV4({ scene: 'home', items: [C.formalTop, C.casualPants, C.casualShoe] });
  assert.equal(sport.canEnterScene, true);
  assert.ok(sport.warnings.includes('SPORT_FORMAL_TOP_NEGATIVE'));
  assert.equal(home.canEnterScene, true);
});

test('Date style preference and style unity affect fit without changing admission', () => {
  const preferred = evaluateSceneEvidenceV4({ scene: 'date', items: [C.lolita, C.casualShoe], recommendationProfile: { preferredStyles: ['Lolita'] } });
  const unpreferred = evaluateSceneEvidenceV4({ scene: 'date', items: [C.lolita, C.casualShoe] });
  const unity = evaluateSceneEvidenceV4({ scene: 'date', items: [C.simpleDress, C.casualShoe] });
  assert.equal(preferred.canEnterScene, true);
  assert.equal(unpreferred.canEnterScene, true);
  assert.ok(preferred.sceneFitScore > unpreferred.sceneFitScore);
  assert.ok(unity.sceneEvidence.some((entry) => entry.id === 'DATE_SIMPLE_STYLE_UNITY'));
});

test('Sport onepiece and weather layering are registered evidence', () => {
  const onepiece = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.sportDress, C.sneaker] });
  const hot = evaluateSceneEvidenceV4({ scene: 'sport', items: [C.tshirt, C.shorts, C.sneaker], weather: { temp: 31 } });
  assert.ok(onepiece.sceneEvidence.some((entry) => entry.id === 'SPORT_EXPLICIT_ONEPIECE' && entry.severity === 'STRONG_POSITIVE'));
  assert.ok(hot.sceneEvidence.some((entry) => entry.id === 'SPORT_WEATHER_LAYER_SUPPORT'));
});

test('optional conflicts suppress only the optional item', () => {
  const policy = evaluateOptionalItemPolicy('home', [C.hat, C.sunglasses, C.formalBag]);
  assert.equal(policy.kept.length, 0);
  assert.equal(policy.suppressed.length, 3);
  const core = evaluateSceneEvidenceV4({ scene: 'home', items: [C.tshirt, C.shorts, C.casualShoe] });
  assert.equal(core.eligible, true);
});

test('optional registry distinguishes formal outerwear and preserves ordinary outerwear', () => {
  const home = evaluateOptionalItemPolicy('home', [C.blazer, C.trench, C.bag]);
  assert.deepEqual(home.suppressed.map((entry) => entry.kind).sort(), ['formal_outerwear', 'styling_accessory']);
  assert.deepEqual(home.kept.map((item) => item._id), ['trench']);
  const work = evaluateOptionalItemPolicy('work', [C.blazer, C.trench, C.bag]);
  assert.equal(work.suppressed.length, 0);
  assert.equal(work.kept.length, 3);
});

test('hard-conflict core always rejects', () => {
  for (const fixture of [
    { scene: 'home', items: [C.blazer, C.businessShoe] },
    { scene: 'work', items: [C.sleepwear, C.slipper] },
    { scene: 'date', items: [C.cosplay, C.casualShoe] },
    { scene: 'sport', items: [C.formalDress, C.highHeel] },
  ]) {
    const result = evaluateSceneEvidenceV4(fixture);
    assert.equal(result.eligible, false);
    assert.equal(result.hardRejected, true);
  }
});

test('semantic family cap prevents repeated scoring', () => {
  const evidence = [0, 1, 2].map((index) => ({
    id: `COLOR_${index}`,
    evidenceFamily: 'color_coordination',
    severity: 'WEAK_POSITIVE',
    rankingContribution: 0.6,
    hardConflict: false,
  }));
  assert.equal(scoreEvidence(evidence).sceneFitScore, scoreEvidence(evidence.slice(0, 1)).sceneFitScore);
});

test('scene score is deterministic and versioned', () => {
  const input = { scene: 'sport', items: [C.tshirt, C.shorts, C.sneaker] };
  const left = evaluateSceneEvidenceV4(input);
  const right = evaluateSceneEvidenceV4(input);
  assert.equal(left.sceneFitScore, right.sceneFitScore);
  assert.deepEqual(left.sceneFitContributionByFamily, right.sceneFitContributionByFamily);
  assert.equal(left.sceneEvidenceVersion, SCENE_EVIDENCE_VERSION);
  assert.equal(left.sceneEvidenceFingerprint, SCENE_EVIDENCE_FINGERPRINT);
  assert.match(SCENE_EVIDENCE_FINGERPRINT, /^[0-9a-f]{20}$/);
});

test('reason-code mapping never decides CAN_ENTER_SCENE', () => {
  const result = evaluateSceneEvidenceV4({ scene: 'home', items: [C.dress] });
  assert.equal(result.canEnterScene, true);
  result.eligibilityReason = undefined;
  assert.equal(result.canEnterScene, true);
});

test('canonical facts distinguish color, pattern and sport provenance', () => {
  const grayBlue = deriveSceneEligibilityFacts(fixtureItem('gray-blue', 'top', 'T恤', {
    colorPalette: [{ name: '灰蓝色', hex: '#6f8799' }],
    styleTags: ['条纹'],
    patternType: '',
  }));
  const lightGreen = deriveSceneEligibilityFacts(fixtureItem('light-green', 'top', 'T恤', {
    colorPalette: [{ name: '浅绿色', hex: '#b8d8ba' }],
    styleTags: ['休闲'],
  }));
  assert.equal(grayBlue.colorFacts[0].family, 'blue');
  assert.equal(lightGreen.colorFacts[0].family, 'green');
  assert.deepEqual(grayBlue.patternFact, {
    sourceField: 'styleTags',
    sourceValue: '条纹',
    canonicalFact: 'stripe',
    mappingRule: 'controlled-style-pattern-map-v1',
  });
  assert.equal(lightGreen.isExplicitSportTop, false);
  assert.equal(lightGreen.sportApparelEvidence, false);
  const explicitSport = deriveSceneEligibilityFacts(C.sportTop);
  assert.equal(explicitSport.isExplicitSportTop, true);
  assert.equal(explicitSport.sportApparelEvidence, true);
});

test('scene tags provide soft activity evidence without redefining clothing identity', () => {
  const ordinaryHomeTaggedTop = fixtureItem('home-tagged-top', 'top', 'T-shirt', {
    styleTags: ['\u4f11\u95f2'],
    sceneTags: ['\u5c45\u5bb6'],
  });
  const facts = deriveSceneEligibilityFacts(ordinaryHomeTaggedTop);
  assert.equal(facts.isHomewear, false);
  assert.ok(facts.explicitHomeSignals.length > 0);

  for (const scene of ['work', 'date']) {
    const result = evaluateSceneEvidenceV4({
      scene,
      items: [ordinaryHomeTaggedTop, C.casualPants, C.casualShoe],
    });
    assert.equal(result.canEnterScene, true);
    assert.equal(result.hardRejected, false);
    assert.ok(result.warnings.includes(scene === 'work'
      ? 'WORK_HOME_SIGNAL_NEGATIVE'
      : 'DATE_HOME_SIGNAL_NEGATIVE'));
  }

  assert.equal(deriveSceneEligibilityFacts(C.homewear).isHomewear, true);
});

test('special-purpose hard conflicts cover professional work and performance date cases', () => {
  const work = evaluateSceneEvidenceV4({ scene: 'work', items: [C.professionalTraining, C.sneaker] });
  const date = evaluateSceneEvidenceV4({ scene: 'date', items: [C.performance, C.casualShoe] });
  assert.equal(work.hardRejected, true);
  assert.ok(work.rejectReasons.includes('WORK_SPECIAL_PURPOSE_CONFLICT'));
  assert.equal(date.hardRejected, true);
  assert.ok(date.rejectReasons.includes('DATE_SPECIAL_PURPOSE_CONFLICT'));
});
