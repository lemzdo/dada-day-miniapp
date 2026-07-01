const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  AI_REVIEW_ERROR_CODES,
  USER_FACING_COPY,
  getAiReviewErrorCopy,
} = require('./userFacingCopyCore');

test('ai review error copy maps each stable server code to an actionable message', () => {
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_COOLDOWN'), USER_FACING_COPY.aiReview.cooldown);
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_IN_PROGRESS'), USER_FACING_COPY.aiReview.inProgress);
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_PROVIDER_NOT_CONFIGURED'), USER_FACING_COPY.aiReview.serviceNotReady);
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_PROVIDER_UNAVAILABLE'), USER_FACING_COPY.aiReview.providerUnavailable);
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_INCOMPLETE_INPUT'), USER_FACING_COPY.aiReview.incompleteOutfit);
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_STORAGE_UNAVAILABLE'), USER_FACING_COPY.aiReview.storageUnavailable);
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_TRANSACTION_UNAVAILABLE'), USER_FACING_COPY.aiReview.storageUnavailable);
  assert.equal(getAiReviewErrorCopy('AI_REVIEW_UNKNOWN'), USER_FACING_COPY.aiReview.genericRetry);
});

test('ai review copy does not expose implementation terms and unknown values fall back safely', () => {
  const visible = JSON.stringify(USER_FACING_COPY);
  assert.doesNotMatch(visible, /云函数|环境变量|数据库|API key|provider body/);
  assert.equal(getAiReviewErrorCopy('SOME_INTERNAL_PROVIDER_STACK'), USER_FACING_COPY.aiReview.genericRetry);
});

test('all declared ai review error codes are covered by the copy mapper', () => {
  for (const code of AI_REVIEW_ERROR_CODES) {
    const message = getAiReviewErrorCopy(code);
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0, code);
    assert.notEqual(message, '小搭点评暂时不可用');
  }
});

test('outfit detail imports the centralized user-facing copy map', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'outfit-detail', 'index.tsx'), 'utf8');
  assert.match(source, /USER_FACING_COPY|getAiReviewErrorCopy/);
  assert.doesNotMatch(source, /小搭点评暂时不可用/);
});
