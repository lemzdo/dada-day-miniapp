'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SAMPLE_COUNT,
  mergeJobTailTimings,
  parseCliArgs,
  summarize,
  summarizeAiFirst,
  validateCopyObservation,
  validateExpectedMode,
  validateTiming,
} = require('./today-first-card-visible-acceptance');

test('acceptance is fixed to exactly three valid samples', () => {
  assert.equal(SAMPLE_COUNT, 3);
  assert.deepEqual(summarize([2200.3334, 1800.1114, 2000.2224]), {
    min: 1800.111,
    median: 2000.222,
    p95: 2200.333,
    max: 2200.333,
  });
  assert.throws(() => summarize([1000, 2000]), /VISIBLE_SAMPLE_COUNT_INVALID/);
});

test('AI-first summary reports exact source and fallback rates from correlated visible samples', () => {
  const samples = [
    { copySource: 'CANONICAL_HIT', fallbackReason: null },
    { copySource: 'PROVIDER_FRESH', fallbackReason: null, plan0ReadyMs: 100, providerStartMs: 120, firstValidatedMs: 700 },
    { copySource: 'SAFE_COPY', fallbackReason: 'SAFE_DEADLINE' },
  ];
  assert.deepEqual(summarizeAiFirst(samples), {
    AI_REASON_FIRST_VISIBLE_RATE: 0.667,
    SAFE_COPY_FALLBACK_RATE: 0.333,
    CANONICAL_HIT_RATE_IN_TEST: 0.333,
    PROVIDER_FRESH_RATE: 0.333,
    SAFE_DEADLINE_RATE: 0.333,
    SAFE_PROVIDER_ERROR_RATE: 0,
    SAFE_VALIDATION_FAILED_RATE: 0,
    PLAN0_TO_PROVIDER_START: null,
    PROVIDER_START_TO_FIRST_VALIDATED: null,
  });
});

test('MISS timing metrics include provider work completed after a safe deadline response', () => {
  const complete = { copySource: 'PROVIDER_FRESH', fallbackReason: null,
    plan0ReadyMs: 100, providerStartMs: 120, firstValidatedMs: 700 };
  const summary = summarizeAiFirst([
    complete,
    { ...complete, copySource: 'SAFE_COPY', fallbackReason: 'SAFE_DEADLINE' },
    { ...complete, copySource: 'SAFE_COPY', fallbackReason: 'SAFE_DEADLINE' },
  ]);
  assert.deepEqual(summary.PLAN0_TO_PROVIDER_START, {
    min: 20,
    median: 20,
    p95: 20,
    max: 20,
  });
  assert.deepEqual(summary.PROVIDER_START_TO_FIRST_VALIDATED, {
    min: 580,
    median: 580,
    p95: 580,
    max: 580,
  });
});

test('persisted terminal job supplies post-response provider timings without changing copy outcome', () => {
  const sample = {
    auditId: 'audit-1', batchId: 'batch-1', copySource: 'SAFE_COPY',
    fallbackReason: 'SAFE_DEADLINE', plan0ReadyMs: 300, providerStartMs: 370,
    providerHeadersMs: null, firstValidatedMs: null, providerCompleteMs: null,
  };
  const merged = mergeJobTailTimings(sample, {
    auditId: 'audit-1', batchId: 'batch-1', status: 'completed',
    runtimeAuditV1: { firstCardAiCriticalPath: {
      origin: 'handler_monotonic', schemaVersion: 1,
      timingsMs: {
        plan0ReadyMs: 309.1354, providerStartMs: 375.5834,
        providerHeadersMs: 1570.7794, firstValidatedMs: 1994.3574,
        providerCompleteMs: 1997.5564,
      },
    } },
  });
  assert.equal(merged.copySource, 'SAFE_COPY');
  assert.equal(merged.firstValidatedMs, 1994.357);
  assert.equal(merged.tailJobStatus, 'completed');
  assert.equal(merged.tailRuntimeAuditObserved, true);
  assert.throws(() => mergeJobTailTimings(sample, {
    auditId: 'other', batchId: 'batch-1', status: 'completed',
  }), /VISIBLE_JOB_AUDIT_MISMATCH/);
});

test('visible source must agree with the server copy decision taxonomy', () => {
  assert.doesNotThrow(() => validateCopyObservation(
    { copySource: 'ai_cache', aiState: 'ready' },
    { copySource: 'PROVIDER_FRESH', fallbackReason: null },
  ));
  assert.doesNotThrow(() => validateCopyObservation(
    { copySource: 'safe', aiState: 'failed' },
    { copySource: 'SAFE_COPY', fallbackReason: 'SAFE_PROVIDER_ERROR' },
  ));
  assert.throws(() => validateCopyObservation(
    { copySource: 'safe', aiState: 'failed' },
    { copySource: 'CANONICAL_HIT', fallbackReason: null },
  ), /VISIBLE_AI_COPY_MISMATCH/);
});

test('live acceptance mode is explicit and rejects unknown options', () => {
  assert.deepEqual(parseCliArgs(['--live']), { valid: true, mode: 'observed' });
  assert.deepEqual(parseCliArgs(['--live', '--mode', 'hit']), { valid: true, mode: 'hit' });
  assert.deepEqual(parseCliArgs(['--live', '--mode', 'miss']), { valid: true, mode: 'miss' });
  assert.equal(parseCliArgs(['--live', '--mode', 'unknown']).valid, false);
  assert.equal(parseCliArgs([]).valid, false);
});

test('HIT and forced MISS modes require exact provider behavior', () => {
  const audit = (starts) => ({ stages: Array.from({ length: starts }, () => ({
    stage: 'PROVIDER_START',
    status: 'started',
  })) });
  assert.doesNotThrow(() => validateExpectedMode('hit', {
    summary: { copySource: 'CANONICAL_HIT' },
    audit: audit(0),
  }));
  assert.doesNotThrow(() => validateExpectedMode('miss', {
    summary: { copySource: 'PROVIDER_FRESH' },
    audit: audit(1),
  }));
  assert.doesNotThrow(() => validateExpectedMode('miss', {
    summary: { copySource: 'SAFE_COPY', fallbackReason: 'SAFE_DEADLINE' },
    audit: audit(1),
  }));
  assert.throws(() => validateExpectedMode('hit', {
    summary: { copySource: 'CANONICAL_HIT' },
    audit: audit(1),
  }), /VISIBLE_EXPECTED_CANONICAL_HIT/);
  assert.throws(() => validateExpectedMode('miss', {
    summary: { copySource: 'CANONICAL_HIT' },
    audit: audit(0),
  }), /VISIBLE_EXPECTED_CANONICAL_MISS/);
});

test('visible timing requires one ordered monotonic client timeline', () => {
  assert.doesNotThrow(() => validateTiming({
    auditId: 'audit-1', seq: 1, batchId: 'batch-1', outfitKey: 'outfit-1',
    clientResponseReceivedMs: 1400, stateCommitMs: 1450, contentVisibleMs: 1500,
    imageLoadMs: 1510, imageVisibleMs: 1520,
  }));
  assert.throws(() => validateTiming({
    auditId: 'audit-1', seq: 1, batchId: 'batch-1', outfitKey: 'outfit-1',
    clientResponseReceivedMs: 1400, stateCommitMs: 1300, contentVisibleMs: 1500,
    imageLoadMs: 1510, imageVisibleMs: 1520,
  }), /VISIBLE_TIMING_INVARIANT_FAILED/);
});
