const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateCopyNaturalness } = require('./copyNaturalnessGate');
const {
  BENEFIT_SLOTS,
  DETAIL_RELATION_SLOTS,
  RELATION_SLOTS,
  SAFE_FALLBACK,
  SCENE_VALUE_SLOTS,
  buildNaturalDetailCopyPlan,
  buildNaturalTodayCopyPlan,
} = require('./recommendationNaturalLanguage');
const { CLAIM_CATALOG, SAFE_FALLBACK_CLUSTERS } = require('./xiaodaVoiceBankV2');

const BANNED_EDITORIAL_COPY = /中性色过渡|适合(?:居家|通勤|约会|日常|运动|轻运动).{0,4}(?:场景)?|配色简洁|整体协调|整体利落|整体更完整|更显质感|已经配齐|已经配上|唯一有明确事实|已经配成上下装|已经配成一身/;

const CASES = [
  matrixCase('home-neutral-two-piece', 'home', 'top+bottom', 'neutral', 'NEUTRAL_COLOR_BRIDGE', ['top', 'bottom']),
  matrixCase('home-basic-benefit', 'home', '基础款两件', 'same', 'SAME_COLOR_TOP_BOTTOM', ['top', 'bottom'], benefit('HOME_HOT_SHORT_SLEEVE_SHORTS', ['short_sleeve', 'shorts'])),
  matrixCase('work-three-piece-benefit', 'work', 'top+bottom+shoes', 'contrast', 'DISTINCT_TOP_BOTTOM_COLOR', ['top', 'bottom'], benefit('WORK_SHIRT_STRAIGHT_PANTS', ['shirt', 'straight_cut'])),
  matrixCase('work-patterned-top', 'work', '图案上衣', 'none', 'SUBTYPE_FEATURE_PRINT', ['top']),
  matrixCase('date-onepiece', 'date', 'onepiece', 'same', 'COLOR_ECHO_ONEPIECE_SHOES', ['onepiece', 'shoes']),
  matrixCase('date-layer-no-color-relation', 'date', 'layer', 'none', 'STRUCTURE_ONEPIECE_OUTERWEAR', ['onepiece', 'outerwear']),
  matrixCase('sport-complete-benefit', 'sport', 'top+bottom+shoes', 'same', 'SAME_COLOR_ALL_ROLES', ['top', 'bottom', 'shoes'], benefit('SPORT_COMPLETE_SET', ['sport_top', 'sport_bottom', 'sport_shoe'])),
  matrixCase('sport-structure-without-color', 'sport', 'top+bottom', 'none', 'STRUCTURE_TOP_BOTTOM', ['top', 'bottom']),
  matrixCase('home-onepiece-safe-structure', 'home', 'onepiece', 'none', 'STRUCTURE_ONEPIECE_ONLY', ['onepiece']),
  matrixCase('date-analogous-colors', 'date', 'top+bottom', 'analogous', 'DISTINCT_TOP_BOTTOM_COLOR', ['top', 'bottom']),
  matrixCase('work-accent-neutral', 'work', 'top+bottom', 'contrast', 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', 'bottom']),
  matrixCase('home-pattern-solid', 'home', '图案上衣', 'contrast', 'PATTERN_SOLID_BALANCE', ['top', 'bottom']),
];

test('naturalness combination matrix covers every requested axis and passes structurally', () => {
  const coverage = { scenes: new Set(), structures: new Set(), colors: new Set(), clauseCounts: new Set() };
  for (const entry of CASES) {
    const { model, relation } = buildInputs(entry);
    const todayPlan = buildNaturalTodayCopyPlan(model, relation);
    const detailPlan = buildNaturalDetailCopyPlan(model, relation);
    const todayGate = evaluateCopyNaturalness(todayPlan);
    const detailGate = evaluateCopyNaturalness(detailPlan);
    assert.equal(todayGate.result, 'PASS', `${entry.id}: ${todayGate.riskFlags.join(',')}`);
    assert.equal(detailGate.result, 'PASS', `${entry.id} detail: ${detailGate.riskFlags.join(',')}`);
    assert.doesNotMatch(`${todayPlan.text}${detailPlan.text}`, BANNED_EDITORIAL_COPY, entry.id);
    assert.equal(todayPlan.clauses[0].relationCode, entry.relationCode);
    assert.equal(todayPlan.clauses.every((clause) => clause.subjectItemIds.length > 0), true);
    assert.equal(todayPlan.clauses.some((clause) => clause.slot === 'benefit'), Boolean(entry.benefit));
    coverage.scenes.add(entry.scene);
    coverage.structures.add(entry.structure);
    coverage.colors.add(entry.colorMode);
    coverage.clauseCounts.add(todayPlan.clauses.length);
  }
  assert.deepEqual([...coverage.scenes].sort(), ['date', 'home', 'sport', 'work']);
  assert.equal(['top+bottom', 'top+bottom+shoes', 'onepiece', '基础款两件', '图案上衣', 'layer'].every((value) => coverage.structures.has(value)), true);
  assert.equal(['neutral', 'same', 'analogous', 'contrast', 'none'].every((value) => coverage.colors.has(value)), true);
  assert.deepEqual([...coverage.clauseCounts].sort(), [1, 2]);
  assert.equal(CASES.every((entry) => {
    const { model, relation } = buildInputs(entry);
    return !buildNaturalTodayCopyPlan(model, relation).clauses.some((clause) => clause.slot === 'scene_value');
  }), true);
});

test('missing relation has no generic sentence fallback', () => {
  const plan = buildNaturalTodayCopyPlan({ scene: 'home', items: [], qualification: {} }, {});
  assert.equal(plan.text, '');
  assert.equal(evaluateCopyNaturalness(plan).result, 'REJECT');
  assert.deepEqual(SAFE_FALLBACK, {
    strategy: 'grounded-relation-only',
    allowGenericSentence: false,
    allowSceneLabelRestatement: false,
  });
});

test('relation, scene, benefit, detail, and Voice Bank inventories are complete and free of old editorial tails', () => {
  const relationCodes = new Set(CASES.map((entry) => entry.relationCode));
  assert.equal([...relationCodes].every((code) => RELATION_SLOTS[code] && DETAIL_RELATION_SLOTS[code]), true);
  assert.deepEqual(Object.keys(SCENE_VALUE_SLOTS).sort(), ['date', 'home', 'sport', 'work']);
  assert.equal(BENEFIT_SLOTS.length > 0, true);
  assert.equal(CLAIM_CATALOG.length > 0, true);
  assert.equal(CLAIM_CATALOG.every((entry) => entry.requirements.length > 0 && !BANNED_EDITORIAL_COPY.test(entry.text)), true);
  assert.deepEqual(SAFE_FALLBACK_CLUSTERS, []);
});

function matrixCase(id, scene, structure, colorMode, relationCode, roles, benefitValue = null) {
  return { id, scene, structure, colorMode, relationCode, roles, benefit: benefitValue };
}

function benefit(reasonCode, facts) {
  return { reasonCode, facts };
}

function buildInputs(entry) {
  const items = rolesForStructure(entry.structure).map((role, index) => ({
    role,
    itemId: `${entry.id}-${role}`,
    canonicalSubtype: subtype(role, entry.structure),
    canonicalName: subtype(role, entry.structure),
    normalizedColor: colorFor(entry.colorMode, index),
  }));
  const subjectItemIds = entry.roles.map((role) => items.find((item) => item.role === role).itemId);
  const evidenceFactIds = subjectItemIds.map((itemId) => `item:${itemId}:${entry.colorMode === 'none' ? 'category' : 'color'}`);
  const eligibilityFacts = entry.benefit?.facts || [];
  const eligibilityEvidence = eligibilityFacts.map((fact, index) => ({
    fact,
    factId: `eligibility:${entry.id}:${fact}`,
    itemId: items[index % items.length].itemId,
  }));
  return {
    model: {
      scene: entry.scene,
      items,
      qualification: {
        reasonCode: entry.benefit?.reasonCode || defaultReason(entry.scene),
        subjectItemIds,
        supportingFactIds: eligibilityEvidence.map((record) => record.factId),
        relationFactIds: [],
        evidence: eligibilityEvidence,
      },
    },
    relation: {
      relationCode: entry.relationCode,
      roles: entry.roles,
      subjectItemIds,
      evidenceFactIds,
    },
  };
}

function rolesForStructure(structure) {
  if (structure === 'onepiece') return ['onepiece', 'shoes'];
  if (structure === 'layer') return ['onepiece', 'outerwear'];
  if (structure === 'top+bottom+shoes') return ['top', 'bottom', 'shoes'];
  return ['top', 'bottom'];
}

function subtype(role, structure) {
  if (role === 'top') return structure === '图案上衣' ? '印花衬衫' : '短袖T恤';
  return { bottom: '直筒裤', shoes: '运动鞋', onepiece: '连衣裙', outerwear: '外套' }[role];
}

function colorFor(mode, index) {
  if (mode === 'none') return '';
  if (mode === 'same') return '白色';
  if (mode === 'neutral') return ['白色', '灰色', '黑色'][index] || '黑色';
  if (mode === 'analogous') return ['蓝色', '绿色', '蓝色'][index] || '蓝色';
  return ['红色', '黑色', '白色'][index] || '白色';
}

function defaultReason(scene) {
  return { home: 'HOME_COMFORT', work: 'WORK_BASELINE_PRESENTABLE', date: 'DATE_SIMPLE_COMPLETE', sport: 'SPORT_LIGHT_ACTIVITY_SET' }[scene];
}
