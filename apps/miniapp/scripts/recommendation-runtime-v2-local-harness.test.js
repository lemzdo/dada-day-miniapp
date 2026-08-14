'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertCompleteBatch,
  runRuntimeV2LocalHarness,
  summarizeMetric,
} = require('./recommendation-runtime-v2-local-harness');

test('local runtime harness fixes complete batch total for 1, 4, 7, and 8 cards', () => {
  const report = runRuntimeV2LocalHarness({ iterations: 3, coldIterations: 2, warmupIterations: 1 });
  assert.equal(report.scope.tAi.includes('outside'), true);
  assert.deepEqual(report.results.map((entry) => entry.requestedBatchSize), [1, 4, 7, 8]);
  assert.deepEqual(report.results.map((entry) => entry.returnedBatchSize), [1, 4, 7, 8]);
  assert.equal(report.results.every((entry) => entry.tCore.p95Ms >= 0), true);
  assert.equal(report.results.every((entry) => entry.tSafe.p95Ms >= 0), true);
  assert.equal(report.results.every((entry) => entry.tRead.p95Ms >= 0), true);
  assert.equal(report.results.every((entry) => entry.coldFullCompute.sampleCount === 2), true);
  assert.equal(report.results.every((entry) => entry.warmFullCompute.sampleCount === 3), true);
});

test('harness statistics use nearest-rank P50 and P95', () => {
  assert.deepEqual(summarizeMetric([1, 2, 3, 4, 5]), {
    p50Ms: 3,
    p95Ms: 5,
    minMs: 1,
    maxMs: 5,
  });
});

test('hot snapshot validation rejects mutable totals and blank copy', () => {
  assert.throws(() => assertCompleteBatch([{
    canonicalRecommendationCopyV2: { batchIndex: 0, batchTotal: 2, text: 'copy' },
  }], { returnedCardCount: 1 }), /RUNTIME_V2_CANONICAL_COPY_INCOMPLETE/);
  assert.throws(() => assertCompleteBatch([{
    canonicalRecommendationCopyV2: { batchIndex: 0, batchTotal: 1, text: '' },
  }], { returnedCardCount: 1 }), /RUNTIME_V2_CANONICAL_COPY_INCOMPLETE/);
});
