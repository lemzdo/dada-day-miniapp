/* eslint-disable @typescript-eslint/no-require-imports */
/* global global, module, process, require */
const { performance } = require('node:perf_hooks');

const { buildOutfitCandidatesV1 } = require('../services/outfitCompositionV1');
const { applyWearabilityAndSceneEligibility } = require('../services/sceneEligibilityV3');
const {
  buildScalingWardrobe,
  countRoleDistribution,
  rawCombinationCount,
} = require('../services/recommendationScalingFixtures');

const PROFILE = Object.freeze({ styleTags: [], colorPreference: [], avoidTags: [], preferredStyles: [] });

function percentile(values, ratio) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function runLegacyOnce(clothes, scene = 'work') {
  const started = performance.now();
  const candidates = buildOutfitCandidatesV1({
    clothes,
    scene,
    weather: {},
    weatherMode: 'unavailable',
    recommendationProfile: PROFILE,
    returnRawCandidates: true,
  });
  const coreMs = performance.now() - started;
  const eligibilityStarted = performance.now();
  const guard = applyWearabilityAndSceneEligibility(candidates, {
    scene,
    weather: {},
    recommendationProfile: PROFILE,
  });
  const eligibilityMs = performance.now() - eligibilityStarted;
  return {
    rawCandidateCount: rawCombinationCount(countRoleDistribution(clothes), scene),
    actualCandidateCount: candidates.length,
    weatherEvalCount: candidates.length,
    sceneRuleEvalCount: candidates.length,
    hardRejectCount: guard.rejected.length,
    acceptedCount: guard.accepted.length,
    scoringCount: guard.accepted.length,
    selectedCount: Math.min(8, guard.accepted.length),
    coreMs,
    eligibilityMs,
  };
}

function runCountOnlyProbe(clothes, scene = 'work') {
  const started = performance.now();
  const roleCounts = countRoleDistribution(clothes);
  const rawCount = rawCombinationCount(roleCounts, scene);
  const elapsedMs = performance.now() - started;
  return {
    rawCandidateCount: rawCount,
    actualCandidateCount: rawCount,
    weatherEvalCount: rawCount,
    sceneRuleEvalCount: rawCount,
    hardRejectCount: null,
    acceptedCount: null,
    scoringCount: null,
    selectedCount: Math.min(8, rawCount),
    coreMs: elapsedMs,
    eligibilityMs: null,
  };
}

function benchmarkWardrobe(size, options = {}) {
  const mode = options.mode || (size <= 100 ? 'legacy-full' : 'count-only');
  const clothes = options.wardrobe || buildScalingWardrobe(size, { prefix: options.prefix });
  const runs = Math.max(1, Number(options.runs || 3));
  const samples = [];
  let heapPeak = 0;
  for (let index = 0; index < runs; index += 1) {
    const sample = mode === 'legacy-full' ? runLegacyOnce(clothes, options.scene) : runCountOnlyProbe(clothes, options.scene);
    samples.push(sample);
    heapPeak = Math.max(heapPeak, Number(process.memoryUsage().heapUsed) || 0);
  }
  const last = samples[samples.length - 1];
  return {
    mode,
    wardrobeCount: clothes.length,
    roleCounts: countRoleDistribution(clothes),
    rawCombinationCount: last.rawCandidateCount,
    actualCandidateCount: last.actualCandidateCount,
    weatherEvalCount: last.weatherEvalCount,
    sceneRuleEvalCount: last.sceneRuleEvalCount,
    hardRejectCount: last.hardRejectCount,
    acceptedCount: last.acceptedCount,
    scoringCount: last.scoringCount,
    selectedCount: last.selectedCount,
    coreP50Ms: percentile(samples.map((sample) => sample.coreMs), 0.5),
    coreP95Ms: percentile(samples.map((sample) => sample.coreMs), 0.95),
    eligibilityP50Ms: percentile(samples.map((sample) => sample.eligibilityMs).filter(Number.isFinite), 0.5),
    eligibilityP95Ms: percentile(samples.map((sample) => sample.eligibilityMs).filter(Number.isFinite), 0.95),
    heapPeakBytes: heapPeak,
    gcTrend: typeof global.gc === 'function' ? 'available; invoke with --expose-gc for controlled runs' : 'unavailable',
  };
}

function runScalingBenchmark(options = {}) {
  const sizes = options.sizes || [30, 100, 300, 500];
  return sizes.map((size) => benchmarkWardrobe(size, options));
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(runScalingBenchmark(), null, 2)}\n`);
}

module.exports = { benchmarkWardrobe, runCountOnlyProbe, runLegacyOnce, runScalingBenchmark };
