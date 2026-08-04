const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canPersistAiReviewAsReady,
  resolveAiReviewFailureSettlement,
} = require('./aiReviewSettlement');

const normalize = (value) => value?.reason ? value : null;
const previous = {
  aiComment: { reason: '旧点评', partial: false },
  inputHash: 'hash',
  inputDigest: 'digest',
  reviewVersion: 'stylist-explanation-v4',
  promptVersion: 'stylist-prompt-v4',
  source: 'ai',
  generatedAt: '2026-07-16T00:00:00.000Z',
};

test('only real AI overall can enter ready settlement, including partial advice success', () => {
  assert.equal(canPersistAiReviewAsReady({ explanationV2: { source: 'ai', overallComment: '合格点评', advice: '合格建议' } }), true);
  assert.equal(canPersistAiReviewAsReady({ explanationV2: { source: 'ai', overallComment: '合格点评', advice: null, partial: true } }), true);
  assert.equal(canPersistAiReviewAsReady({ explanationV2: { source: 'ai', overallComment: '' } }), false);
  assert.equal(canPersistAiReviewAsReady({ explanationV2: { source: 'rule_fallback', overallComment: '旧 fallback' } }), false);
});

test('overall reject or provider exception without previous stays failed', () => {
  for (const failureKind of ['overall_reject', 'provider_exception']) {
    const result = resolveAiReviewFailureSettlement(null, normalize, failureKind);
    assert.equal(result.restored, false);
    assert.equal(result.data.status, 'failed');
    assert.equal(result.data.aiComment, null);
  }
});

test('overall reject or provider exception restores previous ready without clearing it', () => {
  for (const failureKind of ['overall_reject', 'provider_exception']) {
    const result = resolveAiReviewFailureSettlement(previous, normalize, failureKind);
    assert.equal(result.restored, true);
    assert.equal(result.data.status, 'ready');
    assert.equal(result.data.aiComment.reason, '旧点评');
    assert.equal(result.data.inputDigest, 'digest');
  }
});
