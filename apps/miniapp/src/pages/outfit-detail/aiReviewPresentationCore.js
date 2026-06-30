function buildAiReviewPresentation(aiComment) {
  if (!aiComment || typeof aiComment !== 'object') {
    return emptyPresentation();
  }

  const explanation = aiComment.explanationV2 && typeof aiComment.explanationV2 === 'object'
    ? aiComment.explanationV2
    : null;

  if (explanation && explanation.schemaVersion === 2) {
    return buildV2Presentation(aiComment, explanation);
  }
  if (explanation && explanation.schemaVersion === 3) {
    return buildV3Presentation(explanation);
  }

  const bodyParagraphs = uniqueText([aiComment.reason]).map((text) => normalizeText(text, 120)).filter(Boolean);
  return {
    bodyParagraphs,
    tags: [],
    advice: normalizeText(aiComment.tip, 120) || null,
  };
}

function buildV3Presentation(explanation) {
  return {
    bodyParagraphs: uniqueText([explanation.overallComment]).map((text) => normalizeText(text, 120)).filter(Boolean),
    tags: [],
    advice: normalizeText(explanation.advice, 120) || null,
  };
}

function buildV2Presentation(aiComment, explanation) {
  const advice = chooseAdvice(explanation);
  const bodySource = [
    explanation.summary,
    ...readPoints(explanation.strengths),
  ].filter((text) => normalizeComparable(text) !== normalizeComparable(advice));

  const bodyParagraphs = uniqueText(bodySource)
    .map((text) => normalizeText(text, 120))
    .filter(Boolean)
    .slice(0, 4);
  return {
    bodyParagraphs,
    tags: [],
    advice: normalizeText(advice, 120) || null,
  };
}

function chooseAdvice(explanation) {
  const tipText = normalizeText(explanation.tip && explanation.tip.text, 120);
  if (tipText) return tipText;
  return normalizeText(readPoints(explanation.tradeoffs)[0], 120);
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
  const text = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeComparable(value) {
  return normalizeText(value, 200).replace(/[。！？!?,，\s]/g, '');
}

function emptyPresentation() {
  return {
    bodyParagraphs: [],
    tags: [],
    advice: null,
  };
}

module.exports = {
  buildAiReviewPresentation,
};
