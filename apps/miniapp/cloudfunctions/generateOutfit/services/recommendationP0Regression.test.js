const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { resolveRecommendationAvailability } = require('./recommendationAvailability');
const { finalizeAcceptedRecommendations } = require('./recommendationCopyFinalization');
const { compileRecommendationLanguageV3, deriveDisplayTagsV3 } = require('./recommendationLanguageV3');
const { canonicalizeRecommendationBatch } = require('./recommendationPresentation');
const { buildQaBatchAudit } = require('./qaBatchAudit');
const {
  normalizeRecommendationWeather,
  toWeatherSnapshot,
} = require('./recommendationWeatherMode');
const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');
const {
  buildCandidatePoolIdentity,
  createCandidatePoolRecord,
} = require('./candidatePool');

function loadGenerateOutfitInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() {
          return { command: { in: (values) => values } };
        },
        getWXContext() { return { OPENID: 'test-openid' }; },
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

function rawSportItem(id, category, subcategory) {
  return {
    _id: id,
    category,
    subcategory,
    customName: subcategory,
    styleTags: ['sport'],
    sceneTags: ['sport'],
    seasonTags: [],
    colorPalette: [{ name: 'black', hex: '#111111' }],
    confidence: 0.9,
    aiConfidence: 0.9,
  };
}

function buildTwentyFiveCandidateSportWardrobe() {
  return [
    ...Array.from({ length: 5 }, (_, index) =>
      rawSportItem(`sport-dress-${index + 1}`, 'onepiece', 'tennis athletic dress')),
    ...Array.from({ length: 4 }, (_, index) =>
      rawSportItem(`sport-top-${index + 1}`, 'top', 'sport training top')),
    ...Array.from({ length: 5 }, (_, index) =>
      rawSportItem(`sport-bottom-${index + 1}`, 'bottom', 'sport training pants')),
    rawSportItem('sport-shoe', 'shoes', 'training shoes'),
  ];
}

function buildLargeSportWardrobe() {
  return [
    ...Array.from({ length: 6 }, (_, index) =>
      rawSportItem(`large-sport-top-${index + 1}`, 'top', 'sport training top')),
    ...Array.from({ length: 6 }, (_, index) =>
      rawSportItem(`large-sport-bottom-${index + 1}`, 'bottom', 'sport training pants')),
    ...Array.from({ length: 2 }, (_, index) =>
      rawSportItem(`large-sport-shoe-${index + 1}`, 'shoes', 'training shoes')),
  ];
}

function buildConfirmedShapeUnmappedWorkWardrobe() {
  const shared = {
    userId: 'test-openid',
    colors: [],
    colorPalette: [{ name: 'black', hex: '#111111' }],
    styleTags: [],
    seasonTags: [],
    sceneTags: [],
    material: '',
    materialGuess: '',
    thickness: '',
    confidence: 0.9,
    aestheticFeatures: {
      fit: 'regular',
      length: 'regular',
      silhouette: 'regular',
      patternType: 'solid',
      designElements: [],
      formalityLevel: null,
      confidence: {},
    },
  };
  return [
    {
      ...shared,
      _id: 'baseline-work-top',
      category: 'top',
      type: 'top',
      subcategory: 'basic knit top',
      subCategory: 'basic knit top',
      customName: 'basic knit top',
    },
    {
      ...shared,
      _id: 'baseline-work-bottom',
      category: 'bottom',
      type: 'bottom',
      subcategory: 'tailored pants',
      subCategory: 'tailored pants',
      customName: 'tailored pants',
      aestheticFeatures: {
        ...shared.aestheticFeatures,
        length: 'long',
      },
    },
    {
      ...shared,
      _id: 'baseline-work-shoes',
      category: 'shoes',
      type: 'shoes',
      subcategory: 'office shoes',
      subCategory: 'office shoes',
      customName: 'office shoes',
    },
  ];
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

function visibleCardContract(internals, recommendations, weather, batchPrefix) {
  const tempOutfits = recommendations.map((recommendation, index) => internals.toTempOutfit(recommendation, {
    openid: 'test-openid',
    scene: 'sport',
    targetDate: '2026-07-16',
    timeOfDay: 'all_day',
    weather,
    now: '2026-07-16T08:00:00.000Z',
    recommendationBatchId: `${batchPrefix}-${index}`,
  }));
  const compiled = compileRecommendationLanguageV3({ outfits: tempOutfits, scene: 'sport', weather });
  const finalized = finalizeAcceptedRecommendations(compiled, {
    mode: 'new_recommendation',
    requestedCount: 8,
  });
  return canonicalizeRecommendationBatch(finalized.finalRecommendations, { scene: 'sport' }).map((outfit) => ({
    outfitKey: outfit.outfitKey,
    itemIds: outfit.clothingIds,
    title: outfit.title,
    tags: outfit.styleTags,
    todayReason: outfit.copyContract?.todayReason,
    scores: outfit.scores,
    weather: outfit.weatherSnapshot,
    reuseExplanations: outfit.reuseExplanations || [],
  }));
}

function generate(internals, { clothes, scene, weather, weatherMode = 'live', maxResults = 8 }) {
  return internals.generateRuleRecommendations({
    clothes,
    scene,
    weather,
    weatherMode,
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults,
  });
}

function legacyHomeOutfit(index) {
  const weather = { temp: 31, weather: '晴' };
  const items = [
    { clothingId: `top-${index}`, category: 'top', subCategory: '无袖上衣', sleeveLength: 'sleeveless' },
    { clothingId: `bottom-${index}`, category: 'bottom', subCategory: '短裤', pantsLength: 'short' },
    { clothingId: `shoes-${index}`, category: 'shoes', subCategory: '家居拖鞋', shoeType: 'home' },
  ];
  return {
    id: `outfit-${index}`,
    scene: 'home',
    weatherSnapshot: weather,
    items,
    clothingIds: items.map((item) => item.clothingId),
    eligibility: {
      weather: { pass: true },
      scene: evaluateSceneEligibilityV3({ scene: 'home', weather, items }),
    },
  };
}

test('P0 replay: 20 guard PASS and eight enhancement REJECT outcomes still return eight non-empty core reasons', () => {
  const weather = { temp: 31, weather: '晴' };
  const compiled = compileRecommendationLanguageV3({
    outfits: Array.from({ length: 8 }, (_, index) => legacyHomeOutfit(index)),
    scene: 'home',
    weather,
  });
  const finalized = finalizeAcceptedRecommendations(compiled, {
    mode: 'new_recommendation',
    requestedCount: 8,
  });
  const availability = resolveRecommendationAvailability({
    requestedCount: 8,
    finalRecommendationCount: finalized.finalRecommendations.length,
    candidateCount: 20,
    guardAcceptedCount: 20,
    generatedCount: 8,
    copyHiddenCount: finalized.copyHiddenCount,
  });

  assert.equal(finalized.outfitAcceptedCount, 8);
  assert.equal(finalized.coreReasonAcceptedCount, 8);
  assert.equal(finalized.enhancedReasonAcceptedCount, 0);
  assert.equal(finalized.copyAcceptedCount, 8);
  assert.equal(finalized.copyHiddenCount, 0);
  assert.equal(finalized.coreReasonCoverageGapCount, 0);
  assert.deepEqual(finalized.enhancementRejectReasonCounts, { COPY_EVIDENCE_INSUFFICIENT: 8 });
  assert.equal(finalized.finalRecommendations.every((outfit) => (
    outfit.copyDisplay === 'visible'
      && outfit.copyContract.todayReason === '今天31℃，无袖上衣配短裤，宅家穿正合适，整身也不会显得厚重。'
  )), true);
  assert.equal(availability.limited, false);
  assert.equal(availability.limitedReason, null);
});

test('real generateOutfit pipeline preserves V4 eligibility reasons from 25 candidates through finalization', () => {
  const internals = loadGenerateOutfitInternals();
  const weather = { temp: 22, weather: 'clear' };
  const recommendations = internals.generateRuleRecommendations({
    clothes: buildTwentyFiveCandidateSportWardrobe(),
    scene: 'sport',
    weather,
    weatherMode: 'live',
    recommendationProfile: {
      styleTags: [],
      colorPreference: [],
      avoidTags: [],
      fitPreference: 'unknown',
      genderPreference: 'unknown',
      temperatureSensitivity: 'normal',
    },
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  });

  assert.equal(recommendations.debug.candidateCount, 25);
  assert.equal(recommendations.debug.guardAcceptedCount, 25);
  assert.equal(recommendations.debug.guardRejectedCount, 0);
  assert.equal(recommendations.debug.sceneRejectedCount, 0);
  assert.equal(recommendations.debug.rejectReasonCounts.UNMAPPED_ELIGIBILITY_PATH || 0, 0);
  assert.equal(recommendations.length, 8);

  const tempOutfits = recommendations.map((recommendation, index) => internals.toTempOutfit(recommendation, {
    openid: 'test-openid',
    scene: 'sport',
    targetDate: '2026-07-16',
    timeOfDay: 'all_day',
    weather,
    now: '2026-07-16T08:00:00.000Z',
    recommendationBatchId: `integration-${index}`,
  }));
  assert.equal(tempOutfits.every((outfit) => outfit.eligibilityReason?.code), true);

  const compiled = compileRecommendationLanguageV3({ outfits: tempOutfits, scene: 'sport', weather });
  assert.equal(internals.assertEligibilityReasons(compiled, {
    node: 'beforeFinalization',
    scene: 'sport',
    weather,
  }), true);
  const beforeFinalization = compiled.map(internals.toEligibilityReasonDiagnostic);
  assert.equal(beforeFinalization.length, 8);
  for (const node of beforeFinalization) {
    assert.ok(node.eligibilityReasonCode);
    assert.ok(node.subjectItemIds.length > 0);
    assert.ok(node.supportingFactIds.length > 0);
    assert.ok(Array.isArray(node.relationFactIds));
    assert.ok(node.sourceRule);
    assert.ok(node.sourceRuleReasons.length > 0);
    assert.equal(node.subjectItemIds.every((id) => node.selectedOutfitItemIds.includes(id)), true);
  }

  const finalized = finalizeAcceptedRecommendations(compiled, {
    mode: 'new_recommendation',
    requestedCount: 8,
  });
  const availability = resolveRecommendationAvailability({
    requestedCount: 8,
    finalRecommendationCount: finalized.finalRecommendationCount,
    candidateCount: recommendations.debug.candidateCount,
    guardAcceptedCount: recommendations.debug.guardAcceptedCount,
    generatedCount: recommendations.length,
    weatherRejectedCount: recommendations.debug.weatherRejectedCount,
    copyHiddenCount: finalized.copyHiddenCount,
  });

  assert.equal(finalized.outfitAcceptedCount, 8);
  assert.equal(finalized.coreReasonAcceptedCount, 8);
  assert.equal(finalized.coreReasonCoverageGapCount, 0);
  assert.equal(
    Object.entries(finalized.coreReasonCodeCounts)
      .every(([code, count]) => [
        'SPORT_COMPLETE_SET',
        'SPORT_LIGHT_ACTIVITY_SET',
        'SPORT_DRESS_SHOES',
        'SPORT_V4_EVIDENCE_SUPPORTED',
      ].includes(code) && count > 0),
    true,
  );
  assert.equal(finalized.finalRecommendationCount, 8);
  assert.equal(finalized.copyAcceptedCount, 8);
  assert.equal(finalized.copyHiddenCount, 0);
  assert.equal(finalized.finalRecommendations.every((outfit) => outfit.copyContract.todayReason.trim()), true);
  assert.equal(availability.limited, false);
  assert.equal(availability.limitedReason, null);
});

test('candidate-pool next batch skips candidate generation stages and equals a full recompute with the same exclusions', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = buildTwentyFiveCandidateSportWardrobe();
  const weather = { temp: 22, weather: 'clear' };
  const baseRequest = {
    clothes,
    scene: 'sport',
    weather,
    weatherMode: 'live',
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  };
  const firstBatch = internals.generateRuleRecommendations(baseRequest);
  const exclusions = firstBatch.slice(0, 2).map((candidate) => candidate.outfitKey);
  const expected = internals.generateRuleRecommendations({
    ...baseRequest,
    excludedOutfitKeys: exclusions,
  });
  const identity = buildCandidatePoolIdentity({
    openid: 'test-openid',
    clothes,
    sceneKey: 'sport',
    weather: { ...weather, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'generateOutfit-recommendation-v6-1-title-invariant-fix-20260724',
  });
  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:test',
    identity,
    candidates: firstBatch.candidatePoolCandidates,
    now: 1,
  });
  const timings = {
    compositionMs: 0,
    canonicalizeMs: 0,
    eligibilityMs: 0,
    scoringMs: 0,
    batchSelectionMs: 0,
    exclusionMs: 0,
  };
  const actual = internals.generateCandidatePoolRecommendations({
    pool,
    clothes,
    scene: 'sport',
    weather: { ...weather, mode: 'live' },
    weatherMode: 'live',
    excludedOutfitKeys: exclusions,
    excludeClothingIdSets: [],
    maxResults: 8,
    timings,
  });
  assert.deepEqual(
    actual.map((candidate) => [candidate.outfitKey, candidate.eligibilityReason?.code]),
    expected.map((candidate) => [candidate.outfitKey, candidate.eligibilityReason?.code]),
  );
  assert.deepEqual(
    visibleCardContract(internals, actual, weather, 'pool-hit'),
    visibleCardContract(internals, expected, weather, 'full-compute'),
  );
  assert.equal(timings.compositionMs, 0);
  assert.equal(timings.canonicalizeMs, 0);
  assert.equal(timings.eligibilityMs, 0);
  assert.equal(timings.scoringMs, 0);
  assert.ok(timings.batchSelectionMs >= 0);
  assert.ok(timings.exclusionMs >= 0);
});

test('candidate-pool refresh excludes the whole visible eight-card batch, not just the active card', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = buildTwentyFiveCandidateSportWardrobe();
  const weather = { temp: 22, weather: 'clear' };
  const baseRequest = {
    clothes, scene: 'sport', weather, weatherMode: 'live', recommendationProfile: profile(),
    excludeClothingIdSets: [], excludedOutfitKeys: [], maxResults: 8,
  };
  const firstBatch = internals.generateRuleRecommendations(baseRequest);
  const identity = buildCandidatePoolIdentity({
    openid: 'test-openid', clothes, sceneKey: 'sport', weather: { ...weather, mode: 'live' }, weatherMode: 'live',
    recommendationProfile: profile(), timeOfDay: 'all_day', engineVersion: 'generateOutfit-recommendation-v6-1-title-invariant-fix-20260724',
  });
  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:whole-visible-exclusion', identity, candidates: firstBatch.candidatePoolCandidates, now: 1,
  });
  const timings = { compositionMs: 0, canonicalizeMs: 0, eligibilityMs: 0, scoringMs: 0, batchSelectionMs: 0, exclusionMs: 0 };
  const refreshed = internals.generateCandidatePoolRecommendations({
    pool, clothes, scene: 'sport', weather: { ...weather, mode: 'live' }, weatherMode: 'live',
    excludedOutfitKeys: firstBatch.map((candidate) => candidate.outfitKey), excludeClothingIdSets: [], maxResults: 8, timings,
  });

  const previous = new Set(firstBatch.map((candidate) => candidate.outfitKey));
  assert.equal(refreshed.some((candidate) => previous.has(candidate.outfitKey)), false);
  assert.equal(timings.compositionMs, 0);
  assert.equal(timings.canonicalizeMs, 0);
  assert.equal(timings.eligibilityMs, 0);
  assert.equal(timings.scoringMs, 0);
});

test('sport full compute and five consecutive pool hits keep equivalent canonical cards without repeats', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = buildLargeSportWardrobe();
  const weather = { temp: 22, weather: 'clear' };
  const baseRequest = {
    clothes,
    scene: 'sport',
    weather,
    weatherMode: 'live',
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  };
  const initial = internals.generateRuleRecommendations(baseRequest);
  const identity = buildCandidatePoolIdentity({
    openid: 'test-openid',
    clothes,
    sceneKey: 'sport',
    weather: { ...weather, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'generateOutfit-recommendation-v6-1-title-invariant-fix-20260724',
  });
  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:five-sport-refreshes',
    identity,
    candidates: initial.candidatePoolCandidates,
    now: 1,
  });
  const excludedOutfitKeys = initial.map((candidate) => candidate.outfitKey);
  const allVisibleKeys = new Set(excludedOutfitKeys);

  assert.equal(initial.length, 8);
  for (let refreshIndex = 0; refreshIndex < 5; refreshIndex += 1) {
    const expected = internals.generateRuleRecommendations({
      ...baseRequest,
      excludedOutfitKeys,
    });
    const actual = internals.generateCandidatePoolRecommendations({
      pool,
      clothes,
      scene: 'sport',
      weather: { ...weather, mode: 'live' },
      weatherMode: 'live',
      excludedOutfitKeys,
      excludeClothingIdSets: [],
      maxResults: 8,
    });
    const actualCards = visibleCardContract(internals, actual, weather, `pool-hit-${refreshIndex + 1}`);
    const expectedCards = visibleCardContract(internals, expected, weather, `full-${refreshIndex + 1}`);

    assert.equal(actual.length, 8);
    assert.equal(actual.countContract.executionMode, 'candidate_pool_hit');
    assert.deepEqual(actualCards, expectedCards);
    assert.equal(actualCards.every((card) => card.title && card.outfitKey), true);
    for (const card of actualCards) {
      assert.equal(allVisibleKeys.has(card.outfitKey), false);
      allVisibleKeys.add(card.outfitKey);
      excludedOutfitKeys.push(card.outfitKey);
    }
  }
  assert.equal(allVisibleKeys.size, 48);
});

test('sport candidate pool returns full batches, a legal tail, then an empty exhausted batch', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = buildTwentyFiveCandidateSportWardrobe();
  const weather = { temp: 22, weather: 'clear' };
  const initial = internals.generateRuleRecommendations({
    clothes,
    scene: 'sport',
    weather,
    weatherMode: 'live',
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  });
  const identity = buildCandidatePoolIdentity({
    openid: 'test-openid', clothes, sceneKey: 'sport', weather: { ...weather, mode: 'live' }, weatherMode: 'live',
    recommendationProfile: profile(), timeOfDay: 'all_day', engineVersion: 'generateOutfit-recommendation-v6-1-title-invariant-fix-20260724',
  });
  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:sport-tail', identity, candidates: initial.candidatePoolCandidates, now: 1,
  });
  const exclusions = initial.map((candidate) => candidate.outfitKey);
  const next = () => internals.generateCandidatePoolRecommendations({
    pool, clothes, scene: 'sport', weather: { ...weather, mode: 'live' }, weatherMode: 'live',
    excludedOutfitKeys: exclusions, excludeClothingIdSets: [], maxResults: 8,
  });

  const full = next();
  exclusions.push(...full.map((candidate) => candidate.outfitKey));
  const secondFull = next();
  exclusions.push(...secondFull.map((candidate) => candidate.outfitKey));
  const tail = next();
  exclusions.push(...tail.map((candidate) => candidate.outfitKey));
  const exhausted = next();

  assert.equal(full.length, 8);
  assert.equal(secondFull.length, 8);
  assert.equal(tail.length, 1);
  assert.equal(tail.countContract.tailBatchAuthorized, true);
  assert.equal(exhausted.length, 0);
  assert.equal(exhausted.countContract.poolExhaustedAfterConsume, true);
});

test('real composition candidates keep roles, score, reasons, copy, and QA on one canonical object', () => {
  const internals = loadGenerateOutfitInternals();
  const weather = { temp: 22, weather: 'clear' };
  const recommendations = generate(internals, {
    clothes: buildTwentyFiveCandidateSportWardrobe(),
    scene: 'sport',
    weather,
  });

  assert.ok(recommendations.length > 0);
  for (const candidate of recommendations) {
    const hasTwoPiece = Boolean(candidate.itemsByRole.top && candidate.itemsByRole.bottom);
    const hasOnePiece = Boolean(candidate.itemsByRole.onepiece);
    assert.equal(hasTwoPiece || hasOnePiece, true);
    assert.ok(candidate.itemsByRole.shoes);
    assert.equal(['top+bottom+shoes', 'onepiece+shoes'].includes(candidate.archetype), true);
    assert.ok(candidate.totalScore > 0);
    assert.ok(candidate.eligibilityReasonCandidates.length > 0);
    assert.ok(candidate.eligibilityReason?.code);
  }

  const tempOutfits = recommendations.map((candidate, index) => internals.toTempOutfit(candidate, {
    openid: 'test-openid',
    scene: 'sport',
    targetDate: '2026-07-18',
    timeOfDay: 'all_day',
    weather,
    weatherMode: 'live',
    now: '2026-07-18T08:00:00.000Z',
    recommendationBatchId: `canonical-${index}`,
  }));
  const compiled = compileRecommendationLanguageV3({ outfits: tempOutfits, scene: 'sport', weather });
  const qa = buildQaBatchAudit({
    requestScene: 'sport',
    responseScene: 'sport',
    weatherMode: 'live',
    hasUsableWeather: true,
    weatherSnapshotPresent: true,
    temperatureBandApplied: true,
    allCandidates: recommendations,
    acceptedCandidates: recommendations,
    selectedOutfits: recommendations,
    compiledOutfits: compiled,
  });

  assert.equal(compiled.length, recommendations.length);
  for (let index = 0; index < compiled.length; index += 1) {
    const candidate = recommendations[index];
    const outfit = compiled[index];
    assert.deepEqual(outfit.clothingIds.slice().sort(), candidate.itemIds.slice().sort());
    assert.equal(outfit.title, candidate.title);
    assert.equal(outfit.styleTags.length, 1);
    assert.notDeepEqual(outfit.styleTags, deriveDisplayTagsV3(candidate.displayFacts));
    assert.equal(outfit.styleTags[0], '运动');
    assert.equal(outfit.eligibilityReason.code, candidate.eligibilityReason.code);
    assert.ok(outfit.copyContract.todayReason.trim());
  }
  assert.ok(qa.finalCards.every((card) => [2, 3].includes(card.itemAliases.length)));
  assert.ok(qa.finalCards.every((card) => card.score > 0 && card.reasonCode));
});

test('valid work and sport fixtures retain eligible candidates through the canonical pipeline', () => {
  const internals = loadGenerateOutfitInternals();
  const workWardrobe = [
    { _id: 'work-top', category: 'top', subcategory: 'office simple shirt', customName: 'office simple shirt', styleTags: ['simple'], sceneTags: ['work'], colorPalette: [{ name: 'black' }] },
    { _id: 'work-bottom', category: 'bottom', subcategory: 'straight long pants', customName: 'straight long pants', pantsLength: 'long', styleTags: ['simple'], sceneTags: ['work'], colorPalette: [{ name: 'gray' }] },
    { _id: 'work-shoes', category: 'shoes', subcategory: 'simple loafer shoes', customName: 'simple loafer shoes', shoeType: 'loafer', styleTags: ['simple'], sceneTags: ['work'], colorPalette: [{ name: 'black' }] },
  ];
  const work = generate(internals, { clothes: workWardrobe, scene: 'work', weather: { temp: 24, weather: 'clear' } });
  const sport = generate(internals, { clothes: buildTwentyFiveCandidateSportWardrobe(), scene: 'sport', weather: { temp: 22, weather: 'clear' } });

  assert.ok(work.debug.guardAcceptedCount > 0);
  assert.ok(work.length > 0);
  assert.ok(sport.debug.guardAcceptedCount > 0);
  assert.ok(sport.length > 0);
});

test('confirmed-shape work batch keeps an unmapped-specific path through score selection and fact-bound final cards', () => {
  const internals = loadGenerateOutfitInternals();
  const weather = normalizeRecommendationWeather(null, 'disabled');
  const recommendations = internals.generateRuleRecommendations({
    clothes: buildConfirmedShapeUnmappedWorkWardrobe(),
    scene: 'work',
    weather,
    weatherMode: 'disabled',
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
    debugRecommendationAudit: true,
  });

  assert.ok(recommendations.debug.candidateCount > 0);
  assert.ok(recommendations.debug.guardAcceptedCount > 0);
  assert.ok(recommendations.length > 0);
  assert.equal(recommendations.every((candidate) => candidate.eligibilityReason.code === 'WORK_BASELINE_PRESENTABLE'), true);
  assert.equal(recommendations.every((candidate) => candidate.eligibilityReason.evidence.every((record) => record.authorized !== false)), true);

  const tempOutfits = recommendations.map((candidate, index) => internals.toTempOutfit(candidate, {
    openid: 'test-openid',
    scene: 'work',
    targetDate: '2026-07-20',
    timeOfDay: 'all_day',
    weather,
    weatherMode: 'disabled',
    now: '2026-07-20T08:00:00.000Z',
    recommendationBatchId: `baseline-work-${index}`,
  }));
  const compiled = compileRecommendationLanguageV3({ outfits: tempOutfits, scene: 'work', weather });
  const finalized = finalizeAcceptedRecommendations(compiled, {
    mode: 'new_recommendation',
    requestedCount: 8,
  });
  const audit = buildQaBatchAudit({
    requestScene: 'work',
    responseScene: 'work',
    weatherMode: 'disabled',
    hasUsableWeather: false,
    weatherSnapshotPresent: false,
    temperatureBandApplied: false,
    guardAcceptedCandidates: recommendations.debug._auditGuardAcceptedCandidates,
    guardRejectedCandidates: recommendations.debug._auditGuardRejectedCandidates,
    selectedOutfits: recommendations,
    compiledOutfits: finalized.finalRecommendations,
  });

  assert.ok(audit.counts.accepted > 0);
  assert.equal(audit.counts.rejected, 0);
  assert.ok(audit.counts.selected > 0);
  assert.ok(audit.finalCards.length > 0);
  assert.equal(
    audit.finalCards.every((card) => card.reasonCode === 'WORK_BASELINE_PRESENTABLE'),
    true,
  );
  assert.equal(audit.rejectionReasonHistogram.some((entry) => entry.reason === 'UNMAPPED_ELIGIBILITY_PATH'), false);
});

test('set-level selection covers comparable work items instead of letting one item dominate eight cards', () => {
  const internals = loadGenerateOutfitInternals();
  const clothes = [
    ...Array.from({ length: 4 }, (_, index) => ({
      _id: `top-${index}`,
      category: 'top',
      subcategory: `office simple shirt ${index}`,
      customName: `office simple shirt ${index}`,
      styleTags: ['simple'],
      sceneTags: ['work'],
      colorPalette: [{ name: index % 2 ? 'black' : 'white' }],
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      _id: `bottom-${index}`,
      category: 'bottom',
      subcategory: `straight long pants ${index}`,
      customName: `straight long pants ${index}`,
      pantsLength: 'long',
      styleTags: ['simple'],
      sceneTags: ['work'],
      colorPalette: [{ name: index % 2 ? 'gray' : 'black' }],
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      _id: `shoe-${index}`,
      category: 'shoes',
      subcategory: `simple loafer shoes ${index}`,
      customName: `simple loafer shoes ${index}`,
      shoeType: 'loafer',
      styleTags: ['simple'],
      sceneTags: ['work'],
      colorPalette: [{ name: index % 2 ? 'black' : 'brown' }],
    })),
  ];
  const recommendations = generate(internals, {
    clothes,
    scene: 'work',
    weather: { temp: 24, weather: 'clear' },
    maxResults: 8,
  });
  const maxReuse = (role) => Math.max(...Object.values(recommendations.reduce((counts, candidate) => {
    const id = candidate.itemsByRole[role]?._id;
    if (id) counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {})));

  assert.equal(recommendations.length, 8);
  assert.ok(maxReuse('top') < 4);
  assert.ok(maxReuse('bottom') < 4);
  assert.ok(maxReuse('shoes') < 4);
  assert.ok(recommendations.every((candidate) => candidate.batchSelection?.selectionBasis));
});

test('disabled weather stays absent from candidate building through finalization', () => {
  const internals = loadGenerateOutfitInternals();
  const weather = normalizeRecommendationWeather(null, 'disabled');
  const clothes = [
    {
      _id: 'home-sleeveless-top',
      category: 'top',
      subcategory: '无袖上衣',
      customName: '无袖上衣',
      sleeveLength: 'sleeveless',
      styleTags: ['休闲'],
      sceneTags: ['居家'],
      seasonTags: [],
      colorPalette: [{ name: '白色', hex: '#ffffff' }],
      confidence: 0.9,
    },
    {
      _id: 'home-shorts',
      category: 'bottom',
      subcategory: '家居短裤',
      customName: '家居短裤',
      pantsLength: 'short',
      styleTags: ['休闲'],
      sceneTags: ['居家'],
      seasonTags: [],
      colorPalette: [{ name: '灰色', hex: '#999999' }],
      confidence: 0.9,
    },
  ];
  const recommendations = internals.generateRuleRecommendations({
    clothes,
    scene: 'home',
    weather,
    weatherMode: 'disabled',
    recommendationProfile: {
      styleTags: [],
      colorPreference: [],
      avoidTags: [],
      fitPreference: 'unknown',
      genderPreference: 'unknown',
      temperatureSensitivity: 'normal',
    },
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  });

  assert.ok(recommendations.length > 0);
  assert.equal(recommendations.debug.weatherMode, 'disabled');
  assert.equal(recommendations.debug.hasUsableWeather, false);
  assert.equal(recommendations.debug.temperatureBandApplied, false);
  assert.equal(recommendations.debug.temperatureFilterSkippedReason, 'NO_USABLE_WEATHER');
  assert.equal(
    recommendations.debug.candidateCountBeforeTemperatureFilter,
    recommendations.debug.candidateCountAfterTemperatureFilter,
  );
  assert.equal(recommendations.debug.weatherRejectedCount, 0);
  assert.equal(
    recommendations.some((candidate) => candidate.eligibilityReason.code === 'HOME_SLEEVELESS_SHORTS'),
    true,
  );

  const weatherSnapshot = toWeatherSnapshot(weather);
  const tempOutfits = recommendations.map((recommendation, index) => internals.toTempOutfit(recommendation, {
    openid: 'test-openid',
    scene: 'home',
    targetDate: '2026-07-17',
    timeOfDay: 'all_day',
    weather: weatherSnapshot,
    weatherMode: 'disabled',
    now: '2026-07-17T08:00:00.000Z',
    recommendationBatchId: `disabled-weather-${index}`,
  }));
  const compiled = compileRecommendationLanguageV3({
    outfits: tempOutfits,
    scene: 'home',
    weather: weatherSnapshot,
  });
  const finalized = finalizeAcceptedRecommendations(compiled, {
    mode: 'new_recommendation',
    requestedCount: 8,
  });

  assert.ok(finalized.finalRecommendations.length > 0);
  assert.equal(finalized.finalRecommendations.every((outfit) => !outfit.weatherSnapshot), true);
  assert.equal(finalized.finalRecommendations.every((outfit) => outfit.weatherMode === 'disabled'), true);
  assert.equal(finalized.finalRecommendations.some((outfit) => (
    outfit.coreEligibilityReasonCode === 'HOME_SLEEVELESS_SHORTS'
      || outfit.eligibilityReason?.code === 'HOME_SLEEVELESS_SHORTS'
  )), true);
  assert.equal(finalized.finalRecommendations.every((outfit) => (
    typeof outfit.copyContract?.todayReason === 'string'
      && outfit.copyContract.todayReason.trim().length > 0
      && !/℃|天气|温度|闷热|偏凉|寒冷/.test(outfit.copyContract.todayReason)
  )), true);
  const serializedPipeline = JSON.stringify({ recommendations, tempOutfits, compiled, finalized });
  assert.doesNotMatch(serializedPipeline, /"(?:temp|temperature)":22|22℃/);
  assert.doesNotMatch(
    serializedPipeline,
    /WEATHER_(?:HOT|MILD|COOL|COLD)|(?:HOT|COOL|COLD)_DAY|humid_hot|temperature_fit/i,
  );
});
