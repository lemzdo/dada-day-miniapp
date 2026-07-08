const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LOW_QUALITY_COPY_PHRASES,
  sanitizeUserFacingCopy,
} = require('./copyQualityGate');

test('sanitizeUserFacingCopy replaces low quality homepage and detail phrases at final exit', () => {
  const input = '常见单品组合起来不复杂，出门前不用大改。颜色重点的单品已经在这里，其他部分少加复杂元素。';
  const result = sanitizeUserFacingCopy(input, {
    items: [{ name: '米白 T恤' }, { name: '军绿色阔腿裤' }, { name: '白色运动鞋' }],
    scene: '居家',
    fallback: '米白 T恤和白色运动鞋颜色接近，军绿色阔腿裤负责把颜色落住。',
  });

  assert.equal(result, '米白 T恤和白色运动鞋颜色接近，军绿色阔腿裤负责把颜色落住。');
  for (const phrase of LOW_QUALITY_COPY_PHRASES) {
    assert.equal(result.includes(phrase), false, phrase);
  }
});

test('sanitizeUserFacingCopy keeps short grounded copy when no insight is available', () => {
  const result = sanitizeUserFacingCopy('穿起来不绕，整体不会太飘。', {
    items: [{ displayName: '深灰卫衣' }, { displayName: '黑色长裤' }],
    fallback: '',
  });

  assert.equal(result, '深灰卫衣和黑色长裤可以直接成套穿。');
});
