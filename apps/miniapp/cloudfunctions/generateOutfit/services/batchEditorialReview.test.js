const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BATCH_EDITORIAL_FLAGS,
  reviewBatchEditorialNaturalness,
  selectBatchEditorialCandidates,
} = require('./batchEditorialReview');
const { buildPresentationPlan } = require('./presentationFactModel');

function relation(code, roles, suffix) {
  return {
    relationCode: code,
    roles,
    authorizedValues: roles,
    subjectItemIds: roles.map((role) => `${role}-${suffix}`),
    evidenceFactIds: roles.map((role) => `item:${role}-${suffix}:color`),
  };
}

function model(index) {
  const suffix = String(index);
  return {
    scene: 'sport',
    items: [
      { role: 'top', itemId: `top-${suffix}`, canonicalSubtype: '运动上衣', canonicalName: '运动上衣', normalizedColor: index % 2 ? '白色' : '绿色', visibleFeatureTags: [] },
      { role: 'bottom', itemId: `bottom-${suffix}`, canonicalSubtype: '运动短裤', canonicalName: '运动短裤', normalizedColor: '灰色', visibleFeatureTags: [] },
      { role: 'shoes', itemId: `shoes-${suffix}`, canonicalSubtype: '运动鞋', canonicalName: '运动鞋', normalizedColor: index % 2 ? '白色' : '灰色', visibleFeatureTags: [] },
    ],
    relations: [
      relation(index % 2 ? 'COLOR_ECHO_TOP_SHOES' : 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', index % 2 ? 'shoes' : 'bottom'], suffix),
      relation('NEUTRAL_COLOR_BRIDGE', ['bottom', 'shoes'], suffix),
    ],
    availableDifferentiators: [],
    qualification: {
      reasonCode: 'SPORT_LIGHT_ACTIVITY_SET',
      subjectItemIds: [`top-${suffix}`, `bottom-${suffix}`, `shoes-${suffix}`],
      supportingFactIds: [`item:top-${suffix}:sport_top`, `item:bottom-${suffix}:sport_bottom`, `item:shoes-${suffix}:sport_shoe`],
      relationFactIds: [],
      evidence: [
        { factId: `item:top-${suffix}:sport_top`, fact: 'category', itemId: `top-${suffix}` },
        { factId: `item:bottom-${suffix}:sport_bottom`, fact: 'sport_bottom', itemId: `bottom-${suffix}` },
        { factId: `item:shoes-${suffix}:sport_shoe`, fact: 'sport_shoe', itemId: `shoes-${suffix}` },
      ],
    },
  };
}

test('BATCH_EDITORIAL_REVIEW chooses evidence variation deterministically and passes structurally', () => {
  const models = Array.from({ length: 8 }, (_, index) => model(index));
  const selection = selectBatchEditorialCandidates(models);
  const plans = models.map((entry, index) => buildPresentationPlan(entry, {
    selectedMessageCandidateId: selection.selectedCandidateIds[index],
  }).reasonClaim.copyPlan);
  const review = reviewBatchEditorialNaturalness(plans, selection.candidatePools);
  assert.equal(review.result, 'PASS', review.riskFlags.join(','));
  assert.ok(review.metrics.distinctIntentCount >= 3);
  assert.ok(review.metrics.distinctOpeningCount >= 2);
  const sceneEvidenceCount = selection.selectedCandidates
    .filter((candidate) => candidate.authorizationIds.length > 0).length;
  assert.ok(sceneEvidenceCount >= 2, 'the batch must retain representative scene evidence');
  assert.ok(sceneEvidenceCount <= 4, 'the same scene boundary must not dominate the whole batch');
  assert.ok(selection.selectedCandidates.some((candidate) => candidate.source === 'style_insight'));
  assert.deepEqual(
    selectBatchEditorialCandidates(models).selectedCandidateIds,
    selection.selectedCandidateIds,
  );
});

test('BATCH_EDITORIAL_REVIEW rejects avoidable repeated copy and template name replacement', () => {
  const models = Array.from({ length: 8 }, (_, index) => model(index));
  const selection = selectBatchEditorialCandidates(models);
  const repeated = models.map((entry) => buildPresentationPlan(entry, {
    selectedMessageCandidateId: selection.candidatePools[0][0].candidateId,
  }).reasonClaim.copyPlan);
  const review = reviewBatchEditorialNaturalness(repeated, selection.candidatePools);
  assert.equal(review.result, 'REJECT');
  assert.ok(review.riskFlags.some((flag) => [
    BATCH_EDITORIAL_FLAGS.AVOIDABLE_EXACT_DUPLICATE,
    BATCH_EDITORIAL_FLAGS.AVOIDABLE_TEMPLATE_NAME_SWAP,
  ].includes(flag)));
});

test('identical facts with no alternative message are allowed to remain identical', () => {
  const onlyCandidateModels = Array.from({ length: 8 }, (_, index) => ({
    ...model(index),
    relations: [],
  }));
  const selection = selectBatchEditorialCandidates(onlyCandidateModels);
  const plans = onlyCandidateModels.map((entry, index) => buildPresentationPlan(entry, {
    selectedMessageCandidateId: selection.selectedCandidateIds[index],
  }).reasonClaim.copyPlan);
  const review = reviewBatchEditorialNaturalness(plans, selection.candidatePools);
  assert.equal(review.result, 'PASS', review.riskFlags.join(','));
  assert.ok(review.metrics.exactDuplicateCount > 0);
});
