const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAiReviewCacheDecision,
  isFallbackAiReview,
  isReusableAiReview,
} = require('./aiReviewCachePolicy');

function context(overrides = {}) {
  return {
    openid: 'user-a',
    outfitKey: 'outfit-key',
    scene: '上班',
    inputHash: 'input-digest',
    promptVersion: 'stylist-prompt-v4',
    reviewVersion: 'stylist-explanation-v4',
    copyPolicyVersion: 'human-copy-v1',
    voicePolicyVersion: 'xiaoda-voice-v1',
    ...overrides,
  };
}

function readyReview(overrides = {}) {
  return {
    _openid: 'user-a',
    outfitKey: 'outfit-key',
    scene: '上班',
    status: 'ready',
    inputHash: 'input-digest',
    promptVersion: 'stylist-prompt-v4',
    reviewVersion: 'stylist-explanation-v4',
    copyPolicyVersion: 'human-copy-v1',
    voicePolicyVersion: 'xiaoda-voice-v1',
    source: 'ai',
    aiComment: { title: '', reason: '这套多说两句很具体。', styleTags: [], tip: '' },
    ...overrides,
  };
}

test('existing rule fallback review is not reusable and reports skip_fallback', () => {
  const review = readyReview({
    source: 'rule_fallback',
    reviewSource: 'rule_fallback',
    cacheable: false,
    enhanced: false,
  });

  assert.equal(isFallbackAiReview(review), true);
  assert.equal(isReusableAiReview(review, context()), false);
  assert.equal(buildAiReviewCacheDecision(review, context()), 'skip_fallback');
});

test('cached fallback is not reusable even when status and digest match', () => {
  const review = readyReview({
    source: 'cached_fallback',
    aiComment: {
      title: '',
      reason: '旧规则兜底文案。',
      styleTags: [],
      tip: '',
      reviewSource: 'cached_fallback',
    },
  });

  assert.equal(isFallbackAiReview(review), true);
  assert.equal(isReusableAiReview(review, context()), false);
  assert.equal(buildAiReviewCacheDecision(review, context()), 'skip_fallback');
});

test('cached ai remains reusable when identity and versions match', () => {
  const review = readyReview({
    source: 'cached_ai',
    reviewSource: 'cached_ai',
    enhanced: true,
  });

  assert.equal(isFallbackAiReview(review), false);
  assert.equal(isReusableAiReview(review, context()), true);
  assert.equal(buildAiReviewCacheDecision(review, context()), 'hit');
});

test('new fallback marked non-cacheable is not reusable', () => {
  const review = readyReview({
    source: 'rule_fallback',
    cacheable: false,
    enhanced: false,
  });

  assert.equal(isReusableAiReview(review, context()), false);
  assert.equal(buildAiReviewCacheDecision(review, context()), 'skip_fallback');
});
