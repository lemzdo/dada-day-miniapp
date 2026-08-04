const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ELIGIBILITY_REJECTION_AUDIT_VERSION,
  MAX_ELIGIBILITY_REJECTION_SAMPLES,
  buildEligibilityRejectionAudit,
  fitEligibilityRejectionAuditToBudget,
  serializedBytes,
} = require('./eligibilityRejectionAudit');

function fact(itemId, category, flags = {}) {
  return {
    itemId,
    category,
    visibleFacts: [],
    sportSignals: [],
    ...flags,
  };
}

function candidate(index, flags = {}) {
  const suffix = String(index);
  const facts = [
    fact(`top-${suffix}`, 'top', flags.top),
    fact(`bottom-${suffix}`, 'bottom', flags.bottom),
    fact(`shoe-${suffix}`, 'shoes', flags.shoes),
  ];
  return {
    itemIds: facts.map((entry) => entry.itemId),
    roleItemIds: {
      top: facts[0].itemId,
      bottom: facts[1].itemId,
      shoes: facts[2].itemId,
    },
    derivedFacts: { sceneFacts: facts },
  };
}

function rejected(index, rejectReasons, rejectionStage = 'scene_eligibility', flags = {}) {
  return { candidate: candidate(index, flags), rejectReasons, rejectionStage };
}

function build(overrides = {}) {
  return buildEligibilityRejectionAudit({
    enabled: true,
    sceneKey: 'sport',
    generatedCount: 132,
    guardEnteredCount: 132,
    guardAcceptedCount: overrides.accepted?.length || 0,
    guardRejectedCount: overrides.rejected?.length || 132,
    guardAcceptedCandidates: overrides.accepted || [],
    guardRejectedCandidates: overrides.rejected || [rejected(1, ['SPORT_NON_SPORT_APPAREL'])],
    weatherMode: overrides.weatherMode || 'disabled',
    weather: overrides.weather,
    weatherSnapshot: overrides.weatherSnapshot,
  });
}

test('eligibility audit preserves the 132 guard counts', () => {
  const audit = build({ rejected: Array.from({ length: 132 }, (_, index) => rejected(index, ['SPORT_NON_SPORT_APPAREL'])) });
  assert.equal(audit.version, ELIGIBILITY_REJECTION_AUDIT_VERSION);
  assert.equal(audit.generatedCount, 132);
  assert.equal(audit.guardEnteredCount, 132);
  assert.equal(audit.guardRejectedCount, 132);
});

test('reason histogram counts every production rejection code', () => {
  const audit = build({ rejected: [
    rejected(1, ['SPORT_NON_SPORT_APPAREL', 'SPORT_INVALID_SHOE']),
    rejected(2, ['SPORT_NON_SPORT_APPAREL']),
  ] });
  assert.deepEqual(audit.rejectionReasonHistogram, {
    SPORT_INVALID_SHOE: 1,
    SPORT_NON_SPORT_APPAREL: 2,
  });
});

test('reason combinations are unique and sorted before aggregation', () => {
  const audit = build({ rejected: [
    rejected(1, ['SPORT_NON_SPORT_APPAREL', 'SPORT_INVALID_SHOE']),
    rejected(2, ['SPORT_INVALID_SHOE', 'SPORT_NON_SPORT_APPAREL']),
  ] });
  assert.deepEqual(audit.rejectionReasonCombinationHistogram, {
    'SPORT_INVALID_SHOE+SPORT_NON_SPORT_APPAREL': 2,
  });
});

test('stage histogram uses the stage attached by the production guard', () => {
  const audit = build({ rejected: [
    rejected(1, ['HOT_WEATHER_WARM_ITEM'], 'wearability_guard'),
    rejected(2, ['SPORT_INVALID_SHOE'], 'scene_eligibility'),
  ] });
  assert.deepEqual(audit.rejectionStageHistogram, {
    scene_eligibility: 1,
    wearability_guard: 1,
  });
});

test('same reason and category tuple contributes one sample', () => {
  const audit = build({ rejected: [
    rejected(1, ['SPORT_INVALID_SHOE']),
    rejected(2, ['SPORT_INVALID_SHOE']),
  ] });
  assert.equal(audit.samples.length, 1);
  assert.equal(audit.samples[0].sampleIndex, 0);
});

test('sample order is deterministic across repeated builds', () => {
  const rejectedEntries = [
    rejected(3, ['SPORT_NON_SPORT_APPAREL'], 'scene_eligibility', { top: { isTshirtLike: true } }),
    rejected(1, ['SPORT_INVALID_SHOE'], 'scene_eligibility', { shoes: { isHomeShoe: true } }),
    rejected(2, ['SPORT_INVALID_SHOE', 'SPORT_NON_SPORT_APPAREL']),
  ];
  assert.deepEqual(build({ rejected: rejectedEntries }).samples, build({ rejected: rejectedEntries }).samples);
});

test('sample count is bounded at twelve', () => {
  const rejectedEntries = Array.from({ length: 60 }, (_, index) => rejected(index, [
    index % 2 ? 'SPORT_NON_SPORT_APPAREL' : 'SPORT_INVALID_SHOE',
  ], 'scene_eligibility', {
    top: { isTshirtLike: index % 4 === 0, isFormalLike: index % 4 === 1, isWarmTop: index % 4 === 2 },
    bottom: { isShorts: index % 3 === 0, isLongPants: index % 3 === 1, isWarmBottom: index % 3 === 2 },
    shoes: { isSportShoe: index % 6 === 0, isCleanSneaker: index % 6 === 1, isHomeShoe: index % 6 === 2, isSlipperLike: index % 6 === 3, isCrocsLike: index % 6 === 4, isBootLike: index % 6 === 5 },
  }));
  const audit = build({ rejected: rejectedEntries });
  assert.equal(MAX_ELIGIBILITY_REJECTION_SAMPLES, 12);
  assert.ok(audit.samples.length <= MAX_ELIGIBILITY_REJECTION_SAMPLES);
  assert.equal(audit.truncated, true);
});

test('samples expose only anonymous role and controlled sport facts', () => {
  const audit = build({ rejected: [rejected(1, ['SPORT_INVALID_SHOE'], 'scene_eligibility', {
    top: { isTshirtLike: true }, bottom: { isShorts: true }, shoes: { isHomeShoe: true },
  })] });
  const sample = audit.samples[0];
  assert.deepEqual(Object.keys(sample).sort(), ['bottom', 'rejectionCodes', 'rejectionStage', 'roleCompleteness', 'sampleIndex', 'shoes', 'top', 'weather']);
  assert.equal(sample.top.category, 'top');
  assert.equal(sample.top.subtype, 'tshirt');
  assert.equal(sample.top.sportFacts.isTshirtLike, true);
  assert.equal(Object.hasOwn(sample.top.sportFacts, 'itemId'), false);
  assert.equal(JSON.stringify(sample).includes('top-1'), false);
});

test('category distribution reports role completeness and sport fact counts', () => {
  const audit = build({ rejected: [rejected(1, ['SPORT_INVALID_SHOE'], 'scene_eligibility', {
    top: { isTshirtLike: true }, bottom: { isShorts: true }, shoes: { isHomeShoe: true },
  })] });
  assert.equal(audit.categoryDistribution.roleCompleteness.complete, 1);
  assert.equal(audit.categoryDistribution.sportFactCounts.isTshirtLike, 1);
  assert.equal(audit.categoryDistribution.sportFactCounts.isShorts, 1);
});

test('safe sport candidate is derived from accepted guard candidates', () => {
  const audit = build({
    accepted: [candidate(10, {
      top: { isTshirtLike: true },
      bottom: { isShorts: true },
      shoes: { isSportShoe: true, invalidSportShoe: false },
    })],
    rejected: [],
  });
  assert.deepEqual(audit.categoryDistribution.safeSportCandidate, { exists: true, count: 1 });
});

test('weather sample keeps only mode, bucket, and precipitation boolean', () => {
  const audit = build({
    rejected: [rejected(1, ['HOT_WEATHER_WARM_ITEM'], 'wearability_guard')],
    weatherMode: 'live',
    weather: { temp: 31, precipitation: 2, weather: 'private weather text' },
  });
  assert.deepEqual(audit.samples[0].weather, { mode: 'live', temperatureBucket: 'hot', precipitationPresent: true });
  assert.equal(JSON.stringify(audit).includes('private weather text'), false);
});

test('non-sport or disabled audit requests return no object', () => {
  assert.equal(buildEligibilityRejectionAudit({ enabled: true, sceneKey: 'work' }), undefined);
  assert.equal(buildEligibilityRejectionAudit({ enabled: false, sceneKey: 'sport' }), undefined);
});

test('budget trimming preserves histograms and marks truncation', () => {
  const audit = build({ rejected: Array.from({ length: 40 }, (_, index) => rejected(index, [
    `REASON_${index}`,
  ], 'scene_eligibility', {
    top: { isTshirtLike: index % 2 === 0, isFormalLike: index % 3 === 0, isWarmTop: index % 5 === 0 },
  })) });
  const reasonHistogram = { ...audit.rejectionReasonHistogram };
  fitEligibilityRejectionAuditToBudget(audit, 1000);
  assert.deepEqual(audit.rejectionReasonHistogram, reasonHistogram);
  assert.equal(audit.truncated, true);
  assert.equal(audit.samples.length, 0);
});

test('serializedBytes reports actual UTF-8 JSON bytes', () => {
  const audit = build({ rejected: [rejected(1, ['SPORT_INVALID_SHOE'])] });
  assert.equal(audit.serializedBytes, serializedBytes(audit));
  assert.ok(audit.serializedBytes > JSON.stringify(audit).length - 1);
});
