const {
  assertHumanCopy,
  findHumanCopyPolicyViolations,
  isTooSimilar,
} = require('./humanCopyPolicy');

const STYLIST_REVIEW_VERSION = 'stylist-explanation-v3';
const STYLIST_PROMPT_VERSION = 'stylist-prompt-v3';
const COPY_POLICY_VERSION = 'human-copy-v1';

const VALID_LIMITATIONS = new Set([
  'LIMITED_AESTHETIC_COVERAGE',
  'INSUFFICIENT_AESTHETIC_EVIDENCE',
]);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_SOURCES = new Set(['ai', 'rule_fallback']);
const COLOR_WORDS = ['黑色', '白色', '灰色', '灰白', '浅灰', '米色', '米白', '红色', '蓝色', '绿色', '黄色', '粉色', '紫色', '金色', '银色', '卡其', '棕色'];
const MATERIAL_WORDS = ['棉', '羊毛', '皮革', '牛仔', '丝绸', '亚麻', '针织', '雪纺'];

function buildStylistPromptV2(evidenceInput) {
  return {
    system: [
      '你是穿搭顾问，不是系统说明员。',
      '只能使用给定 facts 和 insights，不得虚构颜色、材质、版型、天气、场景、品牌、价格或品质。',
      '不得提及识别、证据、线索、维度、覆盖率，也不得解释生成过程。',
      '不得重复普通推荐理由，不得输出 title 或 styleTags 给 UI。',
      '不得使用显瘦、遮肉、显高、拉长腿等身体评价，也不得推断年龄、职业、身份。',
      '只输出严格 JSON，字段只能是 schemaVersion、reviewVersion、promptVersion、copyPolicyVersion、overallComment、advice。',
      'overallComment 为 40 到 120 字，总结整体气质和关系。',
      'advice 为 20 到 80 字，只给一条可执行调整。',
      '数据少时只讲确定事实，不解释为什么信息有限。',
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
  if (raw.schemaVersion === 3 || raw.overallComment || raw.advice) {
    return validateStylistExplanationV3(raw, evidenceInput, meta);
  }
  return validateLegacyExplanation(raw, evidenceInput, meta);
}

function validateStylistExplanationV3(raw, evidenceInput, meta = {}) {
  if (raw.schemaVersion !== 3) throw new Error('invalid_stylist_explanation');
  if (raw.reviewVersion !== STYLIST_REVIEW_VERSION) throw new Error('invalid_stylist_explanation');
  if (raw.promptVersion !== STYLIST_PROMPT_VERSION) throw new Error('invalid_stylist_explanation');
  if (raw.copyPolicyVersion !== COPY_POLICY_VERSION) throw new Error('invalid_stylist_explanation');

  const overallComment = normalizeVisibleCopy(raw.overallComment, 120);
  const advice = normalizeVisibleCopy(raw.advice, 80);
  if (!overallComment || !advice) throw new Error('invalid_stylist_explanation');
  if (isTooSimilar(overallComment, advice, 0.7)) throw new Error('invalid_stylist_explanation');
  assertKnownFactsOnly(`${overallComment}${advice}`, evidenceInput);

  const confidence = normalizeConfidence(raw.confidence, evidenceInput);
  const limitations = normalizeLimitations(raw.limitations, evidenceInput);
  const evidenceCodes = getValidEvidenceCodes(evidenceInput);
  const primaryCode = Array.from(evidenceCodes)[0];
  const tip = primaryCode ? { text: advice, evidenceCodes: [primaryCode] } : null;

  return {
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    title: '',
    summary: overallComment,
    overallComment,
    advice,
    strengths: [{ text: overallComment, evidenceCodes: primaryCode ? [primaryCode] : [] }],
    tradeoffs: [],
    tip,
    styleTags: [],
    confidence,
    evidenceCodes: Array.from(evidenceCodes).sort(),
    limitations,
    source: VALID_SOURCES.has(raw.source) ? raw.source : 'ai',
    provider: limitText(meta.provider, 48),
    model: limitText(meta.model, 64),
    generatedAt: limitText(meta.generatedAt, 40) || new Date().toISOString(),
    inputDigest: evidenceInput?.inputDigest || '',
  };
}

function validateLegacyExplanation(raw, evidenceInput, meta = {}) {
  if (raw.schemaVersion !== 2) throw new Error('invalid_stylist_explanation');
  if (raw.reviewVersion !== STYLIST_REVIEW_VERSION) throw new Error('invalid_stylist_explanation');
  if (raw.promptVersion !== STYLIST_PROMPT_VERSION) throw new Error('invalid_stylist_explanation');

  const summary = normalizeVisibleCopy(raw.summary, 120);
  const advice = normalizeVisibleCopy(raw.tip?.text || raw.tip || raw.advice || '想让整体更完整，可以让鞋子或配饰延续其中一个主色。', 80);
  if (!summary) throw new Error('invalid_stylist_explanation');

  const validCodes = getValidEvidenceCodes(evidenceInput);
  const strengths = normalizePoints(raw.strengths, validCodes, 3);
  const tradeoffs = normalizePoints(raw.tradeoffs, validCodes, 2);
  const tip = normalizePoint(raw.tip, validCodes) || (Array.from(validCodes)[0] ? { text: advice, evidenceCodes: [Array.from(validCodes)[0]] } : null);

  return {
    schemaVersion: 2,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    title: '',
    summary,
    strengths: strengths.length > 0 ? strengths : [{ text: summary, evidenceCodes: Array.from(validCodes).slice(0, 1) }],
    tradeoffs,
    tip,
    styleTags: [],
    confidence: normalizeConfidence(raw.confidence, evidenceInput),
    evidenceCodes: collectEvidenceCodes(strengths, tradeoffs, tip, raw.evidenceCodes, validCodes),
    limitations: normalizeLimitations(raw.limitations, evidenceInput),
    source: VALID_SOURCES.has(raw.source) ? raw.source : 'ai',
    provider: limitText(meta.provider, 48),
    model: limitText(meta.model, 64),
    generatedAt: limitText(meta.generatedAt, 40) || new Date().toISOString(),
    inputDigest: evidenceInput?.inputDigest || '',
  };
}

function buildRuleFallbackExplanationV2(evidenceInput, meta = {}) {
  const copy = buildHumanFallbackCopy(evidenceInput);
  const validCodes = getValidEvidenceCodes(evidenceInput);
  const primaryCode = Array.from(validCodes)[0];
  const tip = primaryCode ? { text: copy.advice, evidenceCodes: [primaryCode] } : null;
  return {
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    title: '',
    summary: copy.overallComment,
    overallComment: copy.overallComment,
    advice: copy.advice,
    strengths: [{ text: copy.overallComment, evidenceCodes: primaryCode ? [primaryCode] : [] }],
    tradeoffs: [],
    tip,
    styleTags: [],
    confidence: getFallbackConfidence(evidenceInput),
    evidenceCodes: Array.from(validCodes).sort(),
    limitations: readLimitations(evidenceInput),
    source: 'rule_fallback',
    provider: limitText(meta.provider, 48),
    model: limitText(meta.model, 64),
    generatedAt: limitText(meta.generatedAt, 40) || new Date().toISOString(),
    inputDigest: evidenceInput?.inputDigest || '',
  };
}

function toLegacyAiComment(explanation) {
  const reasonParts = explanation.schemaVersion === 3 && explanation.overallComment
    ? [explanation.overallComment]
    : [
        explanation.summary,
        ...uniqueStrings(explanation.strengths?.map((point) => point.text)),
        ...uniqueStrings(explanation.tradeoffs?.map((point) => point.text)),
      ].filter(Boolean);
  return {
    title: '',
    reason: limitText(reasonParts.join(' '), 160),
    styleTags: [],
    tip: explanation.advice || explanation.tip?.text || '想让整体更完整，可以让鞋子或配饰延续其中一个主色。',
    generatedAt: explanation.generatedAt,
    reviewVersion: explanation.reviewVersion,
    promptVersion: explanation.promptVersion,
    copyPolicyVersion: explanation.copyPolicyVersion,
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
  cooldownMs = 5 * 1000,
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
  if (!forceRegenerate && isReadyV3Review(review, context)) return { action: 'reuse' };
  if (forceRegenerate && isReadyV3Review(review, context)) {
    const generatedAt = Date.parse(review.generatedAt || review.updatedAt || '');
    const retryAfterMs = Number.isFinite(generatedAt) ? Math.max(0, cooldownMs - (nowMs - generatedAt)) : 0;
    if (retryAfterMs > 0) return { action: 'cooldown', retryAfterMs };
  }
  if (review.status === 'generating' && review.promptVersion === STYLIST_PROMPT_VERSION && review.inputDigest === context?.inputDigest) {
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
    schemaVersion: explanation.schemaVersion,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    evidenceVersion: context.evidenceVersion,
    inputDigest: context.inputDigest,
    inputHash: context.inputDigest,
    source: explanation.source,
    explanationV2: explanation,
    overallComment: explanation.overallComment,
    advice: explanation.advice,
    title: '',
    reason: aiComment.reason,
    styleTags: [],
    tip: aiComment.tip,
    provider: context.provider || explanation.provider,
    model: context.model || explanation.model,
    aiComment,
    status: 'ready',
    generatedAt: explanation.generatedAt || now,
    updatedAt: now,
  };
}

function normalizePoints(values, validCodes, maxCount) {
  return Array.isArray(values)
    ? values.map((value) => normalizePoint(value, validCodes)).filter(Boolean).slice(0, maxCount)
    : [];
}

function normalizePoint(value, validCodes) {
  if (!value || typeof value !== 'object') return null;
  const text = normalizeVisibleCopy(value.text, 80);
  const evidenceCodes = uniqueStrings(value.evidenceCodes).filter((code) => validCodes.has(code));
  if (!text || evidenceCodes.length === 0) return null;
  return { text, evidenceCodes };
}

function collectEvidenceCodes(strengths, tradeoffs, tip, rawCodes, validCodes) {
  return uniqueStrings([
    ...strengths.flatMap((point) => point.evidenceCodes),
    ...tradeoffs.flatMap((point) => point.evidenceCodes),
    ...(tip ? tip.evidenceCodes : []),
    ...(Array.isArray(rawCodes) ? rawCodes : []),
  ]).filter((code) => validCodes.has(code)).sort();
}

function buildHumanFallbackCopy(evidenceInput) {
  const colors = readOutfitColorNames(evidenceInput);
  const tags = uniqueStrings(evidenceInput?.outfit?.styleTags);
  const categories = uniqueStrings(evidenceInput?.outfit?.categories);
  if (colors.includes('白色') && (colors.includes('灰色') || colors.includes('灰白'))) {
    return {
      overallComment: '整体偏轻松日常，白色和灰色放在一起比较稳定。',
      advice: '想更完整，可以让鞋子延续白色或灰色。',
    };
  }
  if (tags.includes('通勤') || categories.includes('top') && categories.includes('bottom')) {
    return {
      overallComment: '整体偏干净日常，单品之间没有明显冲突。',
      advice: '想让整体更完整，可以让鞋子或配饰延续其中一个主色。',
    };
  }
  return {
    overallComment: '整体偏轻松日常，适合不需要太正式的场合。',
    advice: '想让整体更完整，可以让鞋子或配饰延续其中一个主色。',
  };
}

function normalizeVisibleCopy(value, maxLength) {
  const text = limitText(value, maxLength).replace(/\s+/g, '');
  if (!text) return '';
  try {
    assertHumanCopy(text);
  } catch {
    throw new Error('invalid_stylist_explanation');
  }
  return text;
}

function assertKnownFactsOnly(text, evidenceInput) {
  const allowedColors = readOutfitColorNames(evidenceInput);
  if (allowedColors.length > 0) {
    for (const color of COLOR_WORDS) {
      if (text.includes(color) && !allowedColors.includes(color)) throw new Error('invalid_stylist_explanation');
    }
  }
  const allowedMaterials = readOutfitMaterials(evidenceInput);
  if (allowedMaterials.length > 0) {
    for (const material of MATERIAL_WORDS) {
      if (text.includes(material) && !allowedMaterials.includes(material)) throw new Error('invalid_stylist_explanation');
    }
  }
  if (findHumanCopyPolicyViolations(text).length > 0) throw new Error('invalid_stylist_explanation');
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

function readOutfitColorNames(evidenceInput) {
  return uniqueStrings((evidenceInput?.outfit?.colors || []).map((entry) => (typeof entry === 'string' ? entry : entry?.name))).sort();
}

function readOutfitMaterials(evidenceInput) {
  const items = evidenceInput?.outfit?.items || [];
  return uniqueStrings(items.map((item) => item?.material)).sort();
}

function stripUnsafePromptInput(evidenceInput) {
  return {
    schemaVersion: evidenceInput?.schemaVersion,
    context: evidenceInput?.context,
    outfit: evidenceInput?.outfit,
    scores: evidenceInput?.scores,
    aesthetic: evidenceInput?.aesthetic,
    limitations: evidenceInput?.limitations,
    inputDigest: evidenceInput?.inputDigest,
  };
}

function isReadyV3Review(review, context) {
  return Boolean(
    review
      && review.status === 'ready'
      && review.reviewVersion === STYLIST_REVIEW_VERSION
      && review.promptVersion === STYLIST_PROMPT_VERSION
      && (!context?.copyPolicyVersion || review.copyPolicyVersion === context.copyPolicyVersion)
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
  COPY_POLICY_VERSION,
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
