const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

test('client sends explicit weather mode and has no Shanghai 22 degree business fallback', () => {
  const cloudSource = fs.readFileSync(path.join(ROOT, 'lib/cloud.ts'), 'utf8');
  const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  assert.match(cloudSource, /const requestPayload: Record<string, unknown> = \{\s*\.\.\.params,/);
  assert.doesNotMatch(cloudSource, /function getFallbackWeather/);
  assert.doesNotMatch(cloudSource, /temp:\s*22/);
  assert.match(todaySource, /generateCloudOutfit\(\{[\s\S]{0,500}weatherMode,/);
});

test('WeatherCard distinguishes live cached disabled and unavailable', () => {
  const source = fs.readFileSync(path.join(ROOT, 'components/WeatherCard/index.tsx'), 'utf8');
  assert.match(source, /data\.source === 'cache' \? 'cached' : 'live'/);
  assert.match(source, /notifyWeatherModeChange\('disabled'\)/);
  assert.match(source, /notifyWeatherModeChange\('unavailable'\)/);
  assert.match(source, /Date\.now\(\) - cachedAt > 10 \* 60 \* 1000/);
});

test('client cloud request always receives an audit id for V6 lifecycle correlation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib/cloud.ts'), 'utf8');
  assert.match(source, /CLIENT_BUILD_VERSION = 'miniapp-xiaoda-copy-v4-20260716'/);
  assert.match(source, /auditId: params\.auditId \|\| createRecommendationAuditId\('cloud'\)/);
  assert.match(source, /const result = await callCachedCloudFunction<RecommendResponse>\(/);
  assert.match(source, /return result;/);
});
