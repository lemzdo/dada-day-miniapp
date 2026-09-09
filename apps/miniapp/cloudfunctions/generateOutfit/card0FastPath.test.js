/* global require, module, __dirname, process, setImmediate, performance */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { runRecommendationOrchestrator } = require('./runtime/recommendationOrchestrator');
const { loadRecommendationInputSnapshot } = require('./runtime/inputSnapshotService');
const { resolveRecommendationCache } = require('./runtime/recommendationCacheCoordinator');
const { buildProductionRendererEntry } = require('./services/recommendationVoiceRendererProductionV2');
const { createCandidatePoolRecord } = require('./services/candidatePool');
const narrative = require('./services/recommendationNarrativePlanV2');
const canonical = require('./services/canonicalCandidate');
const { normalizeRecommendationWeather } = require('./services/recommendationWeatherMode');

const INPUT = { scene: 'home', date: '2026-09-03', weatherMode: 'unavailable', v2BatchId: 'v2-fast-path', maxResults: 8 };
const PROFILE = { genderPreference: 'unknown', styleTags: [], fitPreference: 'unknown', colorPreference: [], avoidTags: [], temperatureSensitivity: 'normal' };
const CLOTHES = [
  ...['white', 'blue', 'black'].map((color, index) => ({ _id: `top-${index}`, category: 'top', subcategory: 'shirt', color })),
  ...['black', 'gray', 'blue'].map((color, index) => ({ _id: `bottom-${index}`, category: 'bottom', subcategory: 'pants', color })),
  { _id: 'shoes-0', category: 'shoes', subcategory: 'sneaker', color: 'white' },
].map((item, index) => ({ ...item, _openid: 'fast-path-user', status: 'active', styleTags: ['casual'], imageUrl: `https://example.test/${item._id}.jpg`, createdAt: index }));

// Isolated modules make index.js and the original styling helper use the same
// instrumented REAL planner. No source substitutions or mocked plan outputs.
function loadCore({ failPlanIndex, failEntry = false, remainingCardCpuMs = 0, remainingSelectorCpuMs = 0 } = {}) {
  const events = [];
  const attempts = [];
  let materializations = 0;
  const originalLoad = Module._load;
  const database = { collection(name) {
    return {
      where() { return this; }, orderBy() { return this; }, skip() { return this; }, limit() { return this; },
      async get() { return { data: name === 'clothes' ? structuredClothes() : [{ _openid: 'fast-path-user', styleProfile: {} }] }; },
    };
  } };
  function compile(relative) {
    const filename = path.join(__dirname, relative);
    const compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(path.dirname(filename));
    compiled._compile(fs.readFileSync(filename, 'utf8'), filename);
    return compiled.exports;
  }
  let styling;
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'test', init() {}, database: () => database, getWXContext: () => ({ OPENID: 'fast-path-user' }) };
    if (request.endsWith('/recommendationNarrativePlanV2')) return {
      ...narrative,
      buildRecommendationNarrativePlanV2(recommendation, options) {
        const index = Number(options.recommendationInstanceId.split(':').at(-1));
        attempts.push(index);
        events.push(`plan${index}`);
        if (index === failPlanIndex) throw Object.assign(new Error('fixture plan failure'), { validationErrors: ['FIXTURE_PLAN_FAILURE'] });
        return narrative.buildRecommendationNarrativePlanV2(recommendation, options);
      },
    };
    if (request === './services/recommendationStylingShadowV2') {
      styling ||= compile('services/recommendationStylingShadowV2.js');
      return styling;
    }
    if (request === './services/canonicalCandidate') return {
      ...canonical,
      createCanonicalCandidateBatchSelector(...args) {
        const selector = canonical.createCanonicalCandidateBatchSelector(...args);
        if (remainingSelectorCpuMs <= 0) return selector;
        let round = 0;
        const instrumented = {
          selected: selector.selected,
          selectNext() {
            const index = round++;
            events.push(`selector${index}`);
            if (index > 0) {
              const until = performance.now() + remainingSelectorCpuMs;
              while (performance.now() < until) { /* deterministic synchronous gate */ }
            }
            return selector.selectNext();
          },
          selectRemaining() {
            while (instrumented.selectNext()) { /* Continue instrumented rounds. */ }
            return instrumented.selected;
          },
        };
        return instrumented;
      },
      materializeCanonicalCandidate(...args) {
        const index = materializations++;
        events.push(`materialize${index}`);
        if (index > 0 && remainingCardCpuMs > 0) {
          const until = performance.now() + remainingCardCpuMs;
          while (performance.now() < until) { /* deterministic synchronous gate */ }
        }
        return canonical.materializeCanonicalCandidate(...args);
      },
    };
    if (failEntry && request === './services/recommendationVoiceRendererProductionV2') return {
      ...originalLoad.call(this, request, parent, isMain),
      buildProductionRendererEntry() { throw new Error('fixture entry failure'); },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  let internals;
  try { internals = compile('index.js').__test; } finally {
    Module._load = originalLoad;
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  return { database, internals, events, attempts, styling, get materializations() { return materializations; } };
}

function structuredClothes() { return JSON.parse(JSON.stringify(CLOTHES)); }
function ruleArgs(overrides = {}) {
  return { clothes: structuredClothes(), scene: INPUT.scene, weatherMode: INPUT.weatherMode, recommendationProfile: PROFILE, excludeClothingIdSets: [], excludedOutfitKeys: [], maxResults: INPUT.maxResults, ...overrides };
}
function publicBatch(outfits) { return JSON.parse(JSON.stringify(outfits)); }

async function compute(harness, overrides = {}, hook) {
  const input = { ...INPUT, ...overrides.input };
  const diagnostics = harness.internals.createRecommendationDiagnostics({ ...input, auditId: 'phase1a-audit' });
  diagnostics.stageLogger = () => {};
  const snapshot = await loadRecommendationInputSnapshot(input, {
    database: harness.database,
    openid: 'fast-path-user',
  });
  const cacheResolution = await resolveRecommendationCache(snapshot, {
    loadCandidatePoolForIdentity: overrides.context?.loadCandidatePoolForIdentity,
  });
  return harness.internals.computeProductionRecommendationCore({ ...snapshot, cacheResolution }, diagnostics, {
    userIdentity: { openid: 'fast-path-user' },
    ...overrides.context,
    onFirstCardReady: hook,
  });
}

// Original scheduling: materialize all selected cards, then invoke the
// unchanged safe styling helper. HIT continues to use this schedule.
function legacyPlans(harness, recommendations, weather, onPlanReady) {
  return harness.styling.runRecommendationStylingShadowV2Safely({
    recommendations, scene: INPUT.scene, weather,
    recommendationInstanceSeed: 'phase1a-audit', telemetrySampleRate: 0, onPlanReady,
  });
}

test('Phase1A moves admission before card1 materialization and reuses plan0/fingerprint with an identical batch', async (t) => {
  const fast = loadCore();
  let payload;
  const result = await compute(fast, {}, (ready) => {
    fast.events.push('admission');
    assert.equal(fast.materializations, 1);
    payload = ready;
  });
  assert.equal(result.outfits.length, 8, 'exercise the entire batch');
  const old = loadCore();
  const oldOutfits = old.internals.generateRuleRecommendations(ruleArgs());
  let oldPayload;
  const oldPlans = legacyPlans(old, oldOutfits, result.evidence.weatherSnapshot, (ready) => {
    old.events.push('admission');
    assert.equal(old.materializations, 8);
    oldPayload = ready;
  });
  assert.deepEqual(fast.events.slice(0, 4), ['materialize0', 'plan0', 'admission', 'materialize1']);
  assert.deepEqual(old.events.slice(0, 10), [...Array.from({ length: 8 }, (_, index) => `materialize${index}`), 'plan0', 'admission']);
  assert.deepEqual(fast.attempts, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(payload.plan, result.narrativePlans[0]);
  assert.equal(payload.entry.preparedEntry.plan.planId, result.narrativePlans[0].planId);
  assert.strictEqual(payload.recommendation, result.outfits[0]);
  assert.deepEqual(publicBatch(result.outfits), publicBatch(oldOutfits));
  assert.deepEqual(
    result.outfits.map((outfit) => outfit.eligibilityReason),
    oldOutfits.map((outfit) => outfit.eligibilityReason),
    'the global reason allocator must backfill the exact legacy reason source data',
  );
  assert.deepEqual(result.outfits.countContract, oldOutfits.countContract);
  assert.deepEqual(result.narrativePlans, oldPlans.plans);
  assert.equal(result.metadata.narrativePlanStatus, oldPlans.diagnostics.status);
  const legacyEntry = buildProductionRendererEntry(oldPayload.plan, oldPayload.recommendation, 0, oldPayload.recommendation.outfitKey);
  assert.deepEqual(payload.entry, legacyEntry);
  assert.equal(payload.inputIdentityHash, result.identity.identityHash);
  assert.equal(payload.batchId, result.metadata.batchId);
  assert.deepEqual(
    result.metadata.candidatePoolPersistenceInput.candidates,
    oldOutfits.candidatePoolCandidates,
    'candidate pool identity/content remains unchanged',
  );
  const stageNames = result.evidence.diagnostics.stageDiagnostics.map((entry) => entry.stage);
  const stageIndex = (name) => stageNames.indexOf(name);
  assert.ok(stageIndex('SELECTOR_CARD0_FIXED') < stageIndex('CARD0_MATERIALIZE_START'));
  assert.ok(stageIndex('CARD0_MATERIALIZE_DONE') < stageIndex('PLAN0_BUILD_START'));
  assert.ok(stageIndex('PLAN0_BUILD_DONE') < stageIndex('FINGERPRINT_READY'));
  assert.ok(stageIndex('FINGERPRINT_READY') < stageIndex('PLAN0_READY'));
  assert.ok(stageIndex('PLAN0_READY') < stageIndex('SELECTOR_FULL_BATCH_DONE'));
  assert.ok(stageIndex('SELECTOR_FULL_BATCH_DONE') < stageIndex('ELIGIBILITY_REASON_FULL_BATCH_DONE'));
  t.diagnostic(`before: ${old.events.join(' -> ')}`);
  t.diagnostic(`after: ${fast.events.join(' -> ')}`);
});

test('Phase1A starts the real provider before the synchronous remainder reaches FULL_BATCH_READY', async () => {
  async function runSchedulingCase(awaitAdmissionProgress) {
    const harness = loadCore({ remainingCardCpuMs: 3, remainingSelectorCpuMs: 3 });
    const events = harness.events;
    let earlyEntry;
    let providerCalls = 0;
    let settlements = 0;
    const interactive = {
      resolveAdmission: async () => {
        events.push('CACHE_LOOKUP_START');
        await new Promise((resolve) => setImmediate(resolve));
        events.push('CACHE_LOOKUP_DONE');
        return { entry: earlyEntry };
      },
      persistCanonicalCopy: async (copy) => copy,
      completeCopyJob: async () => { settlements += 1; },
      markCopyJobRetryable: async () => { settlements += 1; },
      applyCanonicalToResponse: (response) => response,
    };
    let coreSnapshot;
    const result = await runRecommendationOrchestrator(INPUT, {
      diagnostics: harness.internals.createRecommendationDiagnostics({ ...INPUT, auditId: `scheduling-${awaitAdmissionProgress}` }),
      prepareFirstCardInteractive: ({ entry }) => { earlyEntry = entry; return interactive; },
      computeRecommendation: async (_input, runtimeContext) => {
        const core = await compute(harness, {}, (payload) => {
          const progress = runtimeContext.onFirstCardReady(payload);
          return awaitAdmissionProgress ? progress : undefined;
        });
        events.push('FULL_BATCH_READY');
        coreSnapshot = core;
        return core;
      },
      prepareRecommendationWork: async (core) => ({
        batchId: core.metadata.batchId,
        tasks: [],
        narrativePlans: core.narrativePlans,
        rendererEntries: [earlyEntry],
        firstCardInteractive: interactive,
      }),
      persistAndAssembleRecommendation: async (core) => ({
        batch: { batchId: core.metadata.batchId, countContract: core.outfits.countContract },
      }),
      renderFirstCardCanonical: async ({ entry, rendererConfig }) => {
        providerCalls += 1;
        events.push('PROVIDER_START');
        rendererConfig.onAuditStage('PROVIDER_START', 'started');
        return {
          status: 'success',
          copy: {
            planId: entry.preparedEntry.plan.planId,
            renderInputFingerprint: entry.renderInputFingerprint,
            text: 'deterministic copy',
          },
        };
      },
    });
    await result.tailDone;
    return { core: coreSnapshot, events, providerCalls, settlements };
  }

  const legacy = await runSchedulingCase(false);
  const fixed = await runSchedulingCase(true);
  assert.ok(legacy.events.indexOf('FULL_BATCH_READY') < legacy.events.indexOf('PROVIDER_START'));
  assert.ok(fixed.events.indexOf('plan0') < fixed.events.indexOf('PROVIDER_START'));
  assert.ok(fixed.events.indexOf('PROVIDER_START') < fixed.events.indexOf('selector1'));
  assert.ok(fixed.events.indexOf('PROVIDER_START') < fixed.events.indexOf('materialize1'));
  assert.ok(fixed.events.indexOf('PROVIDER_START') < fixed.events.indexOf('FULL_BATCH_READY'));
  assert.equal(fixed.providerCalls, 1);
  assert.equal(fixed.settlements, 1);
  assert.deepEqual(publicBatch(fixed.core.outfits), publicBatch(legacy.core.outfits));
  assert.deepEqual(fixed.core.narrativePlans, legacy.core.narrativePlans);
});

test('Phase1A preserves candidate-pool HIT order, callback boundary, identity and fingerprint', async () => {
  const seed = await compute(loadCore());
  const pool = createCandidatePoolRecord({ candidatePoolId: 'pool-hit', identity: seed.identity, candidates: seed.metadata.candidatePoolPersistenceInput.candidates });
  const fast = loadCore();
  let payload;
  let materializedAtAdmission;
  const result = await compute(fast, {
    input: { recommendationBatchId: 'pool-hit' },
    context: { loadCandidatePoolForIdentity: async () => ({ hit: true, pool, ageMs: 10 }) },
  }, (ready) => { payload = ready; materializedAtAdmission = fast.materializations; fast.events.push('admission'); });
  const old = loadCore();
  const oldOutfits = old.internals.generateCandidatePoolRecommendations({ ...ruleArgs(), pool, weather: normalizeRecommendationWeather(undefined, INPUT.weatherMode) });
  const oldPlans = legacyPlans(old, oldOutfits, result.evidence.weatherSnapshot);
  assert.equal(result.executionState.executionMode, 'candidate_pool_hit');
  assert.equal(result.executionState.cacheHit, true);
  assert.equal(result.metadata.candidatePoolPersistenceInput, null);
  assert.equal(materializedAtAdmission, fast.materializations, 'HIT still materializes all cards before admission');
  assert.deepEqual(publicBatch(result.outfits), publicBatch(oldOutfits));
  assert.deepEqual(result.outfits.countContract, oldOutfits.countContract);
  assert.deepEqual(result.narrativePlans, oldPlans.plans);
  assert.deepEqual(result.identity, seed.identity);
  assert.deepEqual(payload.entry, buildProductionRendererEntry(oldPlans.plans[0], oldOutfits[0], 0, oldOutfits[0].outfitKey));
  assert.equal(fast.events.filter((event) => event === 'admission').length, 1);
});

for (const failPlanIndex of [0, 1]) {
  test(`Phase1A plan${failPlanIndex} failure preserves legacy fail-open batch without retrying a plan`, async () => {
    const fast = loadCore({ failPlanIndex });
    const result = await compute(fast);
    const old = loadCore({ failPlanIndex });
    const oldOutfits = old.internals.generateRuleRecommendations(ruleArgs());
    const oldPlans = legacyPlans(old, oldOutfits, result.evidence.weatherSnapshot);
    assert.deepEqual(publicBatch(result.outfits), publicBatch(oldOutfits));
    assert.deepEqual(result.narrativePlans, oldPlans.plans);
    assert.equal(result.metadata.narrativePlanStatus, oldPlans.diagnostics.status);
    assert.equal(result.metadata.narrativePlanStatus, 'partially_failed_open');
    assert.deepEqual(fast.attempts, [0, 1, 2, 3, 4, 5, 6, 7]);
  });
}

for (const mode of ['throw', 'reject', 'entry']) {
  test(`Phase1A ${mode} admission failure does not invalidate or rebuild plan0`, async () => {
    const fast = loadCore({ failEntry: mode === 'entry' });
    const result = await compute(fast, {}, () => {
      if (mode === 'reject') return Promise.reject(new Error('hook rejected'));
      throw new Error('hook failed');
    });
    assert.equal(result.metadata.narrativePlanStatus, 'completed');
    assert.equal(result.narrativePlans.length, 8);
    assert.equal(fast.attempts.filter((index) => index === 0).length, 1);
    await new Promise((resolve) => setImmediate(resolve));
  });
}
