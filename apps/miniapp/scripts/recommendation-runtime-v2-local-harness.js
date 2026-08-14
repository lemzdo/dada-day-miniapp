'use strict';

const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const {
  runRecommendationStylingShadowV2Safely,
} = require('../cloudfunctions/generateOutfit/services/recommendationStylingShadowV2');
const {
  attachRecommendationCanonicalCopiesV2,
  buildRecommendationCanonicalCopyBatchV2,
} = require('../cloudfunctions/generateOutfit/services/recommendationCanonicalCopyRuntimeV2');

const DEFAULT_BATCH_SIZES = Object.freeze([1, 4, 7, 8]);

function loadGenerateOutfitInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'local-harness',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'runtime-v2-local-harness' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('../cloudfunctions/generateOutfit/index.js')];
    return require('../cloudfunctions/generateOutfit/index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function runRuntimeV2LocalHarness({
  iterations = 100,
  coldIterations = 5,
  warmupIterations = 5,
  batchSizes = DEFAULT_BATCH_SIZES,
} = {}) {
  const internals = loadGenerateOutfitInternals();
  const wardrobe = buildWardrobe();
  const results = [];
  for (const batchSize of batchSizes) {
    const coldSamples = Array.from({ length: coldIterations }, () => (
      runSample(loadGenerateOutfitInternals(), wardrobe, batchSize)
    ));
    for (let index = 0; index < warmupIterations; index += 1) {
      runSample(internals, wardrobe, batchSize);
    }
    const samples = Array.from({ length: iterations }, () => runSample(internals, wardrobe, batchSize));
    results.push({
      ...summarizeSamples(batchSize, samples),
      coldFullCompute: summarizeComputeSamples(coldSamples),
      warmFullCompute: summarizeComputeSamples(samples),
      hotSnapshotRead: summarizeMetric(samples.map((sample) => sample.tReadMs)),
    });
  }
  return {
    version: 'recommendation-runtime-v2-local-harness-v1',
    scope: {
      tRead: 'JSON decode + complete batch/count/copy validation of a local hot snapshot',
      tCore: 'current rule recommendation core through Narrative Plans Ready',
      tSafe: 'Narrative Plans Ready through deterministic Canonical Safe Copy Ready',
      tAi: 'omitted; provider is outside the necessary first-screen path',
      excludes: ['cloud transport', 'real database latency', 'snapshot persistence', 'image paint'],
    },
    iterations,
    coldIterations,
    warmupIterations,
    results,
  };
}

function summarizeComputeSamples(samples) {
  return {
    sampleCount: samples.length,
    tCore: summarizeMetric(samples.map((sample) => sample.tCoreMs)),
    tSafe: summarizeMetric(samples.map((sample) => sample.tSafeMs)),
    tCorePlusSafe: summarizeMetric(samples.map((sample) => sample.tCorePlusSafeMs)),
  };
}

function runSample(internals, wardrobe, requestedBatchSize) {
  const timings = {};
  const coreStartedAt = performance.now();
  const recommendations = internals.generateRuleRecommendations({
    clothes: wardrobe,
    scene: '上班',
    weather: { temp: 20, weather: 'clear', mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: buildProfile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: requestedBatchSize,
    debugRecommendationAudit: false,
    timings,
  });
  const styling = runRecommendationStylingShadowV2Safely({
    recommendations,
    scene: '上班',
    weather: { temp: 20, weather: 'clear', mode: 'live' },
    recommendationInstanceSeed: 'runtime-v2-local-harness',
  });
  const tCoreMs = performance.now() - coreStartedAt;

  const safeStartedAt = performance.now();
  const copyBatch = buildRecommendationCanonicalCopyBatchV2({
    plans: styling.plans,
    recommendations,
    aiMaterializationRequested: true,
  });
  const outfits = attachRecommendationCanonicalCopiesV2(recommendations, copyBatch, styling.plans);
  const tSafeMs = performance.now() - safeStartedAt;
  assertCompleteBatch(outfits, recommendations.countContract);

  const snapshotJson = JSON.stringify({
    outfits,
    countContract: recommendations.countContract,
  });
  const readStartedAt = performance.now();
  const restored = JSON.parse(snapshotJson);
  assertCompleteBatch(restored.outfits, restored.countContract);
  const tReadMs = performance.now() - readStartedAt;
  return {
    returnedBatchSize: outfits.length,
    tReadMs,
    tCoreMs,
    tSafeMs,
    tCorePlusSafeMs: tCoreMs + tSafeMs,
  };
}

function summarizeSamples(requestedBatchSize, samples) {
  const returnedCounts = [...new Set(samples.map((sample) => sample.returnedBatchSize))];
  if (returnedCounts.length !== 1) throw new Error('RUNTIME_V2_BATCH_COUNT_UNSTABLE');
  return {
    requestedBatchSize,
    returnedBatchSize: returnedCounts[0],
    sampleCount: samples.length,
    tRead: summarizeMetric(samples.map((sample) => sample.tReadMs)),
    tCore: summarizeMetric(samples.map((sample) => sample.tCoreMs)),
    tSafe: summarizeMetric(samples.map((sample) => sample.tSafeMs)),
    tCorePlusSafe: summarizeMetric(samples.map((sample) => sample.tCorePlusSafeMs)),
  };
}

function summarizeMetric(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return {
    p50Ms: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    minMs: round(sorted[0] || 0),
    maxMs: round(sorted.at(-1) || 0),
  };
}

function quantile(sorted, probability) {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(probability * sorted.length) - 1);
  return sorted[index];
}

function assertCompleteBatch(outfits, countContract) {
  if (!Array.isArray(outfits)) throw new Error('RUNTIME_V2_BATCH_MISSING');
  const total = outfits.length;
  if (Number(countContract?.returnedCardCount) !== total) throw new Error('RUNTIME_V2_COUNT_CONTRACT');
  if (outfits.some((outfit, index) => (
    outfit?.canonicalRecommendationCopyV2?.batchIndex !== index
    || outfit?.canonicalRecommendationCopyV2?.batchTotal !== total
    || !outfit?.canonicalRecommendationCopyV2?.text
  ))) throw new Error('RUNTIME_V2_CANONICAL_COPY_INCOMPLETE');
}

function buildProfile() {
  return {
    styleTags: [],
    colorPreference: [],
    avoidTags: [],
    fitPreference: 'unknown',
    genderPreference: 'unknown',
    temperatureSensitivity: 'normal',
  };
}

function buildWardrobe() {
  return [
    ...Array.from({ length: 5 }, (_, index) => item(`top-${index}`, 'top', `office shirt ${index}`)),
    ...Array.from({ length: 8 }, (_, index) => item(`bottom-${index}`, 'bottom', `straight pants ${index}`, {
      pantsLength: 'long',
      fit: 'straight',
    })),
    ...Array.from({ length: 4 }, (_, index) => item(`shoe-${index}`, 'shoes', `loafer shoes ${index}`, {
      shoeType: 'loafer',
    })),
    ...Array.from({ length: 4 }, (_, index) => item(`dress-${index}`, 'onepiece', `office dress ${index}`)),
  ];
}

function item(id, category, subcategory, extra = {}) {
  return {
    _id: id,
    _openid: 'runtime-v2-local-harness',
    status: 'active',
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
    aestheticFeatures: {
      fit: 'regular',
      length: 'regular',
      silhouette: 'regular',
      patternType: 'solid',
      designElements: [],
      formalityLevel: 3,
      confidence: {},
    },
    ...extra,
  };
}

function round(value) { return Math.round(value * 1000) / 1000; }

if (require.main === module) {
  const iterations = Math.max(1, Number(process.argv[2]) || 100);
  process.stdout.write(`${JSON.stringify(runRuntimeV2LocalHarness({ iterations }), null, 2)}\n`);
}

module.exports = {
  assertCompleteBatch,
  runRuntimeV2LocalHarness,
  summarizeMetric,
};
