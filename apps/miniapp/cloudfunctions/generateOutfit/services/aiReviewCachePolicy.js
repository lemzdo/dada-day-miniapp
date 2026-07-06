const FALLBACK_SOURCES = new Set(['rule_fallback', 'cached_fallback']);

function isFallbackAiReview(review) {
  if (!review || typeof review !== 'object') return false;
  return [
    review.source,
    review.reviewSource,
    review.aiComment?.source,
    review.aiComment?.reviewSource,
    review.explanationV2?.source,
    review.aiComment?.explanationV2?.source,
  ].some((source) => FALLBACK_SOURCES.has(source));
}

function hasMatchingAiReviewIdentity(review, context) {
  return Boolean(
    review
      && context
      && review._openid === context.openid
      && review.outfitKey === context.outfitKey
      && review.scene === context.scene
      && review.status === 'ready'
      && review.inputHash === context.inputHash
      && review.promptVersion === context.promptVersion
      && review.reviewVersion === context.reviewVersion
      && review.copyPolicyVersion === context.copyPolicyVersion
      && review.voicePolicyVersion === context.voicePolicyVersion,
  );
}

function isReusableAiReview(review, context, normalizeAiComment = defaultNormalizeAiComment) {
  return Boolean(
    hasMatchingAiReviewIdentity(review, context)
      && review.cacheable !== false
      && review.enhanced !== false
      && !isFallbackAiReview(review)
      && normalizeAiComment(review.aiComment),
  );
}

function buildAiReviewCacheDecision(review, context, normalizeAiComment = defaultNormalizeAiComment) {
  if (!review) return 'miss';
  if (isReusableAiReview(review, context, normalizeAiComment)) return 'hit';
  if (hasMatchingAiReviewIdentity(review, context) && isFallbackAiReview(review)) return 'skip_fallback';
  return 'stale_or_not_ready';
}

function defaultNormalizeAiComment(value) {
  return value && typeof value === 'object' && value.reason ? value : null;
}

module.exports = {
  buildAiReviewCacheDecision,
  isFallbackAiReview,
  isReusableAiReview,
};
