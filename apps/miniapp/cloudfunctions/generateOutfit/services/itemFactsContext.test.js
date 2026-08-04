const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { buildItemFactsContext } = require('./itemFactsContext');
const { createCompositionItemFacts } = require('./outfitCompositionV1');
const { buildQaAuditSummaries } = require('./qaBatchAudit');
const { compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');

function loadGenerateOutfitInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'item-facts-test-user' }; },
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

function profile() {
  return {
    styleTags: [],
    colorPreference: [],
    avoidTags: [],
    fitPreference: 'unknown',
    genderPreference: 'unknown',
    temperatureSensitivity: 'normal',
  };
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

function largeWorkWardrobe() {
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

function generate(internals, clothes, options = {}) {
  return internals.generateRuleRecommendations({
    clothes,
    scene: 'work',
    weather: { temp: 20, weather: 'clear', mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
    debugRecommendationAudit: true,
    ...options,
  });
}

function candidateSnapshot(candidate) {
  return {
    itemIds: candidate.itemIds.slice().sort(),
    eligibility: candidate.eligibility,
    eligibilityReason: candidate.eligibilityReason,
    eligibilityReasonCandidates: candidate.eligibilityReasonCandidates,
    scoreBreakdown: candidate.scoreBreakdown,
    totalScore: candidate.totalScore,
    rankingScore: candidate.rankingScore,
    selectionSignatures: candidate.selectionSignatures,
  };
}

function resultSnapshot(result) {
  return {
    debug: {
      candidateCount: result.debug.candidateCount,
      guardAcceptedCount: result.debug.guardAcceptedCount,
      guardRejectedCount: result.debug.guardRejectedCount,
      weatherRejectedCount: result.debug.weatherRejectedCount,
      sceneRejectedCount: result.debug.sceneRejectedCount,
      rejectReasonCounts: result.debug.rejectReasonCounts,
    },
    accepted: result.debug._auditGuardAcceptedCandidates.map(candidateSnapshot),
    rejected: result.debug._auditGuardRejectedCandidates.map((entry) => ({
      itemIds: entry.candidate.itemIds.slice().sort(),
      rejectReasons: entry.rejectReasons,
      weather: entry.weather,
      scene: entry.scene,
    })),
    selected: result.map(candidateSnapshot),
  };
}

function compiledCopySnapshot(internals, recommendations) {
  const compiled = compileRecommendationLanguageV3({
    outfits: recommendations.map((candidate, index) => internals.toTempOutfit(candidate, {
      openid: 'item-facts-equivalence-user',
      scene: 'work',
      targetDate: '2026-07-20',
      timeOfDay: 'all_day',
      weather: { temp: 20, weather: 'clear' },
      now: '2026-07-20T08:00:00.000Z',
      recommendationBatchId: `item-facts-equivalence-${index}`,
    })),
    scene: 'work',
    weather: { temp: 20, weather: 'clear' },
  });
  return compiled.map((outfit) => ({
    clothingIds: outfit.clothingIds,
    title: outfit.title,
    tags: outfit.tags,
    todayReason: outfit.todayReason,
  }));
}

function compiledOutfitSnapshot(internals, recommendations) {
  const compiled = compileRecommendationLanguageV3({
    outfits: recommendations.map((candidate, index) => internals.toTempOutfit(candidate, {
      openid: 'item-facts-equivalence-user',
      scene: 'work',
      targetDate: '2026-07-20',
      timeOfDay: 'all_day',
      weather: { temp: 20, weather: 'clear' },
      now: '2026-07-20T08:00:00.000Z',
      recommendationBatchId: `item-facts-equivalence-${index}`,
    })),
    scene: 'work',
    weather: { temp: 20, weather: 'clear' },
  });
  return JSON.parse(JSON.stringify(compiled));
}

function candidateItemOccurrences(result) {
  return [
    ...result.debug._auditGuardAcceptedCandidates,
    ...result.debug._auditGuardRejectedCandidates.map((entry) => entry.candidate),
  ].reduce((count, candidate) => count + candidate.itemIds.length, 0);
}

test('request item facts context is request-local across users and rejects candidate misses', () => {
  const firstItem = item('same-id', 'top', 'casual cotton top', {
    userId: 'user-a', material: 'cotton', styleTags: ['casual'],
  });
  const secondItem = item('same-id', 'top', 'sport mesh top', {
    userId: 'user-b', material: 'mesh', styleTags: ['sport'],
  });
  const first = buildItemFactsContext({ items: [firstItem], createCompositionFacts: createCompositionItemFacts });
  const second = buildItemFactsContext({ items: [secondItem], createCompositionFacts: createCompositionItemFacts });

  assert.notEqual(first.byId, second.byId);
  assert.equal(first.resolveItemFacts(firstItem).sourceItem.userId, 'user-a');
  assert.equal(second.resolveItemFacts(secondItem).sourceItem.userId, 'user-b');
  assert.equal(first.resolveItemFacts(firstItem).itemText.includes('cotton'), true);
  assert.equal(second.resolveItemFacts(secondItem).itemText.includes('mesh'), true);
  assert.notEqual(
    first.resolveItemFacts(firstItem).wearabilityClassification.sportSignals.join('|'),
    second.resolveItemFacts(secondItem).wearabilityClassification.sportSignals.join('|'),
  );
  assert.throws(() => first.resolveItemFacts({ _id: 'not-in-request' }), /item facts context miss/);
});

test('cached and legacy paths preserve candidate eligibility, reasons, scores, and selection', () => {
  const internals = loadGenerateOutfitInternals();
  const allClothes = largeWorkWardrobe();
  const clothes = [
    ...allClothes.filter((value) => value._id.startsWith('top-')).slice(0, 3),
    ...allClothes.filter((value) => value._id.startsWith('bottom-')).slice(0, 3),
    ...allClothes.filter((value) => value._id.startsWith('shoe-')).slice(0, 3),
    ...allClothes.filter((value) => value._id.startsWith('coat-')).slice(0, 2),
    ...allClothes.filter((value) => value._id.startsWith('accessory-')).slice(0, 2),
  ];
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const legacy = generate(internals, clothes, { disableItemFactsContext: true });
    const cached = generate(internals, clothes);
    assert.deepEqual(resultSnapshot(cached), resultSnapshot(legacy));
    assert.deepEqual(compiledCopySnapshot(internals, cached), compiledCopySnapshot(internals, legacy));
  } finally {
    Math.random = originalRandom;
  }
});

test('V6 candidate cores keep optional items out of selection and materialize only selected candidates', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = largeWorkWardrobe();
  const lazyInstrumentation = { counters: {} };
  const lazy = generate(internals, clothes, { testInstrumentation: lazyInstrumentation });
  assert.equal(lazyInstrumentation.counters.materializeCanonicalCandidate, lazy.length);
  assert.equal(lazy.debug._auditGuardAcceptedCandidates.every((candidate) => (
    !Object.hasOwn(candidate, 'items')
    && !Object.hasOwn(candidate, 'visibleFacts')
    && !Object.hasOwn(candidate, 'copyFacts')
    && !Object.hasOwn(candidate, 'displayFacts')
    && !Object.hasOwn(candidate, 'title')
  )), true);
  assert.equal(lazy.debug._auditGuardRejectedCandidates.every((entry) => (
    !Object.hasOwn(entry.candidate, 'items')
    && !Object.hasOwn(entry.candidate, 'visibleFacts')
    && !Object.hasOwn(entry.candidate, 'copyFacts')
    && !Object.hasOwn(entry.candidate, 'displayFacts')
  )), true);
});

test('candidate derived facts preserve production results and remove candidate-stage duplicate work', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = largeWorkWardrobe();
  const optimizedInstrumentation = { counters: {}, timings: {} };
  const referenceInstrumentation = { counters: {}, timings: {} };
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const reference = generate(internals, clothes, {
      disableCandidateDerivedFactsForTest: true,
      testInstrumentation: referenceInstrumentation,
    });
    const optimized = generate(internals, clothes, {
      testInstrumentation: optimizedInstrumentation,
    });
    assert.deepEqual(resultSnapshot(optimized), resultSnapshot(reference));
    assert.deepEqual(compiledCopySnapshot(internals, optimized), compiledCopySnapshot(internals, reference));
    assert.deepEqual(compiledOutfitSnapshot(internals, optimized), compiledOutfitSnapshot(internals, reference));

    const counters = optimizedInstrumentation.counters;
    assert.equal(counters.createCandidateDerivedFacts, optimized.debug.candidateCount);
    assert.equal(counters.composeLegacyVisibleFactsForEligibility || 0, 0);
    assert.equal(counters.eligibilityFactRecordCopy || 0, 0);
    assert.equal(counters.scoreCandidate, optimized.debug.guardAcceptedCount);
    assert.equal(counters.scoreCandidateSourceItemFlatMap || 0, 0);
    assert.equal(counters.scoreCandidateNormalizeColors || 0, 0);
    assert.equal(counters.deriveCandidateWarmth, optimized.debug.candidateCount);
    assert.equal(counters.deriveCandidateCoolness, optimized.debug.candidateCount);
    assert.equal(counters.scoreCandidateItemSignature || 0, 0);
    assert.ok(referenceInstrumentation.counters.composeLegacyVisibleFactsForEligibility > 0);
    assert.equal(referenceInstrumentation.counters.scoreCandidateSourceItemFlatMap, reference.debug.guardAcceptedCount);

    const firstDerivedFacts = optimized.debug._auditGuardAcceptedCandidates[0].derivedFacts;
    assert.ok(firstDerivedFacts?.visibleFactsView?.items?.length > 0);
    assert.equal(Object.hasOwn(firstDerivedFacts, 'sourceItems'), false);
    assert.equal(firstDerivedFacts.itemSignature, firstDerivedFacts.existingSelectionSignatures.itemSignature);
  } finally {
    Math.random = originalRandom;
  }
});

test('large candidate run parses each item once and later stages only read saved facts', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = largeWorkWardrobe();
  const instrumentation = { counters: {} };
  const result = generate(internals, clothes, { testInstrumentation: instrumentation });
  const counters = instrumentation.counters;

  assert.equal(clothes.length, 31);
  assert.ok(result.debug.candidateCount > 0 && result.debug.candidateCount < 1000);
  assert.equal(counters.buildCanonicalItemFacts, clothes.length);
  assert.equal(counters.classifyWearabilityItem, clothes.length);
  assert.equal(counters.deriveSceneEligibilityFacts, clothes.length);
  assert.equal(counters.itemText, clothes.length);
  assert.equal(counters.compositionItemText, clothes.length);
  assert.equal(counters.adaptLegacyVisibleFactItem, clothes.length);
  assert.equal(counters.prepareCopyItemFacts, clothes.length);
  assert.equal(counters.createCandidateCore, result.debug.candidateCount);
  assert.equal(counters.createCandidateDerivedFacts, result.debug.candidateCount);
  assert.equal(counters.composeLegacyVisibleFactsForEligibility || 0, 0);
  assert.equal(counters.scoreCandidate, result.debug.guardAcceptedCount);
  assert.equal(counters.scoreCandidateSourceItemFlatMap || 0, 0);
  assert.equal(counters.scoreCandidateNormalizeColors || 0, 0);
  assert.equal(counters.deriveCandidateWarmth, result.debug.candidateCount);
  assert.equal(counters.deriveCandidateCoolness, result.debug.candidateCount);
  assert.equal(counters.scoreCandidateItemSignature || 0, 0);
  assert.equal(counters.materializeCanonicalCandidate, result.length);
  assert.equal(counters.materializeVisibleFacts, result.length);
  assert.equal(counters.materializeCopyFacts, result.length);
  assert.equal(counters.materializeDisplayFacts, result.length);
  assert.equal(counters.materializeCandidateTitle, result.length);
  assert.ok(candidateItemOccurrences(result) < 7392);
  assert.equal(counters.evaluateSceneEligibilityV3, result.debug.candidateCount);
  assert.equal(counters.collectEligibilityReasonCandidates, result.debug.guardAcceptedCount);

  const materializationCounts = {
    materializeCanonicalCandidate: counters.materializeCanonicalCandidate,
    materializeVisibleFacts: counters.materializeVisibleFacts,
    materializeCopyFacts: counters.materializeCopyFacts,
    materializeDisplayFacts: counters.materializeDisplayFacts,
    materializeCandidateTitle: counters.materializeCandidateTitle,
    createCandidateDerivedFacts: counters.createCandidateDerivedFacts,
    scoreCandidate: counters.scoreCandidate,
    composeLegacyVisibleFactsForEligibility: counters.composeLegacyVisibleFactsForEligibility || 0,
    scoreCandidateSourceItemFlatMap: counters.scoreCandidateSourceItemFlatMap || 0,
    scoreCandidateNormalizeColors: counters.scoreCandidateNormalizeColors || 0,
    deriveCandidateWarmth: counters.deriveCandidateWarmth,
    deriveCandidateCoolness: counters.deriveCandidateCoolness,
    scoreCandidateItemSignature: counters.scoreCandidateItemSignature || 0,
  };
  const compiled = compileRecommendationLanguageV3({
    outfits: result.map((candidate, index) => internals.toTempOutfit(candidate, {
      openid: 'item-facts-test-user',
      scene: 'work',
      targetDate: '2026-07-20',
      timeOfDay: 'all_day',
      weather: { temp: 20, weather: 'clear' },
      now: '2026-07-20T08:00:00.000Z',
      recommendationBatchId: `item-facts-${index}`,
      instrumentation,
    })),
    scene: 'work',
    weather: { temp: 20, weather: 'clear' },
    instrumentation,
  });
  buildQaAuditSummaries({
    guardAcceptedCandidates: result.debug._auditGuardAcceptedCandidates,
    guardRejectedCandidates: result.debug._auditGuardRejectedCandidates,
    selectedOutfits: result,
    compiledOutfits: compiled,
  });
  assert.deepEqual({
    materializeCanonicalCandidate: counters.materializeCanonicalCandidate,
    materializeVisibleFacts: counters.materializeVisibleFacts,
    materializeCopyFacts: counters.materializeCopyFacts,
    materializeDisplayFacts: counters.materializeDisplayFacts,
    materializeCandidateTitle: counters.materializeCandidateTitle,
    createCandidateDerivedFacts: counters.createCandidateDerivedFacts,
    scoreCandidate: counters.scoreCandidate,
    composeLegacyVisibleFactsForEligibility: counters.composeLegacyVisibleFactsForEligibility || 0,
    scoreCandidateSourceItemFlatMap: counters.scoreCandidateSourceItemFlatMap || 0,
    scoreCandidateNormalizeColors: counters.scoreCandidateNormalizeColors || 0,
    deriveCandidateWarmth: counters.deriveCandidateWarmth,
    deriveCandidateCoolness: counters.deriveCandidateCoolness,
    scoreCandidateItemSignature: counters.scoreCandidateItemSignature || 0,
  }, materializationCounts);
  assert.equal(counters.buildSnapshotItems, result.length);
  assert.equal(counters.compileCandidateTags, result.length);
  assert.equal(counters.compileTodayReason, result.length);
  assert.equal(counters.compileCopyContract, result.length);
});

test('large legacy fallback demonstrates candidate-occurrence parsing is removed', () => {
  const internals = loadGenerateOutfitInternals();
  const instrumentation = { counters: {} };
  const result = generate(internals, largeWorkWardrobe(), {
    disableItemFactsContext: true,
    testInstrumentation: instrumentation,
  });

  assert.ok(result.debug.candidateCount > 0 && result.debug.candidateCount < 1000);
  assert.ok(candidateItemOccurrences(result) < 7392);
  assert.ok(instrumentation.counters.classifyWearabilityItem > 0);
  assert.ok(instrumentation.counters.deriveSceneEligibilityFacts > 0);
  assert.ok(instrumentation.counters.itemText > 0);
  assert.ok(instrumentation.counters.adaptLegacyVisibleFactItem > 0);
  assert.equal(instrumentation.counters.copyItemParse || 0, 0);
  assert.equal(instrumentation.counters.materializeCanonicalCandidate, result.length);
  assert.equal(instrumentation.counters.materializeCopyFacts, result.length);
});
