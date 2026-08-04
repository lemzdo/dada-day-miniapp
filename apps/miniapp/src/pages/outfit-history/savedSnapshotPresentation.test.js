const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('history preserves records and conditionally hides unsafe saved copy', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  assert.match(source, /getSavedSnapshotDefaultCopy\(record\)\s*\?\s*\(/);
  assert.match(source, /getOutfitStyleTags\(record\)\.slice\(0, 3\)/);
  assert.doesNotMatch(source, /\.filter\([^\n]*(todayReason|getSavedSnapshotDefaultCopy|copyContract)/);
  assert.doesNotMatch(source, /stale_waiting|衣橱信息还不多/);
  assert.match(source, /selectedDateRecords\.map\(/);
});
