const FALLBACK_REVIEW_SOURCES = new Set(['rule_fallback', 'cached_fallback']);

function resolveRealAiReviewSource(outfit) {
  if (!isPlainObject(outfit?.aiComment)) return '';
  const sources = [
    outfit.reviewSource,
    outfit.aiComment.source,
    outfit.aiComment.reviewSource,
    outfit.aiComment.explanationV2?.source,
  ].map(normalizeReviewSource).filter(Boolean);

  if (sources.some((source) => FALLBACK_REVIEW_SOURCES.has(source))) return '';
  if (sources.includes('cached_ai')) return 'cached_ai';
  if (sources.includes('ai')) return 'ai';
  return outfit.enhanced === true ? 'ai' : '';
}

function mapAiReviewAtBoundary(outfit, normalizeNonRealComment) {
  const source = resolveRealAiReviewSource(outfit);
  if (source) {
    return {
      aiComment: outfit.aiComment,
      reviewSource: source,
      ...(outfit.enhanced === true ? { enhanced: true } : {}),
    };
  }

  const normalized = typeof normalizeNonRealComment === 'function'
    ? normalizeNonRealComment(outfit?.aiComment)
    : null;
  return normalized ? { aiComment: normalized } : {};
}

function normalizeReviewSource(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = {
  mapAiReviewAtBoundary,
  resolveRealAiReviewSource,
};
