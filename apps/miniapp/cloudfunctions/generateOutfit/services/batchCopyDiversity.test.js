const assert = require('node:assert/strict');
const test = require('node:test');

const { applyBatchCopyDiversity } = require('./batchCopyDiversity');

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
