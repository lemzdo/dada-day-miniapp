'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildBlindReview, finalizeReview, summarizeRuns } = require('./review');

function prepareReview(directory = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab')) {
  const artifactFile = path.join(directory, 'raw-runs.json');
  const artifact = JSON.parse(fs.readFileSync(artifactFile, 'utf8'));
  const stability = summarizeRuns(artifact);
  const prepared = buildBlindReview(artifact);
  writeJson(path.join(directory, 'stability-summary.json'), stability);
  writeJson(path.join(directory, 'sol-blind-review.json'), prepared.review);
  writeJson(path.join(directory, '.sealed-model-map.json'), prepared.sealedModelMap);
  return { stability, review: prepared.review };
}

function finalizeReviewFile(directory = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab')) {
  const reviewFile = path.join(directory, 'sol-blind-review.json');
  const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
  const sealedModelMap = JSON.parse(fs.readFileSync(path.join(directory, '.sealed-model-map.json'), 'utf8'));
  const summary = finalizeReview(review, sealedModelMap);
  writeJson(path.join(directory, 'sol-review-summary.json'), summary);
  return summary;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  const action = process.argv[2] || 'prepare';
  const result = action === 'finalize' ? finalizeReviewFile() : prepareReview();
  process.stdout.write(`${JSON.stringify({ action, status: result.status || 'prepared' }, null, 2)}\n`);
}

module.exports = { finalizeReviewFile, prepareReview };
