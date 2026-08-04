const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { planRecommendationNarrative } = require('./recommendationNarrativePlanner');
const {
  COPY_ACCEPTANCE_PASS,
  COPY_ACCEPTANCE_REJECT,
  COPY_RISK_FLAGS,
  inspectRecommendationCopy,
  inspectRecommendationPair,
} = require('./recommendationCopyAcceptanceGate');

function item(id, category, subcategory, extra = {}) {
  return { clothingId: id, category, subcategory, confidence: 0.95, ...extra };
}

function fixture(scene = 'home') {
  const items = scene === 'home'
    ? [item('top-1', 'top', '上衣', { productFacts: ['soft_material'] })]
    : [
        item('top-1', 'top', '衬衫', { fit: '宽松', productFacts: ['soft_material'] }),
        item('bottom-1', 'bottom', '直筒裤', { fit: '直筒', productFacts: ['flexible_fit'] }),
        item('shoes-1', 'shoes', '乐福鞋', { styleComplexity: '简洁' }),
      ];
  const weather = { temp: 22, weather: '晴' };
  const facts = buildOutfitCopyFacts({ outfit: { items, scene, weatherSnapshot: weather }, scene, weather });
  const plan = planRecommendationNarrative({ facts, scene, weather });
  return {
    facts,
    plan,
    context: {
      selectedOutfitItemIds: facts.items.map((entry) => entry.id),
      itemFactsById: facts.itemFactsById,
      relationFacts: facts.relationFacts,
    },
  };
}

function candidate(claim, surface = 'today') {
  return {
    text: claim.text,
    scene: claim.scene,
    surface,
    action: claim.action,
    dimension: claim.dimension,
    claimId: claim.claimId,
    sentenceClusterId: claim.claimId,
    subjectItemIds: claim.subjectItemIds.slice(),
    requiredFactIds: claim.requiredFactIds.slice(),
    evidenceFactIds: claim.evidenceFactIds.slice(),
    evidenceSources: claim.evidenceSources.map((entry) => ({ ...entry })),
    slotBindings: { ...claim.slotBindings },
    userValue: claim.userValue,
    sentence: { text: claim.text, requiredFactIds: claim.requiredFactIds.slice() },
  };
}

function dateRelationFixture() {
  const scene = 'date';
  const weather = { temp: 22, weather: '晴' };
  const items = [
    item('top-date', 'top', '上衣', { color: '米白色' }),
    item('bottom-date', 'bottom', '长裤', { color: '米白色' }),
    item('shoes-date', 'shoes', '乐福鞋', { color: '黑色' }),
  ];
  const facts = buildOutfitCopyFacts({ outfit: { items, scene, weatherSnapshot: weather }, scene, weather });
  const plan = planRecommendationNarrative({ facts, scene, weather });
  return {
    facts,
    plan,
    context: {
      selectedOutfitItemIds: facts.items.map((entry) => entry.id),
      itemFactsById: facts.itemFactsById,
      relationFacts: facts.relationFacts,
    },
  };
}

test('Gate is binary and accepts a complete item-scoped fixed Claim', () => {
  const value = fixture('home');
  const inspection = inspectRecommendationCopy(candidate(value.plan.todayClaim), value.context);
  assert.deepEqual(inspection, { result: COPY_ACCEPTANCE_PASS, riskFlags: [] });
  assert.equal(Object.keys(inspection).sort().join(','), 'result,riskFlags');
});

test('missing Claim facts and sentence facts are rejected independently', () => {
  const value = fixture('home');
  const missingClaimEvidence = candidate(value.plan.todayClaim);
  missingClaimEvidence.evidenceFactIds = [];
  assert.ok(
    inspectRecommendationCopy(missingClaimEvidence, value.context).riskFlags
      .includes(COPY_RISK_FLAGS.CLAIM_FACT_NOT_EVIDENCED),
  );

  const missingSentenceEvidence = candidate(value.plan.todayClaim);
  missingSentenceEvidence.sentence.requiredFactIds.push('item:top-1:not_present');
  assert.ok(
    inspectRecommendationCopy(missingSentenceEvidence, value.context).riskFlags
      .includes(COPY_RISK_FLAGS.SENTENCE_FACT_NOT_EVIDENCED),
  );
});

test('subject slot and evidence membership are each checked against the selected outfit', () => {
  const value = fixture('home');

  const outsideSubject = candidate(value.plan.todayClaim);
  outsideSubject.subjectItemIds = ['outside'];
  assert.ok(inspectRecommendationCopy(outsideSubject, value.context).riskFlags
    .includes(COPY_RISK_FLAGS.SUBJECT_NOT_IN_OUTFIT));

  const outsideSlot = candidate(value.plan.todayClaim);
  outsideSlot.slotBindings.top = 'outside';
  assert.ok(inspectRecommendationCopy(outsideSlot, value.context).riskFlags
    .includes(COPY_RISK_FLAGS.SLOT_ITEM_NOT_IN_OUTFIT));

  const outsideEvidence = candidate(value.plan.todayClaim);
  outsideEvidence.requiredFactIds = ['item:outside:soft_material'];
  outsideEvidence.evidenceFactIds = ['item:outside:soft_material'];
  outsideEvidence.sentence.requiredFactIds = ['item:outside:soft_material'];
  outsideEvidence.evidenceSources = [{
    factId: 'item:outside:soft_material', itemId: 'outside', fact: 'soft_material',
    source: 'user', confidence: 1,
  }];
  assert.ok(inspectRecommendationCopy(outsideEvidence, value.context).riskFlags
    .includes(COPY_RISK_FLAGS.EVIDENCE_ITEM_NOT_IN_OUTFIT));
});

test('weak visual sources cannot support strong functional conclusions', () => {
  const value = fixture('home');
  const weak = candidate(value.plan.todayClaim);
  weak.evidenceSources = weak.evidenceSources.map((entry) => ({
    ...entry,
    source: 'visual_inference',
    confidence: 0.95,
  }));
  value.context.itemFactsById['top-1'].factRecords = weak.evidenceSources.map((entry) => ({
    ...entry,
    fact: 'soft_material',
    value: true,
  }));
  const inspection = inspectRecommendationCopy(weak, value.context);
  assert.equal(inspection.result, COPY_ACCEPTANCE_REJECT);
  assert.ok(inspection.riskFlags.includes(COPY_RISK_FLAGS.EVIDENCE_SOURCE_TOO_WEAK));
});

test('outfit relations require two in-outfit subjects and exact item-scoped support', () => {
  const value = dateRelationFixture();
  assert.equal(value.plan.todayClaim.claimId, 'D01-05');
  const valid = candidate(value.plan.todayClaim);
  assert.equal(inspectRecommendationCopy(valid, value.context).result, COPY_ACCEPTANCE_PASS);

  const selfRelation = JSON.parse(JSON.stringify(value.context));
  selfRelation.relationFacts[0].subjectItemIds = ['top-date', 'top-date'];
  selfRelation.relationFacts[0].supportingFactIds = ['item:top-date:color', 'item:top-date:color'];
  const selfCandidate = candidate(value.plan.todayClaim);
  selfCandidate.evidenceSources[0] = { ...selfRelation.relationFacts[0] };
  const selfInspection = inspectRecommendationCopy(selfCandidate, selfRelation);
  assert.equal(selfInspection.result, COPY_ACCEPTANCE_REJECT);
  assert.ok(selfInspection.riskFlags.length > 0);

  const outsideRelation = JSON.parse(JSON.stringify(value.context));
  outsideRelation.relationFacts[0].subjectItemIds = ['top-date', 'outside'];
  outsideRelation.relationFacts[0].supportingFactIds = ['item:top-date:color', 'item:outside:color'];
  const outsideCandidate = candidate(value.plan.todayClaim);
  outsideCandidate.evidenceSources[0] = { ...outsideRelation.relationFacts[0] };
  const outsideInspection = inspectRecommendationCopy(outsideCandidate, outsideRelation);
  assert.equal(outsideInspection.result, COPY_ACCEPTANCE_REJECT);
  assert.ok(outsideInspection.riskFlags.includes(COPY_RISK_FLAGS.SUBJECT_NOT_IN_OUTFIT));
  assert.ok(outsideInspection.riskFlags.includes(COPY_RISK_FLAGS.EVIDENCE_ITEM_NOT_IN_OUTFIT));
});

test('Gate accepts missing detail but rejects repeated Claim value or evidence', () => {
  const value = fixture('work');
  const today = candidate(value.plan.todayClaim, 'today');
  assert.equal(inspectRecommendationPair({ today }, value.context).result, COPY_ACCEPTANCE_PASS);

  const repeated = candidate(value.plan.todayClaim, 'detail');
  const inspection = inspectRecommendationPair({ today, detail: repeated }, value.context);
  assert.equal(inspection.result, COPY_ACCEPTANCE_REJECT);
  assert.ok(inspection.riskFlags.includes(COPY_RISK_FLAGS.TODAY_DETAIL_CLAIM_REPEAT));
  assert.ok(inspection.riskFlags.includes(COPY_RISK_FLAGS.TODAY_DETAIL_VALUE_REPEAT));
  assert.ok(inspection.riskFlags.includes(COPY_RISK_FLAGS.TODAY_DETAIL_EVIDENCE_REPEAT));
});

test('Gate never rewrites text and rejects any text outside the fixed Catalog', () => {
  const value = fixture('home');
  const changed = candidate(value.plan.todayClaim);
  changed.text = '这件上衣适合当前场景。';
  const inspection = inspectRecommendationCopy(changed, value.context);
  assert.equal(inspection.result, COPY_ACCEPTANCE_REJECT);
  assert.ok(inspection.riskFlags.includes(COPY_RISK_FLAGS.FIXED_CLAIM_TEXT_MISMATCH));
  assert.equal(changed.text, '这件上衣适合当前场景。');
});

test('malformed candidates fail closed and never return partial repair', () => {
  for (const value of [null, {}, { text: '' }, []]) {
    const inspection = inspectRecommendationCopy(value, {});
    assert.equal(inspection.result, COPY_ACCEPTANCE_REJECT);
    assert.ok(inspection.riskFlags.length > 0);
  }
});
