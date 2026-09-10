'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SAMPLE_COUNT, summarize, validateTiming } = require('./today-first-card-visible-acceptance');

test('acceptance is fixed to exactly three valid samples', () => {
  assert.equal(SAMPLE_COUNT, 3);
  assert.deepEqual(summarize([2200.3334, 1800.1114, 2000.2224]), {
    min: 1800.111,
    median: 2000.222,
    max: 2200.333,
  });
  assert.throws(() => summarize([1000, 2000]), /VISIBLE_SAMPLE_COUNT_INVALID/);
});

test('visible timing requires one ordered monotonic client timeline', () => {
  assert.doesNotThrow(() => validateTiming({
    auditId: 'audit-1', seq: 1, batchId: 'batch-1', outfitKey: 'outfit-1',
    clientResponseReceivedMs: 1400, stateCommitMs: 1450, contentVisibleMs: 1500,
    imageLoadMs: 1510, imageVisibleMs: 1520,
  }));
  assert.throws(() => validateTiming({
    auditId: 'audit-1', seq: 1, batchId: 'batch-1', outfitKey: 'outfit-1',
    clientResponseReceivedMs: 1400, stateCommitMs: 1300, contentVisibleMs: 1500,
    imageLoadMs: 1510, imageVisibleMs: 1520,
  }), /VISIBLE_TIMING_INVARIANT_FAILED/);
});
