const assert = require('node:assert/strict');
const test = require('node:test');

const { applyBatchCopyDiversity } = require('./batchCopyDiversity');

function signature(text) {
  return String(text || '')
    .replace(/米白 T恤|白色运动鞋|军绿色阔腿裤|蓝色牛仔裤|黑色短裤|灰色卫衣|白色短袖/g, 'ITEM')
    .replace(/[。！？].*$/g, '')
    .replace(/\s+/g, '');
}

test('applyBatchCopyDiversity limits repeated low value phrases across eight recommendations', () => {
  const copies = Array.from({ length: 8 }, (_, index) => ({
    id: `copy-${index}`,
    todayReason: 'T恤和运动鞋不用多想，临时出门也不费心，自然日常，放在一起很顺。',
    detailExplanation: 'T恤和运动鞋不用多想，临时出门也不费心，自然日常。',
    usedInsightCodes: ['daily_casual'],
    usedPhrases: ['不用多想', '不费心', '临时出门', '自然', '日常', '放在一起'],
  }));

  const result = applyBatchCopyDiversity(copies);
  const todayText = result.map((entry) => entry.todayReason).join('\n');
  const allText = result.map((entry) => `${entry.todayReason}${entry.detailExplanation}`).join('\n');

  assert.ok((allText.match(/不用多想/g) || []).length <= 1);
  assert.ok((allText.match(/不费心/g) || []).length <= 1);
  assert.ok((allText.match(/临时出门/g) || []).length <= 2);
  assert.ok((allText.match(/自然/g) || []).length <= 2);
  assert.ok((allText.match(/日常/g) || []).length <= 3);
  assert.equal(todayText.includes('放在一起'), false);
  assert.ok(new Set(result.map((entry) => entry.angle)).size >= 5);
});

test('applyBatchCopyDiversity rewrites repeated sentence structures across eight recommendations', () => {
  const copies = Array.from({ length: 8 }, (_, index) => ({
    id: `copy-${index}`,
    angle: index % 2 === 0 ? '颜色呼应' : '鞋子收尾',
    todayReason: '米白 T恤和白色运动鞋有呼应，军绿色阔腿裤让整套不至于太淡。',
    detailExplanation: '米白 T恤和白色运动鞋前后呼应，军绿色阔腿裤把颜色压下来一点。居家场景里，这套不会太飘。',
    usedInsightCodes: ['color_echo', 'color_contrast'],
    usedPhrases: ['有呼应', '不至于太淡', '不会太飘'],
  }));

  const result = applyBatchCopyDiversity(copies);
  const text = result.map((entry) => `${entry.todayReason}${entry.detailExplanation}`).join('\n');
  const signatures = result.map((entry) => signature(entry.todayReason));
  const mostRepeatedSignature = Math.max(...Array.from(new Set(signatures)).map((entry) => signatures.filter((item) => item === entry).length));

  assert.ok(mostRepeatedSignature <= 2);
  assert.ok((text.match(/有呼应/g) || []).length <= 2);
  assert.equal(text.includes('不至于太淡'), false);
  assert.equal(text.includes('不会太飘'), false);
  assert.equal(text.includes('放在一起'), false);
  assert.ok(result.filter((entry) => entry.angle === '颜色关系').length <= 3);
  assert.ok(result.some((entry) => entry.angle === '场景适配'));
  assert.ok(result.some((entry) => entry.angle === '天气厚薄'));
  assert.ok(result.some((entry) => entry.angle === '单品组合'));
  assert.ok(result.filter((entry) => entry.angle === '鞋子收尾').length <= 2);
});

test('applyBatchCopyDiversity limits color angles and preserves at least three non-color dimensions', () => {
  const copies = Array.from({ length: 8 }, (_, index) => ({
    id: `copy-${index}`,
    angle: '颜色关系',
    detailAngle: '颜色关系',
    todayReason: '白色上衣和白色运动鞋颜色接近，灰色短裤让这套不全是浅色。',
    detailExplanation: '白色上衣和白色运动鞋颜色接近，灰色短裤让这套不全是浅色。',
    usedInsightCodes: ['color_echo', 'color_contrast'],
    usedPhrases: ['颜色接近', '不全是浅色'],
  }));

  const result = applyBatchCopyDiversity(copies);
  const angles = result.map((entry) => entry.angle);
  const detailAngles = result.map((entry) => entry.detailAngle);
  const nonColorAngles = new Set(angles.filter((angle) => angle !== '颜色关系'));
  const text = result.map((entry) => `${entry.todayReason}${entry.detailExplanation}`).join('\n');

  assert.ok(angles.filter((angle) => angle === '颜色关系').length <= 3);
  assert.ok(nonColorAngles.size >= 3);
  assert.equal(result.every((entry) => entry.angle !== '颜色关系' || entry.detailAngle !== '颜色关系'), true);
  assert.equal(detailAngles.includes('场景适配'), true);
  assert.equal(detailAngles.includes('天气厚薄') || detailAngles.includes('单品作用'), true);
  for (const phrase of ['颜色接近', '深浅变化', '上下分区', '不全是浅色', '适合今天']) {
    assert.equal(text.includes(phrase), false, phrase);
  }
});
