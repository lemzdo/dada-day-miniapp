process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { buildQaAuditSummaries, serializedBytes } = require('./services/qaBatchAudit');
const { CLOUD_BUILD_VERSION } = require('./services/buildVersions');
const {
  buildRecommendationQaLogSummary,
  logRecommendationEvent,
  CLIENT_RECOMMEND_LOG_MAX_BYTES,
} = require('../../src/lib/recommendationDiagnostics');

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

function createLogger() {
  const entries = [];
  const write = (level) => (label, payload) => entries.push({ level, label, payload });
  return {
    entries,
    logger: { log: write('log'), info: write('info'), warn: write('warn'), error: write('error') },
  };
}

test('cacheMissReason: initial_request used only for truly first request', () => {
  const internals = loadInternals();
  assert.equal(
    internals.resolveInitialCacheMissReason({ isRefreshRequest: false, requestedCandidatePoolId: '' }),
    'initial_request',
  );
  assert.equal(
    internals.resolveInitialCacheMissReason({ isRefreshRequest: false, requestedCandidatePoolId: 'pool_xyz' }),
    'initial_request',
  );
});

test('cacheMissReason: refresh_without_pool_id when trigger=refresh and client omits pool id', () => {
  const internals = loadInternals();
  assert.equal(
    internals.resolveInitialCacheMissReason({ isRefreshRequest: true, requestedCandidatePoolId: '' }),
    'refresh_without_pool_id',
  );
});

test('cacheMissReason: empty when refresh carries pool id (loadCandidatePool decides later)', () => {
  const internals = loadInternals();
  assert.equal(
    internals.resolveInitialCacheMissReason({ isRefreshRequest: true, requestedCandidatePoolId: 'pool_abc' }),
    '',
  );
});

test('cacheMissReason: loadCandidatePool reasons mapped to canonical values', () => {
  const internals = loadInternals();
  assert.equal(internals.mapCandidatePoolLoadReason('not_found'), 'candidate_pool_missing');
  assert.equal(internals.mapCandidatePoolLoadReason('expired'), 'candidate_pool_expired');
  assert.equal(internals.mapCandidatePoolLoadReason('ttl_invalid'), 'candidate_pool_expired');
  assert.equal(internals.mapCandidatePoolLoadReason('user_mismatch'), 'candidate_pool_identity_mismatch');
  assert.equal(internals.mapCandidatePoolLoadReason('identity_changed'), 'candidate_pool_identity_mismatch');
  assert.equal(internals.mapCandidatePoolLoadReason('pool_corrupt'), 'pool_corrupt');
  assert.equal(internals.mapCandidatePoolLoadReason('schema_invalid'), 'schema_invalid');
  assert.equal(internals.mapCandidatePoolLoadReason('storage_unavailable'), 'storage_unavailable');
  assert.equal(internals.mapCandidatePoolLoadReason(''), 'pool_corrupt');
});

test('explicit cache-fill decisions preserve measured diagnostics without exposing an unconfirmed id', async () => {
  const internals = loadInternals();
  const skipped = internals.decideCandidatePoolCacheFill({
    homepageBudgetMs: 3000,
    elapsedMs: 2200,
    measuredSaveP95Ms: 200,
    clientReserveMs: 700,
  });
  assert.equal(skipped.decision, 'skip');

  const allowed = internals.decideCandidatePoolCacheFill({
    homepageBudgetMs: 3000,
    elapsedMs: 1800,
    measuredSaveP95Ms: 200,
    clientReserveMs: 700,
  });
  const plan = internals.createCandidatePoolCacheFillPlan({
    decision: allowed,
    execute: async () => ({ status: 'saved', candidatePoolId: 'pool-confirmed' }),
  });
  assert.equal(plan.started, false);
  assert.equal((await plan.start()).candidatePoolId, 'pool-confirmed');
});

test('QA summary carries all eight candidate pool diagnostic fields', () => {
  const audit = buildQaAuditSummaries({
    auditId: 'rec_qa_diag',
    cloudBuild: CLOUD_BUILD_VERSION,
    execution: {
      executionMode: 'full_compute',
      candidatePoolIdentityHash: 'qa_hash',
      candidatePoolAgeMs: 0,
      cacheHit: false,
      cacheMissReason: 'initial_request',
      exclusionsAppliedCount: 0,
      candidatePoolSaveStatus: 'saved',
      candidatePoolSaveReason: null,
      candidatePoolSerializedBytes: 48200,
      candidatePoolChunkCount: 1,
      recommendationBatchIdPresent: true,
      recommendationBatchIdLength: 16,
      requestedCandidatePoolIdPresent: false,
      requestedCandidatePoolIdLength: 0,
    },
  });

  for (const field of [
    'candidatePoolSaveStatus',
    'candidatePoolSaveReason',
    'candidatePoolSerializedBytes',
    'candidatePoolChunkCount',
    'recommendationBatchIdPresent',
    'recommendationBatchIdLength',
    'requestedCandidatePoolIdPresent',
    'requestedCandidatePoolIdLength',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(audit.clientAudit, field), `clientAudit should carry ${field}`);
    assert.ok(Object.prototype.hasOwnProperty.call(audit.serverSummary, field), `serverSummary should carry ${field}`);
  }
  assert.equal(audit.clientAudit.candidatePoolSaveStatus, 'saved');
  assert.equal(audit.clientAudit.candidatePoolSerializedBytes, 48200);
  assert.equal(audit.clientAudit.recommendationBatchIdPresent, true);
  assert.equal(audit.clientAudit.recommendationBatchIdLength, 16);
  assert.equal(audit.clientAudit.requestedCandidatePoolIdPresent, false);
  assert.equal(audit.clientAudit.requestedCandidatePoolIdLength, 0);
  assert.ok(serializedBytes(audit.clientAudit) < 16 * 1024);
});

test('client QA log summary propagates diagnostic fields without leaking pool id content', () => {
  const summary = buildRecommendationQaLogSummary({
    auditId: 'rec_qa_summary',
    version: 'qa-batch-audit-v6-1-semantic-presentation',
    cloudBuild: CLOUD_BUILD_VERSION,
    executionMode: 'full_compute',
    candidatePoolIdentityHash: 'qa_summary_hash',
    candidatePoolAgeMs: 0,
    cacheHit: false,
    cacheMissReason: 'initial_request',
    exclusionsAppliedCount: 8,
    candidatePoolSaveStatus: 'saved',
    candidatePoolSaveReason: null,
    candidatePoolSerializedBytes: 300000,
    candidatePoolChunkCount: 3,
    recommendationBatchIdPresent: true,
    recommendationBatchIdLength: 16,
    requestedCandidatePoolIdPresent: false,
    requestedCandidatePoolIdLength: 0,
    counts: { candidate: 312, accepted: 8, rejected: 304, selected: 8 },
    timings: { totalMs: 4961 },
    responseBytes: { totalDataBytes: 8192 },
  });

  assert.equal(summary.candidatePoolSaveStatus, 'saved');
  assert.equal(summary.candidatePoolSaveReason, '');
  assert.equal(summary.candidatePoolSerializedBytes, 300000);
  assert.equal(summary.candidatePoolChunkCount, 3);
  assert.equal(summary.recommendationBatchIdPresent, true);
  assert.equal(summary.recommendationBatchIdLength, 16);
  assert.equal(summary.requestedCandidatePoolIdPresent, false);
  assert.equal(summary.requestedCandidatePoolIdLength, 0);
  assert.equal(summary.cacheMissReason, 'initial_request');
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('batch:'), false, 'summary must not include raw batch id content (format batch:<timestamp>:<random>)');
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'recommendationBatchId'), false, 'summary must not expose raw recommendationBatchId field');
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'requestedCandidatePoolId'), false, 'summary must not expose raw requestedCandidatePoolId field');
});

test('client lifecycle log sequence: Start -> Response -> QA -> Done, single Done per auditId', () => {
  const { entries, logger } = createLogger();
  const auditId = 'rec_lifecycle_single';
  logRecommendationEvent('[RecommendStart]', {
    auditId, seq: 1, sceneKey: 'home', scene: '居家', trigger: 'initial',
  }, logger);
  logRecommendationEvent('[RecommendResponse]', {
    auditId, seq: 1, trigger: 'initial', outfitCount: 8,
    candidatePoolSaveStatus: 'saved',
    candidatePoolSaveReason: '',
    candidatePoolSerializedBytes: 48200,
    candidatePoolChunkCount: 1,
    recommendationBatchIdPresent: true,
    recommendationBatchIdLength: 16,
    requestedCandidatePoolIdPresent: false,
    requestedCandidatePoolIdLength: 0,
    cacheMissReason: 'initial_request',
  }, logger);
  logRecommendationEvent('[RecommendationQA]', {
    auditId, cacheMissReason: 'initial_request', candidatePoolSaveStatus: 'saved',
  }, logger);
  logRecommendationEvent('[RecommendDone]', {
    auditId, clientTimings: { cloudRoundTripMs: 4961, imageReadyMs: 12, requestedImageCount: 0, resolvedImageCount: 0, imageTimeout: false },
  }, logger);

  assert.deepEqual(
    entries.map((entry) => entry.label),
    ['[RecommendStart]', '[RecommendResponse]', '[RecommendationQA]', '[RecommendDone]'],
  );

  const doneEntries = entries.filter((entry) => entry.label === '[RecommendDone]');
  assert.equal(doneEntries.length, 1, 'exactly one [RecommendDone] per auditId');
  const responseEntries = entries.filter((entry) => entry.label === '[RecommendResponse]');
  assert.equal(responseEntries.length, 1, 'exactly one [RecommendResponse] per auditId');

  entries.forEach((entry) => {
    assert.ok(entry.payload.auditId);
  });
});

test('client RecommendResponse log includes candidate pool diagnostic fields without leaking pool id content', () => {
  const { entries, logger } = createLogger();
  const poolId = 'pool_secret_value_' + '0'.repeat(20);
  logRecommendationEvent('[RecommendResponse]', {
    auditId: 'rec_response_diag',
    seq: 1,
    trigger: 'refresh',
    outfitCount: 8,
    candidatePoolSaveStatus: 'saved',
    candidatePoolSaveReason: '',
    candidatePoolSerializedBytes: 48200,
    candidatePoolChunkCount: 1,
    recommendationBatchIdPresent: true,
    recommendationBatchIdLength: poolId.length,
    requestedCandidatePoolIdPresent: true,
    requestedCandidatePoolIdLength: poolId.length,
    cacheMissReason: '',
  }, logger);
  assert.equal(entries.length, 1);
  const payload = entries[0].payload;
  assert.equal(payload.candidatePoolSaveStatus, 'saved');
  assert.equal(payload.candidatePoolSerializedBytes, 48200);
  assert.equal(payload.recommendationBatchIdPresent, true);
  assert.equal(payload.recommendationBatchIdLength, poolId.length);
  assert.equal(payload.requestedCandidatePoolIdPresent, true);
  assert.equal(payload.requestedCandidatePoolIdLength, poolId.length);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('pool_secret_value_'), false, 'must not log raw recommendationBatchId content');
  assert.ok(serialized.length < CLIENT_RECOMMEND_LOG_MAX_BYTES);
});
