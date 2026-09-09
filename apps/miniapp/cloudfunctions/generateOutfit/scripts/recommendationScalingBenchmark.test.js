const assert = require('node:assert/strict');
const test = require('node:test');

const { benchmarkHierarchicalWardrobe, benchmarkWardrobe, runHierarchicalScalingBenchmark, runScalingBenchmark } = require('./recommendationScalingBenchmark');
const { buildWorstCaseWardrobe } = require('../services/recommendationScalingFixtures');

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

test('hierarchical engine runs full bounded benchmark at every required size', () => {
  for (const size of [30, 100, 300, 500]) {
    const result = benchmarkHierarchicalWardrobe(size, { runs: 1 });
    assert.equal(result.mode, 'production-hierarchical-full');
    assert.equal(result.wardrobeCount, size);
    assert.ok(result.skeletonExpansionCount > 0);
    assert.ok(result.structuralExpansionCount >= 0);
    assert.ok(result.structuralExpansionCount <= result.budget.structuralExpansionBudget);
    assert.ok(result.accessoryBeamExpansionCount >= 0);
    assert.ok(result.fullCandidateCount >= 0);
    assert.equal(result.acceptedCount, result.scoringCount);
    assert.ok(result.reservoirCount <= result.acceptedCount);
    assert.ok(result.reservoirCount <= result.budget.reservoirCapacity);
    assert.ok(result.structuralExpansionCount <= result.budget.structuralExpansionBudget);
    assert.ok(result.accessoryBeamExpansionCount <= result.budget.accessoryExpansionBudget);
    assert.ok(result.fullCandidateCount <= result.budget.hardCandidateLimit);
    assert.ok(Number.isFinite(result.coreP95Ms));
    assert.ok(Number.isFinite(result.eligibilityP95Ms));
    assert.ok(Number.isFinite(result.scoringP50Ms));
    assert.ok(Number.isFinite(result.scoringP95Ms));
    assert.ok(result.heapPeakBytes > 0);
    assert.ok(result.heapDeltaPeakBytes >= 0);
  }
});

test('hierarchical full candidate count stays budget-bounded as wardrobe grows', () => {
  const results = runHierarchicalScalingBenchmark({ runs: 1 });
  assert.deepEqual(results.map((result) => result.wardrobeCount), [30, 100, 300, 500]);
  assert.ok(results.every((result) => result.fullCandidateCount <= result.budget.hardCandidateLimit));
  assert.ok(results.every((result) => result.structuralExpansionCount <= result.budget.structuralExpansionBudget));
  assert.ok(results[3].fullCandidateCount < 1442400);
  assert.ok(results[3].skeletonExpansionCount <= results[3].budget.skeletonExpansionBudget * 4);
});

test('500-item worst-case role concentration remains inside the same bounded production envelope', () => {
  const result = benchmarkHierarchicalWardrobe(500, { runs: 1, wardrobe: buildWorstCaseWardrobe(500) });
  assert.ok(result.fullCandidateCount <= result.budget.hardCandidateLimit);
  assert.ok(result.structuralExpansionCount <= result.budget.structuralExpansionBudget);
  assert.ok(result.skeletonExpansionCount <= result.budget.skeletonExpansionBudget * 4);
  assert.equal(result.selectedCount, 8);
});
