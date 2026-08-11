const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateCopyNaturalness } = require('./copyNaturalnessGate');
const {
  LOW_VALUE_RELATION_CODES,
  SAFE_FALLBACK,
  buildNaturalDetailCopyPlan,
  buildNaturalTodayCopyCandidates,
  buildNaturalTodayCopyPlan,
} = require('./recommendationNaturalLanguage');

const ITEM_IDS = Object.freeze({ top: 'top-1', bottom: 'bottom-1', onepiece: 'dress-1', outerwear: 'outer-1', shoes: 'shoe-1', accessory: 'accessory-1' });

function item(role, subtype, color = '', tags = []) {
  return {
    role,
    itemId: ITEM_IDS[role],
    canonicalSubtype: subtype,
    canonicalName: subtype,
    normalizedColor: color,
    visibleFeatureTags: tags,
  };
}

function relation(code, roles) {
  return {
    relationCode: code,
    roles,
    authorizedValues: roles.map((role) => role),
    subjectItemIds: roles.map((role) => ITEM_IDS[role]),
    evidenceFactIds: roles.map((role) => `item:${ITEM_IDS[role]}:authorized`),
  };
}

function qualification(reasonCode, facts, roles = ['top', 'bottom']) {
  const evidence = facts.map((fact, index) => ({
    factId: `item:${ITEM_IDS[roles[index % roles.length]]}:${fact}`,
    fact,
    itemId: ITEM_IDS[roles[index % roles.length]],
  }));
  return {
    reasonCode,
    subjectItemIds: [...new Set(evidence.map((record) => record.itemId))],
    supportingFactIds: evidence.map((record) => record.factId),
    relationFactIds: [],
    evidence,
  };
}

function model({ scene = 'home', items = [], relations = [], qualification: evidence = {} }) {
  return { scene, items, relations, qualification: evidence };
}

const cases = [
  ['same-color', model({ scene: 'date', items: [item('top', 'T恤', '白色'), item('bottom', '直筒裤', '白色')], relations: [relation('SAME_COLOR_TOP_BOTTOM', ['top', 'bottom'])] })],
  ['neutral-support', model({ scene: 'work', items: [item('top', '衬衫', '白色'), item('bottom', '直筒裤', '灰色')], relations: [relation('NEUTRAL_COLOR_BRIDGE', ['top', 'bottom'])] })],
  ['primary-neutral', model({ scene: 'date', items: [item('top', 'T恤', '绿色'), item('bottom', '直筒裤', '灰色')], relations: [relation('TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', 'bottom'])] })],
  ['bright-scene', model({ scene: 'date', items: [item('top', 'T恤', '粉色'), item('bottom', '直筒裤', '黑色')], qualification: qualification('DATE_BRIGHT_TOP_BASIC_SUPPORT', ['bright_color', 'basic_color']) })],
  ['pattern-solid', model({ scene: 'date', items: [item('top', '印花T恤', '白色', ['印花']), item('bottom', '直筒裤', '黑色', ['纯色'])], relations: [relation('PATTERN_SOLID_BALANCE', ['top', 'bottom'])], qualification: qualification('DATE_PATTERN_TOP_SIMPLE_SUPPORT', ['pattern_visible', 'solid_color', 'simple_style']) })],
  ['onepiece-only', model({ scene: 'date', items: [item('onepiece', '连衣裙', '蓝色')], relations: [relation('STRUCTURE_ONEPIECE_ONLY', ['onepiece'])] })],
  ['onepiece-shoes', model({ scene: 'home', items: [item('onepiece', '吊带裙', '白色'), item('shoes', '运动鞋', '白色')], relations: [relation('STRUCTURE_ONEPIECE_SHOES', ['onepiece', 'shoes'])], qualification: qualification('HOME_DRESS_NORMAL_SHOES', ['dress', 'outing_shoe'], ['onepiece', 'shoes']) })],
  ['onepiece-layer', model({ scene: 'work', items: [item('onepiece', '连衣裙', '藏青色'), item('outerwear', '外套', '灰色')], relations: [relation('STRUCTURE_ONEPIECE_OUTERWEAR', ['onepiece', 'outerwear'])] })],
  ['optional-accessory-keeps-core-message', model({ scene: 'date', items: [item('top', 'T恤', '绿色'), item('bottom', '直筒裤', '灰色'), item('accessory', '小包', '白色')], relations: [relation('TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', 'bottom'])] })],
  ['home-light', model({ scene: 'home', items: [item('top', '短袖T恤'), item('bottom', '短裤')], qualification: qualification('HOME_SHORT_SLEEVE_SHORTS', ['short_sleeve', 'shorts']) })],
  ['home-movement', model({ scene: 'home', items: [item('top', 'T恤'), item('bottom', '阔腿裤')], qualification: qualification('HOME_LOOSE_TWO_PIECE', ['loose_fit']) })],
  ['home-quick-outing', model({ scene: 'home', items: [item('top', '短袖T恤'), item('bottom', '长裤')], qualification: qualification('HOME_SHORT_SLEEVE_LONG_PANTS', ['short_sleeve', 'long_pants']) })],
  ['work-strong', model({ scene: 'work', items: [item('top', '衬衫'), item('bottom', '直筒裤')], qualification: qualification('WORK_SHIRT_STRAIGHT_PANTS', ['shirt', 'straight_cut']) })],
  ['work-weather', model({ scene: 'work', items: [item('top', '短袖T恤'), item('bottom', '长裤')], qualification: qualification('WORK_HOT_SHORT_SLEEVE_PANTS', ['short_sleeve', 'long_pants']) })],
  ['medium-relation-plus-scene', model({ scene: 'work', items: [item('top', '短袖T恤', '白色'), item('bottom', '长裤', '灰色')], relations: [relation('NEUTRAL_COLOR_BRIDGE', ['top', 'bottom'])], qualification: qualification('WORK_V4_EVIDENCE_SUPPORTED', ['category'], ['top']) })],
  ['date-simple', model({ scene: 'date', items: [item('onepiece', '连衣裙'), item('shoes', '乐福鞋')], qualification: qualification('DATE_SIMPLE_DRESS_SHOES', ['dress', 'simple_style', 'outing_shoe'], ['onepiece', 'shoes']) })],
  ['scene-only', model({ scene: 'date', items: [item('onepiece', '连衣裙')], qualification: qualification('DATE_V4_EVIDENCE_SUPPORTED', ['category'], ['onepiece']) })],
  ['sport-complete', model({ scene: 'sport', items: [item('top', '运动上衣'), item('bottom', '运动裤'), item('shoes', '运动鞋')], qualification: qualification('SPORT_COMPLETE_SET', ['sport_top', 'sport_bottom', 'sport_shoe'], ['top', 'bottom', 'shoes']) })],
  ['sport-hot', model({ scene: 'sport', items: [item('top', '短袖运动上衣'), item('bottom', '运动短裤'), item('shoes', '运动鞋')], qualification: qualification('SPORT_HOT_SHORT_SLEEVE_SHORTS', ['short_sleeve', 'shorts', 'sport_bottom', 'sport_shoe'], ['top', 'bottom', 'bottom', 'shoes']) })],
];

test('high-value fixture spans color, pattern, structure, scene, weather, and evidence-strength axes', () => {
  for (const [name, source] of cases) {
    const candidates = buildNaturalTodayCopyCandidates(source);
    assert.ok(candidates.length > 0, `${name}: candidate`);
    const plan = buildNaturalTodayCopyPlan(source, source.relations[0] || {}, { candidateId: candidates[0].candidateId });
    const gate = evaluateCopyNaturalness(plan);
    assert.equal(gate.result, 'PASS', `${name}: ${gate.riskFlags.join(',')}`);
    assert.equal(plan.clauses.length, 1, name);
    assert.ok(plan.messageIntent, name);
    assert.ok(plan.valueAssessment.userValue >= 2, name);
    assert.doesNotMatch(plan.text, /配色简洁|整体协调|更显质感|其他单品沿用.+就好|组成一套.+不用临时补搭/, name);
  }
});

test('weak, conflicting, or merely factual observations are omitted instead of padded', () => {
  const weakCases = [
    model({ items: [item('top', '印花T恤', '白色', ['印花']), item('bottom', '印花短裤', '黑色', ['印花'])], relations: [relation('SUBTYPE_FEATURE_PRINT', ['top'])] }),
    model({ items: [item('top', 'T恤')], relations: [relation('STRUCTURE_SINGLE_ITEM', ['top'])] }),
    model({ items: [item('top', 'T恤'), item('bottom', '短裤')], relations: [relation('STRUCTURE_TOP_BOTTOM', ['top', 'bottom'])] }),
    model({ items: [item('top', 'T恤')], relations: [], qualification: {} }),
  ];
  for (const source of weakCases) {
    assert.deepEqual(buildNaturalTodayCopyCandidates(source), []);
    const plan = buildNaturalTodayCopyPlan(source, source.relations[0] || {});
    assert.equal(plan.text, '');
    assert.equal(plan.fallbackStrategy, SAFE_FALLBACK.strategy);
  }
  assert.ok([...LOW_VALUE_RELATION_CODES].includes('SUBTYPE_FEATURE_PRINT'));
});

test('generic scene eligibility does not override an independent Style Insight relation', () => {
  const source = model({
    scene: 'sport',
    items: [
      item('top', '短袖T恤', '白色'),
      item('bottom', '短裤', '灰色'),
      item('shoes', '运动鞋', '白色'),
    ],
    relations: [relation('NEUTRAL_COLOR_BRIDGE', ['top', 'bottom'])],
    qualification: qualification('SPORT_V4_EVIDENCE_SUPPORTED', ['category'], ['top']),
  });
  const [candidate] = buildNaturalTodayCopyCandidates(source);
  assert.equal(candidate.source, 'style_insight');
  assert.match(candidate.text, /安静|简单/);
  assert.doesNotMatch(candidate.text, /散步|走动/);
  assert.deepEqual(candidate.authorizationIds, []);
  assert.ok(candidate.evidenceFactIds.some((factId) => factId.includes(':authorized')));
  const plan = buildNaturalTodayCopyPlan(source, source.relations[0], { candidateId: candidate.candidateId });
  assert.equal(evaluateCopyNaturalness(plan).result, 'PASS');
});

test('detail advice stays grounded and is not a copy of the Today message', () => {
  for (const [name, source] of cases.filter(([, entry]) => entry.relations.length > 0)) {
    const relationValue = source.relations[0];
    const today = buildNaturalTodayCopyPlan(source, relationValue);
    const detail = buildNaturalDetailCopyPlan(source, relationValue);
    if (!detail.text) continue;
    assert.equal(evaluateCopyNaturalness(detail).result, 'PASS', name);
    assert.notEqual(detail.text, today.text, name);
  }
});
