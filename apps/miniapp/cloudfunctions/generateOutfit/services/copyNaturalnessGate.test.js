const assert = require('node:assert/strict');
const test = require('node:test');
const {
  COPY_NATURALNESS_FLAGS,
  DECISION_VALUE_PASS,
  DECISION_VALUE_REJECT,
  evaluateCopyNaturalness,
  evaluateDecisionValue,
} = require('./copyNaturalnessGate');
const {
  buildNaturalTodayCopyPlan,
  joinClauses,
} = require('./recommendationNaturalLanguage');

function groundedModel() {
  return {
    scene: 'date',
    items: [
      item('top', 'top-1', '短袖T恤', '绿色'),
      item('bottom', 'bottom-1', '直筒裤', '灰色'),
    ],
    relations: [{
      relationCode: 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
      roles: ['top', 'bottom'],
      authorizedValues: ['绿色', '灰色'],
      subjectItemIds: ['top-1', 'bottom-1'],
      evidenceFactIds: ['item:top-1:color', 'item:bottom-1:color'],
    }],
    qualification: {
      reasonCode: 'DATE_BRIGHT_TOP_BASIC_SUPPORT',
      subjectItemIds: ['top-1', 'bottom-1'],
      supportingFactIds: ['item:top-1:bright_color', 'item:bottom-1:basic_color'],
      evidence: [
        { factId: 'item:top-1:bright_color', fact: 'bright_color', itemId: 'top-1' },
        { factId: 'item:bottom-1:basic_color', fact: 'basic_color', itemId: 'bottom-1' },
      ],
    },
  };
}

function item(role, itemId, subtype, normalizedColor) {
  return { role, itemId, canonicalSubtype: subtype, canonicalName: subtype, normalizedColor };
}

function validPlan() {
  const model = groundedModel();
  return buildNaturalTodayCopyPlan(model, model.relations[0]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceText(plan, text) {
  const next = clone(plan);
  next.clauses[0].text = text.replace(/[。！？!?]+$/u, '');
  next.text = joinClauses(next.clauses);
  return next;
}

test('registered high-value message with complete evidence passes both gates', () => {
  const plan = validPlan();
  assert.equal(plan.compositionPattern, 'natural_message');
  assert.equal(plan.clauses.length, 1);
  assert.equal(evaluateCopyNaturalness(plan).result, 'PASS');
  assert.equal(evaluateDecisionValue(plan).result, DECISION_VALUE_PASS);
});

test('missing valuable evidence cannot fall back to a generic sentence', () => {
  const plan = buildNaturalTodayCopyPlan({ scene: 'home', items: [], relations: [], qualification: {} });
  assert.equal(plan.text, '');
  assert.equal(evaluateCopyNaturalness(plan).result, 'REJECT');
  assert.equal(evaluateDecisionValue(plan).result, DECISION_VALUE_REJECT);
});

test('message intent, template registration, provenance, and value assessment are structural', () => {
  const intent = clone(validPlan());
  intent.messageIntent = 'forged_intent';
  assert.ok(evaluateCopyNaturalness(intent).riskFlags.includes(COPY_NATURALNESS_FLAGS.MESSAGE_INTENT_MISMATCH));

  const template = clone(validPlan());
  template.clauses[0].templateId = 'message.unregistered';
  assert.ok(evaluateCopyNaturalness(template).riskFlags.includes(COPY_NATURALNESS_FLAGS.UNKNOWN_TEMPLATE));

  const provenance = clone(validPlan());
  provenance.clauses[0].evidenceFactIds = [];
  provenance.clauses[0].authorizationIds = [];
  assert.ok(evaluateCopyNaturalness(provenance).riskFlags.includes(COPY_NATURALNESS_FLAGS.MISSING_PROVENANCE));

  const value = clone(validPlan());
  value.valueAssessment.userValue = 0;
  value.clauses[0].valueAssessment.userValue = 0;
  assert.ok(evaluateCopyNaturalness(value).riskFlags.includes(COPY_NATURALNESS_FLAGS.INVALID_VALUE_ASSESSMENT));
});

test('copy plan must remain one natural message instead of mechanical slot concatenation', () => {
  const plan = clone(validPlan());
  plan.clauses.push(clone(plan.clauses[0]));
  plan.clauses[1].informationKey = 'second-slot';
  plan.text = joinClauses(plan.clauses);
  assert.ok(evaluateCopyNaturalness(plan).riskFlags.includes(COPY_NATURALNESS_FLAGS.INVALID_SLOT_ORDER));
});

test('reported low-value production sentences are rejected even with forged complete provenance', () => {
  const failures = [
    '短袖T恤配短裤，在家穿不会裹得太多。',
    '白色印花短袖T恤的印花已经是这身的重点。',
    '毛衣、阔腿裤、运动鞋和手提袋组成一套，上班出门不用临时补搭。',
    '灰色卫衣定下主色，其他单品沿用灰色或相近颜色就好。',
    '这套有清楚的搭配关系，日常约会穿着自然。',
    '白色短裤和白色运动鞋用同色呼应。',
    '这套活动结构轻便，适合散步和日常轻运动。',
  ];
  for (const copy of failures) {
    const result = evaluateCopyNaturalness(replaceText(validPlan(), copy));
    assert.equal(result.result, 'REJECT', copy);
    assert.ok(result.riskFlags.includes(COPY_NATURALNESS_FLAGS.KNOWN_LOW_VALUE_SENTENCE)
      || result.riskFlags.includes(COPY_NATURALNESS_FLAGS.MECHANICAL_SCENE_RESTATEMENT), copy);
  }
});

test('human policy still rejects system-checklist and generic editorial language', () => {
  const checklist = replaceText(validPlan(), '这些单品已经配齐，可以直接这样穿。');
  assert.ok(evaluateCopyNaturalness(checklist).riskFlags.includes(COPY_NATURALNESS_FLAGS.SYSTEM_CHECKLIST_TONE));

  const editorial = replaceText(validPlan(), '绿色上衣和灰色下装配色简洁。');
  assert.ok(evaluateCopyNaturalness(editorial).riskFlags.includes(COPY_NATURALNESS_FLAGS.GENERIC_EDITORIAL_TAIL));
});
