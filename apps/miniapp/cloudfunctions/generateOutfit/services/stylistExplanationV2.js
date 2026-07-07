const {
  assertHumanCopy,
  findHumanCopyPolicyViolations,
  isTooSimilar,
} = require('./humanCopyPolicy');
const {
  VOICE_POLICY_VERSION,
  MECHANICAL_VOICE_TERMS,
  UNSUPPORTED_SENSATION_TERMS,
  findXiaodaVoicePolicyViolations,
  renderXiaodaStylistFallback,
} = require('./xiaodaVoicePolicy');
const {
  buildXiaodaDefaultReviewV1,
  hasQualifiedAiReviewIncrementV1,
  normalizeXiaodaSuggestionV1,
} = require('./xiaodaContentPlan');

const STYLIST_REVIEW_VERSION = 'stylist-explanation-v4';
const STYLIST_PROMPT_VERSION = 'stylist-prompt-v4';
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
      '你是用户身边懂穿搭的贴心朋友，表达要具体、温和、有生活感。',
      '只能使用给定 facts、insights 和 benefits，不得虚构颜色、材质、版型、天气、场景、品牌、价格或品质。',
      '不得解释识别、算法或生成过程，也不得提及识别、证据、线索、维度、覆盖率。',
      '不得使用机械设计词，例如克制、稳定、基础单品、正式度接近、视觉关系、更完整。',
      '不虚构舒适、材质、透气、保暖、柔软、亲肤等穿着感受。',
      '不得重复普通推荐理由，不得输出 title 或 styleTags 给 UI。',
      '不得使用显瘦、遮肉、显高、拉长腿等身体评价，也不得推断年龄、职业、身份。',
      '不过度卖萌，不使用宝宝、绝绝子、拿捏。',
      '只输出严格 JSON，字段只能是 overallComment、advice；不要输出版本字段，版本由服务端填写。',
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
  try {
    if (!raw || typeof raw !== 'object') throw new Error('invalid_stylist_explanation');
    if (raw.overallComment || raw.advice || raw.schemaVersion !== 2) {
      return validateStylistExplanationV3(raw, evidenceInput, meta);
    }
    return validateLegacyExplanation(raw, evidenceInput, meta);
  } catch (error) {
    attachStylistValidatorDiagnostics(error, raw, evidenceInput);
    throw error;
  }
}

function validateStylistExplanationV3(raw, evidenceInput, meta = {}) {
  const overallComment = normalizeVisibleCopy(raw.overallComment, 120);
  const advice = normalizeVisibleCopy(raw.advice, 80, { optional: true });
  if (!overallComment) {
    const error = new Error('invalid_stylist_explanation');
    error.validatorRejectReasons = ['SCHEMA_FIELDS_INVALID'];
    throw error;
  }
  if (advice && isTooSimilar(overallComment, advice, 0.7)) throw new Error('invalid_stylist_explanation');
  assertKnownFactsOnly(`${overallComment}${advice}`, evidenceInput);
  const contentPlan = evidenceInput?.contentPlan;
  if (contentPlan) {
    const defaultReview = buildXiaodaDefaultReviewV1(contentPlan);
    const increment = hasQualifiedAiReviewIncrementV1(
      { reason: overallComment, tip: advice, source: VALID_SOURCES.has(raw.source) ? raw.source : 'ai' },
      contentPlan,
      defaultReview,
    );
    if (!increment.qualified) {
      const error = new Error('invalid_stylist_explanation');
      error.validatorRejectReasons = increment.rejectReasons;
      throw error;
    }
  }

  const confidence = normalizeConfidence(raw.confidence, evidenceInput);
  const limitations = normalizeLimitations(raw.limitations, evidenceInput);
  const evidenceCodes = getValidEvidenceCodes(evidenceInput);
  const primaryCode = Array.from(evidenceCodes)[0];
  const tip = primaryCode && advice ? { text: advice, evidenceCodes: [primaryCode] } : null;

  return {
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
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
  const advice = normalizeVisibleCopy(raw.tip?.text || raw.tip || raw.advice || '想再有精神一点，可以让鞋子或小包呼应其中一个主色。', 80);
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
    voicePolicyVersion: VOICE_POLICY_VERSION,
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
  const tip = primaryCode && copy.advice ? { text: copy.advice, evidenceCodes: [primaryCode] } : null;
  return {
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
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
    tip: explanation.advice || explanation.tip?.text || '',
    generatedAt: explanation.generatedAt,
    reviewVersion: explanation.reviewVersion,
    promptVersion: explanation.promptVersion,
    copyPolicyVersion: explanation.copyPolicyVersion,
    voicePolicyVersion: explanation.voicePolicyVersion || VOICE_POLICY_VERSION,
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
    voicePolicyVersion: VOICE_POLICY_VERSION,
    evidenceVersion: context.evidenceVersion,
    inputDigest: context.inputDigest,
    inputHash: context.inputDigest,
    source: explanation.source,
    reviewSource: explanation.source,
    contentPlanVersion: context.contentPlanVersion || context.evidenceInput?.contentPlan?.version,
    sceneIntent: context.sceneIntent || context.evidenceInput?.contentPlan?.sceneIntent,
    primaryBenefitCode: context.primaryBenefitCode || context.evidenceInput?.contentPlan?.primaryBenefit,
    validatorRejectReasons: [],
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
  if (evidenceInput?.contentPlan) {
    const review = buildXiaodaDefaultReviewV1(evidenceInput.contentPlan);
    return {
      overallComment: review.reason,
      advice: review.tip || '',
    };
  }
  return renderXiaodaStylistFallback({ facts: evidenceToVoiceFacts(evidenceInput), benefits: [] });
}

function normalizeVisibleCopy(value, maxLength, options = {}) {
  const text = limitText(value, maxLength).replace(/\s+/g, '');
  if (!text) {
    if (options.optional) return '';
    return '';
  }
  try {
    assertHumanCopy(text);
  } catch {
    throw new Error('invalid_stylist_explanation');
  }
  if (findXiaodaVoicePolicyViolations(text).length > 0) {
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

function traceStylistExplanationValidationV2(rawValue, evidenceInput) {
  const raw = clonePlain(rawValue);
  const trace = [];
  const add = (check, pass, code = '', detail = '') => {
    trace.push({
      check,
      pass: Boolean(pass),
      ...(code ? { code } : {}),
      ...(detail ? { detail: limitText(detail, 120) } : {}),
    });
  };
  if (!raw || typeof raw !== 'object') {
    add('schema_fields', false, 'SCHEMA_FIELDS_INVALID', 'parsed JSON is not an object');
    return trace;
  }

  const versionFields = [
    raw.schemaVersion === undefined || raw.schemaVersion === 3 ? '' : 'schemaVersion',
    raw.reviewVersion === undefined || raw.reviewVersion === STYLIST_REVIEW_VERSION ? '' : 'reviewVersion',
    raw.promptVersion === undefined || raw.promptVersion === STYLIST_PROMPT_VERSION ? '' : 'promptVersion',
    raw.copyPolicyVersion === undefined || raw.copyPolicyVersion === COPY_POLICY_VERSION ? '' : 'copyPolicyVersion',
    raw.voicePolicyVersion === undefined || raw.voicePolicyVersion === VOICE_POLICY_VERSION ? '' : 'voicePolicyVersion',
  ].filter(Boolean);
  add(
    'version_fields_normalized',
    true,
    '',
    versionFields.length ? `server_normalized:${versionFields.join(',')}` : 'server-owned version fields ready',
  );
  add(
    'schema_fields',
    typeof raw.overallComment === 'string' && raw.overallComment.trim().length > 0,
    typeof raw.overallComment === 'string' && raw.overallComment.trim().length > 0 ? '' : 'SCHEMA_FIELDS_INVALID',
    typeof raw.overallComment === 'string' && raw.overallComment.trim().length > 0
      ? 'content fields are present'
      : 'overallComment is required',
  );

  const overallComment = normalizeTraceText(raw.overallComment, 120);
  const advice = normalizeTraceText(raw.advice, 80);
  add(
    'overall_comment_present',
    Boolean(overallComment),
    overallComment ? '' : 'MISSING_OVERALL_COMMENT',
    overallComment ? `length:${Array.from(overallComment).length}` : 'overallComment is empty or missing',
  );
  add(
    'advice_optional',
    true,
    advice ? '' : 'ADVICE_OPTIONAL_EMPTY',
    advice ? `advice length:${Array.from(advice).length}` : 'advice is empty and treated as optional',
  );
  add(
    'advice_distinct',
    !advice || !isTooSimilar(overallComment, advice, 0.7),
    advice && isTooSimilar(overallComment, advice, 0.7) ? 'EMPTY_OR_GENERIC_ADVICE' : '',
    advice ? 'checked advice is not just a repeat of overallComment' : 'empty advice is optional',
  );

  const combined = `${overallComment}${advice}`;
  const mechanicalTerms = findTerms(combined, MECHANICAL_VOICE_TERMS);
  add(
    'mechanical_copy',
    mechanicalTerms.length === 0,
    mechanicalTerms.length ? 'MECHANICAL_COPY' : '',
    mechanicalTerms.length ? `matched:${mechanicalTerms.join(',')}` : 'no mechanical wording matched',
  );

  const forbiddenTerms = findHumanCopyPolicyViolations(combined).filter((term) => !mechanicalTerms.includes(term));
  add(
    'forbidden_terms',
    forbiddenTerms.length === 0,
    forbiddenTerms.length ? 'FORBIDDEN_TERM' : '',
    forbiddenTerms.length ? `matched:${forbiddenTerms.join(',')}` : 'no forbidden terms matched',
  );

  const sensationTerms = findTerms(combined, UNSUPPORTED_SENSATION_TERMS);
  add(
    'unsupported_sensation',
    sensationTerms.length === 0,
    sensationTerms.length ? 'UNSUPPORTED_SENSATION' : '',
    sensationTerms.length ? `matched:${sensationTerms.join(',')}` : 'no unsupported sensation matched',
  );

  const unsupportedFacts = findUnsupportedFacts(combined, evidenceInput);
  add(
    'unsupported_fact',
    unsupportedFacts.length === 0,
    unsupportedFacts.length ? 'UNSUPPORTED_FACT' : '',
    unsupportedFacts.length ? `matched:${unsupportedFacts.join(',')}` : 'no unsupported color material or item fact matched',
  );

  const contentPlan = evidenceInput?.contentPlan;
  if (contentPlan) {
    const defaultReview = buildXiaodaDefaultReviewV1(contentPlan);
    const increment = hasQualifiedAiReviewIncrementV1(
      { reason: overallComment, tip: advice, source: VALID_SOURCES.has(raw.source) ? raw.source : 'ai' },
      contentPlan,
      defaultReview,
    );
    add(
      'information_gain',
      !increment.rejectReasons.includes('no_information_gain'),
      increment.rejectReasons.includes('no_information_gain') ? 'NO_INFORMATION_GAIN' : '',
      increment.rejectReasons.includes('no_information_gain') ? 'too close to known default or too little new detail' : 'has information gain or no rejection from content plan',
    );
    add(
      'similar_to_default',
      !isTooSimilar(overallComment, defaultReview.reason, 0.76),
      isTooSimilar(overallComment, defaultReview.reason, 0.76) ? 'TOO_SIMILAR_TO_DEFAULT' : '',
      isTooSimilar(overallComment, defaultReview.reason, 0.76) ? 'overallComment is too close to default review' : 'not too similar to default review',
    );
    const normalizedSuggestion = advice ? normalizeXiaodaSuggestionV1(advice, contentPlan) : null;
    add(
      'advice_actionable',
      !advice || Boolean(normalizedSuggestion),
      advice && !normalizedSuggestion ? 'EMPTY_OR_GENERIC_ADVICE' : advice ? '' : 'ADVICE_OPTIONAL_EMPTY',
      advice ? 'checked advice against grounded action rules' : 'empty advice is optional',
    );
    for (const reason of increment.rejectReasons) {
      const code = mapIncrementRejectReason(reason);
      if (code && !trace.some((entry) => entry.code === code && entry.pass === false)) {
        add(`content_plan_${reason}`, false, code, reason);
      }
    }
  } else {
    add('information_gain', true, '', 'content plan not available');
    add('similar_to_default', true, '', 'content plan not available');
    add('advice_actionable', true, advice ? '' : 'ADVICE_OPTIONAL_EMPTY', advice ? 'content plan not available' : 'empty advice is optional');
  }

  return trace;
}

function attachStylistValidatorDiagnostics(error, raw, evidenceInput) {
  const trace = traceStylistExplanationValidationV2(raw, evidenceInput);
  const existingReasons = uniqueStrings(error?.validatorRejectReasons);
  const traceReasons = trace
    .filter((entry) => entry.pass === false && entry.code)
    .map((entry) => entry.code);
  error.validatorTrace = trace;
  error.validatorRejectReasons = uniqueStrings([...existingReasons.map((reason) => mapIncrementRejectReason(reason) || reason), ...traceReasons])
    .filter(Boolean);
}

function findUnsupportedFacts(text, evidenceInput) {
  const issues = [];
  const allowedColors = readOutfitColorNames(evidenceInput);
  if (allowedColors.length > 0) {
    for (const color of COLOR_WORDS) {
      if (text.includes(color) && !allowedColors.includes(color)) issues.push(`color:${color}`);
    }
  }
  const allowedMaterials = readOutfitMaterials(evidenceInput);
  if (allowedMaterials.length > 0) {
    for (const material of MATERIAL_WORDS) {
      if (text.includes(material) && !allowedMaterials.includes(material)) issues.push(`material:${material}`);
    }
  }
  return uniqueStrings(issues);
}

function mapIncrementRejectReason(reason) {
  const map = {
    missing_reason: 'MISSING_OVERALL_COMMENT',
    empty_phrase: 'EMPTY_OR_GENERIC_ADVICE',
    english_type_leak: 'FORBIDDEN_TERM',
    not_grounded: 'NO_INFORMATION_GAIN',
    no_information_gain: 'NO_INFORMATION_GAIN',
    invalid_suggestion: 'EMPTY_OR_GENERIC_ADVICE',
  };
  return map[reason] || reason;
}

function findTerms(text, terms) {
  return uniqueStrings((terms || []).filter((term) => term && text.includes(term)));
}

function normalizeTraceText(value, maxLength) {
  return limitText(value, maxLength).replace(/\s+/g, '');
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

function evidenceToVoiceFacts(evidenceInput = {}) {
  const items = Array.isArray(evidenceInput.outfit?.items)
    ? evidenceInput.outfit.items.map((entry, index) => ({
        id: entry.itemId || entry.clothingId || `item-${index}`,
        slot: entry.category || entry.slot || 'other',
        name: entry.subcategory || entry.name || entry.category || '单品',
        colors: readOutfitColorNames(evidenceInput),
        styleTags: uniqueStrings(evidenceInput.outfit?.styleTags),
        material: entry.material || '',
        thickness: entry.thickness || '',
      }))
    : [];
  return {
    items,
    outfit: {
      categories: uniqueStrings(evidenceInput.outfit?.categories),
      styleTags: uniqueStrings(evidenceInput.outfit?.styleTags),
    },
    context: evidenceInput.context || {},
  };
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
      && (!context?.voicePolicyVersion || review.voicePolicyVersion === context.voicePolicyVersion)
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
  VOICE_POLICY_VERSION,
  buildRuleFallbackExplanationV2,
  buildStylistPromptV2,
  buildStylistReviewDocument,
  parseStylistExplanationJson,
  resolveStylistReviewReuse,
  toLegacyAiComment,
  traceStylistExplanationValidationV2,
  validateStylistExplanationV2,
};
