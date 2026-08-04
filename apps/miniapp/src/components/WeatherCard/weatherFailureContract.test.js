const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('weather UI preserves distinct permission, location, and service failure paths', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  for (const reason of ['permission_denied', 'location_unavailable', 'service_unavailable']) {
    assert.equal(source.includes(reason), true, reason);
  }
  assert.match(source, /notifyWeatherModeChange\('disabled'\)/);
  assert.match(source, /notifyWeatherModeChange\('unavailable'\)/);
  assert.match(source, /weatherMode: data\.source === 'cache' \? 'cached' : 'live'/);
});
