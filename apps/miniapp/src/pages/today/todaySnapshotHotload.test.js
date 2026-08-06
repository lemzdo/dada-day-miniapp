const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('Today restores a valid user snapshot during authenticated entry', () => {
  const entry = todaySource.indexOf('entryIntentIdRef.current =');
  const restore = todaySource.indexOf(
    'restoreTodaySnapshotFromDetail(captureAuthContext(), { requireReturnIntent: false });',
    entry,
  );
  const weather = todaySource.indexOf('<WeatherCard', entry);

  assert.ok(entry >= 0, 'authenticated entry must be present');
  assert.ok(restore > entry && restore < weather, 'snapshot restore must be scheduled before WeatherCard work');
});

test('Today hot-load keeps background weather refresh from owning the full-screen loader', () => {
  const weatherHandler = todaySource.slice(
    todaySource.indexOf('async function handleWeatherChange('),
    todaySource.indexOf('function goToWardrobe()', todaySource.indexOf('async function handleWeatherChange(')),
  );
  const backgroundRequest = weatherHandler.indexOf('silent: outfitsRef.current.length > 0');
  assert.ok(backgroundRequest >= 0, 'weather refresh must be silent after cards are present');
  assert.match(weatherHandler.slice(backgroundRequest), /trigger: options\.forceRefresh \? 'weather-force' : 'weather'/);
});

test('Today entry restore retains existing snapshot validity gates', () => {
  const restore = todaySource.slice(todaySource.indexOf('function restoreTodaySnapshotFromDetail('));
  assert.match(restore, /canRestoreTodaySnapshot\(snapshot\)/);
  assert.match(restore, /applyTodayOutfitStatuses\(/);
  assert.match(restore, /setOutfits\(restoredOutfits\)/);
  assert.match(restore, /setLoading\(false\)/);
});

test('A valid entry restore does not invoke recommendation generation', () => {
  const entry = todaySource.indexOf('restoreTodaySnapshotFromDetail(captureAuthContext(), { requireReturnIntent: false });');
  const restore = todaySource.slice(
    todaySource.indexOf('function restoreTodaySnapshotFromDetail('),
    todaySource.indexOf('function readTodayRestoreSnapshot(', entry),
  );
  assert.doesNotMatch(restore, /generateCloudOutfit\(/);
});

test('Background recommendation failure retains already visible cards', () => {
  const fetch = todaySource.slice(
    todaySource.indexOf('async function fetchRecommendations('),
    todaySource.indexOf('function handleRefresh()', todaySource.indexOf('async function fetchRecommendations(')),
  );
  assert.match(fetch, /if \(outfitsRef\.current\.length === 0\) \{/);
  assert.match(fetch, /setRecommendationNotice\(/);
  assert.match(fetch, /else \{/);
});
