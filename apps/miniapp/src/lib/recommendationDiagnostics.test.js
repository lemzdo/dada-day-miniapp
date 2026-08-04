const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  CLIENT_RECOMMEND_LOG_MAX_BYTES,
  buildRecommendationQaLogSummary,
  isRecommendationLifecycleLoggingEnabled,
  logRecommendationEvent,
  serializedLogBytes,
} = require('./recommendationDiagnostics');

function createLogger() {
  const entries = [];
  const write = (level) => (label, payload) => entries.push({ level, label, payload });
  return {
    entries,
    logger: { log: write('log'), info: write('info'), warn: write('warn'), error: write('error') },
  };
}

function qaGateSummary(overrides = {}) {
  return {
    version: 'qa-batch-audit-v6-1-semantic-presentation',
    counts: { candidate: 120, generated: 120, accepted: 100, rejected: 20, selected: 8 },
    finalCardCount: 8,
    alternativeCandidateCount: 8,
    qaGatePassed: true,
    gateStatus: 'passed',
    qaBlockReasons: [],
    duplicateCause: 'NONE',
    placeholderTitleCount: 0,
    syntheticSuffixCount: 0,
    availableDifferentiatorCount: 0,
    titleDuplicateWarningCount: 0,
    unsupportedClaimCount: 0,
    tagSceneMismatchCount: 0,
    cardConsistencyFailures: 0,
    qaTruncated: false,
    ...overrides,
  };
}

test('client lifecycle logs are limited to the recommend contract and stay below 8KB', () => {
  const { entries, logger } = createLogger();
  logRecommendationEvent('[RecommendStart]', {
    auditId: 'rec_client_1', seq: 1, sceneKey: 'work', scene: '上班', trigger: 'initial',
  }, logger);
  logRecommendationEvent('[RecommendResponse]', {
    auditId: 'rec_client_1', seq: 1, outfitCount: 8, timings: { totalMs: 18 }, responseBytes: { totalDataBytes: 4096 },
  }, logger);
  logRecommendationEvent('[RecommendDone]', {
    auditId: 'rec_client_1', seq: 1, clientTimings: { cloudRoundTripMs: 4961, imageReadyMs: 12, requestedImageCount: 0, resolvedImageCount: 0, imageTimeout: false },
  }, logger);
  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['[RecommendStart]', '[RecommendResponse]', '[RecommendDone]'],
  );
  entries.forEach((entry) => {
    assert.ok(entry.payload.auditId);
    assert.ok(serializedLogBytes(entry.label, entry.payload) < CLIENT_RECOMMEND_LOG_MAX_BYTES);
  });
});

test('client reject and error preserve diagnostics without response bodies', () => {
  const { entries, logger } = createLogger();
  logRecommendationEvent('[RecommendReject]', {
    auditId: 'rec_reject',
    reason: 'SCENE_MISMATCH',
    seq: 2,
    requestScene: 'work',
    responseSceneKey: 'home',
    responseScene: '居家',
    topLevelKeys: ['outfits', 'debug'],
    cloudBuild: 'generateOutfit-diagnostics-v1-20260720',
    transport: { cacheStatus: 'miss', dataKeysAfterUnwrap: ['outfits'] },
  }, logger);
  logRecommendationEvent('[RecommendError]', {
    auditId: 'rec_error',
    seq: 3,
    message: 'x'.repeat(20_000),
    data: { outfits: Array.from({ length: 1000 }, () => ({ imageUrl: 'https://private.example' })) },
  }, logger);
  assert.equal(entries.length, 2);
  assert.equal(Object.hasOwn(entries[1].payload, 'data'), false, 'response bodies are never logged');
  assert.ok(serializedLogBytes(entries[1].label, entries[1].payload) < CLIENT_RECOMMEND_LOG_MAX_BYTES);
  assert.equal(JSON.stringify(entries[1].payload).includes('https://private.example'), false);
});

test('QA log is a compact aggregate rather than the full QA payload', () => {
  const audit = {
    auditId: 'rec_qa',
    version: 'qa-batch-audit-v4',
    cloudBuild: 'build',
    executionMode: 'candidate_pool_hit',
    candidatePoolIdentityHash: 'pool-hash',
    candidatePoolAgeMs: 123,
    cacheHit: true,
    exclusionsAppliedCount: 8,
    counts: { candidate: 1200, accepted: 1000, rejected: 200, selected: 8 },
    rejectionReasonHistogram: Array.from({ length: 20 }, (_, index) => ({ reason: `R${index}`, count: index })),
    archetypeHistogram: Array.from({ length: 20 }, (_, index) => ({ reason: `A${index}`, count: index })),
    finalCards: Array.from({ length: 8 }, () => ({ itemAliases: ['I01'], titleSignature: 'x'.repeat(500) })),
    alternativeCandidates: Array.from({ length: 8 }, () => ({ itemAliases: ['I02'] })),
    availableDifferentiatorCount: 0,
    duplicateCause: 'FACT_EQUIVALENCE',
    titleDuplicateWarningCount: 8,
    gateStatus: 'passed_with_warnings',
    qaGatePassed: true,
    timings: { totalMs: 12 },
    responseBytes: { totalDataBytes: 1234 },
    qaGateSummary: qaGateSummary({
      gateStatus: 'passed_with_warnings',
      duplicateCause: 'FACT_EQUIVALENCE',
      titleDuplicateWarningCount: 8,
    }),
  };
  const summary = buildRecommendationQaLogSummary(audit);
  assert.equal(summary.finalCardCount, 8);
  assert.equal(summary.alternativeCandidateCount, 8);
  assert.equal(summary.executionMode, 'candidate_pool_hit');
  assert.equal(summary.cacheHit, true);
  assert.equal(summary.exclusionsAppliedCount, 8);
  assert.equal(summary.availableDifferentiatorCount, 0);
  assert.equal(summary.duplicateCause, 'FACT_EQUIVALENCE');
  assert.equal(summary.titleDuplicateWarningCount, 8);
  assert.equal(summary.gateStatus, 'passed_with_warnings');
  assert.equal(summary.qaGateSummary.alternativeCandidateCount, 8);
  assert.equal(Object.hasOwn(summary, 'finalCards'), false);
  assert.ok(serializedLogBytes('[RecommendationQA]', summary) < CLIENT_RECOMMEND_LOG_MAX_BYTES);
});

test('over-budget QA logging preserves only the fixed gate contract when optional diagnostics are dropped', () => {
  const { entries, logger } = createLogger();
  const gate = qaGateSummary({
    gateStatus: 'passed_with_warnings',
    duplicateCause: 'FACT_EQUIVALENCE',
    titleDuplicateWarningCount: 5,
    qaTruncated: true,
  });
  logRecommendationEvent('[RecommendationQA]', {
    auditId: 'rec_qa_truncated',
    qaGateSummary: gate,
    ...Object.fromEntries(Array.from({ length: 18 }, (_, index) => [
      `optionalDiagnostics${index}`,
      'x'.repeat(CLIENT_RECOMMEND_LOG_MAX_BYTES),
    ])),
    eligibilityRejectionAudit: {
      samples: Array.from({ length: 12 }, () => ({ rejectionCodes: ['OPTIONAL'] })),
    },
  }, logger);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].payload.qaGateSummary, gate);
  assert.ok(serializedLogBytes(entries[0].label, entries[0].payload) < CLIENT_RECOMMEND_LOG_MAX_BYTES);
  assert.equal(Object.hasOwn(entries[0].payload, 'optionalDiagnostics0'), false);
});

test('QA logging does not invent a missing required gate field', () => {
  const { entries, logger } = createLogger();
  const gate = qaGateSummary();
  delete gate.alternativeCandidateCount;
  logRecommendationEvent('[RecommendationQA]', { auditId: 'rec_qa_missing', qaGateSummary: gate }, logger);
  assert.equal(Object.hasOwn(entries[0].payload.qaGateSummary, 'alternativeCandidateCount'), false);
});

test('diagnostic timings and response bytes preserve the full server lifecycle map', () => {
  const summary = buildRecommendationQaLogSummary({
    auditId: 'rec_qa_lifecycle_metrics',
    timings: {
      dataLoadMs: 1,
      candidatePoolSaveMs: 4613,
      snapshotUpsertMs: 27,
      serializationMs: 14,
    },
    responseBytes: { totalDataBytes: 2843133, debugBytes: 512 },
  });

  assert.equal(summary.timings.candidatePoolSaveMs, 4613);
  assert.equal(summary.timings.snapshotUpsertMs, 27);
  assert.equal(summary.timings.serializationMs, 14);
  assert.equal(summary.responseBytes.totalDataBytes, 2843133);
  assert.equal(summary.responseBytes.debugBytes, 512);

  const { entries, logger } = createLogger();
  logRecommendationEvent('[RecommendResponse]', {
    auditId: 'rec_client_lifecycle_metrics',
    timings: {
      dataLoadMs: 1,
      candidatePoolSaveMs: 4613,
      snapshotUpsertMs: 27,
      serializationMs: 14,
    },
    responseBytes: { totalDataBytes: 2843133, debugBytes: 512 },
  }, logger);
  assert.equal(entries[0].payload.timings.candidatePoolSaveMs, 4613);
  assert.equal(entries[0].payload.timings.snapshotUpsertMs, 27);
  assert.equal(entries[0].payload.timings.serializationMs, 14);
  assert.equal(entries[0].payload.responseBytes.totalDataBytes, 2843133);
});

test('QA log carries the bounded eligibility rejection audit without candidate identities', () => {
  const audit = {
    version: 'eligibility-rejection-audit-v1',
    generatedCount: 132,
    guardEnteredCount: 132,
    guardAcceptedCount: 0,
    guardRejectedCount: 132,
    rejectionStageHistogram: { scene_eligibility: 132 },
    rejectionReasonHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
    rejectionReasonCombinationHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
    categoryDistribution: {
      top: { categories: { top: 132 }, subtypes: { tshirt: 132 } },
      bottom: { categories: { bottom: 132 }, subtypes: { shorts: 132 } },
      shoes: { categories: { shoes: 132 }, subtypes: { home_shoe: 132 } },
      roleCompleteness: { complete: 132, incomplete: 0 },
      sportFactCounts: { isTshirtLike: 132 },
      safeSportCandidate: { exists: false, count: 0 },
    },
    samples: [{
      sampleIndex: 0,
      rejectionStage: 'scene_eligibility',
      rejectionCodes: ['SPORT_NON_SPORT_APPAREL'],
      top: { category: 'top', subtype: 'tshirt', sportFacts: { isTshirtLike: true } },
      bottom: { category: 'bottom', subtype: 'shorts', sportFacts: { isShorts: true } },
      shoes: { category: 'shoes', subtype: 'home_shoe', sportFacts: { isHomeShoe: true } },
      roleCompleteness: true,
      weather: { mode: 'disabled', temperatureBucket: 'unknown', precipitationPresent: false },
    }],
    truncated: false,
    serializedBytes: 1234,
  };
  const summary = buildRecommendationQaLogSummary({ auditId: 'rec_qa_sport', eligibilityRejectionAudit: audit });
  assert.equal(summary.eligibilityRejectionAudit.guardRejectedCount, 132);
  assert.deepEqual(summary.eligibilityRejectionAudit.rejectionReasonHistogram, { SPORT_NON_SPORT_APPAREL: 132 });
  assert.equal(summary.eligibilityRejectionAudit.samples.length, 1);
  assert.equal(JSON.stringify(summary).includes('clothingId'), false);
  assert.equal(JSON.stringify(summary).includes('imageUrl'), false);
});

test('client QA logging trims only audit samples to stay under the 8KB log budget', () => {
  const baseSample = {
    sampleIndex: 0,
    rejectionStage: 'scene_eligibility',
    rejectionCodes: ['SPORT_NON_SPORT_APPAREL', 'SPORT_INVALID_SHOE'],
    top: {
      category: 'top',
      subtype: 'tshirt',
      sportFacts: Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`controlledFact${index}`, true])),
    },
    bottom: { category: 'bottom', subtype: 'shorts', sportFacts: { isShorts: true } },
    shoes: { category: 'shoes', subtype: 'home_shoe', sportFacts: { isHomeShoe: true } },
    roleCompleteness: true,
    weather: { mode: 'disabled', temperatureBucket: 'unknown', precipitationPresent: false },
  };
  const summary = buildRecommendationQaLogSummary({
    auditId: 'rec_qa_budget',
    eligibilityRejectionAudit: {
      version: 'eligibility-rejection-audit-v1', generatedCount: 132, guardEnteredCount: 132,
      guardAcceptedCount: 0, guardRejectedCount: 132,
      rejectionStageHistogram: { scene_eligibility: 132 },
      rejectionReasonHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
      rejectionReasonCombinationHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
      categoryDistribution: {},
      samples: Array.from({ length: 12 }, (_, index) => ({ ...baseSample, sampleIndex: index })),
      truncated: false,
      serializedBytes: 9000,
    },
  });
  assert.ok(serializedLogBytes('[RecommendationQA]', summary) < CLIENT_RECOMMEND_LOG_MAX_BYTES);
  assert.ok(summary.eligibilityRejectionAudit.samples.length < 12);
  assert.equal(summary.eligibilityRejectionAudit.truncated, true);
  assert.deepEqual(summary.eligibilityRejectionAudit.rejectionReasonHistogram, { SPORT_NON_SPORT_APPAREL: 132 });
});

test('only develop and trial enable lifecycle logs, and old recommendation log labels are gone', () => {
  assert.equal(isRecommendationLifecycleLoggingEnabled('develop'), true);
  assert.equal(isRecommendationLifecycleLoggingEnabled('trial'), true);
  assert.equal(isRecommendationLifecycleLoggingEnabled('release'), false);
  const todayPage = fs.readFileSync(path.join(__dirname, '../pages/today/index.tsx'), 'utf8');
  for (const oldLabel of ['[TodayPage]', '[RecommendationQA_JSON]', '[SceneContractReject]', '[generateCloudOutfit]']) {
    assert.equal(todayPage.includes(oldLabel), false, `${oldLabel} should not be emitted`);
  }
});
