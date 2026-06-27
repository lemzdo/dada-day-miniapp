const STYLIST_REVIEW_VERSION = 'stylist-explanation-v2';
const STYLIST_PROMPT_VERSION = 'stylist-prompt-v2';
const VALID_LIMITATIONS = new Set([
  'LIMITED_AESTHETIC_COVERAGE',
  'INSUFFICIENT_AESTHETIC_EVIDENCE',
]);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_SOURCES = new Set(['ai', 'rule_fallback']);
const POINT_LIMITS = {
  strengths: 3,
  tradeoffs: 2,
};

function buildStylistPromptV2(evidenceInput) {
  return {
    system: [
      '你是搭搭day的小搭穿搭解释者，不是衣服选择器。',
      '只能使用用户输入中的 facts 和 evidence code 解释既有 outfit，不得重新选择衣服。',
      '每个 strengths、tradeoffs 和 tip 都必须引用输入中真实存在的 evidence code。',
      '不得创造不存在的材质、颜色、版型、天气、场景、品牌、价格或品质。',
      '不得推断身材、体型、年龄、职业、身份、经济状况，也不得评价用户本人。',
      '禁止使用显瘦、遮肉、拉长腿等身体导向表达。',
      'low coverage 或 INSUFFICIENT_AESTHETIC_EVIDENCE 时必须谨慎，不得输出整体审美优劣结论。',
      '不得修改或重新计算 scores。',
      '输出严格 JSON，不输出 Markdown，不输出 schema 外字段。',
      '中文自然简洁，使用小搭语气但不过度卖萌。',
    ].join('\n'),
    user: JSON.stringify(stripUnsafePromptInput(evidenceInput)),
  };
}

function parseStylistExplanationJson(content) {
  const text = String(content || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        throw new Error('invalid_stylist_json');
      }
    }
    throw new Error('invalid_stylist_json');
  }
}

function validateStylistExplanationV2(rawValue, evidenceInput, meta = {}) {
  const raw = clonePlain(rawValue);
  if (!raw || typeof raw !== 'object') throw new Error('invalid_stylist_explanation');
  if (raw.schemaVersion !== 2) throw new Error('invalid_stylist_explanation');
  if (raw.reviewVersion !== STYLIST_REVIEW_VERSION) throw new Error('invalid_stylist_explanation');
  if (raw.promptVersion !== STYLIST_PROMPT_VERSION) throw new Error('invalid_stylist_explanation');

  const validCodes = getValidEvidenceCodes(evidenceInput);
  const limitations = normalizeLimitations(raw.limitations, evidenceInput);
  const confidence = normalizeConfidence(raw.confidence, evidenceInput);
  const title = limitText(raw.title, 16);
  const summary = limitText(raw.summary, 120);
  if (!title || !summary) throw new Error('invalid_stylist_explanation');

  const strengths = normalizePoints(raw.strengths, validCodes, POINT_LIMITS.strengths);
  const tradeoffs = normalizePoints(raw.tradeoffs, validCodes, POINT_LIMITS.tradeoffs);
  const tip = normalizePoint(raw.tip, validCodes);
  if (strengths.length === 0 && tradeoffs.length === 0 && !tip) {
    throw new Error('invalid_stylist_explanation');
  }

  return {
    schemaVersion: 2,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    title,
    summary,
    strengths,
    tradeoffs,
    tip,
    styleTags: normalizeStyleTags(raw.styleTags),
    confidence,
    evidenceCodes: collectEvidenceCodes(strengths, tradeoffs, tip, raw.evidenceCodes, validCodes),
    limitations,
    source: VALID_SOURCES.has(raw.source) ? raw.source : 'ai',
    provider: limitText(meta.provider, 48),
    model: limitText(meta.model, 64),
    generatedAt: limitText(meta.generatedAt, 40) || new Date().toISOString(),
    inputDigest: evidenceInput.inputDigest,
  };
}

function buildRuleFallbackExplanationV2(evidenceInput, meta = {}) {
  const evidence = Array.isArray(evidenceInput?.evidence) ? evidenceInput.evidence : [];
  const positive = evidence.filter((entry) => entry.polarity === 'positive');
  const negative = evidence.filter((entry) => entry.polarity === 'negative');
  const neutral = evidence.filter((entry) => entry.polarity === 'neutral');
  const primary = positive[0] || neutral[0] || evidence[0] || null;
  const hasInsufficient = readLimitations(evidenceInput).includes('INSUFFICIENT_AESTHETIC_EVIDENCE');
  const confidence = getFallbackConfidence(evidenceInput);
  const prefix = hasInsufficient ? '从目前可识别的信息看，' : '';
  const strengths = primary
    ? [{
        text: `${prefix}${describeEvidence(primary)}，可以作为这套的主要观察点。`,
        evidenceCodes: [primary.code],
      }]
    : [{
        text: '小搭目前只能基于场景、天气和单品基础信息做谨慎点评。',
        evidenceCodes: [],
      }];
  const tradeoffs = negative[0]
    ? [{
        text: `可以优先关注${describeDimension(negative[0].dimension)}，避免视觉重点过多。`,
        evidenceCodes: [negative[0].code],
      }]
    : [];
  const tip = primary
    ? {
        text: '小搭建议沿着这条已识别线索微调配饰或外层，保持整体一致。',
        evidenceCodes: [primary.code],
      }
    : null;

  return {
    schemaVersion: 2,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    title: hasInsufficient ? '谨慎参考' : '小搭参考',
    summary: hasInsufficient
      ? '当前审美证据较少，小搭先基于已知信息给出谨慎点评。'
      : '小搭根据已识别的组合证据给出这次点评。',
    strengths,
    tradeoffs,
    tip,
    styleTags: buildFallbackStyleTags(evidenceInput),
    confidence,
    evidenceCodes: uniqueStrings([
      ...strengths.flatMap((point) => point.evidenceCodes),
      ...tradeoffs.flatMap((point) => point.evidenceCodes),
      ...(tip ? tip.evidenceCodes : []),
    ]),
    limitations: readLimitations(evidenceInput),
    source: 'rule_fallback',
    provider: limitText(meta.provider, 48),
    model: limitText(meta.model, 64),
    generatedAt: limitText(meta.generatedAt, 40) || new Date().toISOString(),
    inputDigest: evidenceInput?.inputDigest || '',
  };
}

function toLegacyAiComment(explanation) {
  const reasonParts = [
    explanation.summary,
    ...explanation.strengths.map((point) => point.text),
    ...explanation.tradeoffs.map((point) => point.text),
  ].filter(Boolean);
  return {
    title: explanation.title,
    reason: limitText(reasonParts.join(' '), 160),
    styleTags: explanation.styleTags,
    tip: explanation.tip ? explanation.tip.text : '小搭建议保持整体信息简单，优先选择你今天最舒服的穿法。',
    generatedAt: explanation.generatedAt,
    reviewVersion: explanation.reviewVersion,
    promptVersion: explanation.promptVersion,
    inputDigest: explanation.inputDigest,
    source: explanation.source,
    explanationV2: explanation,
  };
}

function resolveStylistReviewReuse({
  review,
  context,
  forceRegenerate = false,
  nowMs = Date.now(),
  cooldownMs = 30 * 1000,
  generationToken,
  mode = 'acquire',
} = {}) {
  if (mode === 'finish') {
    if (!isCurrentGeneration(review, context, generationToken)) return { action: 'superseded' };
    if (review.inputDigest !== context.inputDigest) return { action: 'superseded' };
    return { action: 'save' };
  }
  if (mode === 'failure') {
    if (!isCurrentGeneration(review, context, generationToken)) return { action: 'superseded' };
    return review.previousReview ? { action: 'restore_previous' } : { action: 'mark_failed' };
  }
  if (!review) return { action: 'generate' };
  if (!forceRegenerate && isReadyV2Review(review, context)) return { action: 'reuse' };
  if (forceRegenerate && isReadyV2Review(review, context)) {
    const generatedAt = Date.parse(review.generatedAt || review.updatedAt || '');
    const retryAfterMs = Number.isFinite(generatedAt) ? Math.max(0, cooldownMs - (nowMs - generatedAt)) : 0;
    if (retryAfterMs > 0) return { action: 'cooldown', retryAfterMs };
  }
  if (review.status === 'generating' && review.promptVersion === STYLIST_PROMPT_VERSION) {
    return { action: 'in_progress' };
  }
  return { action: 'generate' };
}

function buildStylistReviewDocument({ context, explanation, now }) {
  const aiComment = toLegacyAiComment(explanation);
  return {
    _openid: context.openid,
    userId: context.openid,
    outfitKey: context.outfitKey,
    scene: context.scene,
    schemaVersion: 2,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    evidenceVersion: context.evidenceVersion,
    inputDigest: context.inputDigest,
    inputHash: context.inputDigest,
    source: explanation.source,
    explanationV2: explanation,
    title: aiComment.title,
    reason: aiComment.reason,
    styleTags: aiComment.styleTags,
    tip: aiComment.tip,
    provider: context.provider || explanation.provider,
    model: context.model || explanation.model,
    aiComment,
    status: 'ready',
    generatedAt: explanation.generatedAt || now,
    updatedAt: now,
  };
}

function isReadyV2Review(review, context) {
  return Boolean(
    review
      && review.status === 'ready'
      && review.reviewVersion === STYLIST_REVIEW_VERSION
      && (!review.promptVersion || review.promptVersion === STYLIST_PROMPT_VERSION)
      && review.inputDigest === context.inputDigest,
  );
}

function isCurrentGeneration(review, context, generationToken) {
  return Boolean(
    review
      && review.status === 'generating'
      && review.generationToken === generationToken
      && (!context?.inputDigest || review.inputDigest === context.inputDigest),
  );
}

function normalizePoints(values, validCodes, maxCount) {
  return Array.isArray(values)
    ? values.map((value) => normalizePoint(value, validCodes)).filter(Boolean).slice(0, maxCount)
    : [];
}

function normalizePoint(value, validCodes) {
  if (!value || typeof value !== 'object') return null;
  const text = limitText(value.text, 80);
  const evidenceCodes = uniqueStrings(value.evidenceCodes).filter((code) => validCodes.has(code));
  if (!text || evidenceCodes.length === 0) return null;
  return { text, evidenceCodes };
}

function collectEvidenceCodes(strengths, tradeoffs, tip) {
  return uniqueStrings([
    ...strengths.flatMap((point) => point.evidenceCodes),
    ...tradeoffs.flatMap((point) => point.evidenceCodes),
    ...(tip ? tip.evidenceCodes : []),
  ]).sort();
}

function normalizeStyleTags(value) {
  return uniqueStrings(value)
    .map((tag) => limitText(tag, 12))
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeLimitations(rawLimitations, evidenceInput) {
  const merged = uniqueStrings([...(Array.isArray(rawLimitations) ? rawLimitations : []), ...readLimitations(evidenceInput)]).sort();
  for (const limitation of merged) {
    if (!VALID_LIMITATIONS.has(limitation)) throw new Error('invalid_stylist_explanation');
  }
  return merged;
}

function normalizeConfidence(value, evidenceInput) {
  let confidence = VALID_CONFIDENCE.has(value) ? value : getFallbackConfidence(evidenceInput);
  const coverage = Number(evidenceInput?.aesthetic?.coverage || 0);
  const hasInsufficient = readLimitations(evidenceInput).includes('INSUFFICIENT_AESTHETIC_EVIDENCE');
  if (hasInsufficient || coverage < 0.25) confidence = 'low';
  else if (coverage < 0.5 && confidence === 'high') confidence = 'medium';
  return confidence;
}

function getFallbackConfidence(evidenceInput) {
  const coverage = Number(evidenceInput?.aesthetic?.coverage || 0);
  if (evidenceInput?.aesthetic?.score === null || coverage < 0.25) return 'low';
  if (coverage < 0.5) return 'medium';
  return 'high';
}

function getValidEvidenceCodes(evidenceInput) {
  return new Set((Array.isArray(evidenceInput?.evidence) ? evidenceInput.evidence : []).map((entry) => entry.code).filter(Boolean));
}

function readLimitations(evidenceInput) {
  return uniqueStrings(evidenceInput?.limitations).filter((limitation) => VALID_LIMITATIONS.has(limitation)).sort();
}

function describeEvidence(entry) {
  if (!entry) return '已知信息有限';
  if (entry.code.includes('COLOR')) return '配色证据比较明确';
  if (entry.code.includes('SILHOUETTE')) return '轮廓关系比较清楚';
  if (entry.code.includes('FORMALITY')) return '场合正式度较一致';
  if (entry.code.includes('PATTERN')) return '图案重点有可观察线索';
  if (entry.code.includes('DETAIL')) return '细节分布有可观察线索';
  return '这套有可识别的搭配线索';
}

function describeDimension(dimension) {
  const map = {
    colorHarmony: '配色',
    silhouetteBalance: '轮廓',
    proportionBalance: '比例',
    patternBalance: '图案',
    formalityConsistency: '正式度',
    detailBalance: '细节',
  };
  return map[dimension] || '已识别的搭配线索';
}

function buildFallbackStyleTags(evidenceInput) {
  const tags = uniqueStrings(evidenceInput?.outfit?.styleTags).slice(0, 3);
  if (tags.length >= 2) return tags;
  return uniqueStrings([...tags, '日常参考', '小搭点评']).slice(0, 5);
}

function stripUnsafePromptInput(evidenceInput) {
  return {
    schemaVersion: evidenceInput?.schemaVersion,
    evidenceVersion: evidenceInput?.evidenceVersion,
    context: evidenceInput?.context,
    outfit: evidenceInput?.outfit,
    scores: evidenceInput?.scores,
    aesthetic: evidenceInput?.aesthetic,
    evidence: evidenceInput?.evidence,
    limitations: evidenceInput?.limitations,
    inputDigest: evidenceInput?.inputDigest,
  };
}

function limitText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return Array.from(value.trim().replace(/\s+/g, ' ')).slice(0, maxLength).join('');
}

function uniqueStrings(values) {
  return Array.isArray(values)
    ? values
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim())
        .filter((value, index, array) => array.indexOf(value) === index)
    : [];
}

function clonePlain(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  STYLIST_PROMPT_VERSION,
  STYLIST_REVIEW_VERSION,
  buildRuleFallbackExplanationV2,
  buildStylistPromptV2,
  buildStylistReviewDocument,
  parseStylistExplanationJson,
  resolveStylistReviewReuse,
  toLegacyAiComment,
  validateStylistExplanationV2,
};
