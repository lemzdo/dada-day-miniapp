const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { buildSupportedOutfitInsights } = require('./supportedOutfitInsights');
const { composePageCopy } = require('./pageCopyComposer');

function composeGolden() {
  const facts = buildOutfitCopyFacts({
    outfit: {
      scene: '居家',
      weatherSnapshot: { temp: 22, weather: '多云' },
      items: [
        { clothingId: 'top-1', category: 'top', subcategory: 'T恤', color: '米白色' },
        { clothingId: 'bottom-1', category: 'bottom', subcategory: '阔腿裤', color: '军绿色' },
        { clothingId: 'shoes-1', category: 'shoes', subcategory: '运动鞋', color: '白色' },
      ],
    },
  });
  return composePageCopy({ facts, insights: buildSupportedOutfitInsights(facts) });
}

test('composePageCopy separates today reason detail explanation and AI default', () => {
  const copy = composeGolden();

  assert.equal(copy.todayReason, '米白 T恤和白色运动鞋颜色接近，军绿色阔腿裤让这套不全是浅色。');
  assert.equal(copy.detailExplanation, '米白 T恤和白色运动鞋颜色接近，军绿色阔腿裤让这套不全是浅色。居家穿不显得刻意，临时出门也不用重新换一身。');
  assert.equal(copy.aiExtraDefault, copy.detailExplanation);
  assert.notEqual(copy.todayReason, copy.detailExplanation);
  assert.ok(copy.usedInsightCodes.includes('color_echo'));
  assert.ok(copy.usedInsightCodes.includes('color_contrast'));
});

test('composePageCopy avoids mechanical default phrases', () => {
  const text = Object.values(composeGolden()).flat().join('\n');
  for (const phrase of ['主线', '清楚的亮点', '亮点已经落在', '更稳', '保持简单', '单品和单品', '想再明确一点', '放在一起', '不用多想', '不费心', '有呼应', '压住一点', '不至于太淡', '不会太飘', '能确认的主要', '多一点层次', '常见单品', '常用单品']) {
    assert.equal(text.includes(phrase), false, phrase);
  }
});
