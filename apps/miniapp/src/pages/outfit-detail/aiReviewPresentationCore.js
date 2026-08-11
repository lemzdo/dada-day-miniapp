const EMPTY_PHRASES = ['衣物之间太泛', '想再清楚一点', '整体比较完整', '场景适配度比较高'];
const FALLBACK_REVIEW_SOURCES = new Set([
  'rule_default',
  'rule_fallback',
  'cached_fallback',
  'fallback',
  'legacy',
]);

function buildAiReviewPresentation(aiComment, contentPlan, context = {}) {
  if (!isRealAiComment(aiComment, context)) return emptyPresentation();

  const explanation = isPlainObject(aiComment.explanationV2)
    ? aiComment.explanationV2
    : null;
  if (explanation?.schemaVersion === 2) {
    return choosePresentation(buildV2Presentation(explanation), emptyPresentation());
  }
  if (explanation?.schemaVersion === 3) {
    return choosePresentation(buildV3Presentation(explanation), emptyPresentation());
  }

  return choosePresentation({
    bodyParagraphs: uniqueText([aiComment.reason]).map((text) => normalizeText(text, 120)).filter(Boolean),
    tags: [],
    advice: normalizeText(aiComment.tip, 120) || null,
  }, emptyPresentation());
}

function isRealAiComment(aiComment, context) {
  if (!isPlainObject(aiComment)) return false;
  const explicitSources = [
    aiComment.source,
    aiComment.reviewSource,
    isPlainObject(aiComment.explanationV2) ? aiComment.explanationV2.source : undefined,
  ].map(normalizeReviewSource).filter(Boolean);

  if (explicitSources.some((source) => FALLBACK_REVIEW_SOURCES.has(source))) return false;
  if (explicitSources.includes('cached_ai') || explicitSources.includes('ai')) return true;
  const contextSource = normalizeReviewSource(context?.reviewSource);
  if (FALLBACK_REVIEW_SOURCES.has(contextSource)) return false;
  if (contextSource === 'cached_ai' || contextSource === 'ai') return true;
  return context?.enhanced === true;
}

function choosePresentation(candidate, fallback) {
  return hasQualifiedContent(candidate) ? candidate : fallback;
}

function hasQualifiedContent(candidate) {
  const body = Array.isArray(candidate?.bodyParagraphs)
    ? candidate.bodyParagraphs.join('')
    : '';
  const advice = candidate?.advice || '';
  const text = `${body}${advice}`;
  if (!body) return false;
  if (EMPTY_PHRASES.some((phrase) => text.includes(phrase))) return false;
  return !/\b(category|subcategory|slot|top|bottom|shoes|outerwear|accessory|onepiece)\b/i.test(text);
}

function buildV3Presentation(explanation) {
  return {
    bodyParagraphs: uniqueText([explanation.overallComment]).map((text) => normalizeText(text, 120)).filter(Boolean),
    tags: [],
    advice: normalizeText(explanation.advice, 120) || null,
  };
}

function buildV2Presentation(explanation) {
  const advice = chooseAdvice(explanation);
  const bodySource = [
    explanation.summary,
    ...readPoints(explanation.strengths),
  ].filter((text) => normalizeComparable(text) !== normalizeComparable(advice));

  return {
    bodyParagraphs: uniqueText(bodySource)
      .map((text) => normalizeText(text, 120))
      .filter(Boolean)
      .slice(0, 4),
    tags: [],
    advice: normalizeText(advice, 120) || null,
  };
}

function chooseAdvice(explanation) {
  const tipText = normalizeText(explanation.tip && explanation.tip.text, 120);
  return tipText || normalizeText(readPoints(explanation.tradeoffs)[0], 120);
}

function readPoints(points) {
  return Array.isArray(points) ? points.map((point) => point && point.text).filter(Boolean) : [];
}

function uniqueText(value) {
  const list = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();
  for (const entry of list) {
    const text = normalizeText(entry, 180);
    const key = normalizeComparable(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function normalizeText(value, maxLength) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeComparable(value) {
  return normalizeText(value, 200).replace(/[。！？!?,，\s]/g, '');
}

function normalizeReviewSource(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function emptyPresentation() {
  return { bodyParagraphs: [], tags: [], advice: null };
}

module.exports = {
  buildAiReviewPresentation,
};
