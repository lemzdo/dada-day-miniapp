'use strict';
const crypto = require('node:crypto');
const CRITERIA = Object.freeze([
  'meaningPreserved', 'noNewStylingReason', 'noUnauthorizedClaim', 'primaryNatural',
  'baselineNatural', 'friendLike', 'notTemplated', 'noCrossPlanContamination',
]);
function blindReview(artifact) {
  const entries = [];
  const modelMapEntries = [];
  for (const row of artifact.records || []) if (row.mode === 'single') {
    const batch = (artifact.records || []).find((candidate) => candidate.scene === row.scene && candidate.repetition === row.repetition && candidate.mode === 'batch');
    if (!batch) continue;
    const swap = crypto.createHash('sha256').update(`${row.scene}:${row.repetition}`).digest()[0] % 2 === 0;
    entries.push({ reviewId: `${row.scene}:r${row.repetition}`, scene: row.scene, repetition: row.repetition, candidates: swap ? [{ label: 'A', ...pick(row) }, { label: 'B', ...pick(batch) }] : [{ label: 'A', ...pick(batch) }, { label: 'B', ...pick(row) }], judgment: null });
    modelMapEntries.push([`${row.scene}:r${row.repetition}`, swap
      ? { A: 'single', B: 'batch' }
      : { A: 'batch', B: 'single' }]);
  }
  return {
    review: { version: 'voice-renderer-v2-shadow-review-v1', criteria: CRITERIA.slice(), entries },
    sealedModelMap: Object.fromEntries(modelMapEntries),
  };
}
function pick(row) { return { planCount: row.planCount, renderedCount: row.renderedCount, requestCount: row.requestCount, latencyMs: row.latencyMs, providerLatencyMs: row.providerLatencyMs, usage: row.usage, automatedContract: row.automatedContract, reviewCases: row.reviewCases }; }
function finalizeReview(review) { if (!review?.entries?.length || review.entries.some((entry) => !entry.judgment || CRITERIA.some((criterion) => typeof entry.judgment[criterion] !== 'boolean'))) throw new Error('REVIEW_INCOMPLETE'); return { version: 'voice-renderer-v2-shadow-review-summary-v1', status: 'REVIEWED', judgments: review.entries.map((entry) => ({ reviewId: entry.reviewId, judgment: entry.judgment })) }; }
module.exports = { CRITERIA, blindReview, finalizeReview };
