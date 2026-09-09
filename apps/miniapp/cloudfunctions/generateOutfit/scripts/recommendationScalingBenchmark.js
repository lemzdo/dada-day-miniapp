const { performance } = require('node:perf_hooks');
const Module = require('node:module');

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
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
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

let cachedGenerateOutfitInternals;

function loadGenerateOutfitInternals() {
  if (cachedGenerateOutfitInternals) return cachedGenerateOutfitInternals;
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'benchmark',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'benchmark-openid' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('../index.js')];
    cachedGenerateOutfitInternals = require('../index.js').__test;
    return cachedGenerateOutfitInternals;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function runHierarchicalOnce(clothes, scene = 'work') {
  const internals = loadGenerateOutfitInternals();
  const timings = {};
  const started = performance.now();
  const recommendations = internals.generateRuleRecommendations({
    clothes,
    scene,
    weather: { temp: 20, weather: 'clear', mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: PROFILE,
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
    timings,
  });
  const totalMs = performance.now() - started;
  if (recommendations && typeof recommendations.then === 'function') {
    throw new Error('scaling benchmark requires the synchronous core path');
  }
  const d = recommendations.debug.search;
  return {
    rawCandidateCount: d.rawSkeletonCount,
    skeletonExpansionCount: d.partialSkeletonExpansionCount + d.fullSkeletonCount,
    structuralExpansionCount: d.structuralExpansionCount,
    accessoryBeamExpansionCount: d.accessoryBeamExpansionCount,
    fullCandidateCount: d.actualCandidateCount,
    weatherEvalCount: d.weatherEvalCount,
    sceneRuleEvalCount: d.sceneRuleEvalCount,
    hardRejectCount: recommendations.debug.guardRejectedCount,
    acceptedCount: recommendations.debug.guardAcceptedCount,
    scoringCount: recommendations.debug.guardAcceptedCount,
    reservoirCount: recommendations.candidatePoolCandidates.length,
    selectedCount: recommendations.length,
    coreMs: totalMs,
    eligibilityMs: Number(timings.eligibilityMs) || 0,
    scoringMs: Number(timings.scoringMs) || 0,
    diagnostics: d,
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

function benchmarkHierarchicalWardrobe(size, options = {}) {
  const clothes = options.wardrobe || buildScalingWardrobe(size, { prefix: options.prefix });
  const runs = Math.max(1, Number(options.runs || 3));
  const samples = [];
  let heapPeak = 0;
  let heapDeltaPeak = 0;
  for (let index = 0; index < runs; index += 1) {
    if (typeof global.gc === 'function') global.gc();
    const heapBefore = Number(process.memoryUsage().heapUsed) || 0;
    samples.push(runHierarchicalOnce(clothes, options.scene));
    const heapAfter = Number(process.memoryUsage().heapUsed) || 0;
    heapPeak = Math.max(heapPeak, heapAfter);
    heapDeltaPeak = Math.max(heapDeltaPeak, heapAfter - heapBefore);
  }
  const last = samples[samples.length - 1];
  return {
    mode: 'production-hierarchical-full',
    wardrobeCount: clothes.length,
    roleCounts: last.diagnostics.roleCounts,
    rawSkeletonCount: last.rawCandidateCount,
    skeletonExpansionCount: last.skeletonExpansionCount,
    structuralExpansionCount: last.structuralExpansionCount,
    accessoryBeamExpansionCount: last.accessoryBeamExpansionCount,
    fullCandidateCount: last.fullCandidateCount,
    weatherEvalCount: last.weatherEvalCount,
    sceneRuleEvalCount: last.sceneRuleEvalCount,
    hardRejectCount: last.hardRejectCount,
    acceptedCount: last.acceptedCount,
    scoringCount: last.scoringCount,
    reservoirCount: last.reservoirCount,
    selectedCount: last.selectedCount,
    coreP50Ms: percentile(samples.map((sample) => sample.coreMs), 0.5),
    coreP95Ms: percentile(samples.map((sample) => sample.coreMs), 0.95),
    eligibilityP50Ms: percentile(samples.map((sample) => sample.eligibilityMs), 0.5),
    eligibilityP95Ms: percentile(samples.map((sample) => sample.eligibilityMs), 0.95),
    scoringP50Ms: percentile(samples.map((sample) => sample.scoringMs), 0.5),
    scoringP95Ms: percentile(samples.map((sample) => sample.scoringMs), 0.95),
    heapPeakBytes: heapPeak,
    heapDeltaPeakBytes: heapDeltaPeak,
    gcTrend: typeof global.gc === 'function' ? 'controlled-between-samples' : 'unavailable',
    budget: last.diagnostics.budget,
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
module.exports.runHierarchicalOnce = runHierarchicalOnce;
module.exports.benchmarkHierarchicalWardrobe = benchmarkHierarchicalWardrobe;
module.exports.runHierarchicalScalingBenchmark = (options = {}) => (options.sizes || [30, 100, 300, 500])
  .map((size) => benchmarkHierarchicalWardrobe(size, options));
