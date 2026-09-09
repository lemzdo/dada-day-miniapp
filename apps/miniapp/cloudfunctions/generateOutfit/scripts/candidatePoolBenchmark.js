'use strict';

const { performance } = require('node:perf_hooks');
const Module = require('node:module');
const {
  buildCandidatePoolIdentity,
  buildCandidatePoolStoragePlan,
  createCandidatePoolRecord,
  hydrateCandidateCore,
  validateCandidatePoolStoragePlan,
} = require('../services/candidatePool');
const { buildScalingWardrobe } = require('../services/recommendationScalingFixtures');

const PROFILE = Object.freeze({ styleTags: [], colorPreference: [], avoidTags: [], preferredStyles: [] });
const FORBIDDEN_FIELDS = ['derivedFacts', 'debug', 'qa', 'evidence', 'narrative', 'presentation', 'renderer', 'imageUrl', 'snapshotItems'];

function percentile(values, ratio) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function loadInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') return {
      DYNAMIC_CURRENT_ENV: 'candidate-pool-benchmark', init() {},
      database() { return { command: { in: (values) => values } }; },
      getWXContext() { return { OPENID: 'candidate-pool-benchmark-user' }; },
    };
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

function createFixture() {
  return buildScalingWardrobe(30, { prefix: 'pool-benchmark' });
}

function buildFixturePool(internals, clothes) {
  const recommendations = internals.generateRuleRecommendations({
    clothes,
    scene: 'work',
    weather: { temp: 20, weather: 'clear', mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: PROFILE,
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  });
  const candidates = recommendations.candidatePoolCandidates.slice(0, 96);
  const identity = buildCandidatePoolIdentity({
    openid: 'candidate-pool-benchmark-user', clothes, sceneKey: 'work',
    weather: { temp: 20, weather: 'clear', mode: 'live' }, weatherMode: 'live',
    recommendationProfile: PROFILE, timeOfDay: 'all_day', engineVersion: 'candidate-pool-benchmark',
  });
  return { candidates, identity, pool: createCandidatePoolRecord({ candidatePoolId: 'candidate-pool-benchmark', identity, candidates, now: Date.parse('2026-09-09T00:00:00.000Z') }) };
}

function measureOnce(internals, fixture) {
  const serializationSamples = [];
  let plan;
  let heapPeak = 0;
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    plan = buildCandidatePoolStoragePlan(fixture.pool);
    serializationSamples.push(performance.now() - started);
    heapPeak = Math.max(heapPeak, Number(process.memoryUsage().heapUsed) || 0);
  }
  validateCandidatePoolStoragePlan(plan);
  const hydrated = fixture.pool.candidates.map((candidate) => hydrateCandidateCore(candidate, {
    reasonDescriptorForCode: (code) => ({ code, label: code }),
  }));
  const excluded = new Set(hydrated.slice(0, 8).map((candidate) => candidate.outfitKey));
  const refresh = hydrated.filter((candidate) => !excluded.has(candidate.outfitKey)).slice(0, 8);
  const json = JSON.stringify({ manifest: plan.manifest, chunks: plan.chunks });
  return {
    candidateCount: fixture.pool.candidateCount,
    serializedBytes: plan.serializedBytes,
    manifestBytes: plan.manifestBytes,
    chunksBytes: plan.chunksBytes,
    serializationP50Ms: percentile(serializationSamples, 0.5),
    serializationP95Ms: percentile(serializationSamples, 0.95),
    heapPeakBytes: heapPeak,
    chunkCount: plan.chunks.length,
    hydratedCount: hydrated.length,
    refreshCount: refresh.length,
    noRepeat: refresh.every((candidate) => !excluded.has(candidate.outfitKey)),
    compactPayload: FORBIDDEN_FIELDS.every((field) => !json.includes(`"${field}"`)),
    sourceCandidateBytes: Buffer.byteLength(JSON.stringify(fixture.candidates), 'utf8'),
    gcTrend: typeof global.gc === 'function' ? 'available; invoke with --expose-gc for controlled runs' : 'unavailable',
    poolSave: 'not_measured; collect from production smoke',
  };
}

function runCandidatePoolBenchmark({ runs = 3 } = {}) {
  const internals = loadInternals();
  const clothes = createFixture();
  const fixture = buildFixturePool(internals, clothes);
  const samples = Array.from({ length: Math.max(1, Number(runs)) }, () => measureOnce(internals, fixture));
  const last = samples[samples.length - 1];
  return {
    benchmark: 'candidate-pool-compact-v1',
    wardrobeCount: clothes.length,
    candidateCount: last.candidateCount,
    serializedBytes: last.serializedBytes,
    sourceCandidateBytes: last.sourceCandidateBytes,
    compactRatio: last.serializedBytes / Math.max(1, last.sourceCandidateBytes),
    manifestBytes: last.manifestBytes,
    chunksBytes: last.chunksBytes,
    chunkCount: last.chunkCount,
    serializationP50Ms: percentile(samples.map((sample) => sample.serializationP50Ms), 0.5),
    serializationP95Ms: percentile(samples.map((sample) => sample.serializationP95Ms), 0.95),
    heapPeakBytes: Math.max(...samples.map((sample) => sample.heapPeakBytes)),
    hydratedCount: last.hydratedCount,
    refreshCount: last.refreshCount,
    noRepeat: samples.every((sample) => sample.noRepeat),
    compactPayload: samples.every((sample) => sample.compactPayload),
    identityAndRoles: last.hydratedCount === last.candidateCount,
    gcTrend: last.gcTrend,
    poolSave: last.poolSave,
  };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(runCandidatePoolBenchmark(), null, 2)}\n`);

module.exports = { runCandidatePoolBenchmark, measureOnce, loadInternals };
