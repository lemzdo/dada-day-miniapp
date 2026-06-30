const assert = require('node:assert/strict');
const test = require('node:test');

const {
  STYLIST_PROMPT_VERSION,
  STYLIST_REVIEW_VERSION,
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
    context: { scene: 'work', temperatureBand: 'mild', conditionBucket: 'cloudy' },
    outfit: {
      itemCount: 2,
      categories: ['bottom', 'top'],
      colors: [{ name: 'black', role: 'primary' }],
      styleTags: ['clean', 'commute'],
    },
    scores: { total: 8.2, weatherAdaptation: 8, styleUnity: 8, freshness: 7, preference: 8 },
    aesthetic: { engineVersion: 'aesthetic-compat-v1', score: 82, coverage: 0.75, dimensions: {} },
    evidence: [
      { code: 'COLOR_MONOCHROMATIC', dimension: 'colorHarmony', polarity: 'positive', strength: 3, facts: { colors: ['black'] } },
      { code: 'SILHOUETTE_BALANCED_CONTRAST', dimension: 'silhouetteBalance', polarity: 'positive', strength: 3, facts: { categories: ['top', 'bottom'] } },
      { code: 'FORMALITY_ALIGNED', dimension: 'formalityConsistency', polarity: 'positive', strength: 2, facts: { gap: 1 } },
    ],
    limitations: [],
    inputDigest: 'a'.repeat(64),
    ...overrides,
  };
}

function rawExplanation(overrides = {}) {
  return {
    schemaVersion: 2,
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    title: '通勤清爽感',
    summary: '这套以稳定配色和清晰轮廓为主，适合通勤场景里保持利落感。',
    strengths: [
      { text: '黑色系让整体更统一，视觉重点不会太分散。', evidenceCodes: ['COLOR_MONOCHROMATIC'] },
      { text: '上下装轮廓有对比，整体线条更有层次。', evidenceCodes: ['SILHOUETTE_BALANCED_CONTRAST'] },
    ],
    tradeoffs: [{ text: '如果场合更正式，可以优先保留简洁配饰。', evidenceCodes: ['FORMALITY_ALIGNED'] }],
    tip: { text: '小搭建议保持鞋包颜色简单，让主线更清楚。', evidenceCodes: ['COLOR_MONOCHROMATIC'] },
    styleTags: ['通勤', '清爽', '通勤'],
    confidence: 'high',
    evidenceCodes: ['COLOR_MONOCHROMATIC', 'SILHOUETTE_BALANCED_CONTRAST', 'UNKNOWN_CODE'],
    limitations: [],
    source: 'ai',
    provider: 'fake-provider',
    model: 'fake-model',
    generatedAt: '1999-01-01T00:00:00.000Z',
    inputDigest: 'model-digest',
    extra: { raw: true },
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

test('validateStylistExplanationV2 accepts complete valid output and overwrites model controlled metadata', () => {
  const result = validateStylistExplanationV2(rawExplanation(), evidenceInput(), meta());
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.reviewVersion, STYLIST_REVIEW_VERSION);
  assert.equal(result.provider, 'aliyun-bailian');
  assert.equal(result.model, 'qwen-flash');
  assert.equal(result.generatedAt, NOW);
  assert.equal(result.inputDigest, 'a'.repeat(64));
  assert.equal(result.source, 'ai');
  assert.deepEqual(result.styleTags, ['通勤', '清爽']);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'extra'), false);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('validateStylistExplanationV2 rejects missing required fields', () => {
  assert.throws(
    () => validateStylistExplanationV2(rawExplanation({ title: '' }), evidenceInput(), meta()),
    /invalid_stylist_explanation/,
  );
});

test('validateStylistExplanationV2 trims long text and array sizes', () => {
  const result = validateStylistExplanationV2(rawExplanation({
    title: '一二三四五六七八九十一二三四五六七八九十',
    summary: '很'.repeat(150),
    strengths: [
      { text: '强'.repeat(100), evidenceCodes: ['COLOR_MONOCHROMATIC'] },
      { text: '强2', evidenceCodes: ['SILHOUETTE_BALANCED_CONTRAST'] },
      { text: '强3', evidenceCodes: ['FORMALITY_ALIGNED'] },
      { text: '强4', evidenceCodes: ['FORMALITY_ALIGNED'] },
    ],
    tradeoffs: [
      { text: '权衡1', evidenceCodes: ['COLOR_MONOCHROMATIC'] },
      { text: '权衡2', evidenceCodes: ['FORMALITY_ALIGNED'] },
      { text: '权衡3', evidenceCodes: ['FORMALITY_ALIGNED'] },
    ],
    styleTags: ['a', 'b', 'c', 'd', 'e', 'f'],
  }), evidenceInput(), meta());
  assert.equal(Array.from(result.title).length, 16);
  assert.equal(Array.from(result.summary).length, 120);
  assert.equal(Array.from(result.strengths[0].text).length, 80);
  assert.equal(result.strengths.length, 3);
  assert.equal(result.tradeoffs.length, 2);
  assert.equal(result.styleTags.length, 5);
});

test('validateStylistExplanationV2 removes unknown evidence codes and unsupported points', () => {
  const result = validateStylistExplanationV2(rawExplanation({
    strengths: [
      { text: '有效', evidenceCodes: ['COLOR_MONOCHROMATIC', 'MISSING'] },
      { text: '无效', evidenceCodes: ['MISSING'] },
    ],
    tradeoffs: [{ text: '也无效', evidenceCodes: ['NOPE'] }],
    tip: { text: '有效建议', evidenceCodes: ['FORMALITY_ALIGNED', 'NOPE'] },
  }), evidenceInput(), meta());
  assert.deepEqual(result.strengths, [{ text: '有效', evidenceCodes: ['COLOR_MONOCHROMATIC'] }]);
  assert.deepEqual(result.tradeoffs, []);
  assert.deepEqual(result.tip, { text: '有效建议', evidenceCodes: ['FORMALITY_ALIGNED'] });
  assert.deepEqual(result.evidenceCodes, ['COLOR_MONOCHROMATIC', 'FORMALITY_ALIGNED']);
});

test('validateStylistExplanationV2 prevents high confidence on low coverage and preserves known limitations', () => {
  const input = evidenceInput({
    aesthetic: { engineVersion: 'aesthetic-compat-v1', score: null, coverage: 0.1, dimensions: {} },
    limitations: ['INSUFFICIENT_AESTHETIC_EVIDENCE'],
  });
  const result = validateStylistExplanationV2(rawExplanation({ confidence: 'high', limitations: ['INSUFFICIENT_AESTHETIC_EVIDENCE'] }), input, meta());
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.limitations, ['INSUFFICIENT_AESTHETIC_EVIDENCE']);
});

test('validateStylistExplanationV2 rejects unknown limitations', () => {
  assert.throws(
    () => validateStylistExplanationV2(rawExplanation({ limitations: ['UNKNOWN_LIMIT'] }), evidenceInput(), meta()),
    /invalid_stylist_explanation/,
  );
});

test('validateStylistExplanationV2 does not mutate model output', () => {
  const raw = rawExplanation();
  const before = JSON.stringify(raw);
  validateStylistExplanationV2(raw, evidenceInput(), meta());
  assert.equal(JSON.stringify(raw), before);
});

test('buildRuleFallbackExplanationV2 handles no aesthetic evidence with valid schema', () => {
  const result = buildRuleFallbackExplanationV2(evidenceInput({ evidence: [], aesthetic: { score: null, coverage: 0, dimensions: {} } }), meta());
  assert.equal(result.source, 'rule_fallback');
  assert.equal(result.confidence, 'low');
  assert.deepEqual(result.evidenceCodes, []);
  assert.equal(result.strengths.length >= 1, true);
});

test('buildRuleFallbackExplanationV2 handles only color and only silhouette evidence', () => {
  const colorOnly = buildRuleFallbackExplanationV2(evidenceInput({ evidence: [evidenceInput().evidence[0]] }), meta());
  const silhouetteOnly = buildRuleFallbackExplanationV2(evidenceInput({ evidence: [evidenceInput().evidence[1]] }), meta());
  assert.deepEqual(colorOnly.evidenceCodes, ['COLOR_MONOCHROMATIC']);
  assert.deepEqual(silhouetteOnly.evidenceCodes, ['SILHOUETTE_BALANCED_CONTRAST']);
});

test('buildRuleFallbackExplanationV2 handles positive negative low coverage and deterministic output', () => {
  const input = evidenceInput({
    aesthetic: { engineVersion: 'aesthetic-compat-v1', score: null, coverage: 0.1, dimensions: {} },
    limitations: ['INSUFFICIENT_AESTHETIC_EVIDENCE'],
    evidence: [{ code: 'DETAIL_COMPETING_FOCUS', dimension: 'detailBalance', polarity: 'negative', strength: 1, facts: {} }],
  });
  const first = buildRuleFallbackExplanationV2(input, meta());
  const second = buildRuleFallbackExplanationV2(input, meta());
  assert.equal(first.confidence, 'low');
  assert.equal(first.tradeoffs.length, 1);
  assert.deepEqual(first, second);
});

test('buildRuleFallbackExplanationV2 references only valid evidence and avoids sensitive body language', () => {
  const result = buildRuleFallbackExplanationV2(evidenceInput(), meta());
  const validCodes = new Set(evidenceInput().evidence.map((entry) => entry.code));
  for (const code of result.evidenceCodes) assert.equal(validCodes.has(code), true);
  const text = JSON.stringify(result);
  assert.equal(/显瘦|遮肉|腿|年龄|职业|身份|身材/.test(text), false);
});

test('toLegacyAiComment maps V2 to title reason styleTags and tip', () => {
  const explanation = validateStylistExplanationV2(rawExplanation(), evidenceInput(), meta());
  const legacy = toLegacyAiComment(explanation);
  assert.equal(legacy.title, explanation.title);
  assert.equal(legacy.styleTags.length, 2);
  assert.equal(legacy.tip, explanation.tip.text);
  assert.match(legacy.reason, /这套以稳定配色/);
});

test('buildStylistPromptV2 contains grounding and safety rules', () => {
  const prompt = buildStylistPromptV2(evidenceInput());
  assert.match(prompt.system, /穿搭解释者/);
  assert.match(prompt.system, /不是衣服选择器/);
  assert.match(prompt.system, /evidence code/);
  assert.match(prompt.system, /不得推断身材/);
  assert.equal(prompt.user.includes('cloud://'), false);
  assert.equal(prompt.user.includes('learnedProfile'), false);
});

test('resolveStylistReviewReuse covers digest reuse digest change force refresh and V1 upgrade', () => {
  const context = { inputDigest: 'new', reviewVersion: STYLIST_REVIEW_VERSION, promptVersion: STYLIST_PROMPT_VERSION };
  assert.equal(resolveStylistReviewReuse({ review: { status: 'ready', reviewVersion: STYLIST_REVIEW_VERSION, inputDigest: 'new' }, context }).action, 'reuse');
  assert.equal(resolveStylistReviewReuse({ review: { status: 'ready', reviewVersion: STYLIST_REVIEW_VERSION, inputDigest: 'old' }, context }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review: { status: 'ready', reviewVersion: STYLIST_REVIEW_VERSION, inputDigest: 'new' }, context, forceRegenerate: true, nowMs: 1_000, cooldownMs: 0 }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review: { status: 'ready', promptVersion: 'v1', inputHash: 'new' }, context }).action, 'generate');
});

test('resolveStylistReviewReuse uses a 5 second default cooldown only for force regenerate', () => {
  const context = { inputDigest: 'new', reviewVersion: STYLIST_REVIEW_VERSION, promptVersion: STYLIST_PROMPT_VERSION };
  const review = {
    status: 'ready',
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    inputDigest: 'new',
    generatedAt: new Date(10_000).toISOString(),
  };
  const fourSecondsLater = resolveStylistReviewReuse({ review, context, forceRegenerate: true, nowMs: 14_000 });
  assert.equal(fourSecondsLater.action, 'cooldown');
  assert.equal(fourSecondsLater.retryAfterMs, 1000);
  assert.equal(resolveStylistReviewReuse({ review, context, forceRegenerate: true, nowMs: 15_100 }).action, 'generate');
  assert.equal(resolveStylistReviewReuse({ review, context, forceRegenerate: false, nowMs: 14_000 }).action, 'reuse');
});

test('resolveStylistReviewReuse keeps lease blocking ahead of forced cooldown after generating starts', () => {
  const context = { inputDigest: 'new', reviewVersion: STYLIST_REVIEW_VERSION, promptVersion: STYLIST_PROMPT_VERSION };
  const review = {
    status: 'generating',
    reviewVersion: STYLIST_REVIEW_VERSION,
    promptVersion: STYLIST_PROMPT_VERSION,
    inputDigest: 'new',
    generatedAt: new Date(10_000).toISOString(),
  };
  assert.equal(resolveStylistReviewReuse({ review, context, forceRegenerate: true, nowMs: 11_000 }).action, 'in_progress');
});

test('resolveStylistReviewReuse preserves old success on AI failure and blocks stale late writes', () => {
  const current = {
    status: 'generating',
    generationToken: 'new-token',
    reviewVersion: STYLIST_REVIEW_VERSION,
    inputDigest: 'new',
    previousReview: { aiComment: { title: '旧', reason: '旧', styleTags: [], tip: '旧' } },
  };
  assert.equal(resolveStylistReviewReuse({ review: current, context: { inputDigest: 'new' }, generationToken: 'old-token', mode: 'finish' }).action, 'superseded');
  assert.equal(resolveStylistReviewReuse({ review: current, context: { inputDigest: 'new' }, generationToken: 'new-token', mode: 'failure' }).action, 'restore_previous');
});

test('buildStylistReviewDocument persists safe V2 payload without full outfit or image data', () => {
  const explanation = buildRuleFallbackExplanationV2(evidenceInput(), meta());
  const document = buildStylistReviewDocument({
    context: {
      openid: 'user-a',
      outfitKey: 'a_b',
      scene: 'work',
      reviewId: 'rid',
      inputDigest: evidenceInput().inputDigest,
      evidenceVersion: 'stylist-evidence-v1',
      promptVersion: STYLIST_PROMPT_VERSION,
      model: 'qwen-flash',
      provider: 'aliyun-bailian',
    },
    explanation,
    now: NOW,
  });
  const json = JSON.stringify(document);
  assert.equal(document.reviewVersion, STYLIST_REVIEW_VERSION);
  assert.equal(document.aiComment.title, explanation.title);
  assert.equal(json.includes('cloud://'), false);
  assert.equal(json.includes('"outfit"'), false);
});
