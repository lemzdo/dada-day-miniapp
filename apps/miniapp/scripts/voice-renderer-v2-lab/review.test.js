'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildGoldPlans } = require('./gold-plans');
const { buildRendererInput } = require('./core');
const { buildArtifact } = require('./run');
const { REVIEW_CRITERIA, buildBlindReview, finalizeReview, summarizeRuns } = require('./review');

function artifact() {
  const plans = buildGoldPlans();
  const inputs = plans.map(buildRendererInput);
  const calls = [];
  for (const modelAlias of ['max', 'plus']) {
    for (let repetition = 1; repetition <= 2; repetition += 1) {
      const outputs = plans.map((plan) => ({
        planId: plan.planId,
        insightId: plan.primary?.insightId || null,
        text: plan.primary?.meaning || `${plan.garments[0]}配${plan.garments[1]}，就是简单日常的一套。`,
      }));
      const checks = plans.map((plan, index) => ({
        caseId: plan.caseId,
        planId: plan.planId,
        pass: !(modelAlias === 'plus' && repetition === 2 && index === 0),
        failures: modelAlias === 'plus' && repetition === 2 && index === 0 ? ['PERSONA_OR_EDITORIAL_LANGUAGE'] : [],
      }));
      calls.push({ modelAlias, repetition, outputs, checks });
    }
  }
  return buildArtifact(plans, inputs, calls, 2, ['max', 'plus']);
}

test('stability summary reports repeat uniqueness and intermittent automated failures', () => {
  const summary = summarizeRuns(artifact());
  assert.equal(summary.models.max.exactRepeatStableCases, 8);
  assert.equal(summary.models.max.cases['primary-pattern-focus'].averagePairSimilarity, 1);
  assert.equal(summary.models.max.cases['primary-pattern-focus'].outputs.length, 2);
  assert.equal(summary.models.plus.automatedCaseFailures, 1);
  assert.deepEqual(summary.models.plus.cases['primary-pattern-focus'].automatedFailureCounts, { PERSONA_OR_EDITORIAL_LANGUAGE: 1 });
});

test('review rejects incomplete model/repetition artifacts even if status says complete', () => {
  const incomplete = artifact();
  incomplete.calls.pop();
  assert.throws(() => summarizeRuns(incomplete), /ARTIFACT_CALL_COUNT/);
});

test('blind review hides candidate model identity and covers every case/repetition', () => {
  const review = buildBlindReview(artifact());
  assert.equal(review.review.entries.length, 16);
  assert.equal(JSON.stringify(review.review).includes('qwen3.7'), false);
  assert.equal(JSON.stringify(review.review).includes('modelAlias'), false);
  assert.equal(JSON.stringify(review.review).includes('sealedModelMap'), false);
  assert.deepEqual(review.review.entries[0].candidates.map((candidate) => candidate.label), ['A', 'B']);
});

test('final review requires explicit Sol judgment for every criterion and unblinds model results', () => {
  const prepared = buildBlindReview(artifact());
  const review = prepared.review;
  assert.throws(() => finalizeReview(review, prepared.sealedModelMap), /REVIEW_INCOMPLETE/);
  for (const entry of review.entries) {
    const evaluation = Object.fromEntries(REVIEW_CRITERIA.map((criterion) => [criterion, true]));
    entry.judgment = {
      outcome: 'TIE',
      A: { ...evaluation, notes: '自然且守住原意。' },
      B: { ...evaluation, notes: '自然且守住原意。' },
    };
  }
  const summary = finalizeReview(review, prepared.sealedModelMap);
  assert.equal(summary.status, 'SOL_REVIEWED');
  assert.deepEqual(summary.outcomeCounts, { TIE: 16 });
  assert.equal(summary.modelCriteria.max.naturalChinese.pass, 16);
  assert.equal(summary.modelCriteria.plus.noNewReason.fail, 0);
});
