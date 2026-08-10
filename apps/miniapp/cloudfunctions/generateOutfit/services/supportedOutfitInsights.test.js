const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { buildSupportedOutfitInsights } = require('./supportedOutfitInsights');

function facts(overrides = {}) {
  return buildOutfitCopyFacts({
    outfit: {
      scene: '居家',
      weatherSnapshot: { temp: 22, weather: '多云' },
      items: [
        { clothingId: 'top-1', category: 'top', subcategory: 'T恤', color: '米白色' },
        { clothingId: 'bottom-1', category: 'bottom', subcategory: '阔腿裤', color: '军绿色' },
        {
          clothingId: 'shoes-1', category: 'shoes', subcategory: '运动鞋', color: '白色',
          contractFacts: ['qualified_shoes'],
        },
      ],
      ...overrides,
    },
  });
}

test('buildSupportedOutfitInsights produces grounded golden insights', () => {
  const insights = buildSupportedOutfitInsights(facts());
  const codes = insights.map((entry) => entry.code);

  assert.ok(codes.includes('color_echo'));
  assert.ok(codes.includes('color_contrast'));
  assert.ok(codes.includes('scene_fit_home'));
  assert.ok(codes.includes('light_outing'));
  assert.ok(codes.includes('weather_fit'));
  assert.ok(codes.includes('daily_casual'));

  const echo = insights.find((entry) => entry.code === 'color_echo');
  assert.deepEqual(echo.subjectItemIds, ['top-1', 'shoes-1']);
  assert.ok(echo.evidenceFactIds.every((id) => /^item:[^:]+:[^:]+$/.test(id)));
  assert.deepEqual(echo.pageSuitability, ['today', 'detail']);
  assert.ok(echo.requiredFacts.includes('color:米白色'));
  assert.ok(echo.text.includes('米白色'));
  assert.equal(insights.find((entry) => entry.code === 'scene_fit_home').text, '宅家时可以直接穿这组衣物');
});

test('buildSupportedOutfitInsights does not invent color insights without colors', () => {
  const insights = buildSupportedOutfitInsights(buildOutfitCopyFacts({
    outfit: {
      scene: '居家',
      items: [
        { clothingId: 'top-1', category: 'top', subcategory: 'T恤' },
        { clothingId: 'shoes-1', category: 'shoes', subcategory: '运动鞋' },
      ],
    },
  }));
  const codes = insights.map((entry) => entry.code);

  assert.equal(codes.includes('color_echo'), false);
  assert.equal(codes.includes('color_contrast'), false);
  assert.ok(codes.includes('scene_fit_home'));
});
