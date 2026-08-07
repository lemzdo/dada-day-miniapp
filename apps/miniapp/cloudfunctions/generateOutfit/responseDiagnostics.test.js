const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { buildQaAuditSummaries, serializedBytes } = require('./services/qaBatchAudit');
const { adaptCompositionCandidate, hydrateCanonicalScore } = require('./services/canonicalCandidate');
const { buildRecommendationCountContract } = require('./shared/countContract');

function loadInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'test-openid' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function makeCandidate(id, score) {
  const candidate = adaptCompositionCandidate({
    outfitKey: `key-${id}`,
    items: [{ _id: id, category: 'top', outfitSlot: 'top', outfitRole: 'core', styleTags: ['casual'] }],
  }, { scene: 'home', weather: {} });
  candidate.rankingScore = score;
  candidate.eligibilityReason = { code: 'HOME_COMFORT', subjectItemIds: [id] };
  hydrateCanonicalScore(candidate, { title: `title-${id}`, scores: { total: score } });
  return candidate;
}

function makeOutfit(index) {
  return {
    id: `outfit-${index}`,
    clothingIds: [`item-${index}`],
    title: `outfit ${index}`,
    imageUrl: `https://cdn.example/${index}.jpg`,
    copyContract: { todayReason: `reason-${index}` },
  };
}

test('response diagnostics keep QA, debug, and total payload inside byte budgets', () => {
  const internals = loadInternals();
  const countContract = buildRecommendationCountContract({ returnedCardCount: 8, remainingUniqueBeforeConsume: 8 });
  const candidates = Array.from({ length: 1200 }, (_, index) => makeCandidate(`item-${index % 31}`, 1200 - index));
  const qaResult = buildQaAuditSummaries({
    auditId: 'rec_response_budget',
    cloudBuild: 'generateOutfit-diagnostics-v1-20260720',
    guardAcceptedCandidates: candidates,
    selectedOutfits: candidates.slice(0, 8),
    compiledOutfits: candidates.slice(0, 8).map((candidate) => ({ outfitKey: candidate.outfitKey, title: candidate.title })),
  });
  const diagnostics = internals.createRecommendationDiagnostics({ auditId: 'rec_response_budget' });
  diagnostics.timings.compositionMs = 2;
  diagnostics.timings.canonicalizeMs = 2;
  diagnostics.timings.eligibilityMs = 2;
  diagnostics.timings.scoringMs = 2;
  diagnostics.timings.batchSelectionMs = 2;
  const logs = [];
  const qaLogs = [];
  const oldLog = console.log;
  const oldInfo = console.info;
  console.log = (...args) => logs.push(args);
  console.info = (...args) => qaLogs.push(args);
  try {
    const response = internals.finalizeRecommendationResponse({
      sceneContract: internals.createRecommendationSceneContract('home'),
      diagnostics,
      qaResult,
      rejectionReasonCounts: { WORK_INVALID_SHOE: 3 },
      data: {
        outfits: Array.from({ length: 8 }, (_, index) => makeOutfit(index)),
        countContract,
        weatherMode: 'disabled',
        debug: {
          auditId: diagnostics.auditId,
          cloudBuildVersion: 'generateOutfit-diagnostics-v1-20260720',
          candidateCount: 1200,
          acceptedCount: 1200,
          rejectedCount: 0,
          selectedCount: 8,
          timings: diagnostics.timings,
          responseBytes: {},
        },
        meta: { auditId: diagnostics.auditId, cloudBuildVersion: 'generateOutfit-diagnostics-v1-20260720' },
      },
    });
    const bytes = internals.measureRecommendationResponse(response);
    assert.ok(bytes.qaBytes < 16 * 1024);
    assert.ok(bytes.debugBytes < 8 * 1024);
    assert.ok(bytes.totalDataBytes < 768 * 1024);
    assert.equal(JSON.stringify(response).includes('allCandidates'), false);
    assert.equal(JSON.stringify(response.qaBatchAudit).includes('https://cdn.example'), false);
    assert.equal(response.qaBatchAudit.finalCards.length <= 8, true);
    assert.equal(response.qaBatchAudit.alternativeCandidates.length <= 8, true);
    assert.equal(response.qaBatchAudit.qaGateSummary.version, response.qaBatchAudit.version);
    assert.equal(response.qaBatchAudit.qaGateSummary.finalCardCount, 8);
    assert.equal(response.qaBatchAudit.qaGateSummary.alternativeCandidateCount, response.qaBatchAudit.alternativeCandidates.length);
    assert.equal(response.qaBatchAudit.qaGateSummary.qaGatePassed, response.qaBatchAudit.qaGatePassed);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[RecommendationServerDone]');
    assert.ok(serializedBytes({ label: logs[0][0], payload: logs[0][1] }) < 16 * 1024);
    assert.equal(qaLogs.length, 1);
    assert.equal(qaLogs[0][0], '[RecommendationQA_SERVER]');
    assert.ok(serializedBytes({ label: qaLogs[0][0], payload: qaLogs[0][1] }) < 16 * 1024);
    if (process.env.REPORT_RESPONSE_DIAGNOSTICS === 'true') {
      process.stdout.write(`response-bytes ${JSON.stringify(bytes)}\n`);
    }
  } finally {
    console.log = oldLog;
    console.info = oldInfo;
  }
});

test('QA-disabled response does not build or return an audit object', () => {
  const internals = loadInternals();
  const diagnostics = internals.createRecommendationDiagnostics({ auditId: 'rec_without_qa' });
  const oldLog = console.log;
  console.log = () => {};
  try {
    const response = internals.finalizeRecommendationResponse({
      sceneContract: internals.createRecommendationSceneContract('home'),
      diagnostics,
      qaResult: null,
      data: {
        outfits: [],
        debug: {
          auditId: diagnostics.auditId,
          cloudBuildVersion: 'build',
          candidateCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          selectedCount: 0,
          timings: diagnostics.timings,
          responseBytes: {},
        },
        meta: { auditId: diagnostics.auditId, cloudBuildVersion: 'build' },
      },
    });
    assert.equal(Object.hasOwn(response, 'qaBatchAudit'), false);
    assert.equal(response.debug.qaTruncated, false);
  } finally {
    console.log = oldLog;
  }
});

test('diagnostics=true returns an anonymous performance ledger while normal responses do not', () => {
  const internals = loadInternals();
  const makeResponse = (requested) => {
    const diagnostics = internals.createRecommendationDiagnostics({
      auditId: 'rec_ledger_contract',
      diagnostics: requested,
    }, 100);
    diagnostics.databaseOps = { reads: 2, writes: 3 };
    diagnostics.snapshotPayloadBytes = 1200;
    diagnostics.candidatePoolPayloadBytes = 3400;
    internals.recordServerPhase(diagnostics, 'candidateGeneration', 110, 130);
    internals.recordServerPhase(diagnostics, 'cardCompilation', 131, 140);
    internals.recordServerPhase(diagnostics, 'handlerEnd', 100, 150);
    const oldLog = console.log;
    console.log = () => {};
    try {
      return internals.finalizeRecommendationResponse({
        sceneContract: internals.createRecommendationSceneContract('home'),
        diagnostics,
        qaResult: null,
        data: {
          outfits: [],
          debug: { timings: diagnostics.timings, responseBytes: {} },
          meta: { cloudBuildVersion: 'test' },
        },
      });
    } finally {
      console.log = oldLog;
    }
  };

  const diagnosticResponse = makeResponse(true);
  assert.equal(diagnosticResponse.diagnostics.performance.ledgerVersion, 'generateOutfit-phase-ledger-v2');
  assert.equal(diagnosticResponse.diagnostics.performance.dbRoundTrips, 5);
  assert.deepEqual(diagnosticResponse.diagnostics.performance.criticalPath, ['candidateGeneration', 'cardCompilation', 'responseSerialization', 'handlerEnd']);
  const serialized = JSON.stringify(diagnosticResponse.diagnostics.performance);
  assert.equal(serialized.includes('openid'), false);
  assert.equal(serialized.includes('userId'), false);
  assert.equal(serialized.includes('imageUrl'), false);
  assert.equal(serialized.includes('clothing'), false);
  const normalResponse = makeResponse(false);
  assert.equal(normalResponse.diagnostics, undefined);
  assert.equal(normalResponse.debug.phaseLedger, undefined);
});

test('presentation evidence over budget is omitted without changing the successful response contract', () => {
  const internals = loadInternals();
  const debug = {};
  const countContract = buildRecommendationCountContract({ returnedCardCount: 8, remainingUniqueBeforeConsume: 8 });
  const oversizedCards = Array.from({ length: 8 }, (_, index) => ({
    outfitKey: `safe-outfit-${index}`,
    title: `safe title ${index}`,
    reason: `safe reason ${index}`,
    styleTags: Array.from({ length: 8 }, (_, tagIndex) => `tag-${index}-${tagIndex}-${'x'.repeat(310)}`),
  }));
  assert.doesNotThrow(() => internals.attachPresentationEvidenceDebug(debug, {
    auditId: 'rec_evidence_budget',
    scene: 'sport',
    finalCards: oversizedCards,
    countContract,
  }));
  assert.equal(debug.presentationEvidence, undefined);
  assert.equal(debug.presentationEvidenceStatus.status, 'omitted_over_budget');
  assert.equal(debug.presentationEvidenceStatus.version, 'presentation-evidence-v3');
  assert.ok(debug.presentationEvidenceStatus.actualBytes > 24 * 1024);
  assert.equal(debug.presentationEvidenceStatus.limitBytes, 24 * 1024);
});

test('sport QA responseBytes exposes the measured eligibility audit bytes', () => {
  const internals = loadInternals();
  const bytes = internals.measureRecommendationResponse({
    outfits: [],
    debug: {},
    qaBatchAudit: {
      eligibilityRejectionAudit: { serializedBytes: 15560 },
    },
  });
  assert.equal(bytes.eligibilityRejectionAuditBytes, 15560);
});
