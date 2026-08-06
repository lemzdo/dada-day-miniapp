// Run from the repository root with `node apps/miniapp/cloudfunctions/generateOutfit/scripts/itemFactsBenchmark.js`.
// The benchmark uses only deterministic synthetic wardrobe data and writes results to stdout.

const { performance } = require('node:perf_hooks');
const Module = require('node:module');

const { buildQaAuditSummaries } = require('../services/qaBatchAudit');
const { compileRecommendationLanguageV3 } = require('../services/recommendationLanguageV3');
const { buildCandidatePoolIdentity, createCandidatePoolRecord } = require('../services/candidatePool');

function loadGenerateOutfitInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'benchmark',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'item-facts-benchmark-user' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('../index.js')];
    return require('../index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function item(id, category, subcategory, extra = {}) {
  return {
    _id: id,
    category,
    type: category,
    subcategory,
    subCategory: subcategory,
    customName: subcategory,
    styleTags: ['simple'],
    sceneTags: ['work'],
    seasonTags: [],
    colorPalette: [{ name: 'black', hex: '#111111' }],
    confidence: 0.9,
    ...extra,
  };
}

function wardrobe() {
  return [
    ...Array.from({ length: 5 }, (_, index) => item(`top-${index}`, 'top', `office simple shirt ${index}`)),
    ...Array.from({ length: 8 }, (_, index) => item(`bottom-${index}`, 'bottom', `straight long pants ${index}`, { pantsLength: 'long', fit: 'straight' })),
    ...Array.from({ length: 4 }, (_, index) => item(`shoe-${index}`, 'shoes', `simple loafer shoes ${index}`, { shoeType: 'loafer' })),
    ...Array.from({ length: 6 }, (_, index) => item(`coat-${index}`, 'outerwear', `office blazer ${index}`)),
    ...Array.from({ length: 4 }, (_, index) => item(`accessory-${index}`, 'accessory', `accent bag ${index}`, {
      colorPalette: [{ name: 'red', hex: '#ff0000' }],
    })),
    ...Array.from({ length: 4 }, (_, index) => item(`dress-${index}`, 'onepiece', `simple office dress ${index}`)),
  ];
}

function profile() {
  return {
    styleTags: [], colorPreference: [], avoidTags: [], fitPreference: 'unknown', genderPreference: 'unknown', temperatureSensitivity: 'normal',
  };
}

function runOnce(internals, debugRecommendationAudit) {
  const instrumentation = { counters: {}, timings: {} };
  const timings = {
    compositionMs: 0,
    canonicalizeMs: 0,
    eligibilityMs: 0,
    scoringMs: 0,
    batchSelectionMs: 0,
    cardCompilationMs: 0,
    qaAuditMs: 0,
    serializationMs: 0,
    totalMs: 0,
  };
  const startedAt = performance.now();
  const recommendations = internals.generateRuleRecommendations({
    clothes: wardrobe(),
    scene: 'work',
    weather: { temp: 20, weather: 'clear', mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
    debugRecommendationAudit,
    timings,
    testInstrumentation: instrumentation,
  });
  const cardStartedAt = performance.now();
  const compiledOutfits = compileRecommendationLanguageV3({
    outfits: recommendations.map((candidate, index) => internals.toTempOutfit(candidate, {
      openid: 'item-facts-benchmark-user',
      scene: 'work',
      targetDate: '2026-07-20',
      timeOfDay: 'all_day',
      weather: { temp: 20, weather: 'clear' },
      now: '2026-07-20T08:00:00.000Z',
      recommendationBatchId: `benchmark-${index}`,
      instrumentation,
    })),
    scene: 'work',
    weather: { temp: 20, weather: 'clear' },
    instrumentation,
  });
  timings.cardCompilationMs = Math.round(performance.now() - cardStartedAt);
  if (debugRecommendationAudit) {
    const qaStartedAt = performance.now();
    buildQaAuditSummaries({
      guardAcceptedCandidates: recommendations.debug._auditGuardAcceptedCandidates,
      guardRejectedCandidates: recommendations.debug._auditGuardRejectedCandidates,
      selectedOutfits: recommendations,
      compiledOutfits,
      timings,
    });
    timings.qaAuditMs = Math.round(performance.now() - qaStartedAt);
  }
  timings.totalMs = Math.round(performance.now() - startedAt);
  return {
    candidateCount: recommendations.debug.candidateCount,
    acceptedCount: recommendations.debug.guardAcceptedCount,
    selectedCount: recommendations.length,
    timings: {
      ...timings,
      derivedFactsMs: instrumentation.timings.derivedFactsMs || 0,
      materializationMs: instrumentation.timings.materializationMs || 0,
    },
    fullMaterializationCount: instrumentation.counters.materializeCanonicalCandidate || 0,
  };
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function benchmark(internals, qaEnabled) {
  runOnce(internals, qaEnabled);
  const samples = Array.from({ length: 5 }, () => runOnce(internals, qaEnabled));
  const fields = [
    'compositionMs',
    'canonicalizeMs',
    'derivedFactsMs',
    'eligibilityMs',
    'scoringMs',
    'batchSelectionMs',
    'materializationMs',
    'totalMs',
  ];
  return {
    qaEnabled,
    runs: samples.length,
    itemCount: wardrobe().length,
    candidateCount: samples[0].candidateCount,
    acceptedCount: samples[0].acceptedCount,
    selectedCount: samples[0].selectedCount,
    fullMaterializationCount: median(samples.map((sample) => sample.fullMaterializationCount)),
    median: Object.fromEntries(fields.map((field) => [field, median(samples.map((sample) => sample.timings[field]))])),
  };
}

function benchmarkCandidatePoolRefreshes(internals) {
  const weather = { temp: 20, weather: 'clear', mode: 'live' };
  const recommendationProfile = profile();
  const clothes = wardrobe();
  const sourceCandidates = internals.generateRuleRecommendations({
    clothes,
    scene: 'work',
    weather,
    weatherMode: 'live',
    recommendationProfile,
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  });
  const candidatePool = createCandidatePoolRecord({
    candidatePoolId: 'benchmark-candidate-pool',
    identity: buildCandidatePoolIdentity({
      openid: 'item-facts-benchmark-user',
      clothes,
      sceneKey: 'work',
      weather,
      weatherMode: 'live',
      recommendationProfile,
      timeOfDay: 'all_day',
      engineVersion: 'benchmark',
    }),
    candidates: sourceCandidates.candidatePoolCandidates,
    now: Date.parse('2026-07-20T08:00:00.000Z'),
  });
  const runs = Array.from({ length: 3 }, (_, index) => {
    const startedAt = performance.now();
    const timings = {
      compositionMs: 0,
      canonicalizeMs: 0,
      eligibilityMs: 0,
      scoringMs: 0,
      batchSelectionMs: 0,
      exclusionMs: 0,
    };
    const refreshOutfits = internals.generateCandidatePoolRecommendations({
      pool: candidatePool,
      clothes,
      scene: 'work',
      weather,
      weatherMode: 'live',
      excludedOutfitKeys: candidatePool.candidates.slice(0, index).map((candidate) => candidate.stableSortId),
      excludeClothingIdSets: [],
      maxResults: 8,
      timings,
    });
    const cardStartedAt = performance.now();
    compileRecommendationLanguageV3({
      outfits: refreshOutfits.map((candidate, outfitIndex) => internals.toTempOutfit(candidate, {
        openid: 'item-facts-benchmark-user',
        scene: 'work',
        targetDate: '2026-07-20',
        timeOfDay: 'all_day',
        weather,
        now: '2026-07-20T08:00:00.000Z',
        recommendationBatchId: `benchmark-refresh-${index}-${outfitIndex}`,
        instrumentation: { counters: {}, timings: {} },
      })),
      scene: 'work',
      weather,
    });
    return {
      index: index + 1,
      excludedOutfitCount: index,
      selectedCount: refreshOutfits.length,
      cloudSelectionMs: Math.round(performance.now() - startedAt),
      cardCompilationMs: Math.round(performance.now() - cardStartedAt),
      timings,
    };
  });
  return {
    runs,
    maxCloudSelectionMs: Math.max(...runs.map((run) => run.cloudSelectionMs)),
    allCandidateRecomputeStagesSkipped: runs.every((run) => (
      run.timings.compositionMs === 0
      && run.timings.canonicalizeMs === 0
      && run.timings.eligibilityMs === 0
      && run.timings.scoringMs === 0
    )),
  };
}

const internals = loadGenerateOutfitInternals();
console.log(JSON.stringify({
  benchmark: 'generateOutfit-candidate-derived-facts-v1',
  qaDisabled: benchmark(internals, false),
  qaEnabled: benchmark(internals, true),
  candidatePoolRefreshes: benchmarkCandidatePoolRefreshes(internals),
}, null, 2));
