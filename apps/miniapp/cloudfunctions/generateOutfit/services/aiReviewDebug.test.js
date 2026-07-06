const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAiRawSummary,
  createAiReviewDebug,
  logAiReviewDebug,
  toSafeAiReviewDebug,
  updateAiReviewDebug,
} = require('./aiReviewDebug');

function baseDebug(overrides = {}) {
  return createAiReviewDebug({
    requestId: 'req-1',
    action: 'aiComment',
    outfitKey: 'top_bottom_shoes',
    scene: '上班',
    provider: 'aliyun-bailian',
    model: 'qwen-flash',
    ...overrides,
  });
}

test('cache hit diagnostics show no ai attempt', () => {
  const debug = updateAiReviewDebug(baseDebug(), {
    cacheDecision: 'hit',
    aiAttempted: false,
    saved: false,
  });

  assert.equal(debug.cacheDecision, 'hit');
  assert.equal(debug.aiAttempted, false);
  assert.equal(debug.outfitKeyShort.length, 8);
  assert.equal(debug.saved, false);
});

test('provider not configured diagnostics stay safe', () => {
  const debug = updateAiReviewDebug(baseDebug(), {
    providerConfigured: false,
    errorCode: 'AI_REVIEW_PROVIDER_NOT_CONFIGURED',
    fallbackUsed: true,
    fallbackReason: 'provider_not_configured',
  });
  const safe = toSafeAiReviewDebug(debug);
  const json = JSON.stringify(safe);

  assert.equal(safe.providerConfigured, false);
  assert.equal(safe.errorCode, 'AI_REVIEW_PROVIDER_NOT_CONFIGURED');
  assert.equal(safe.fallbackReason, 'provider_not_configured');
  assert.doesNotMatch(json, /top_bottom_shoes|OPENID|sk-|cloud:\/\//);
});

test('provider start and done paths are observable', () => {
  const debug = baseDebug();
  const logs = [];
  logAiReviewDebug('provider_start', updateAiReviewDebug(debug, {
    aiAttempted: true,
    providerConfigured: true,
    providerRequestStarted: true,
  }), (prefix, event, payload) => logs.push({ prefix, event, payload }));
  logAiReviewDebug('provider_done', updateAiReviewDebug(debug, {
    providerRequestFinished: true,
    providerStatus: 200,
  }), (prefix, event, payload) => logs.push({ prefix, event, payload }));

  assert.deepEqual(logs.map((entry) => entry.prefix), ['[xiaoda-review]', '[xiaoda-review]']);
  assert.deepEqual(logs.map((entry) => entry.event), ['provider_start', 'provider_done']);
  assert.equal(logs[0].payload.providerRequestStarted, true);
  assert.equal(logs[1].payload.providerRequestFinished, true);
  assert.equal(logs[1].payload.providerStatus, 200);
});

test('validator rejection and rule fallback keep reject reason and fallback reason', () => {
  const debug = updateAiReviewDebug(baseDebug(), {
    validatorResult: 'rejected',
    validatorRejectReasons: ['NO_INFORMATION_GAIN'],
    fallbackUsed: true,
    fallbackReason: 'validator_rejected',
  });

  assert.equal(debug.validatorResult, 'rejected');
  assert.deepEqual(debug.validatorRejectReasons, ['NO_INFORMATION_GAIN']);
  assert.equal(debug.fallbackUsed, true);
  assert.equal(debug.fallbackReason, 'validator_rejected');
});

test('skipped fallback cache decision is included in safe debug', () => {
  const debug = updateAiReviewDebug(baseDebug(), {
    cacheDecision: 'skip_fallback',
    aiAttempted: false,
  });
  const safe = toSafeAiReviewDebug(debug);

  assert.equal(safe.cacheDecision, 'skip_fallback');
  assert.equal(safe.aiAttempted, false);
});

test('raw provider summary records plain text parse failure without leaking sensitive values', () => {
  const summary = createAiRawSummary({
    providerReturned: true,
    statusCode: 200,
    rawText: `not json cloud://bucket/private.png https://example.com/a.jpg OPENID=o-secret sk-test-secret ${'x'.repeat(260)}`,
    parsedJson: false,
    parseErrorCode: 'SCHEMA_PARSE_FAILED',
  });

  assert.equal(summary.providerReturned, true);
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.parsedJson, false);
  assert.equal(summary.parseErrorCode, 'SCHEMA_PARSE_FAILED');
  assert.ok(Array.from(summary.rawTextPreview).length <= 200);
  assert.doesNotMatch(summary.rawTextPreview, /cloud:\/\/|https:\/\/|OPENID=o-secret|sk-test-secret/);
});

test('safe debug includes raw summary and validator trace with bounded details', () => {
  const debug = updateAiReviewDebug(baseDebug(), {
    aiRawSummary: createAiRawSummary({
      providerReturned: true,
      statusCode: 200,
      rawText: JSON.stringify({ overallComment: 'safe overall', advice: 'safe advice' }),
      parsedJson: true,
      parsedValue: { overallComment: 'safe overall', advice: 'safe advice' },
    }),
    validatorTrace: [
      { check: 'json_parse', pass: true, detail: 'ok' },
      { check: 'information_gain', pass: false, code: 'NO_INFORMATION_GAIN', detail: `detail ${'x'.repeat(200)}` },
    ],
  });
  const safe = toSafeAiReviewDebug(debug);
  const json = JSON.stringify(safe);

  assert.equal(safe.aiRawSummary.providerReturned, true);
  assert.equal(safe.aiRawSummary.fields.hasOverallComment, true);
  assert.equal(safe.validatorTrace[1].code, 'NO_INFORMATION_GAIN');
  assert.ok(safe.validatorTrace[1].detail.length <= 120);
  assert.doesNotMatch(json, /cloud:\/\/|OPENID|sk-/);
});
