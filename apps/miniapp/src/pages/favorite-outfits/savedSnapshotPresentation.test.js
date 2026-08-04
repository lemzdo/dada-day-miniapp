const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('favorites preserve cards when saved default copy is hidden', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  assert.match(source, /getSavedSnapshotDefaultCopy\(outfit\)\s*\?\s*\(/);
  assert.match(source, /getOutfitStyleTags\(outfit\)\.slice\(0, 2\)/);
  assert.match(source, /getOutfitWeatherSummary\(outfit\)\.chip/);
  assert.doesNotMatch(source, /\.filter\([^\n]*(todayReason|getSavedSnapshotDefaultCopy|copyContract)/);
  assert.doesNotMatch(source, /stale_waiting|衣橱信息还不多/);
  assert.match(source, /outfits\.map\(/);
});
