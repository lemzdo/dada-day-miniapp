const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateWeatherWearability } = require('./wearabilityGuard');

function item(id, category, extra = {}) {
  return {
    _id: id,
    category,
    subcategory: extra.subcategory || category,
    customName: extra.customName || extra.name || id,
    styleTags: extra.styleTags || [],
    sceneTags: extra.sceneTags || [],
    seasonTags: extra.seasonTags || [],
    colorPalette: extra.colorPalette || [],
    material: extra.material,
    thickness: extra.thickness,
    confidence: extra.confidence ?? 0.86,
    ...extra,
  };
}

test('rejects sweater hoodie and thick knit at 29C unless lightness is explicit', () => {
  const result = evaluateWeatherWearability({
    items: [
      item('tee', 'top', { subcategory: 'T恤', thickness: '薄' }),
      item('hoodie', 'top', { subcategory: '卫衣', thickness: '厚' }),
      item('shorts', 'bottom', { subcategory: '短裤' }),
      item('shoes', 'shoes', { subcategory: '运动鞋' }),
    ],
    weather: { temp: 29, weather: '晴' },
  });

  assert.equal(result.pass, false);
  assert.ok(result.rejectReasons.includes('HOT_WEATHER_WARM_ITEM'));
  assert.ok(result.evidence.some((entry) => entry.itemId === 'hoodie'));
});

test('passes thin summer sun-protection knit at 29C', () => {
  const result = evaluateWeatherWearability({
    items: [
      item('summer-knit', 'top', {
        subcategory: '薄针织防晒衫',
        seasonTags: ['夏季'],
        thickness: '轻薄',
        material: '冰丝',
      }),
      item('shorts', 'bottom', { subcategory: '短裤' }),
      item('shoes', 'shoes', { subcategory: '运动鞋' }),
    ],
    weather: { temp: 29, weather: '晴' },
  });

  assert.equal(result.pass, true);
  assert.equal(result.rejectReasons.length, 0);
});

test('rejects a warm long-sleeve knit at 27C without explicit lightness evidence', () => {
  const result = evaluateWeatherWearability({
    items: [
      item('sweater', 'top', { subcategory: '毛衣', material: '羊毛' }),
      item('pants', 'bottom', { subcategory: '长裤' }),
      item('shoes', 'shoes', { subcategory: '运动鞋' }),
    ],
    weather: { temp: 27, weather: '多云' },
  });

  assert.equal(result.pass, false);
  assert.ok(result.rejectReasons.includes('WARM_WEATHER_WARM_TOP'));
  assert.ok(result.penalty > 0);
  assert.ok(result.warningReasons.includes('WARM_WEATHER_HEAVY_COMBO'));
});

test('allows a warm-weather knit at 27C only when lightness is explicit', () => {
  const result = evaluateWeatherWearability({
    items: [
      item('thin-knit', 'top', { subcategory: 'thin knit', material: 'breathable', thickness: 'lightweight' }),
      item('shorts', 'bottom', { subcategory: 'shorts' }),
      item('shoes', 'shoes', { subcategory: 'sneaker' }),
    ],
    weather: { temp: 27, weather: 'cloudy' },
  });

  assert.equal(result.pass, true);
  assert.equal(result.rejectReasons.includes('WARM_WEATHER_WARM_TOP'), false);
});

test('rejects down coat below hot weather even in 22 to 25C band', () => {
  const result = evaluateWeatherWearability({
    items: [
      item('shirt', 'top', { subcategory: '衬衫' }),
      item('pants', 'bottom', { subcategory: '长裤' }),
      item('down', 'outerwear', { subcategory: '羽绒服', thickness: '厚' }),
      item('boots', 'shoes', { subcategory: '靴子' }),
    ],
    weather: { temp: 24, weather: '晴' },
  });

  assert.equal(result.pass, false);
  assert.ok(result.rejectReasons.includes('MILD_WEATHER_HEAVY_OUTERWEAR'));
});
