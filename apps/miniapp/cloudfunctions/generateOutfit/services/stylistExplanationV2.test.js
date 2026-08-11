const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
} = require('./stylistExplanationV2');
const { buildXiaodaDefaultReviewV1 } = require('./xiaodaContentPlan');
const { MECHANICAL_VOICE_TERMS } = require('./xiaodaVoicePolicy');

const NOW = '2026-06-27T10:00:00.000Z';

function evidenceInput(overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceVersion: 'stylist-evidence-v1',
    context: { scene: 'home', temperatureBand: 'mild', conditionBucket: 'cloudy' },
    outfit: {
      itemCount: 2,
      categories: ['bottom', 'top'],
      colors: [{ name: '白色', role: 'primary' }, { name: '灰色', role: 'secondary' }],
      styleTags: ['休闲'],
      items: [
        { category: 'top', subcategory: '白色上衣', material: '棉' },
        { category: 'bottom', subcategory: '灰色下装' },
      ],
    },
    scores: { total: 8.2, weatherAdaptation: 8, styleUnity: 8, freshness: 7, preference: 8 },
    aesthetic: { engineVersion: 'aesthetic-compat-v1', score: 82, coverage: 0.75, dimensions: {} },
    evidence: [
      { code: 'COLOR_LIGHT_NEUTRAL_BALANCE', dimension: 'colorHarmony', polarity: 'positive', strength: 3, facts: { colors: ['白色', '灰色'] } },
      { code: 'STYLE_CASUAL_EASY', dimension: 'style', polarity: 'positive', strength: 2, facts: {} },
    ],
    limitations: [],
    inputDigest: 'a'.repeat(64),
    ...overrides,
  };
}

function meta(overrides = {}) {
  return {
    provider: 'aliyun-bailian',
    model: 'qwen-flash',
    generatedAt: NOW,
    ...overrides,
  };
}

test('parseStylistExplanationJson parses loose JSON and rejects invalid JSON', () => {
  assert.equal(parseStylistExplanationJson('```json\n{"ok":true}\n```').ok, true);
  assert.throws(() => parseStylistExplanationJson('{not-json'), /invalid_stylist_json/);
});

test('V3 constants and prompt describe human-only JSON output', () => {
  assert.equal(STYLIST_PROMPT_VERSION, 'stylist-prompt-v21');
  assert.equal(STYLIST_REVIEW_VERSION, 'stylist-explanation-v20');
  assert.equal(COPY_POLICY_VERSION, 'human-copy-v2');
  assert.equal(VOICE_POLICY_VERSION, 'xiaoda-voice-v6');
  const prompt = buildStylistPromptV2(evidenceInput());
  assert.match(prompt.system, /overallComment/);
  assert.match(prompt.system, /advice/);
  assert.doesNotMatch(prompt.system, /字段只能是 schemaVersion/);
  assert.doesNotMatch(prompt.system, /reviewVersion、promptVersion/);
  assert.match(prompt.system, /你是“小搭”/);
  assert.match(prompt.system, /本次主判断/);
  assert.match(prompt.system, /算法中文/);
  assert.match(prompt.system, /视线拉回两端/);
  assert.match(prompt.system, /短裤在中间留出颜色变化/);
  assert.match(prompt.system, /鞋子因为和上衣颜色一样所以不突兀/);
  assert.match(prompt.system, /不虚构舒适、透气、保暖、柔软/);
  assert.match(prompt.system, /不能让用户换掉、替换、另选或购买任何衣物/);
  assert.doesNotMatch(prompt.system, /primary\.subjectItemIds/);
  assert.equal(prompt.user.includes('cloud://'), false);
  assert.equal(prompt.user.includes('learnedProfile'), false);
  assert.equal(prompt.user.includes('contentPlan'), false);
});

test('retry prompt carries only safe validator codes and controlled rejected terms', () => {
  const prompt = buildStylistPromptV2(evidenceInput(), {
    retryReasons: ['STYLE_INSIGHT_DRIFT'],
    retryRejectedTerms: ['轻松自在', 'untrusted-free-text'],
  });
  assert.match(prompt.system, /纠错重试/);
  assert.match(prompt.system, /STYLE_INSIGHT_DRIFT/);
  assert.match(prompt.system, /同一个 primary/);
  assert.match(prompt.system, /轻松自在/);
  assert.doesNotMatch(prompt.system, /untrusted-free-text/);
});

test('algorithm-Chinese retry switches from picture analysis to body-centered language', () => {
  const prompt = buildStylistPromptV2(evidenceInput(), {
    retryReasons: ['algorithm_to_chinese_leakage'],
  });
  assert.match(prompt.system, /不描述颜色在画面里怎样移动、连接或分区/);
  assert.match(prompt.system, /只说具体衣物穿在人身上的判断/);
  assert.match(prompt.system, /鞋子不会显得突兀、下装让整身保留颜色变化/);
  assert.match(prompt.system, /也不要出现“中间”/);
});

test('unsupported-fact retry prevents attributes from leaking across items', () => {
  const prompt = buildStylistPromptV2(evidenceInput(), {
    retryReasons: ['UNSUPPORTED_FACT', 'OVERALL_FACT_VALIDATION_FAILED'],
  });

  assert.match(prompt.system, /必须逐件绑定/);
  assert.match(prompt.system, /不要写任何材质、厚度、版型或设计属性/);
  assert.match(prompt.system, /输入里的衣物名称/);
});

test('overall-copy retry tells the model to replace repeated full names with natural garment references', () => {
  const prompt = buildStylistPromptV2(evidenceInput(), {
    retryReasons: ['OVERALL_COPY_INVALID'],
  });

  assert.match(prompt.system, /每件衣物的完整名称和颜色.*最多说一次/);
  assert.match(prompt.system, /后一句改用“上衣、下装、鞋子、它”等代称/);
  assert.doesNotMatch(prompt.system, /头重脚轻/);
});

test('prompt carries safe item facts and the same Today Style Insight', () => {
  const contentPlan = {
    version: 'xiaoda-content-plan-v3',
    personaVersion: 'xiaoda-persona-v1',
    sceneIntent: 'date:casual',
    primaryBenefit: 'clear_highlight',
    items: [{ id: 'top-1', slot: 'top', role: 'core', displayName: '白色印花上衣' }],
    observations: ['top:白色印花上衣'],
    defaultTodayReason: '白色印花上衣已经够有内容了，灰色下装简单一点刚刚好。',
    xiaodaStyleInsight: {
      version: 'xiaoda-style-insight-v2',
      personaVersion: 'xiaoda-persona-v1',
      primary: {
        rank: 'PRIMARY',
        code: 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT',
        intent: 'pattern_balance',
        dimension: 'pattern',
        primaryObservation: '印花上衣负责重点',
        supportingRelation: '灰色下装保持简单',
        humanMeaning: '重点只留一处',
        overallMeaning: '有重点但不杂',
      },
      secondary: [],
      optional: [],
      forbiddenClaims: ['显瘦'],
    },
  };
  const prompt = buildStylistPromptV2(evidenceInput({ contentPlan }));
  const input = JSON.parse(prompt.user);
  assert.equal(input.todayReason, contentPlan.defaultTodayReason);
  assert.deepEqual(input.mainJudgment, [
    '印花上衣负责重点',
    '灰色下装保持简单',
    '重点只留一处',
    '有重点但不杂',
  ]);
  assert.equal(input.garments[0].name, '白色上衣');
  assert.equal('contentPlan' in input, false);
  assert.equal(prompt.user.includes('PATTERN_FOCUS_WITH_SIMPLE_SUPPORT'), false);
  assert.equal(prompt.user.includes('top-1'), false);
});

test('validateStylistExplanationV2 accepts old AI version fields when content is valid', () => {
  const result = validateStylistExplanationV2({
    schemaVersion: 1,
    reviewVersion: '1.0',
    overallComment: '白色上衣和灰色下装都偏日常，放在一起不用多想，今天在家或附近走走都合适。',
    advice: '',
  }, evidenceInput(), meta());

  assert.equal(result.schemaVersion, 3);
  assert.equal(result.reviewVersion, STYLIST_REVIEW_VERSION);
  assert.equal(result.promptVersion, STYLIST_PROMPT_VERSION);
  assert.equal(result.copyPolicyVersion, COPY_POLICY_VERSION);
  assert.equal(result.voicePolicyVersion, VOICE_POLICY_VERSION);
  assert.equal(result.overallComment, '白色上衣和灰色下装都偏日常，放在一起不用多想，今天在家或附近走走都合适。');
});

test('validateStylistExplanationV2 accepts V3 overallComment advice and overwrites metadata', () => {
  const result = validateStylistExplanationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。',
    advice: '想再有精神一点，可以让鞋子呼应白色或灰色。',
    provider: 'model-provider',
  }, evidenceInput(), meta());
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.reviewVersion, STYLIST_REVIEW_VERSION);
  assert.equal(result.promptVersion, STYLIST_PROMPT_VERSION);
  assert.equal(result.copyPolicyVersion, COPY_POLICY_VERSION);
  assert.equal(result.provider, 'aliyun-bailian');
  assert.equal(result.model, 'qwen-flash');
  assert.equal(result.generatedAt, NOW);
  assert.equal(result.inputDigest, 'a'.repeat(64));
  assert.equal(result.voicePolicyVersion, VOICE_POLICY_VERSION);
  assert.equal(result.overallComment, '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。');
  assert.equal(result.advice, '想再有精神一点，可以让鞋子呼应白色或灰色。');
  assert.deepEqual(result.styleTags, []);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('validateStylistExplanationV2 rejects unsafe copy hallucinated facts repeated advice and bad JSON shape', () => {
  assert.throws(() => validateStylistExplanationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: '当前审美证据较少，只能基于识别线索点评。',
    advice: '沿着这条线索微调。',
  }, evidenceInput(), meta()), /invalid_stylist_explanation/);

  assert.throws(() => validateStylistExplanationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: '整体偏轻松，紫色和金色让它更醒目。',
    advice: '可以继续使用紫色配饰。',
  }, evidenceInput(), meta()), /invalid_stylist_explanation/);

  const partial = validateStylistExplanationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。',
    advice: '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。',
  }, evidenceInput(), meta());
  assert.equal(partial.partial, true);
  assert.equal(partial.advice, null);
  assert.deepEqual(partial.adviceRejectReasons, ['ADVICE_REPEATS_OVERALL']);

  assert.throws(() => validateStylistExplanationV2({ schemaVersion: 3 }, evidenceInput(), meta()), /invalid_stylist_explanation/);
});

test('overall and advice validate independently, including mechanical stable phrases', () => {
  const ordinaryStable = validateOverallComment(
    '白色上衣和灰色下装放在一起很稳定，日常穿也显得清爽。',
    evidenceInput(),
  );
  assert.equal(ordinaryStable.accepted, true);

  const mechanicalOverall = validateOverallComment(
    '白色上衣和灰色下装稳定视觉重心，日常穿也显得清爽。',
    evidenceInput(),
  );
  assert.equal(mechanicalOverall.accepted, false);
  assert.ok(mechanicalOverall.rejectReasons.includes('OVERALL_COPY_INVALID'));

  const mechanicalAdvice = validateAdvice(
    '可以用白色上衣稳定视觉重心。',
    '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。',
    evidenceInput(),
  );
  assert.equal(mechanicalAdvice.accepted, false);
  assert.ok(mechanicalAdvice.rejectReasons.includes('ADVICE_COPY_INVALID'));
});

test('legacy V2-shaped payload is still accepted but normalized without title or tags', () => {
  const result = validateStylistExplanationV2({
    schemaVersion: 2,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    title: '模型标题',
    summary: '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。',
    strengths: [{ text: '白色和灰色放在一起很清爽。', evidenceCodes: ['COLOR_LIGHT_NEUTRAL_BALANCE'] }],
    tradeoffs: [],
    tip: { text: '想再有精神一点，可以让鞋子呼应白色或灰色。', evidenceCodes: ['COLOR_LIGHT_NEUTRAL_BALANCE'] },
    styleTags: ['休闲'],
    confidence: 'high',
  }, evidenceInput(), meta());
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.title, '');
  assert.deepEqual(result.styleTags, []);
  assert.equal(result.tip.text, '想再有精神一点，可以让鞋子呼应白色或灰色。');
});

test('buildRuleFallbackExplanationV2 fails closed without canonical Contract content', () => {
  const result = buildRuleFallbackExplanationV2(evidenceInput({
    evidence: [],
    aesthetic: { score: null, coverage: 0, dimensions: {} },
    limitations: ['INSUFFICIENT_AESTHETIC_EVIDENCE'],
  }), meta());
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.source, 'rule_fallback');
  assert.equal(result.confidence, 'low');
  assert.equal(result.copyPolicyVersion, COPY_POLICY_VERSION);
  assert.equal(result.voicePolicyVersion, VOICE_POLICY_VERSION);
  assert.equal(result.overallComment, '');
  assert.equal(result.advice, '');
  assert.deepEqual(result.strengths, []);
  assert.deepEqual(result.styleTags, []);
  assert.doesNotMatch(`${result.overallComment}${result.advice}${result.summary}${result.strengths.map((point) => point.text).join('')}`, /识别|证据|线索|观察点|覆盖率|信息不足/);
});

test('toLegacyAiComment maps V3 to compatible aiComment without title or tags', () => {
  const explanation = buildRuleFallbackExplanationV2(evidenceInput(), meta());
  const legacy = toLegacyAiComment(explanation);
  assert.equal(legacy.title, '');
  assert.deepEqual(legacy.styleTags, []);
  assert.equal(legacy.tip, explanation.advice);
  assert.equal(legacy.reviewVersion, STYLIST_REVIEW_VERSION);
  assert.equal(legacy.promptVersion, STYLIST_PROMPT_VERSION);
  assert.equal(legacy.copyPolicyVersion, COPY_POLICY_VERSION);
  assert.equal(legacy.voicePolicyVersion, VOICE_POLICY_VERSION);
  assert.equal(legacy.explanationV2.schemaVersion, 3);
});

test('resolveStylistReviewReuse covers V3 reuse upgrade cooldown and stale write protection', () => {
  const context = { inputDigest: 'new', reviewVersion: STYLIST_REVIEW_VERSION, promptVersion: STYLIST_PROMPT_VERSION, copyPolicyVersion: COPY_POLICY_VERSION, voicePolicyVersion: VOICE_POLICY_VERSION };
  const ready = {
    status: 'ready',
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    inputDigest: 'new',
    generatedAt: new Date(10_000).toISOString(),
  };
  assert.equal(resolveStylistReviewReuse({ review: ready, context }).action, 'reuse');
  assert.equal(resolveStylistReviewReuse({ review: { ...ready, inputDigest: 'old' }, context }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review: { ...ready, reviewVersion: 'stylist-explanation-v2', promptVersion: 'stylist-prompt-v2' }, context }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review: { ...ready, copyPolicyVersion: 'old-policy' }, context }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review: { ...ready, voicePolicyVersion: undefined }, context }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review: ready, context, forceRegenerate: true, nowMs: 14_000 }).action, 'cooldown');
  assert.equal(resolveStylistReviewReuse({ review: ready, context, forceRegenerate: true, nowMs: 15_100 }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review: { status: 'generating', promptVersion: STYLIST_PROMPT_VERSION, inputDigest: 'new' }, context }).action, 'in_progress');

  const current = {
    status: 'generating',
    generationToken: 'new-token',
    inputDigest: 'new',
    previousReview: { aiComment: { title: '', reason: '旧', styleTags: [], tip: '旧' } },
  };
  assert.equal(resolveStylistReviewReuse({ review: current, context, generationToken: 'old-token', mode: 'finish' }).action, 'superseded');
  assert.equal(resolveStylistReviewReuse({ review: current, context, generationToken: 'new-token', mode: 'failure' }).action, 'restore_previous');
});

test('buildStylistReviewDocument persists V3 payload without full outfit or image data', () => {
  const explanation = buildRuleFallbackExplanationV2(evidenceInput(), meta());
  const document = buildStylistReviewDocument({
    context: {
      openid: 'user-a',
      outfitKey: 'a_b',
      scene: 'home',
      inputDigest: evidenceInput().inputDigest,
      evidenceVersion: 'stylist-evidence-v1',
      promptVersion: STYLIST_PROMPT_VERSION,
      copyPolicyVersion: COPY_POLICY_VERSION,
      voicePolicyVersion: VOICE_POLICY_VERSION,
      model: 'qwen-flash',
      provider: 'aliyun-bailian',
    },
    explanation,
    now: NOW,
  });
  const json = JSON.stringify(document);
  assert.equal(document.schemaVersion, 3);
  assert.equal(document.reviewVersion, STYLIST_REVIEW_VERSION);
  assert.equal(document.copyPolicyVersion, COPY_POLICY_VERSION);
  assert.equal(document.voicePolicyVersion, VOICE_POLICY_VERSION);
  assert.equal(document.aiComment.voicePolicyVersion, VOICE_POLICY_VERSION);
  assert.equal(document.aiComment.title, '');
  assert.deepEqual(document.aiComment.styleTags, []);
  assert.equal(json.includes('cloud://'), false);
  assert.equal(json.includes('"outfit"'), false);
});

test('validator trace reports missing overall comment with a concrete code', () => {
  const trace = traceStylistExplanationValidationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    advice: 'safe optional advice',
  }, evidenceInput());

  assert.equal(trace.some((entry) => entry.check === 'schema_fields' && entry.pass === false), true);
  assert.equal(trace.some((entry) => entry.code === 'MISSING_OVERALL_COMMENT'), true);
  assert.equal(trace.some((entry) => entry.code === 'SCHEMA_PARSE_FAILED'), false);
  assert.equal(trace.some((entry) => entry.code === 'SCHEMA_FIELDS_INVALID'), true);
});

test('valid JSON with invalid fields reports SCHEMA_FIELDS_INVALID instead of parse failure', () => {
  const parsed = parseStylistExplanationJson(JSON.stringify({
    schemaVersion: 1,
    reviewVersion: '1.0',
    advice: '想再有精神一点，可以让鞋子呼应白色或灰色。',
  }));
  const trace = traceStylistExplanationValidationV2(parsed, evidenceInput());

  assert.equal(trace.some((entry) => entry.code === 'SCHEMA_PARSE_FAILED'), false);
  assert.equal(trace.some((entry) => entry.code === 'SCHEMA_FIELDS_INVALID'), true);
  assert.equal(trace.some((entry) => entry.code === 'MISSING_OVERALL_COMMENT'), true);
});

test('invalid JSON parse failure is reserved for real JSON parse errors', () => {
  assert.throws(() => parseStylistExplanationJson('今天这套不用多想，不是 JSON'), /invalid_stylist_json/);
});

test('unsupported fact trace includes the matched field and word', () => {
  const trace = traceStylistExplanationValidationV2({
    schemaVersion: 1,
    reviewVersion: '1.0',
    overallComment: '白色上衣和紫色下装放在一起很日常，今天在家或附近走走都合适。',
    advice: '',
  }, evidenceInput());
  const unsupportedFact = trace.find((entry) => entry.code === 'UNSUPPORTED_FACT');

  assert.ok(unsupportedFact);
  assert.match(unsupportedFact.detail, /color:紫色/);
});

test('validator trace allows color aliases from the outfit fact policy', () => {
  const trace = traceStylistExplanationValidationV2({
    schemaVersion: 1,
    reviewVersion: '1.0',
    overallComment: '米色系上衣和绿色系下装有对比，白色系鞋子接住上衣颜色。',
    advice: '',
  }, evidenceInput({
    outfit: {
      itemCount: 3,
      categories: ['bottom', 'shoes', 'top'],
      colors: [{ name: '米白色' }, { name: '军绿色' }, { name: '白色' }],
      styleTags: [],
      items: [
        { category: 'top', subcategory: 'T恤', color: '米白色' },
        { category: 'bottom', subcategory: '阔腿裤', color: '军绿色' },
        { category: 'shoes', subcategory: '运动鞋', color: '白色' },
      ],
    },
  }));

  assert.equal(trace.some((entry) => entry.code === 'UNSUPPORTED_FACT'), false);
  assert.equal(trace.some((entry) => entry.code === 'COLOR_ALIAS_ALLOWED'), true);
});

test('validator accepts a color carried by the authoritative content-plan display name', () => {
  const input = evidenceInput({
    outfit: {
      itemCount: 1,
      categories: ['top'],
      colors: [],
      styleTags: [],
      items: [{ itemId: 'top-1', category: 'top', subcategory: '毛衣' }],
    },
    contentPlan: {
      version: 'xiaoda-content-plan-v3',
      sceneIntent: 'work:polished',
      primaryBenefit: 'commute_polish',
      items: [{ id: 'top-1', slot: 'top', role: 'core', displayName: '灰色毛衣' }],
      defaultDetailExplanation: '灰色毛衣让日常办公更利落。',
      xiaodaStyleInsight: {
        version: 'xiaoda-style-insight-v2',
        primary: { code: 'WORK_DAILY_READY', subjectItemIds: ['top-1'] },
        secondary: [],
        optional: [],
      },
    },
  });
  const trace = traceStylistExplanationValidationV2({
    overallComment: '灰色毛衣把日常办公需要的利落感交代清楚，整身正式程度刚好，不会显得太严肃。',
    advice: '',
  }, input);
  assert.equal(trace.some((entry) => entry.code === 'UNSUPPORTED_FACT' && entry.pass === false), false);
});

test('validator aligns hashed evidence items to content-plan slots instead of array order', () => {
  const input = evidenceInput({
    outfit: {
      itemCount: 3,
      categories: ['bottom', 'shoes', 'top'],
      colors: [],
      styleTags: [],
      items: [
        { identity: 'hash-bottom', category: 'bottom', subcategory: '阔腿裤', colors: [] },
        { identity: 'hash-shoes', category: 'shoes', subcategory: '运动鞋', colors: [] },
        { identity: 'hash-top', category: 'top', subcategory: '毛衣', colors: [] },
      ],
    },
    contentPlan: {
      version: 'xiaoda-content-plan-v3',
      sceneIntent: 'work:polished',
      primaryBenefit: 'commute_polish',
      items: [
        { id: 'raw-top', slot: 'top', role: 'core', displayName: '灰色毛衣' },
        { id: 'raw-bottom', slot: 'bottom', role: 'core', displayName: '军绿色阔腿裤' },
        { id: 'raw-shoes', slot: 'shoes', role: 'support', displayName: '白色运动鞋' },
      ],
      defaultDetailExplanation: '灰色毛衣搭军绿色阔腿裤，白色运动鞋收住整体。',
      xiaodaStyleInsight: {
        version: 'xiaoda-style-insight-v2',
        primary: { code: 'WORK_DAILY_READY', subjectItemIds: ['raw-top', 'raw-bottom', 'raw-shoes'] },
        secondary: [],
        optional: [],
      },
    },
  });
  const trace = traceStylistExplanationValidationV2({
    overallComment: '灰色毛衣搭军绿色阔腿裤很适合日常办公，白色运动鞋让整身利落但不显得太严肃。',
    advice: '',
  }, input);

  assert.equal(trace.some((entry) => entry.code === 'UNSUPPORTED_FACT' && entry.pass === false), false);
});

test('empty advice is traced as optional instead of required failure', () => {
  const trace = traceStylistExplanationValidationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: 'safe overall comment with enough detail for the validator trace',
    advice: '',
  }, evidenceInput());
  const adviceTrace = trace.find((entry) => entry.check === 'advice_optional');

  assert.equal(adviceTrace?.pass, true);
  assert.equal(adviceTrace?.code, 'ADVICE_OPTIONAL_EMPTY');
  assert.equal(trace.some((entry) => entry.check === 'schema_fields' && entry.pass === false && entry.detail.includes('advice')), false);
});

test('mechanical copy and no information gain receive concrete validator codes', () => {
  const mechanicalTrace = traceStylistExplanationValidationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: `safe text with ${MECHANICAL_VOICE_TERMS[0]} mechanical wording`,
    advice: '',
  }, evidenceInput());
  assert.equal(mechanicalTrace.some((entry) => entry.code === 'MECHANICAL_COPY'), true);

  const contentPlan = {
    version: 'xiaoda-content-plan-v1',
    sceneIntent: 'home:clean_daily',
    items: [{ id: 'top-1', slot: 'top', role: 'core', displayName: 'top item' }],
    observations: ['core:top item'],
    primaryBenefit: 'clean_daily',
    suggestion: null,
  };
  const defaultReview = buildXiaodaDefaultReviewV1(contentPlan);
  const noGainTrace = traceStylistExplanationValidationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: defaultReview.reason,
    advice: '',
  }, evidenceInput({ contentPlan }));
  assert.equal(noGainTrace.some((entry) => entry.code === 'NO_INFORMATION_GAIN'), true);
});

test('real editorial rejection phrases are rejected before an AI review is saved', () => {
  const trace = traceStylistExplanationValidationV2({
    overallComment: '白色上衣形成呼应，灰色下装作为底色，再用小包做点睛之笔，让整体不过于平淡。',
    advice: '',
  }, evidenceInput());

  assert.equal(trace.some((entry) => entry.code === 'MECHANICAL_COPY' && entry.pass === false), true);
});

test('validator rejects a Detail comment that drifts away from the primary Style Insight', () => {
  const contentPlan = {
    version: 'xiaoda-content-plan-v3',
    sceneIntent: 'date:casual',
    items: [
      { id: 'top-1', slot: 'top', role: 'core', displayName: '白色上衣' },
      { id: 'bottom-1', slot: 'bottom', role: 'core', displayName: '灰色下装' },
    ],
    observations: ['top:白色上衣', 'bottom:灰色下装'],
    primaryBenefit: 'clear_highlight',
    defaultDetailExplanation: '印花上衣负责重点，灰色下装简单一点。',
    xiaodaStyleInsight: {
      version: 'xiaoda-style-insight-v2',
      primary: { code: 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT' },
      secondary: [],
      optional: [],
    },
  };
  const trace = traceStylistExplanationValidationV2({
    overallComment: '白色上衣和灰色下装颜色很清爽，日常穿不会显得太用力。',
    advice: '',
  }, evidenceInput({ contentPlan }));
  assert.equal(trace.some((entry) => entry.code === 'STYLE_INSIGHT_DRIFT' && entry.pass === false), true);
});

test('validator rejects assigning a color focal role to a supporting garment', () => {
  const contentPlan = {
    version: 'xiaoda-content-plan-v3',
    sceneIntent: 'home:clean_daily',
    items: [
      { id: 'top-1', slot: 'top', role: 'core', displayName: '白色短袖T恤' },
      { id: 'bottom-1', slot: 'bottom', role: 'core', displayName: '绿色阔腿裤' },
      { id: 'shoes-1', slot: 'shoes', role: 'core', displayName: '白色运动鞋' },
    ],
    observations: ['top:白色短袖T恤', 'bottom:绿色阔腿裤', 'shoes:白色运动鞋'],
    primaryBenefit: 'clean_daily',
    defaultDetailExplanation: '绿色阔腿裤是颜色重点，白色单品保持简单。',
    xiaodaStyleInsight: {
      version: 'xiaoda-style-insight-v2',
      primary: {
        code: 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT',
        subjectItemIds: ['bottom-1', 'top-1'],
      },
      secondary: [],
      optional: [],
    },
  };
  const trace = traceStylistExplanationValidationV2({
    overallComment: '白色T恤作为视觉焦点，绿色阔腿裤让下身更突出，白色运动鞋保持简单，整身颜色很清爽。',
    advice: '',
  }, evidenceInput({ contentPlan }));
  assert.equal(trace.some((entry) => entry.code === 'STYLE_INSIGHT_DRIFT' && entry.pass === false), true);
});
