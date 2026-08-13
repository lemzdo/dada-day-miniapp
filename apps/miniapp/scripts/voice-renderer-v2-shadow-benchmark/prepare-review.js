'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { blindReview } = require('./review');
const { summarize } = require('./report');

function prepareReview(directory = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-shadow-benchmark')) {
  const rawFile = path.join(directory, 'raw-runs.json');
  const artifact = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
  if (artifact?.status !== 'complete') throw new Error('RAW_RUNS_INCOMPLETE');
  const prepared = blindReview(artifact);
  const report = summarize(artifact);
  fs.writeFileSync(path.join(directory, 'sol-blind-review.json'), `${JSON.stringify(prepared.review, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(directory, '.sealed-mode-map.json'), `${JSON.stringify(prepared.sealedModelMap, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(directory, 'benchmark-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { reviewEntries: prepared.review.entries.length, reportRecords: report.recordCount };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(prepareReview(), null, 2)}\n`);
}

module.exports = { prepareReview };
