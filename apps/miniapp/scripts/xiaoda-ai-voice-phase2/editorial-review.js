'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REVIEW_FIELDS = Object.freeze(['id','rawReason','factsCorrect','bindingCorrect','unsupportedClaim','primaryInsightContinuity','sceneRelevance','weatherRelevance','humanChinese','xiaodaPersona','informationValue','overExplanation','algorithmLeakage','verdict','solNotes']);
const HUMAN_REVIEWED = 'HUMAN_REVIEWED';
const blank = (id) => ({ id, rawReason: '', factsCorrect: null, bindingCorrect: null, unsupportedClaim: null, primaryInsightContinuity: null, sceneRelevance: null, weatherRelevance: null, humanChinese: null, xiaodaPersona: null, informationValue: null, overExplanation: null, algorithmLeakage: null, verdict: '', solNotes: '', reviewStatus: HUMAN_REVIEWED });

function scaffold(artifactDir) {
  const dir = path.resolve(artifactDir); const dev = JSON.parse(fs.readFileSync(path.join(dir, '03-development.json'), 'utf8')); const hold = JSON.parse(fs.readFileSync(path.join(dir, '04-holdout-sealed.json'), 'utf8'));
  const document = { version: 'xiaoda-ai-voice-phase2-editorial-review-v1', reviewStatus: HUMAN_REVIEWED, attempt: 0, changeHypothesis: '', changedLayer: '', before: '', after: '', solJudgment: '', freezeApproved: false, developmentReviews: dev.fixtures.map((x) => blank(x.id)), holdoutReviews: hold.fixtures.map((x) => blank(x.id)), holdoutSelection: { worst5: [], best8: [], crossSceneExample: null } };
  fs.writeFileSync(path.join(dir, '07-editorial-review.json'), `${JSON.stringify(document, null, 2)}\n`); return document;
}

function validateReview(document, options = {}) {
  const failures = []; if (!document || document.reviewStatus !== HUMAN_REVIEWED) failures.push('HUMAN_REVIEWED_REQUIRED');
  for (const key of ['objectiveChecksPass','automaticOnly','autoApproved','gateResult']) if (Object.prototype.hasOwnProperty.call(document || {}, key)) failures.push('AUTOMATIC_GATE_FORBIDDEN');
  const expected = options.expected || (options.kind === 'holdout' ? 16 : 20); const reviews = options.reviews || (options.kind === 'holdout' ? document?.holdoutReviews : document?.developmentReviews) || [];
  if (reviews.length !== expected) failures.push('COUNT_INVALID'); const ids = new Set();
  for (const review of reviews) { if (!review || REVIEW_FIELDS.some((field) => !(field in review))) { failures.push(`FIELDS_INCOMPLETE:${review?.id || 'unknown'}`); continue; } if (ids.has(review.id)) failures.push(`DUPLICATE_ID:${review.id}`); ids.add(review.id); if (review.reviewStatus && review.reviewStatus !== HUMAN_REVIEWED) failures.push(`REVIEW_STATUS:${review.id}`); if (!review.rawReason || typeof review.verdict !== 'string' || !review.verdict || typeof review.solNotes !== 'string' || !review.solNotes) failures.push(`REVIEW_INCOMPLETE:${review.id}`); for (const field of REVIEW_FIELDS.slice(2, 13)) if (typeof review[field] !== 'boolean') failures.push(`BOOLEAN_REQUIRED:${review.id}:${field}`); }
  if (options.kind === 'holdout') { const sel = document?.holdoutSelection || {}; if (!Array.isArray(sel.worst5) || sel.worst5.length !== 5 || !Array.isArray(sel.best8) || sel.best8.length !== 8 || typeof sel.crossSceneExample !== 'string' || !sel.crossSceneExample) failures.push('HOLDOUT_SELECTION_INVALID'); }
  if (options.requireFreezeApproval && document.freezeApproved !== true) failures.push('FREEZE_APPROVAL_REQUIRED');
  return { pass: failures.length === 0, failures: [...new Set(failures)] };
}

function validateEditorialReviewFile(file, options = {}) { return validateReview(JSON.parse(fs.readFileSync(file, 'utf8')), options); }
if (require.main === module) { const dir = path.resolve(process.argv[2]); if (process.argv.includes('--scaffold')) scaffold(dir); else { const result = validateEditorialReviewFile(path.join(dir, '07-editorial-review.json')); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.pass ? 0 : 1; } }
module.exports = { HUMAN_REVIEWED, REVIEW_FIELDS, scaffold, validateReview, validateEditorialReviewFile };
