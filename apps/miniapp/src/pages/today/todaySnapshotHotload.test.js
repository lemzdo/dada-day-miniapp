const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const adapterSource = fs.readFileSync(path.join(__dirname, 'todayV2Adapter.ts'), 'utf8');

test('Today restores a valid user snapshot during authenticated entry', () => {
  const entry = todaySource.indexOf('if (!isAuthenticated) return;');
  const restore = todaySource.indexOf('const snapshot = readTodayV2Snapshot(', entry);
  const weather = todaySource.indexOf('<WeatherCard', entry);

  assert.ok(entry >= 0, 'authenticated entry must be present');
  assert.ok(restore > entry && restore < weather, 'exact snapshot restore must be scheduled before WeatherCard work');
  assert.match(todaySource.slice(entry, weather), /effectiveInput\.identity/);
});

test('Today hot-load keeps background weather refresh from owning the full-screen loader', () => {
  const weatherHandler = todaySource.slice(
    todaySource.indexOf('async function handleWeatherChange('),
    todaySource.indexOf('function goToWardrobe()', todaySource.indexOf('async function handleWeatherChange(')),
  );
  const backgroundRequest = weatherHandler.indexOf('silent: Boolean(v2SnapshotRef.current?.cards.length)');
  assert.ok(backgroundRequest >= 0, 'weather refresh must be silent after cards are present');
  assert.match(weatherHandler.slice(backgroundRequest), /trigger: options\.forceRefresh \? 'weather-force' : 'weather'/);
});

test('Today entry restore retains existing snapshot validity gates', () => {
  assert.match(adapterSource, /snapshot\.runtimeVersion !== 'today-runtime-v2'/);
  assert.match(adapterSource, /snapshot\.inputIdentity !== expectedInputIdentity/);
  assert.match(adapterSource, /snapshot\.core\.countContract\?\.returnedCardCount !== snapshot\.core\.cardCount/);
  assert.match(todaySource, /commitCanonicalSnapshotForRender\(snapshot/);
});

test('A valid entry restore does not invoke recommendation generation', () => {
  const entry = todaySource.indexOf('const snapshot = readTodayV2Snapshot(');
  const restore = todaySource.slice(
    entry,
    todaySource.indexOf('const resetUserState = useCallback(', entry),
  );
  assert.doesNotMatch(restore, /acquireRecommendationForInput|generateCloudOutfit/);
});

test('Background recommendation failure retains already visible cards', () => {
  const fetch = todaySource.slice(
    todaySource.indexOf('async function fetchRecommendations('),
    todaySource.indexOf('function handleRefresh()', todaySource.indexOf('async function fetchRecommendations(')),
  );
  assert.match(fetch, /if \(!\(v2SnapshotRef\.current\?\.cards\.length\)\) \{/);
  assert.match(fetch, /setRecommendationNotice\(/);
  assert.match(fetch, /else \{/);
});
