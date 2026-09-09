/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const assert = require('node:assert/strict');
const test = require('node:test');

const { benchmarkWardrobe, runScalingBenchmark } = require('./recommendationScalingBenchmark');

test('30 and 100 run bounded legacy full benchmark with required metrics', () => {
  for (const size of [30, 100]) {
    const result = benchmarkWardrobe(size, { runs: 1 });
    assert.equal(result.mode, 'legacy-full');
    assert.equal(result.wardrobeCount, size);
    assert.ok(result.rawCombinationCount > 0);
    assert.ok(result.actualCandidateCount > 0);
    assert.ok(result.weatherEvalCount >= result.actualCandidateCount);
    assert.ok(result.sceneRuleEvalCount >= result.actualCandidateCount);
    assert.ok(result.acceptedCount + result.hardRejectCount === result.actualCandidateCount);
    assert.equal(result.scoringCount, result.acceptedCount);
    assert.ok(Number.isFinite(result.coreP50Ms));
    assert.ok(Number.isFinite(result.coreP95Ms));
    assert.ok(result.heapPeakBytes > 0);
  }
});

test('300 and 500 default to allocation-free count-only probes', () => {
  for (const size of [300, 500]) {
    const result = benchmarkWardrobe(size, { runs: 2 });
    assert.equal(result.mode, 'count-only');
    assert.equal(result.wardrobeCount, size);
    assert.equal(result.rawCombinationCount, result.actualCandidateCount);
    assert.equal(result.acceptedCount, null);
    assert.equal(result.scoringCount, null);
    assert.equal(result.eligibilityP50Ms, 0);
    assert.equal(result.eligibilityP95Ms, 0);
  }
});

test('scaling benchmark returns all required sizes without materializing 300/500 candidates', () => {
  const results = runScalingBenchmark({ runs: 1 });
  assert.deepEqual(results.map((result) => result.wardrobeCount), [30, 100, 300, 500]);
  assert.deepEqual(results.map((result) => result.mode), ['legacy-full', 'legacy-full', 'count-only', 'count-only']);
});
