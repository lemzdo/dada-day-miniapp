const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AI_REVIEW_ERROR_CODES,
  createAiReviewServiceError,
  getSafeAiReviewMessage,
  mapAiReviewErrorCode,
  toSafeAiReviewErrorData,
} = require('./aiReviewErrorPolicy');

test('maps provider configuration and provider temporary failures separately', () => {
  assert.equal(mapAiReviewErrorCode(new Error('BAILIAN_API_KEY is missing')), 'AI_REVIEW_PROVIDER_NOT_CONFIGURED');
  assert.equal(mapAiReviewErrorCode(new Error('ai_comment_api_error_503:provider body')), 'AI_REVIEW_PROVIDER_UNAVAILABLE');
});

test('maps incomplete input storage transaction cooldown in progress and unknown errors', () => {
  assert.equal(mapAiReviewErrorCode(new Error('outfit identity is required')), 'AI_REVIEW_INCOMPLETE_INPUT');
  assert.equal(mapAiReviewErrorCode(createAiReviewServiceError('AI_REVIEW_STORAGE_UNAVAILABLE')), 'AI_REVIEW_STORAGE_UNAVAILABLE');
  assert.equal(mapAiReviewErrorCode(createAiReviewServiceError('AI_REVIEW_TRANSACTION_UNAVAILABLE')), 'AI_REVIEW_TRANSACTION_UNAVAILABLE');
  assert.equal(mapAiReviewErrorCode(createAiReviewServiceError('AI_REVIEW_COOLDOWN')), 'AI_REVIEW_COOLDOWN');
  assert.equal(mapAiReviewErrorCode(createAiReviewServiceError('AI_REVIEW_IN_PROGRESS')), 'AI_REVIEW_IN_PROGRESS');
  assert.equal(mapAiReviewErrorCode(new Error('random stack')), 'AI_REVIEW_UNKNOWN');
});

test('safe client payloads do not leak sensitive exception details', () => {
  const payload = toSafeAiReviewErrorData(new Error('BAILIAN_API_KEY is missing: sk-secret provider body database'));
  assert.equal(payload.errorCode, 'AI_REVIEW_PROVIDER_NOT_CONFIGURED');
  assert.equal(payload.message, getSafeAiReviewMessage(payload.errorCode));
  assert.doesNotMatch(JSON.stringify(payload), /sk-secret|provider body|database|BAILIAN_API_KEY/);
});

test('all server ai review codes have safe actionable messages', () => {
  for (const code of AI_REVIEW_ERROR_CODES) {
    const message = getSafeAiReviewMessage(code);
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0, code);
    assert.doesNotMatch(message, /云函数|数据库|环境变量|API key|provider body/);
  }
});
