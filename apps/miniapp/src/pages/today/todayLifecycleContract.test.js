const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const intentSource = fs.readFileSync(path.join(__dirname, 'recommendationIntent.js'), 'utf8');
const cardSource = fs.readFileSync(path.join(__dirname, 'HomeLightCardV2.tsx'), 'utf8');
const weatherSource = fs.readFileSync(path.join(__dirname, '../../components/WeatherCard/index.tsx'), 'utf8');

test('initial recommendation waits for weather readiness instead of disabled full compute', () => {
  assert.match(todaySource, /pendingInitialRecommendationRef/);
  assert.match(todaySource, /currentWeatherModeRef\.current === 'disabled'/);
  assert.match(todaySource, /pendingInitialRecommendationRef\.current = false/);
  assert.match(todaySource, /refreshHardInvalidRecommendation\(authContext\)/);
});

test('unavailable weather has one notification key and one fallback dispatch path', () => {
  assert.match(weatherSource, /notifyWeatherModeChange\('disabled'\)/);
  assert.match(weatherSource, /notifyWeatherModeChange\('unavailable'\)/);
  assert.match(weatherSource, /lastNotifiedKeyRef/);
});

test('request identity and latest generation ownership are behavior primitives', () => {
  assert.match(intentSource, /inFlightBySignature/);
  assert.match(intentSource, /generation: \+\+nextGeneration/);
  assert.match(intentSource, /intent\.generation === activeIntent\.generation/);
  assert.match(todaySource, /!isRecommendationIntentCurrent\(intent\)/);
  assert.match(todaySource, /resolveRecommendationMedia\(rawResponse\)/);
});

test('media resolution is owner-checked before and after asynchronous work', () => {
  const ownerCheck = todaySource.indexOf('const v2IntentCurrent = isRecommendationIntentCurrent(intent)');
  const mediaResolve = todaySource.indexOf('const response = await resolveRecommendationMedia(rawResponse)');
  const mediaOwnerCheck = todaySource.indexOf("v2MediaResolutionRejectedAt");
  assert.ok(ownerCheck >= 0 && ownerCheck < mediaResolve);
  assert.ok(mediaResolve < mediaOwnerCheck);
});

test('renderer consumes only the resolved canonical displayImageUrl', () => {
  assert.match(cardSource, /src=\{item\.displayImageUrl\}/);
  assert.doesNotMatch(cardSource, /resolveRecommendationMedia|getTempFileURL|cloud\.downloadFile/);
  assert.doesNotMatch(cardSource, /thumbnailUrl|imageUrl/);
});
