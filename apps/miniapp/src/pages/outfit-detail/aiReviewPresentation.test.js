const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAiReviewPresentation } = require('./aiReviewPresentationCore');

function v2Comment(overrides = {}) {
  const { explanationV2: explanationOverrides = {}, ...commentOverrides } = overrides;
  return {
    title: '模型生成标题不应展示',
    reason: '旧兼容正文',
    styleTags: ['通勤', '利落'],
    tip: '旧建议',
    explanationV2: {
      schemaVersion: 2,
      reviewVersion: 'stylist-explanation-v2',
      promptVersion: 'stylist-prompt-v2',
      title: '内部标题不展示',
      summary: '这套是清爽利落的通勤感，配色和轮廓都比较收束。',
      strengths: [
        { text: '黑白配色让视觉重点更清楚。', evidenceCodes: ['COLOR_MONOCHROMATIC'] },
        { text: '短上衣和长裤的比例层次明确。', evidenceCodes: ['PROPORTION_CLEAR_LAYERING'] },
      ],
      tradeoffs: [{ text: '如果场合更正式，可以减少装饰感。', evidenceCodes: ['FORMALITY_ALIGNED'] }],
      tip: { text: '鞋包保持同色，主线会更清楚。', evidenceCodes: ['COLOR_MONOCHROMATIC'] },
      styleTags: ['通勤', '利落', '通勤'],
      confidence: 'high',
      evidenceCodes: ['COLOR_MONOCHROMATIC'],
      limitations: [],
      source: 'rule_fallback',
      provider: 'rule',
      model: 'rule',
      generatedAt: '2026-06-30T00:00:00.000Z',
      inputDigest: 'digest',
      ...explanationOverrides,
    },
    ...commentOverrides,
  };
}

test('V2 presentation uses summary and strengths as body paragraphs', () => {
  const result = buildAiReviewPresentation(v2Comment());
  assert.deepEqual(result.bodyParagraphs, [
    '这套是清爽利落的通勤感，配色和轮廓都比较收束。',
    '黑白配色让视觉重点更清楚。',
    '短上衣和长裤的比例层次明确。',
  ]);
});

test('presentation excludes model titles and all tags from visible text', () => {
  const result = buildAiReviewPresentation(v2Comment());
  const visible = [...result.bodyParagraphs, ...result.tags, result.advice].filter(Boolean).join('\n');
  assert.deepEqual(result.tags, []);
  assert.doesNotMatch(visible, /模型生成标题|内部标题/);
});

test('tip appears only as advice and not repeated in body', () => {
  const result = buildAiReviewPresentation(v2Comment({
    explanationV2: {
      strengths: [
        { text: '鞋包保持同色，主线会更清楚。', evidenceCodes: ['COLOR_MONOCHROMATIC'] },
        { text: '黑白配色让视觉重点更清楚。', evidenceCodes: ['COLOR_MONOCHROMATIC'] },
      ],
    },
  }));
  assert.equal(result.advice, '鞋包保持同色，主线会更清楚。');
  assert.equal(result.bodyParagraphs.includes(result.advice), false);
});

test('first tradeoff becomes advice when tip is missing and no empty advice block is rendered', () => {
  const withTradeoff = buildAiReviewPresentation(v2Comment({
    explanationV2: {
      tip: null,
      tradeoffs: [
        { text: '正式场合可以换成更简洁的鞋。', evidenceCodes: ['FORMALITY_ALIGNED'] },
        { text: '第二条不展示为建议。', evidenceCodes: ['DETAIL_SINGLE_FOCUS'] },
      ],
    },
  }));
  assert.equal(withTradeoff.advice, '正式场合可以换成更简洁的鞋。');

  const withoutAdvice = buildAiReviewPresentation(v2Comment({ explanationV2: { tip: null, tradeoffs: [] } }));
  assert.equal(withoutAdvice.advice, null);
});

test('legacy V1 presentation uses reason and tip without title or tags', () => {
  const result = buildAiReviewPresentation({
    title: '旧标题不展示',
    reason: '这套整体更清爽，适合日常通勤。',
    styleTags: ['清爽', '通勤', '清爽'],
    tip: '可以加一件薄外套。',
  });
  assert.deepEqual(result.bodyParagraphs, ['这套整体更清爽，适合日常通勤。']);
  assert.deepEqual(result.tags, []);
  assert.equal(result.advice, '可以加一件薄外套。');
  assert.doesNotMatch([...result.bodyParagraphs, ...result.tags, result.advice].join('\n'), /旧标题/);
});

test('V3 presentation uses overallComment and advice without title or tags', () => {
  const result = buildAiReviewPresentation({
    title: '旧标题不展示',
    reason: '旧正文',
    styleTags: ['休闲', '运动'],
    tip: '旧建议',
    explanationV2: {
      schemaVersion: 3,
      reviewVersion: 'stylist-explanation-v3',
      promptVersion: 'stylist-prompt-v3',
      copyPolicyVersion: 'human-copy-v1',
      overallComment: '这套整体偏轻松活泼，有重点但不会太满。',
      advice: '想让整体更清爽，可以让配饰只延续一个主色。',
      title: '模型标题不展示',
      styleTags: ['休闲'],
    },
  });
  assert.deepEqual(result.bodyParagraphs, ['这套整体偏轻松活泼，有重点但不会太满。']);
  assert.deepEqual(result.tags, []);
  assert.equal(result.advice, '想让整体更清爽，可以让配饰只延续一个主色。');
});

test('empty input deterministic output and long duplicate text are handled safely', () => {
  assert.deepEqual(buildAiReviewPresentation(null), { bodyParagraphs: [], tags: [], advice: null });
  assert.deepEqual(buildAiReviewPresentation({}), { bodyParagraphs: [], tags: [], advice: null });

  const input = v2Comment();
  const before = JSON.parse(JSON.stringify(input));
  assert.deepEqual(buildAiReviewPresentation(input), buildAiReviewPresentation(input));
  assert.deepEqual(input, before);

  const longText = '这段点评'.repeat(80);
  const result = buildAiReviewPresentation(v2Comment({
    explanationV2: {
      summary: longText,
      strengths: [
        { text: longText, evidenceCodes: ['A'] },
        { text: '第二段有效信息。', evidenceCodes: ['B'] },
      ],
    },
  }));
  assert.equal(result.bodyParagraphs.length, 2);
  assert.ok(result.bodyParagraphs[0].length <= 120);
});

test('tradeoff is not duplicated when it matches advice and evidence codes stay hidden', () => {
  const result = buildAiReviewPresentation(v2Comment({
    explanationV2: {
      tip: { text: '正式场合可以减少装饰。', evidenceCodes: ['FORMALITY_ALIGNED'] },
      tradeoffs: [{ text: '正式场合可以减少装饰。', evidenceCodes: ['FORMALITY_ALIGNED'] }],
    },
  }));
  assert.equal(result.advice, '正式场合可以减少装饰。');
  assert.equal(result.bodyParagraphs.includes('正式场合可以减少装饰。'), false);
  assert.doesNotMatch(result.bodyParagraphs.join('\n'), /COLOR_|SILHOUETTE_|PROPORTION_/);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('outfit detail UI keeps old content during loading and uses a friendly cooldown message', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  assert.match(source, /commentLoading/);
  assert.match(source, /USER_FACING_COPY\.aiReview\.loading/);
  assert.match(source, /AI_REVIEW_COOLDOWN/);
  assert.match(source, /getAiReviewErrorCopy/);
  assert.doesNotMatch(source, /retryAfterSeconds|秒后可再试/);
});

test('outfit detail UI does not render aiComment title or review tags directly', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  assert.doesNotMatch(source, /aiComment\.title/);
  assert.doesNotMatch(source, /ai-comment-title/);
  assert.doesNotMatch(source, /aiReviewPresentation\.tags/);
  assert.doesNotMatch(source, /ai-comment-tags/);
});
