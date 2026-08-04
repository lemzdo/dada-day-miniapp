const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasRealRecommendationWeather,
  normalizeRecommendationWeather,
  toWeatherSnapshot,
} = require('./recommendationWeatherMode');

test('live and cached weather preserve only real supplied values', () => {
  for (const mode of ['live', 'cached']) {
    const value = normalizeRecommendationWeather({ temp: 31, humidity: 70, weather: '晴', wind: 2, uv: 6 }, mode);
    assert.equal(value.mode, mode);
    assert.equal(hasRealRecommendationWeather(value), true);
    assert.deepEqual(toWeatherSnapshot(value), { temp: 31, humidity: 70, weather: '晴', wind: 2, uv: 6 });
  }
});

test('disabled and unavailable weather never synthesize 22 degrees or a snapshot', () => {
  for (const mode of ['disabled', 'unavailable']) {
    const value = normalizeRecommendationWeather({ temp: 22, humidity: 65, weather: '多云' }, mode);
    assert.equal(value.mode, mode);
    assert.equal(value.temperature, null);
    assert.equal(value.temp, null);
    assert.equal(value.condition, null);
    assert.equal(value.source, 'none');
    assert.equal(hasRealRecommendationWeather(value), false);
    assert.equal(toWeatherSnapshot(value), undefined);
    assert.doesNotMatch(JSON.stringify(value), /22/);
  }
});

test('missing temperature downgrades an asserted live mode to unavailable', () => {
  const value = normalizeRecommendationWeather({ weather: '晴' }, 'live');
  assert.equal(value.mode, 'unavailable');
  assert.equal(value.temp, null);
});
