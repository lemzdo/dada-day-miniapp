'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const {
  buildEligibilityRejectionAudit,
} = require('./eligibilityRejectionAudit');
const {
  compileRecommendationLanguageV3,
} = require('./recommendationLanguageV3');
const {
  finalizeAcceptedRecommendations,
} = require('./recommendationCopyFinalization');
const {
  canonicalizeRecommendationBatch,
} = require('./recommendationPresentation');
const {
  applyWearabilityAndSceneEligibility,
  evaluateSceneEligibilityV3,
  isProvenLightSportBaseline,
} = require('./sceneEligibilityV3');
const { deriveSceneEligibilityFacts } = require('./itemWearabilityFacts');
const {
  createRealSportEvidenceFixture,
} = require('./sportEligibilityEvidence.fixture');
const { adaptLegacyVisibleFactItem } = require('./recommendationEligibilityFacts');

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

function cloneClothes(clothes) {
  return clothes.map((item) => ({
    ...item,
    ...(Array.isArray(item.structuredAiFacts)
      ? { structuredAiFacts: item.structuredAiFacts.slice() }
      : {}),
  }));
}

function buildNegativeCases() {
  const fixture = createRealSportEvidenceFixture();
  const [top, bottom, shoes] = fixture.clothes;
  return {
    baseline: fixture.clothes,
    slippers: [top, bottom, { _id: 'negative-slippers', category: 'shoes', subcategory: 'slippers' }],
    restrictedBottom: [top, { _id: 'negative-restricted-bottom', category: 'bottom', subcategory: 'activity-restricted long pants' }, shoes],
    formalShoes: [top, bottom, { _id: 'negative-formal-shoes', category: 'shoes', subcategory: 'formal dress shoes' }],
    incomplete: [top, shoes],
    professional: [
      { _id: 'professional-top', category: 'top', subcategory: 'training top', structuredAiFacts: ['sport_top'] },
      { _id: 'professional-bottom', category: 'bottom', subcategory: 'training pants', structuredAiFacts: ['sport_bottom'] },
      { _id: 'professional-shoes', category: 'shoes', subcategory: 'running shoes', structuredAiFacts: ['sport_shoe'] },
    ],
  };
}

function evaluate(items, scene = 'sport') {
  return evaluateSceneEligibilityV3({
    scene,
    weather: { mode: 'disabled', temp: null },
    items: cloneClothes(items),
  });
}

function candidate(items, index = 0) {
  return {
    itemIds: items.map((item) => item._id),
    items: cloneClothes(items),
    rankingScore: 80 - index,
  };
}

test('real redacted sport evidence passes the exact light baseline', () => {
  const fixture = createRealSportEvidenceFixture();
  const result = evaluate(fixture.clothes);

  assert.equal(result.eligible, true);
  assert.equal(result.hardRejected, false);
  assert.equal(result.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'), false);
  assert.equal(result.eligibilityReason.code, 'SPORT_LIGHT_ACTIVITY_SET');
  assert.equal(result.acceptReasons.includes('SPORT_LIGHT_ACTIVITY_BASELINE'), true);
});

test('real evidence travels generation through eligibility, scoring, selection, and canonical card', () => {
  const internals = loadGenerateOutfitInternals();
  const fixture = createRealSportEvidenceFixture();
  const recommendations = internals.generateRuleRecommendations({
    clothes: cloneClothes(fixture.clothes),
    scene: fixture.sceneKey,
    weather: fixture.weather,
    weatherMode: fixture.weather.mode,
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
  });

  assert.equal(recommendations.debug.candidateCount, 1);
  assert.equal(recommendations.debug.guardAcceptedCount, 1);
  assert.equal(recommendations.debug.guardRejectedCount, 0);
  assert.equal(recommendations.debug.rejectReasonCounts.SPORT_NON_SPORT_APPAREL, undefined);
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].eligibilityReason.code, 'SPORT_LIGHT_ACTIVITY_SET');

  const tempOutfits = recommendations.map((recommendation, index) => internals.toTempOutfit(recommendation, {
    openid: 'test-openid',
    scene: fixture.sceneKey,
    targetDate: '2026-07-22',
    timeOfDay: 'all_day',
    weather: fixture.weather,
    weatherMode: fixture.weather.mode,
    now: '2026-07-22T08:00:00.000Z',
    recommendationBatchId: `real-sport-evidence-${index}`,
  }));
  const compiled = compileRecommendationLanguageV3({
    outfits: tempOutfits,
    scene: fixture.sceneKey,
    weather: fixture.weather,
  });
  const finalized = finalizeAcceptedRecommendations(compiled, {
    mode: 'new_recommendation',
    requestedCount: 8,
  });
  const cards = canonicalizeRecommendationBatch(finalized.finalRecommendations, { scene: fixture.sceneKey });

  assert.equal(finalized.acceptedCount, 1);
  assert.equal(finalized.finalRecommendationCount, 1);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].clothingIds, fixture.clothes.map((item) => item._id));
  assert.equal(cards[0].eligibilityReason.code, 'SPORT_LIGHT_ACTIVITY_SET');
  assert.equal(typeof cards[0].copyContract.todayReason, 'string');
  assert.ok(cards[0].copyContract.todayReason.length > 0);
});

test('slippers, restricted bottoms, formal shoes, and incomplete roles stay rejected', () => {
  const cases = buildNegativeCases();
  const slippers = evaluate(cases.slippers);
  const restrictedBottom = evaluate(cases.restrictedBottom);
  const formalShoes = evaluate(cases.formalShoes);
  const incomplete = evaluate(cases.incomplete);

  assert.equal(slippers.eligible, false);
  assert.ok(slippers.rejectReasons.includes('SPORT_INVALID_SHOE'));
  assert.equal(slippers.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'), true);
  assert.equal(restrictedBottom.eligible, false);
  assert.ok(restrictedBottom.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'));
  assert.equal(formalShoes.eligible, false);
  assert.ok(formalShoes.rejectReasons.includes('SPORT_INVALID_SHOE'));
  assert.equal(incomplete.eligible, false);
  assert.equal(incomplete.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'), true);
});

test('professional sport qualification remains unchanged', () => {
  const result = evaluate(buildNegativeCases().professional);

  assert.equal(result.eligible, true);
  assert.equal(result.rejectReasons.length, 0);
  assert.equal(result.acceptReasons.includes('SPORT_APPAREL'), true);
  assert.equal(result.acceptReasons.includes('SPORT_LIGHT_ACTIVITY_BASELINE'), false);
});

test('home, work, and date eligibility remain unchanged', () => {
  const home = evaluate([
    { _id: 'home-top', category: 'top', subcategory: 'home tee', styleTags: ['casual'] },
    { _id: 'home-bottom', category: 'bottom', subcategory: 'home shorts', styleTags: ['casual'] },
    { _id: 'home-shoes', category: 'shoes', subcategory: 'slippers' },
  ], 'home');
  const work = evaluate([
    { _id: 'work-top', category: 'top', subcategory: 'office shirt', styleTags: ['simple'] },
    { _id: 'work-bottom', category: 'bottom', subcategory: 'straight long pants', styleTags: ['simple'] },
    { _id: 'work-shoes', category: 'shoes', subcategory: 'office shoes', styleTags: ['simple'] },
  ], 'work');
  const date = evaluate([
    { _id: 'date-dress', category: 'onepiece', subcategory: 'date dress', styleTags: ['simple', 'date'] },
    { _id: 'date-shoes', category: 'shoes', subcategory: 'loafers', styleTags: ['simple', 'date'] },
  ], 'date');

  assert.equal(home.eligible, true);
  assert.equal(work.eligible, true);
  assert.equal(date.eligible, true);
});

test('eligibility rejection audit conserves counts and excludes the accepted baseline from rejection reasons', () => {
  const cases = buildNegativeCases();
  const candidates = [
    candidate(cases.baseline),
    candidate(cases.slippers, 1),
    candidate(cases.restrictedBottom, 2),
    candidate(cases.formalShoes, 3),
    candidate(cases.incomplete, 4),
  ];
  const guarded = applyWearabilityAndSceneEligibility(candidates, {
    scene: 'sport',
    weather: { mode: 'disabled', temp: null },
  });
  const audit = buildEligibilityRejectionAudit({
    enabled: true,
    sceneKey: 'sport',
    generatedCount: candidates.length,
    guardEnteredCount: candidates.length,
    guardAcceptedCount: guarded.accepted.length,
    guardRejectedCount: guarded.rejected.length,
    guardAcceptedCandidates: guarded.accepted,
    guardRejectedCandidates: guarded.rejected,
    weatherMode: 'disabled',
    weather: { mode: 'disabled', temp: null },
  });

  assert.equal(audit.generatedCount, 5);
  assert.equal(audit.guardEnteredCount, 5);
  assert.equal(audit.guardAcceptedCount, 1);
  assert.equal(audit.guardRejectedCount, 4);
  assert.equal(audit.guardAcceptedCount + audit.guardRejectedCount, audit.guardEnteredCount);
  assert.equal(audit.rejectionStageHistogram.scene_eligibility, 4);
  assert.equal(audit.categoryDistribution.safeSportCandidate.exists, true);
  assert.equal(audit.categoryDistribution.safeSportCandidate.count, 1);
  const rejectedNonSportApparelCount = guarded.rejected.filter((entry) =>
    entry.rejectReasons.includes('SPORT_NON_SPORT_APPAREL')).length;
  assert.equal(audit.rejectionReasonHistogram.SPORT_NON_SPORT_APPAREL, rejectedNonSportApparelCount);
  assert.equal(audit.rejectionReasonHistogram.SPORT_NON_SPORT_APPAREL < audit.guardEnteredCount, true);
});

test('debugRecommendationAudit false keeps QA diagnostics out of the recommendation result', () => {
  const internals = loadGenerateOutfitInternals();
  const fixture = createRealSportEvidenceFixture();
  const recommendations = internals.generateRuleRecommendations({
    clothes: cloneClothes(fixture.clothes),
    scene: fixture.sceneKey,
    weather: fixture.weather,
    weatherMode: fixture.weather.mode,
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
    debugRecommendationAudit: false,
  });

  assert.equal(Object.prototype.hasOwnProperty.call(recommendations, 'eligibilityRejectionAudit'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(recommendations.debug, 'eligibilityRejectionAudit'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(recommendations[0], 'eligibilityRejectionAudit'), false);
});

test('light baseline predicate requires the complete evidence boundary', () => {
  const cases = buildNegativeCases();
  const facts = cloneClothes(cases.baseline).map((item, index) => deriveSceneEligibilityFacts(
    item,
    adaptLegacyVisibleFactItem(item, index),
  ));

  assert.equal(isProvenLightSportBaseline(facts), true);
  assert.equal(isProvenLightSportBaseline(facts.slice(0, 2)), false);
  assert.equal(isProvenLightSportBaseline([]), false);
});
