const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const intentSource = fs.readFileSync(path.join(__dirname, 'recommendationIntent.js'), 'utf8');
const cardSource = fs.readFileSync(path.join(__dirname, 'HomeLightCardV2.tsx'), 'utf8');
const weatherSource = fs.readFileSync(path.join(__dirname, '../../components/WeatherCard/index.tsx'), 'utf8');

test('initial recommendation waits for weather readiness instead of disabled full compute', () => {
  assert.match(todaySource, /createRecommendationInputCoordinator/);
  assert.match(todaySource, /readiness: 'deferred'/);
  assert.match(todaySource, /readiness: weather \? 'ready'/);
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

test('refresh resolves media before committing Home Light state', () => {
  const refreshStart = todaySource.indexOf('async function handleV2Refresh');
  const resolve = todaySource.indexOf('resolveRecommendationMedia(response)', refreshStart);
  const snapshot = todaySource.indexOf('const next = toTodayV2Snapshot(resolvedResponse)', refreshStart);
  assert.ok(refreshStart >= 0 && resolve > refreshStart && snapshot > resolve);
});

test('renderer consumes only the resolved canonical displayImageUrl', () => {
  assert.match(cardSource, /src=\{item\.displayImageUrl\}/);
  assert.doesNotMatch(cardSource, /resolveRecommendationMedia|getTempFileURL|cloud\.downloadFile/);
  assert.doesNotMatch(cardSource, /thumbnailUrl|imageUrl/);
});

test('restored canonical snapshot resolves before entering renderer state', () => {
  assert.match(todaySource, /readTodayV2Snapshot/);
  assert.match(todaySource, /resolveRecommendationMedia\(\{ light: \{ cards: snapshot\.cards \} \}\)/);
  assert.match(todaySource, /isAuthContextCurrent\(authContext\)/);
  assert.match(todaySource, /setV2Snapshot\(\{ \.\.\.snapshot, cards: resolved\.light\.cards \}\)/);
});

test('reset and unload invalidate an in-flight restore owner', () => {
  const resetStart = todaySource.indexOf('const resetUserState = useCallback(() => {');
  const resetEnd = todaySource.indexOf('  }, []);', resetStart);
  const unloadStart = todaySource.indexOf('useUnload(() => {');
  const unloadEnd = todaySource.indexOf('  });', unloadStart);
  assert.match(todaySource.slice(resetStart, resetEnd), /restoreGenerationRef\.current \+= 1/);
  assert.match(todaySource.slice(unloadStart, unloadEnd), /restoreGenerationRef\.current \+= 1/);
});
