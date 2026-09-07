'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractAudit, parseObject, verifyInvocation, buildTimeline } = require('./evidence');
const { hash } = require('./safety');
const {
  buildCacheIdentity,
  buildJobIdentity,
} = require('../../cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2');

const OPENID = 'smoke-user';
const FINGERPRINT = 'a'.repeat(64);
const RENDERER = 'recommendation-voice-renderer-production-v2';
const BATCH_ID = 'batch-1';
const CACHE_ID = buildCacheIdentity({ openid: OPENID, rendererVersion: RENDERER, renderInputFingerprint: FINGERPRINT });
const JOB_ID = buildJobIdentity({ openid: OPENID, batchId: BATCH_ID, rendererVersion: RENDERER });

function stage(stageName, status, auditId = 'audit-1') {
  return { auditId, stage: stageName, status, elapsedFromHandlerMs: 1 };
}

function baseAudit(stages, summary = {}) {
  return {
    stages,
    summaries: [{
      auditId: 'audit-1',
      executionOutcome: 'succeeded',
      providerCalled: true,
      validated: true,
      persisted: true,
      failure: null,
      ...summary,
    }],
  };
}

function baseJob(overrides = {}) {
  return {
    _id: JOB_ID,
    jobId: JOB_ID,
    _openid: OPENID,
    batchId: BATCH_ID,
    rendererVersion: RENDERER,
    entries: [{ position: 0, outfitKey: 'outfit-1', cacheId: CACHE_ID, renderInputFingerprint: FINGERPRINT }],
    ...overrides,
  };
}

function baseCache(overrides = {}) {
  return {
    _id: CACHE_ID,
    cacheId: CACHE_ID,
    _openid: OPENID,
    rendererVersion: RENDERER,
    renderInputFingerprint: FINGERPRINT,
    source: 'ai_cache',
    text: '适合今天的搭配。',
    ...overrides,
  };
}

function baseResult(overrides = {}) {
  return {
    statusCode: 200,
    batchId: BATCH_ID,
    firstCard: { outfitKey: 'outfit-1', todayReason: '适合今天的搭配。' },
    ...overrides,
  };
}

function missAudit() {
  return baseAudit([
    stage('CACHE_LOOKUP_DONE', 'miss'),
    stage('FIRST_CARD_AI_ADMITTED', 'admitted'),
    stage('PROVIDER_START', 'started'),
    stage('PROVIDER_COMPLETE', 'completed'),
    stage('VALIDATOR_COMPLETE', 'accepted'),
    stage('CANONICAL_PERSISTED', 'tail'),
  ]);
}

test('timeline combines correlated performance logs and execution end without fabricating plan or visibility', () => {
  const audit = extractAudit([
    '[RecommendationStage] { auditId: "audit-1", batchId: "batch-1", stage: "PLAN0_READY", elapsedMs: 10 }',
    '[RecommendationStage] { auditId: "other", stage: "PLAN0_READY", elapsedMs: 1 }',
    '[RecommendationAudit] { auditId: "audit-1", stage: "PROVIDER_START", status: "started", elapsedFromHandlerMs: 20 }',
    '[RecommendationAudit] { auditId: "audit-1", stage: "PROVIDER_COMPLETE", status: "completed", elapsedFromHandlerMs: 30 }',
    '[RecommendationAudit] { auditId: "audit-1", stage: "EXECUTION_COMPLETE", status: "succeeded", elapsedFromHandlerMs: 100 }',
    '[RecommendationStage] { auditId: "audit-1", stage: "CANONICAL_READY", elapsedMs: 110 }',
    '[RecommendationAudit] { auditId: "audit-1", stage: "FIRST_CARD_VISIBLE", status: "completed", elapsedFromHandlerMs: 120 }',
  ], 'audit-1');
  assert.deepEqual(buildTimeline(audit), { PLAN0_READY: 10, AI_START: 20, AI_COMPLETE: 100,
    CANONICAL_READY: 110, FIRST_CARD_VISIBLE: null });
  assert.equal(audit.performanceStages.length, 2);
  const legacy = buildTimeline({ stages: [stage('NARRATIVE_PLAN_READY', 'completed'), stage('PROVIDER_COMPLETE', 'completed')] });
  assert.equal(legacy.PLAN0_READY, null);
  assert.equal(legacy.AI_COMPLETE, null);
  assert.equal(buildTimeline({ stages: [stage('CACHE_LOOKUP_DONE', 'hit')] }).CANONICAL_READY, 1);
});

test('parseObject accepts JSON and Node console literal objects', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseObject('{"auditId":"a","ok":true,"n":2,"x":[null,"v"]}'))), {
    auditId: 'a', ok: true, n: 2, x: [null, 'v'],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(parseObject('{ auditId: \'a\', nested: { accepted: false } }'))), {
    auditId: 'a', nested: { accepted: false },
  });
});

test('parseObject never executes log content', () => {
  globalThis.__d1dEvidenceAttack = 0;
  assert.throws(
    () => parseObject("{ auditId: (globalThis.__d1dEvidenceAttack = 1) }"),
    /LOG_NOT_LITERAL/,
  );
  assert.equal(globalThis.__d1dEvidenceAttack, 0);
  delete globalThis.__d1dEvidenceAttack;
});

test('reconstructed CLS lines stop at the audit object before unrelated log objects', () => {
  const log = "[RecommendationAudit] {\n auditId: 'audit-1',\n stage: 'CACHE_LOOKUP_DONE',\n status: 'hit'\n}\n[RecommendationStage] { x: 'unrelated } content' }\n[RecommendationAuditSummary] { auditId: 'audit-1', failure: null }\nEND request";
  const audit = extractAudit([{ requestId: 'r', log }], 'audit-1');
  assert.equal(audit.stages.length, 1);
  assert.equal(audit.stages[0].status, 'hit');
  assert.equal(audit.summaries.length, 1);
  assert.equal(audit.unparsed, 0);
});

test('extractAudit handles multiline logs, filters auditId, and deduplicates records', () => {
  const first = JSON.stringify(stage('CACHE_LOOKUP_DONE', 'miss'));
  const summary = JSON.stringify({ auditId: 'audit-1', executionOutcome: 'succeeded' });
  const logs = [
    `[RecommendationAudit] ${first}`,
    `[RecommendationAudit] ${first}`,
    '[RecommendationAudit] {\n  auditId: \'other\',\n  stage: \'PROVIDER_START\',\n  status: \'started\'\n}',
    `[RecommendationAuditSummary] {\n  auditId: 'audit-1',\n  executionOutcome: 'succeeded'\n}`,
    `[RecommendationAuditSummary] ${summary}`,
  ];
  const result = extractAudit(logs, 'audit-1');
  assert.equal(result.stages.length, 1);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.stages[0].stage, 'CACHE_LOOKUP_DONE');
  assert.equal(result.summaries[0].executionOutcome, 'succeeded');
  assert.equal(result.unparsed, 0);
});

test('verifyInvocation accepts a successful MISS full chain', () => {
  const evidence = verifyInvocation({
    audit: missAudit(), result: baseResult(), job: baseJob(), cache: baseCache(),
    openid: OPENID, expectedFingerprint: FINGERPRINT, mode: 'miss',
  });
  assert.equal(evidence.mode, 'miss');
  assert.equal(evidence.providerStarts, 1);
  assert.equal(evidence.httpStatus, 200);
});

test('verifyInvocation accepts production HIT without AI or new persistence', () => {
  const audit = baseAudit([
    stage('CACHE_LOOKUP_DONE', 'hit'),
  ], {
    executionOutcome: 'not_started',
    providerCalled: false,
    firstCardAiStarted: false,
    validated: false,
    persisted: false,
  });
  const evidence = verifyInvocation({
    audit, result: baseResult(), job: baseJob(), cache: baseCache(),
    openid: OPENID, expectedFingerprint: FINGERPRINT, mode: 'hit',
  });
  assert.equal(evidence.mode, 'hit');
  assert.equal(evidence.providerStarts, 0);
});

test('verifyInvocation rejects a failed MISS audit', () => {
  const audit = baseAudit([
    stage('CACHE_LOOKUP_DONE', 'miss'),
    stage('FIRST_CARD_AI_ADMITTED', 'admitted'),
    stage('PROVIDER_START', 'started'),
    stage('PROVIDER_COMPLETE', 'failed'),
  ], { failure: { code: 'PROVIDER_HTTP_ERROR' } });
  assert.throws(() => verifyInvocation({
    audit, result: baseResult(), job: baseJob(), cache: baseCache(),
    openid: OPENID, expectedFingerprint: FINGERPRINT, mode: 'miss',
  }), /SMOKE_AUDIT_FAILED_OR_MISSING/);
});

test('verifyInvocation rejects HIT that calls the provider', () => {
  const audit = baseAudit([
    stage('CACHE_LOOKUP_DONE', 'hit'),
    stage('PROVIDER_START', 'started'),
  ], { providerCalled: true });
  assert.throws(() => verifyInvocation({
    audit, result: baseResult(), job: baseJob(), cache: baseCache(),
    openid: OPENID, expectedFingerprint: FINGERPRINT, mode: 'hit',
  }), /SMOKE_HIT_CALLED_PROVIDER/);
});

test('verifyInvocation rejects wrong fingerprint and cache ownership', () => {
  assert.throws(() => verifyInvocation({
    audit: missAudit(), result: baseResult(), job: baseJob(), cache: baseCache(),
    openid: OPENID, expectedFingerprint: 'b'.repeat(64), mode: 'miss',
  }), /SMOKE_FINGERPRINT_CHANGED/);
  assert.throws(() => verifyInvocation({
    audit: missAudit(), result: baseResult(), job: baseJob(), cache: baseCache({ _openid: 'other-user' }),
    openid: OPENID, expectedFingerprint: FINGERPRINT, mode: 'miss',
  }), /SMOKE_CANONICAL_MISSING/);
});

test('canonical HIT text mismatch is rejected', () => {
  const audit = baseAudit([stage('CACHE_LOOKUP_DONE', 'hit')], {
    executionOutcome: 'not_started', providerCalled: false, firstCardAiStarted: false,
    validated: false, persisted: false,
  });
  assert.throws(() => verifyInvocation({
    audit,
    result: baseResult({ firstCard: { outfitKey: 'outfit-1', todayReason: '另一段文案。' } }),
    job: baseJob(), cache: baseCache(), openid: OPENID,
    expectedFingerprint: FINGERPRINT, mode: 'hit',
  }), /SMOKE_HIT_TEXT_MISMATCH/);
  assert.equal(hash('另一段文案。') === hash(baseCache().text), false);
});
