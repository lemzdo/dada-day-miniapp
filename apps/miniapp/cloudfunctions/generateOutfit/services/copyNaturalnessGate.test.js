const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COPY_NATURALNESS_FLAGS,
  DECISION_VALUE_CATEGORIES,
  DECISION_VALUE_FLAGS,
  evaluateDecisionValue,
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
  plan.clauses.find((clause) => clause.slot === 'scene_value').text = '宅家时可以直接这样穿';
  plan.text = joinClauses(plan.clauses);
  return plan;
}

function prependGroundedRelation(planValue) {
  const plan = clone(planValue);
  const sceneClause = plan.clauses.find((entry) => entry.slot === 'scene_value');
  plan.clauses.unshift({
    ...clone(sceneClause),
    slot: 'relation',
    templateId: 'relation.neutral-pair',
    text: '白色短袖T恤和灰色短裤都是中性色',
    informationKey: 'relation:NEUTRAL_COLOR_BRIDGE',
    evidenceFactIds: ['item:top-1:color', 'item:bottom-1:color'],
    authorizationIds: [],
    source: 'presentation_relation',
  });
  plan.compositionPattern = plan.clauses.map((entry) => entry.slot).join('>');
  plan.text = joinClauses(plan.clauses);
  return plan;
}

function replaceSceneWithBenefit(planValue) {
  const plan = prependGroundedRelation(planValue);
  const clause = plan.clauses.find((entry) => entry.slot === 'scene_value');
  clause.slot = 'benefit';
  clause.templateId = 'benefit.less-bundled-home-short-sleeve';
  clause.text = '短袖和短裤不会裹得太多';
  clause.informationKey = 'benefit:benefit.less-bundled-home-short-sleeve';
  clause.source = 'core_eligibility_benefit';
  clause.authorizationIds = ['eligibility:HOME_HOT_SHORT_SLEEVE_SHORTS'];
  plan.compositionPattern = plan.clauses.map((entry) => entry.slot).join('>');
  plan.text = joinClauses(plan.clauses);
  return plan;
}

test('COPY_NATURALNESS_GATE replaces a low-value relation with meaningful scene evidence', () => {
  const plan = validPlan();
  assert.equal(plan.compositionPattern, 'scene_value');
  assert.equal(plan.clauses.some((clause) => clause.slot === 'scene_value'), true);
  assert.equal(evaluateCopyNaturalness(plan).result, 'PASS');
  assert.deepEqual(evaluateDecisionValue(plan).categories, [
    DECISION_VALUE_CATEGORIES.MEANINGFUL_SCENE_EVIDENCE,
  ]);
});

test('COPY_NATURALNESS_GATE rejects the reported editorial composition even with populated provenance', () => {
  const plan = insertGenericScene(prependGroundedRelation(validPlan()));
  plan.clauses[0].text = '白色短袖T恤与灰色短裤用中性色过渡';
  plan.clauses[1].text = '适合居家场景，配色简洁';
  plan.text = joinClauses(plan.clauses);
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT));
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.GENERIC_EDITORIAL_TAIL));
});

test('COPY_NATURALNESS_GATE rejects a benefit that repeats relation evidence', () => {
  const plan = replaceSceneWithBenefit(validPlan());
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
});

test('COPY_NATURALNESS_GATE rejects system checklist phrasing even when provenance is complete', () => {
  const plan = validPlan();
  plan.clauses.find((clause) => clause.slot === 'scene_value').text = '活动用的下装和鞋已经配上';
  plan.text = joinClauses(plan.clauses);
  assert.deepEqual(evaluateCopyNaturalness(plan), {
    version: 'copy-naturalness-gate-v1',
    result: 'REJECT',
    riskFlags: ['SYSTEM_CHECKLIST_TONE'],
  });
});

test('COPY_NATURALNESS_GATE rejects repeated scene semantics across scene and benefit slots', () => {
  const plan = validPlan();
  const benefit = clone(plan.clauses.find((clause) => clause.slot === 'scene_value'));
  benefit.slot = 'benefit';
  benefit.templateId = 'benefit.less-bundled-home-short-sleeve';
  benefit.text = '在家时短袖和短裤不会裹得太多';
  benefit.informationKey = 'benefit:benefit.less-bundled-home-short-sleeve';
  benefit.evidenceFactIds = ['item:top-1:benefit'];
  benefit.source = 'core_eligibility_benefit';
  plan.clauses.push(benefit);
  plan.compositionPattern = plan.clauses.map((clause) => clause.slot).join('>');
  plan.text = joinClauses(plan.clauses);
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes('DUPLICATE_INFORMATION'));
});

test('COPY_NATURALNESS_GATE preserves NO_INCREMENTAL_INFORMATION for a template without metadata', () => {
  const plan = validPlan();
  plan.clauses[0].templateId = 'relation.unregistered';
  const result = evaluateCopyNaturalness(plan);
  assert.equal(result.result, 'REJECT');
  assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.NO_INCREMENTAL_INFORMATION));
});

test('DECISION_VALUE_GATE rejects a factual relation when it is the whole final reason', () => {
  const plan = validPlan();
  plan.clauses = [{
    ...plan.clauses[0],
    templateId: 'relation.top-bottom',
    text: '短袖T恤配短裤',
  }];
  plan.compositionPattern = 'relation';
  plan.text = joinClauses(plan.clauses);
  const decision = evaluateDecisionValue(plan);
  assert.equal(decision.result, 'REJECT');
  assert.deepEqual(decision.categories, [DECISION_VALUE_CATEGORIES.FACTUAL_BUT_LOW_VALUE]);
  assert.deepEqual(decision.riskFlags, [DECISION_VALUE_FLAGS.LOW_VALUE_FINAL_REASON]);
  assert.ok(evaluateCopyNaturalness(plan).riskFlags.includes(COPY_NATURALNESS_FLAGS.LOW_VALUE_FINAL_REASON));
});
