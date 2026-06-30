const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FORBIDDEN_HUMAN_COPY_TERMS,
  SENSITIVE_HUMAN_COPY_TERMS,
  assertHumanCopy,
  findHumanCopyPolicyViolations,
  hasRepeatedSentenceParts,
  isTooSimilar,
} = require('./humanCopyPolicy');

test('policy blocks internal terms in user-facing copy', () => {
  for (const term of FORBIDDEN_HUMAN_COPY_TERMS) {
    assert.throws(() => assertHumanCopy(`这是一段包含${term}的文案。`), /human_copy_policy_violation/, term);
  }
});

test('policy blocks body-sensitive and value-judgment terms', () => {
  for (const term of SENSITIVE_HUMAN_COPY_TERMS) {
    assert.throws(() => assertHumanCopy(`这件衣服很${term}。`), /human_copy_policy_violation/, term);
  }
});

test('policy accepts natural recommendation copy', () => {
  assert.doesNotThrow(() => assertHumanCopy('印花上衣做主角，浅色下装和运动鞋让整体轻松但不杂乱。'));
});

test('policy reports all matching terms without mutating text', () => {
  const text = '这些颜色有真实识别记录，卡片先讲颜色，详情再补充组合层次。';
  const before = text.slice();
  const violations = findHumanCopyPolicyViolations(text);
  assert.equal(text, before);
  assert.ok(violations.includes('识别'));
  assert.ok(violations.includes('卡片'));
  assert.ok(violations.includes('详情'));
});

test('quality gate catches repeated sentence parts and adjacent phrase overlap', () => {
  assert.equal(hasRepeatedSentenceParts('整体重点更清楚，整体重点更清楚。'), true);
  assert.equal(hasRepeatedSentenceParts('整体更轻松，也更轻松自然。'), true);
  assert.equal(hasRepeatedSentenceParts('印花上衣做主角，浅色下装把整体稳住。'), false);
});

test('similarity gate catches Today and detail copy repetition', () => {
  assert.equal(
    isTooSimilar(
      '印花上衣做主角，浅色下装和运动鞋让整体轻松但不杂乱。',
      '印花上衣做主角，浅色下装和运动鞋让整体轻松但不杂乱。',
    ),
    true,
  );
  assert.equal(
    isTooSimilar(
      '印花上衣做主角，浅色下装和运动鞋让整体轻松但不杂乱。',
      '运动鞋延续了休闲感，居家穿或临时出门都比较自然。',
    ),
    false,
  );
});
