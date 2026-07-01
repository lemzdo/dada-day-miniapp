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
  validateStylistExplanationV2,
} = require('./stylistExplanationV2');

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
  assert.equal(STYLIST_PROMPT_VERSION, 'stylist-prompt-v4');
  assert.equal(STYLIST_REVIEW_VERSION, 'stylist-explanation-v4');
  assert.equal(COPY_POLICY_VERSION, 'human-copy-v1');
  assert.equal(VOICE_POLICY_VERSION, 'xiaoda-voice-v1');
  const prompt = buildStylistPromptV2(evidenceInput());
  assert.match(prompt.system, /overallComment/);
  assert.match(prompt.system, /advice/);
  assert.match(prompt.system, /懂穿搭的贴心朋友/);
  assert.match(prompt.system, /不得使用机械设计词/);
  assert.match(prompt.system, /不虚构舒适、材质、透气、保暖/);
  assert.equal(prompt.user.includes('cloud://'), false);
  assert.equal(prompt.user.includes('learnedProfile'), false);
  assert.equal(prompt.user.includes('evidence'), false);
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

  assert.throws(() => validateStylistExplanationV2({
    schemaVersion: 3,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    overallComment: '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。',
    advice: '白色上衣和灰色下装放在一起很清爽，日常穿不会显得太用力。',
  }, evidenceInput(), meta()), /invalid_stylist_explanation/);

  assert.throws(() => validateStylistExplanationV2({ schemaVersion: 3 }, evidenceInput(), meta()), /invalid_stylist_explanation/);
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

test('buildRuleFallbackExplanationV2 returns human V3 fallback even with low data', () => {
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
  assert.ok(result.overallComment);
  assert.ok(result.advice);
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
