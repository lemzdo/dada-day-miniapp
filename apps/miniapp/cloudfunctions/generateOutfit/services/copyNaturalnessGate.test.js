const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COPY_NATURALNESS_FLAGS,
  evaluateCopyNaturalness,
} = require('./copyNaturalnessGate');
const { buildNaturalTodayCopyPlan, joinClauses } = require('./recommendationNaturalLanguage');

function validPlan() {
  const model = {
    scene: 'home',
    items: [
      { role: 'top', itemId: 'top-1', canonicalSubtype: '短袖T恤', normalizedColor: '白色' },
      { role: 'bottom', itemId: 'bottom-1', canonicalSubtype: '短裤', normalizedColor: '灰色' },
    ],
    qualification: {
      reasonCode: 'HOME_HOT_SHORT_SLEEVE_SHORTS',
      subjectItemIds: ['top-1', 'bottom-1'],
      supportingFactIds: ['item:top-1:short_sleeve', 'item:bottom-1:shorts'],
      relationFactIds: [],
      evidence: [
        { factId: 'item:top-1:short_sleeve', fact: 'short_sleeve', itemId: 'top-1' },
        { factId: 'item:bottom-1:shorts', fact: 'shorts', itemId: 'bottom-1' },
      ],
    },
  };
  const relation = {
    relationCode: 'NEUTRAL_COLOR_BRIDGE',
    roles: ['top', 'bottom'],
    subjectItemIds: ['top-1', 'bottom-1'],
    evidenceFactIds: ['item:top-1:color', 'item:bottom-1:color'],
  };
  return buildNaturalTodayCopyPlan(model, relation);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function insertGenericScene(planValue) {
  const plan = clone(planValue);
  const relation = plan.clauses.find((clause) => clause.slot === 'relation');
  const sceneClause = {
    slot: 'scene_value',
    templateId: 'scene.home-direct',
    text: '宅家时可以直接这样穿',
    informationKey: 'scene:home:HOME_HOT_SHORT_SLEEVE_SHORTS',
    subjectItemIds: ['top-1', 'bottom-1'],
    evidenceFactIds: ['outfit:home_eligible'],
    authorizationIds: ['eligibility:HOME_HOT_SHORT_SLEEVE_SHORTS'],
    relationCode: relation.relationCode,
    scene: 'home',
    source: 'core_eligibility',
  };
  const relationIndex = plan.clauses.indexOf(relation);
  plan.clauses.splice(relationIndex + 1, 0, sceneClause);
  plan.compositionPattern = plan.clauses.map((clause) => clause.slot).join('>');
  plan.text = joinClauses(plan.clauses);
  return plan;
}

test('COPY_NATURALNESS_GATE accepts grounded relation and new benefit evidence without a forced scene clause', () => {
  const plan = validPlan();
  assert.equal(plan.compositionPattern, 'relation>benefit');
  assert.equal(plan.clauses.some((clause) => clause.slot === 'scene_value'), false);
  assert.equal(evaluateCopyNaturalness(plan).result, 'PASS');
});

test('COPY_NATURALNESS_GATE rejects the reported editorial composition even with populated provenance', () => {
  const plan = insertGenericScene(validPlan());
  plan.clauses = plan.clauses.slice(0, 3);
  plan.clauses[0].text = '白色短袖T恤与灰色短裤用中性色过渡';
  plan.clauses[1].text = '适合居家场景';
  plan.clauses[2].text = '配色简洁';
  plan.text = joinClauses(plan.clauses);
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT));
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.GENERIC_EDITORIAL_TAIL));
});

test('COPY_NATURALNESS_GATE rejects a benefit that repeats relation evidence', () => {
  const plan = clone(validPlan());
  const benefitClause = plan.clauses.find((clause) => clause.slot === 'benefit');
  benefitClause.evidenceFactIds = plan.clauses[0].evidenceFactIds.slice();
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.BENEFIT_WITHOUT_NEW_EVIDENCE));
});

test('COPY_NATURALNESS_GATE rejects unregistered templates and broken composition', () => {
  const plan = clone(validPlan());
  plan.clauses[0].templateId = 'relation.unregistered';
  plan.compositionPattern = 'benefit>relation>scene_value';
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.UNKNOWN_TEMPLATE));
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.INVALID_SLOT_ORDER));
});

test('COPY_NATURALNESS_GATE rejects scene copy without eligibility authorization', () => {
  const plan = insertGenericScene(validPlan());
  plan.clauses.find((clause) => clause.slot === 'scene_value').authorizationIds = [];
  plan.text = joinClauses(plan.clauses);
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT));
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.NO_INCREMENTAL_INFORMATION));
});

test('COPY_NATURALNESS_GATE rejects system checklist phrasing even when provenance is complete', () => {
  const plan = validPlan();
  plan.clauses.find((clause) => clause.slot === 'benefit').text = '活动用的下装和鞋已经配上';
  plan.text = joinClauses(plan.clauses);
  assert.deepEqual(evaluateCopyNaturalness(plan), {
    version: 'copy-naturalness-gate-v1',
    result: 'REJECT',
    riskFlags: ['SYSTEM_CHECKLIST_TONE'],
  });
});

test('COPY_NATURALNESS_GATE rejects repeated scene semantics across scene and benefit slots', () => {
  const plan = insertGenericScene(validPlan());
  plan.clauses.find((clause) => clause.slot === 'benefit').text = '宅家时短袖和短裤不会裹得太多';
  plan.text = joinClauses(plan.clauses);
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes('DUPLICATE_INFORMATION'));
});

test('COPY_NATURALNESS_GATE positively rejects a known slot with no incremental information', () => {
  const plan = insertGenericScene(validPlan());
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.NO_INCREMENTAL_INFORMATION));
});
