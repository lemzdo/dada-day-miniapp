const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
