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
} = require('./xiaodaVoicePolicy');
const {
  buildXiaodaDefaultReviewV1,
  hasQualifiedAiReviewIncrementV1,
  normalizeXiaodaSuggestionV1,
} = require('./xiaodaContentPlan');
const { validateCopyAgainstFacts } = require('./validatorFactPolicy');
const { inspectXiaodaPersonaCopy } = require('./xiaodaPersonaContract');

const STYLIST_REVIEW_VERSION = 'stylist-explanation-v20';
const STYLIST_PROMPT_VERSION = 'stylist-prompt-v21';
const COPY_POLICY_VERSION = 'human-copy-v2';

const VALID_LIMITATIONS = new Set([
  'LIMITED_AESTHETIC_COVERAGE',
  'INSUFFICIENT_AESTHETIC_EVIDENCE',
]);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
const VALID_SOURCES = new Set(['ai', 'rule_fallback']);
const MATERIAL_WORDS = ['棉', '羊毛', '皮革', '牛仔', '丝绸', '亚麻', '针织', '雪纺'];

function buildStylistPromptV2(evidenceInput, options = {}) {
  const retryReasons = uniqueStrings(options.retryReasons);
  const safeRetryTerms = uniqueStrings(options.retryRejectedTerms)
    .filter((term) => [...MECHANICAL_VOICE_TERMS, ...UNSUPPORTED_SENSATION_TERMS].includes(term))
    .slice(0, 8);
  const primary = evidenceInput?.contentPlan?.xiaodaStyleInsight?.primary || {};
  const primaryGuide = [
    limitText(primary.primaryObservation, 160),
    limitText(primary.supportingRelation, 160),
    limitText(primary.humanMeaning, 160),
    limitText(primary.overallMeaning, 180),
  ].filter(Boolean).join(' / ');
  return {
    system: [
      '你是“小搭”：审美在线、懂搭配、熟悉用户衣橱，说话自然、有判断但不过度点评的朋友型私人穿搭顾问。你不是 AI 客服、杂志编辑或系统分析器。',
      '推荐已经由服务端决定。不要重新推荐、重跑判断或改变结论，只沿着本次主判断继续讲深。',
      ...(primaryGuide ? [`本次主判断已经先翻译成人能理解的话：${primaryGuide}。不要转去讲另一套理由。`] : []),
      '先给人能听懂的穿着判断，再说明具体衣物之间为什么成立。从穿衣者视角讲上身、下身、鞋子、外层和整身，不翻译算法字段。',
      '只能使用给定衣物事实、已经确认的穿着关系、Today 文案和确定性 Detail 文案，不得虚构颜色、材质、版型、天气、场景、品牌、价格、品质或身体效果。',
      '颜色、材质、厚度、版型和图案必须逐件绑定。某一件衣物有“棉、薄、印花”等字段，不代表其他衣物也有；除非每件都明确给出，否则不能说“两件都是……”。',
      '不得提及识别、证据、线索、维度、覆盖率、关系编码，也不得使用“视觉重量、色块、结构完整度、主体连起来”等算法中文。',
      '不虚构舒适、透气、保暖、柔软、亲肤，不承诺显瘦、显高、显腿长、显白、高级、性感或修饰身材。',
      '不要用“毫无负担、轻松自在、不费力就”替代具体搭配判断；这些说法既空泛，也容易暗示未经证实的穿着感受。',
      '避免“形成呼应、作为底色、点睛之笔、不过于平淡、既有层次又……”等时尚杂志套话。直接说哪件衣物做了什么，以及用户为什么可以保留这套搭法。',
      '不要把点评写成“上身清爽、下身利落”或连续堆叠“自然、简洁、得体、有分寸”等形容词；每句话至少落到一件具体衣物关系。',
      '不要把衣物关系包装成“视觉落点、视觉节奏、连成一体、连成整体、连续感、中间隔开、接住上衣、核心单品共同维持”等编辑腔或分析腔，直接说穿上这些具体衣物后，人看起来怎样，以及每件衣物贡献了什么。',
      '不要用“视线拉回两端、视线留在脸附近、裤子在中间隔开、短裤在中间留出颜色变化、腿部到脚下颜色不断开、让中间的颜色更集中”来画算法示意图。改用“上衣有重点、下装简单、鞋子不突兀、整身不杂”这类由事实支持、用户能直接理解的穿衣判断。',
      '当主判断涉及上衣和鞋子同色时，只需说鞋子因为和上衣颜色一样所以不突兀，下装又让整身保留颜色变化。不得解释它们在身体两端、被裤子隔开，或把视线拉向哪里。',
      '不要把“简单”扩写成“基础款型、没有额外设计”，也不要用“穿起来不费力、自然过渡、有联系又不单调”代替具体判断。输入没有明确写出的款型或设计事实一律不说。',
      '不要说“基础休闲款”，不要把上衣和鞋子描述成“上下两头接住、下装在中间”，也不要说“主色统一、其他位置、中性色过渡、颜色连续、支撑关系”。这些仍是算法翻译。',
      '不要重判“适合居家、适合通勤、适合轻运动”等场景结论；推荐系统已经决定场景。可以解释当前衣物关系，但不能重新证明它适合这个场景。',
      '使用口语化逗号和句号，不使用分号。避免“这套的价值在于、各司其职、互不干扰、主支撑关系、松弛感”等分析总结。',
      'overallComment 最多两句话：第一句用具体衣物名延续 Today 的判断，第二句只展开一个衣物关系或一个用户决策价值。不要另起第三个观点。',
      '每件衣物的完整名称和颜色在 overallComment 里最多说一次。后一句需要再次指代时，用“上衣、短裤、鞋子、它”这类自然代称，不要在相邻分句重复三个字以上的原短语。',
      'overallComment 必须同时比 Today 文案和确定性 Detail 文案多一层解释，但不能换成另一套理由，不能只是把已有句子换同义词写长。',
      '只围绕本次主判断涉及的衣物展开核心判断，其他衣物最多用一句交代，不要把配饰或第三件衣物发展成新观点。',
      'advice 不能让用户换掉、替换、另选或购买任何衣物，也不能一边建议换掉、一边说当前可保留。只允许针对当前组合给“保留、不再增加、减少额外颜色”等微调；没有真实增量就返回空字符串。',
      '若主判断是颜色或图案焦点，绝不能把陪衬衣物称为焦点、亮点或颜色重点，即使后文又改回来也算改变判断。',
      '好例：Today 说“印花上衣已经够有内容，纯色长裤简单一些，穿在身上有重点但不拥挤”，Detail 解释“穿上后会先注意到印花上衣，长裤没有再加图案，所以衣服不会堆得太满”。AI 可以再讲“印花集中在上半身，人的第一眼仍落在脸和上衣附近，长裤只把腿部线条收干净”。',
      '好例：Today 说“黑色长裤配黑色运动鞋，下半身看着干净，白色T恤留出了明暗变化”，Detail 解释“腿部到脚下少一次明暗变化，白色T恤因此更醒目”。AI 还要说清这种明暗安排为什么让上下身清楚又不杂。',
      '好例：基础组合没有更强关系时，Today 直接说“白色T恤配灰色短裤，穿在身上简单自然”。若没有比确定性 Detail 更深的真实内容，宁可返回朴素但具体的说明，advice 留空。',
      '坏例：把上句改写成“图案与纯色形成视觉平衡，提升整体协调感”；这是算法翻译和空泛总结。',
      '只输出严格 JSON，字段只能是 overallComment、advice；不要输出版本字段，版本由服务端填写。',
      'overallComment 为 40 到 90 字，说明总体判断和具体衣物关系。',
      'advice 允许为空；不为空时为 20 到 80 字，只给一条可执行调整。',
      '数据少时只讲确定事实，不解释为什么信息有限。',
      ...(retryReasons.length > 0
        ? [`这是一次纠错重试。上一次只因这些安全校验未通过：${retryReasons.join('、')}。请重新输出，不要复述错误码；必须守住同一个 primary。`]
        : []),
      ...(safeRetryTerms.length > 0
        ? [`上一次出现了这些明确禁用表达：${safeRetryTerms.join('、')}。本次逐字避开，并换成具体衣物关系。`]
        : []),
      ...(retryReasons.includes('STYLE_INSIGHT_DRIFT')
        ? ['上一次换了理由。本次以输入中的 Today 文案、确定性 Detail 文案和主判断为唯一语义骨架，只做更自然、更具体的展开。']
        : []),
      ...(retryReasons.some((reason) => ['ALGORITHM_TO_CHINESE_LEAKAGE', 'algorithm_to_chinese_leakage'].includes(reason))
        ? ['上一次仍在用视线、两端、中间、隔开、颜色不断开等位置或画面术语解释算法。本次只说具体衣物穿在人身上的判断，不描述颜色在画面里怎样移动、连接或分区，也不要出现“中间”。若上衣和鞋子同色，就说鞋子不会显得突兀、下装让整身保留颜色变化，到这里结束。']
        : []),
      ...(retryReasons.some((reason) => ['OVERALL_COPY_INVALID', 'MECHANICAL_COPY'].includes(reason))
        ? ['上一次有相邻分句重复了同一段衣物名或颜色。本次每个完整衣物名只说一次，后一句改用“上衣、下装、鞋子、它”等代称，仍保持两句话以内。']
        : []),
      ...(retryReasons.some((reason) => ['UNSUPPORTED_FACT', 'OVERALL_FACT_VALIDATION_FAILED', 'ADVICE_FACT_VALIDATION_FAILED'].includes(reason))
        ? ['上一次把单件属性传播给了其他衣物，或补了输入没有的事实。本次不要写任何材质、厚度、版型或设计属性，只使用输入里的衣物名称与已经明确给出的颜色或关系。']
        : []),
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
  const overallResult = validateOverallComment(raw.overallComment, evidenceInput, raw);
  if (!overallResult.accepted) {
    const error = new Error('invalid_stylist_explanation');
    error.validatorRejectReasons = overallResult.rejectReasons;
    throw error;
  }
  const overallComment = overallResult.value;
  const adviceResult = validateAdvice(raw.advice, overallComment, evidenceInput);
  const advice = adviceResult.accepted ? adviceResult.value : null;

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
    partial: !adviceResult.accepted,
    adviceRejectReasons: adviceResult.rejectReasons,
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

function validateOverallComment(value, evidenceInput, raw = {}) {
  const rejectReasons = [];
  let overallComment = '';
  if (typeof value !== 'string' || !value.trim()) {
    rejectReasons.push('SCHEMA_FIELDS_INVALID');
  } else {
    try {
      overallComment = normalizeVisibleCopy(value, 90);
    } catch {
      rejectReasons.push('OVERALL_COPY_INVALID');
    }
  }
  if (overallComment) {
    try {
      assertKnownFactsOnly(overallComment, evidenceInput);
    } catch {
      rejectReasons.push('OVERALL_FACT_VALIDATION_FAILED');
    }
  }
  const contentPlan = evidenceInput?.contentPlan;
  if (overallComment && contentPlan) {
    const defaultReview = buildXiaodaDefaultReviewV1(contentPlan);
    const increment = hasQualifiedAiReviewIncrementV1(
      { reason: overallComment, tip: '', source: VALID_SOURCES.has(raw.source) ? raw.source : 'ai' },
      contentPlan,
      defaultReview,
    );
    rejectReasons.push(...increment.rejectReasons.filter((reason) => reason !== 'invalid_suggestion'));
    if (isTooSimilar(overallComment, defaultReview.reason, 0.76)) {
      rejectReasons.push('TOO_SIMILAR_TO_DEFAULT');
    }
  }
  return {
    accepted: rejectReasons.length === 0,
    value: overallComment,
    rejectReasons: uniqueStrings(rejectReasons),
  };
}

function validateAdvice(value, overallComment, evidenceInput) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { accepted: true, value: null, rejectReasons: [] };
  }
  const rejectReasons = [];
  let advice = '';
  try {
    advice = normalizeVisibleCopy(value, 80, { optional: true });
  } catch {
    rejectReasons.push('ADVICE_COPY_INVALID');
  }
  if (advice && isTooSimilar(overallComment, advice, 0.7)) {
    rejectReasons.push('ADVICE_REPEATS_OVERALL');
  }
  if (advice) {
    try {
      assertKnownFactsOnly(advice, evidenceInput);
    } catch {
      rejectReasons.push('ADVICE_FACT_VALIDATION_FAILED');
    }
  }
  if (advice && evidenceInput?.contentPlan && !normalizeXiaodaSuggestionV1(advice, evidenceInput.contentPlan)) {
    rejectReasons.push('ADVICE_NOT_ACTIONABLE_OR_NOT_IN_WARDROBE');
  }
  return {
    accepted: rejectReasons.length === 0,
    value: rejectReasons.length === 0 ? advice : null,
    rejectReasons: uniqueStrings(rejectReasons),
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
    strengths: copy.overallComment
      ? [{ text: copy.overallComment, evidenceCodes: primaryCode ? [primaryCode] : [] }]
      : [],
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
    reviewSource: explanation.source,
    overallComment: explanation.overallComment || explanation.summary || '',
    advice: explanation.advice || null,
    partial: Boolean(explanation.partial),
    adviceRejectReasons: uniqueStrings(explanation.adviceRejectReasons),
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
    partial: Boolean(explanation.partial),
    adviceRejectReasons: uniqueStrings(explanation.adviceRejectReasons),
    explanationV2: explanation,
    overallComment: explanation.overallComment,
    advice: explanation.advice || null,
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
  return { overallComment: '', advice: '' };
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
  if (!inspectXiaodaPersonaCopy(text).passed) throw new Error('invalid_stylist_explanation');
  return text;
}

function assertKnownFactsOnly(text, evidenceInput) {
  const factPolicy = validateCopyAgainstFacts(text, evidenceToCopyFactsInput(evidenceInput));
  if (!factPolicy.ok) throw new Error('invalid_stylist_explanation');
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

  const factPolicyTrace = traceFactPolicy(combined, evidenceInput);
  for (const entry of factPolicyTrace.filter((item) => item.pass && item.code === 'COLOR_ALIAS_ALLOWED')) {
    add('color_alias_allowed', true, 'COLOR_ALIAS_ALLOWED', `matched:${entry.term}`);
  }

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
      'ai_commentary_incremental_value',
      !increment.rejectReasons.includes('no_ai_incremental_value'),
      increment.rejectReasons.includes('no_ai_incremental_value') ? 'AI_COMMENTARY_INCREMENTAL_VALUE' : '',
      increment.rejectReasons.includes('no_ai_incremental_value')
        ? 'AI commentary does not add a deeper garment contribution beyond Today and deterministic Detail'
        : 'AI commentary adds a deeper grounded styling reason',
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
  const factPolicy = validateCopyAgainstFacts(text, evidenceToCopyFactsInput(evidenceInput));
  const issues = factPolicy.trace
    .filter((entry) => entry.pass === false && entry.code === 'UNSUPPORTED_FACT')
    .map((entry) => `${classifyUnsupportedTerm(entry.term)}:${entry.term}`);
  const allowedMaterials = readOutfitMaterials(evidenceInput);
  if (allowedMaterials.length > 0) {
    for (const material of MATERIAL_WORDS) {
      if (text.includes(material) && !allowedMaterials.includes(material)) issues.push(`material:${material}`);
    }
  }
  return uniqueStrings(issues);
}

function classifyUnsupportedTerm(term) {
  if (['米白色', '米白', '米色', '白色', '米色系', '白色系', '军绿色', '军绿', '绿色', '绿色系', '低饱和色', '灰色', '灰色系', '黑色', '黑色系', '紫色'].includes(term)) {
    return 'color';
  }
  if (['牛仔', '皮质'].includes(term)) return 'material';
  return 'fact';
}

function traceFactPolicy(text, evidenceInput) {
  return validateCopyAgainstFacts(text, evidenceToCopyFactsInput(evidenceInput)).trace || [];
}

function mapIncrementRejectReason(reason) {
  const map = {
    missing_reason: 'MISSING_OVERALL_COMMENT',
    empty_phrase: 'EMPTY_OR_GENERIC_ADVICE',
    english_type_leak: 'FORBIDDEN_TERM',
    not_grounded: 'NO_INFORMATION_GAIN',
    semantic_drift: 'STYLE_INSIGHT_DRIFT',
    no_information_gain: 'NO_INFORMATION_GAIN',
    no_ai_incremental_value: 'AI_COMMENTARY_INCREMENTAL_VALUE',
    algorithm_to_chinese_leakage: 'ALGORITHM_TO_CHINESE_LEAKAGE',
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

function evidenceToCopyFactsInput(evidenceInput = {}) {
  const outfit = evidenceInput.outfit || {};
  const colors = readOutfitColorNames(evidenceInput);
  const contentPlanItems = Array.isArray(evidenceInput?.contentPlan?.items)
    ? evidenceInput.contentPlan.items
    : [];
  const contentPlanIndexesById = new Map(contentPlanItems
    .map((item, index) => [item?.id, index])
    .filter(([id]) => id));
  const usedContentPlanIndexes = new Set();
  const items = Array.isArray(outfit.items)
    ? outfit.items.map((entry, index) => {
        const clothingId = entry.itemId || entry.clothingId || entry.identity || `item-${index}`;
        const contentPlanItem = matchContentPlanItem({
          entry,
          index,
          clothingId,
          contentPlanItems,
          contentPlanIndexesById,
          usedContentPlanIndexes,
          evidenceItemCount: outfit.items.length,
        });
        const displayName = limitText(contentPlanItem?.displayName, 120);
        return {
          clothingId,
          category: entry.category || entry.slot || contentPlanItem?.slot || 'other',
          subcategory: entry.subcategory || entry.name || displayName || entry.category || '单品',
          color: readFirstColorName(entry)
            || readColorFromDisplayName(displayName)
            || colors[index]
            || colors[0]
            || '',
          material: entry.material || '',
          patternType: entry.patternType || '',
          fit: entry.fit || entry.silhouette || '',
          styleTags: uniqueStrings(entry.styleTags || outfit.styleTags),
        };
      })
    : colors.map((color, index) => ({
        clothingId: `color-${index}`,
        category: 'other',
        subcategory: '单品',
        color,
      }));
  return {
    outfit: {
      scene: evidenceInput.context?.scene,
      weatherSnapshot: evidenceInput.context,
      items,
    },
  };
}

function matchContentPlanItem({
  entry,
  index,
  clothingId,
  contentPlanItems,
  contentPlanIndexesById,
  usedContentPlanIndexes,
  evidenceItemCount,
}) {
  const directIndex = contentPlanIndexesById.get(clothingId);
  if (directIndex !== undefined && !usedContentPlanIndexes.has(directIndex)) {
    usedContentPlanIndexes.add(directIndex);
    return contentPlanItems[directIndex];
  }

  const evidenceSlot = normalizeSemanticSlot(entry.category || entry.slot);
  const semanticIndex = contentPlanItems.findIndex((item, itemIndex) => (
    !usedContentPlanIndexes.has(itemIndex)
      && normalizeSemanticSlot(item?.slot) === evidenceSlot
  ));
  if (semanticIndex >= 0) {
    usedContentPlanIndexes.add(semanticIndex);
    return contentPlanItems[semanticIndex];
  }

  if (evidenceItemCount === 1 && contentPlanItems.length === 1) {
    usedContentPlanIndexes.add(0);
    return contentPlanItems[0];
  }

  const positionalItem = contentPlanItems[index];
  if (positionalItem && !usedContentPlanIndexes.has(index) && evidenceSlot === 'other') {
    usedContentPlanIndexes.add(index);
    return positionalItem;
  }
  return undefined;
}

function normalizeSemanticSlot(value) {
  const text = limitText(value, 80).toLowerCase();
  if (/^(onepiece|dress)$|连衣裙|连体|jumpsuit/.test(text)) return 'onepiece';
  if (/^(outerwear|outer|coat|jacket)$|外套|大衣|风衣|夹克/.test(text)) return 'outerwear';
  if (/^(accessory|accessories)$|配饰|包|帽|腰带/.test(text)) return 'accessory';
  if (/^(shoes?|sneakers?)$|鞋/.test(text)) return 'shoes';
  if (/^(top|shirt|tee)$|上衣|衬衫|毛衣|卫衣|t恤/.test(text)) return 'top';
  if (/^(bottom|pants|trousers?|skirt)$|下装|裤|半身裙/.test(text)) return 'bottom';
  return text || 'other';
}

function readFirstColorName(entry = {}) {
  const direct = limitText(entry.color || entry.primaryColor, 80);
  if (direct) return direct;
  const palette = Array.isArray(entry.colors)
    ? entry.colors
    : Array.isArray(entry.colorPalette)
      ? entry.colorPalette
      : [];
  for (const color of palette) {
    const name = limitText(typeof color === 'string' ? color : color?.name, 80);
    if (name) return name;
  }
  return '';
}

function readColorFromDisplayName(value) {
  return limitText(value, 120).match(/军绿色|米白色|藏青色|卡其色|灰白色|黑色|白色|灰色|米色|棕色|蓝色|绿色|红色|黄色|紫色|粉色|橙色/u)?.[0] || '';
}

function stripUnsafePromptInput(evidenceInput) {
  const contentPlan = evidenceInput?.contentPlan || {};
  const primary = contentPlan?.xiaodaStyleInsight?.primary || {};
  const factItems = evidenceToCopyFactsInput(evidenceInput)?.outfit?.items || [];
  const supportingJudgments = (Array.isArray(contentPlan?.xiaodaStyleInsight?.secondary)
    ? contentPlan.xiaodaStyleInsight.secondary
    : [])
    .map((entry) => uniqueStrings([
      limitText(entry?.primaryObservation, 140),
      limitText(entry?.supportingRelation, 140),
      limitText(entry?.humanMeaning, 160),
      limitText(entry?.overallMeaning, 180),
    ]))
    .filter((entry) => entry.length > 0)
    .slice(0, 2);
  return {
    scene: limitText(evidenceInput?.context?.scene, 40),
    weather: {
      temperatureBand: limitText(evidenceInput?.context?.temperatureBand, 24),
      condition: limitText(evidenceInput?.context?.conditionBucket, 24),
    },
    garments: factItems.map((item) => ({
      category: limitText(item.category, 40),
      name: limitText(item.subcategory, 100),
      color: limitText(item.color, 40),
      material: limitText(item.material, 40),
      pattern: limitText(item.patternType, 60),
      fit: limitText(item.fit, 60),
      styles: uniqueStrings(item.styleTags).slice(0, 5),
    })),
    sceneUse: humanSceneUse(contentPlan.primaryBenefit),
    mainJudgment: uniqueStrings([
      limitText(primary.primaryObservation, 160),
      limitText(primary.supportingRelation, 160),
      limitText(primary.humanMeaning, 180),
      limitText(primary.overallMeaning, 200),
    ]),
    supportingJudgments,
    todayReason: limitText(contentPlan.defaultTodayReason, 180),
    deterministicDetail: limitText(contentPlan.defaultDetailExplanation, 220),
    allowedAestheticWords: uniqueStrings(primary.allowedAestheticInferences?.map((entry) => entry?.label)).slice(0, 6),
    limitations: uniqueStrings(evidenceInput?.limitations).slice(0, 4),
  };
}

function humanSceneUse(value) {
  const values = {
    indoor_relax: '在家日常活动',
    walkable: '日常走动',
    clean_daily: '普通日常穿着',
    commute_polish: '日常上班',
    temperature_buffer: '应对温差',
    soft_mood: '自然约会',
    clear_highlight: '约会时有一个明确重点',
    light_activity: '散步或快走',
    formal_training: '正式训练',
    hot_weather: '天气较热时穿着',
  };
  return values[limitText(value, 60)] || '';
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
  validateAdvice,
  validateOverallComment,
  validateStylistExplanationV2,
};
