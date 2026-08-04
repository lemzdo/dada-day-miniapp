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
      source: 'ai',
      provider: 'aliyun-bailian',
      model: 'qwen-flash',
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

test('ambiguous legacy V1 aliases are rejected', () => {
  const result = buildAiReviewPresentation({
    title: '旧标题不展示',
    reason: '这套整体更清爽，适合日常通勤。',
    styleTags: ['清爽', '通勤', '清爽'],
    tip: '可以加一件薄外套。',
  });
  assert.deepEqual(result.bodyParagraphs, []);
  assert.deepEqual(result.tags, []);
  assert.equal(result.advice, null);
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
      source: 'ai',
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

test('rule fallback response stays empty in the AI-only presentation', () => {
  const contentPlan = {
    primaryBenefit: 'commute_polish',
    items: [{ role: 'core', slot: 'top', displayName: '白衬衫' }],
    defaultDetailExplanation: '这条裤子弹性不错，坐着办公久一点也不容易勒。',
  };
  const result = buildAiReviewPresentation({
    title: '',
    reason: '旧 fallback 不应该替换默认正文。',
    styleTags: [],
    tip: '旧 fallback 建议也不展示。',
    source: 'rule_fallback',
    reviewSource: 'rule_fallback',
  }, contentPlan, { copyContractVersion: 'recommendation-copy-contract-v3' });

  assert.deepEqual(result.bodyParagraphs, []);
  assert.equal(result.advice, null);
});

test('rule default and legacy comments never enter the AI-only presentation', () => {
  const contentPlan = {
    primaryBenefit: 'clean_daily',
    items: [
      { role: 'core', slot: 'top', displayName: '米白 T恤' },
      { role: 'core', slot: 'bottom', displayName: '军绿色阔腿裤' },
      { role: 'core', slot: 'shoes', displayName: '白色运动鞋' },
    ],
    defaultDetailExplanation: '这条裤子弹性不错，宅家坐久了也不容易勒得慌。',
  };

  for (const aiComment of [
    {
      overallComment: 'T恤、阔腿裤、运动鞋是这套能确认的主要组合。',
      advice: '不需要强行再加外套或配饰。',
      reviewSource: 'rule_default',
    },
    {
      reason: 'T恤、阔腿裤、运动鞋是这套能确认的主要组合。',
      tip: '不需要强行再加外套或配饰。',
      source: 'legacy',
    },
  ]) {
    const result = buildAiReviewPresentation(aiComment, contentPlan, {
      copyContractVersion: 'recommendation-copy-contract-v3',
    });
    const visible = [...result.bodyParagraphs, result.advice].filter(Boolean).join('\n');

    assert.deepEqual(result.bodyParagraphs, []);
    assert.doesNotMatch(visible, /能确认的主要组合|已有单品本身|不需要强行/);
  }
});

test('successful enhanced review can replace contentPlan defaultDetailExplanation', () => {
  const contentPlan = {
    primaryBenefit: 'clean_daily',
    items: [{ role: 'core', slot: 'top', displayName: '米白 T恤' }],
    defaultDetailExplanation: '这条裤子弹性不错，宅家坐久了也不容易勒得慌。',
  };
  const result = buildAiReviewPresentation({
    explanationV2: {
      schemaVersion: 3,
      overallComment: '米白 T恤把上半身提亮，军绿色阔腿裤让颜色不单薄，白色运动鞋也接住了上衣。',
      advice: '居家穿可以维持这三件，临时出门不用重新换一身。',
      source: 'ai',
    },
  }, contentPlan);

  assert.deepEqual(result.bodyParagraphs, ['米白 T恤把上半身提亮，军绿色阔腿裤让颜色不单薄，白色运动鞋也接住了上衣。']);
  assert.equal(result.advice, '居家穿可以维持这三件，临时出门不用重新换一身。');
});

test('contentPlan without canonical detail stays empty instead of joining item names', () => {
  const result = buildAiReviewPresentation(null, {
    primaryBenefit: 'soft_mood',
    sceneIntent: 'home:clean_daily',
    items: [
      { role: 'core', slot: 'top', displayName: '米白 T恤' },
      { role: 'core', slot: 'bottom', displayName: '军绿色阔腿裤' },
      { role: 'core', slot: 'shoes', displayName: '白色运动鞋' },
    ],
  });
  const visible = [...result.bodyParagraphs, result.advice].filter(Boolean).join('\n');

  assert.equal(visible, '');
});

test('cached ai response can still replace content plan presentation', () => {
  const result = buildAiReviewPresentation({
    title: '',
    reason: '白衬衫和黑长裤让通勤线条更清楚，整体不会显得用力。',
    styleTags: [],
    tip: '鞋子保持简洁，主线会更稳。',
    source: 'cached_ai',
    reviewSource: 'cached_ai',
  }, {
    primaryBenefit: 'commute_polish',
    items: [{ role: 'core', slot: 'top', displayName: '白衬衫' }],
  });

  assert.deepEqual(result.bodyParagraphs, ['白衬衫和黑长裤让通勤线条更清楚，整体不会显得用力。']);
  assert.equal(result.advice, '鞋子保持简洁，主线会更稳。');
});

test('success false rule fallback keeps retry button and non-success toast semantics', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  const stateSource = fs.readFileSync(path.join(__dirname, 'aiReviewPageState.js'), 'utf8');
  assert.match(source, /isFallbackAiReviewResult/);
  assert.match(source, /刚刚没接上话，再试一次吧。/);
  assert.match(stateSource, /再听小搭说说/);
  assert.match(source, /!isFallbackAiReviewResult\(result\)/);
  assert.doesNotMatch(source, /success && result\.aiComment\)/);
});

test('canonical rule detail is excluded from the AI-only presentation', () => {
  const currentContext = { copyContractVersion: 'recommendation-copy-contract-v3' };
  const contentPlan = {
    defaultDetailExplanation: '这条裤子弹性不错，坐着办公久一点也不容易勒。',
    suggestion: { text: '不应混入默认正文的建议。' },
    items: [{ role: 'core', slot: 'top', displayName: '白衬衫' }],
    primaryBenefit: 'commute_polish',
  };

  assert.deepEqual(buildAiReviewPresentation(null, contentPlan, currentContext), {
    bodyParagraphs: [],
    tags: [],
    advice: null,
  });
  assert.deepEqual(buildAiReviewPresentation(null, contentPlan, { copyContractVersion: 'old' }), {
    bodyParagraphs: [],
    tags: [],
    advice: null,
  });
});

test('stale structural plans cannot create prose from item names, benefits, scene intent, or suggestions', () => {
  const result = buildAiReviewPresentation(null, {
    sceneIntent: 'work:commute',
    primaryBenefit: 'commute_polish',
    suggestion: { text: '建议加一件外套。' },
    items: [
      { role: 'core', slot: 'top', displayName: '白衬衫' },
      { role: 'functional', slot: 'shoes', displayName: '黑色皮鞋' },
    ],
  }, { copyContractVersion: 'old' });

  assert.deepEqual(result, { bodyParagraphs: [], tags: [], advice: null });
});

test('real ai remains independent of stale default copy but fallback-first conflicts cannot escape', () => {
  const realAi = v2Comment({ source: 'cached_ai', reviewSource: 'cached_ai' });
  const realResult = buildAiReviewPresentation(realAi, {
    defaultDetailExplanation: '旧默认文案',
  }, {
    copyContractVersion: 'old',
    reviewSource: 'cached_ai',
    enhanced: true,
  });
  assert.deepEqual(realResult.bodyParagraphs, [
    '这套是清爽利落的通勤感，配色和轮廓都比较收束。',
    '黑白配色让视觉重点更清楚。',
    '短上衣和长裤的比例层次明确。',
  ]);

  const conflict = buildAiReviewPresentation({
    ...realAi,
    source: 'cached_fallback',
  }, {
    defaultDetailExplanation: '这条裤子弹性不错，坐着办公久一点也不容易勒。',
  }, {
    copyContractVersion: 'recommendation-copy-contract-v3',
    reviewSource: 'ai',
    enhanced: true,
  });
  assert.deepEqual(conflict, { bodyParagraphs: [], tags: [], advice: null });
});
