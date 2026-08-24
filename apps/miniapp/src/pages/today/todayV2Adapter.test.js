const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'todayV2Adapter.ts'), 'utf8');

test('Home Light adapter uses a minimal whitelist and independent snapshot key', () => {
  assert.match(source, /TODAY_V2_SNAPSHOT_KEY/);
  assert.match(source, /core: response\.batch/);
  assert.match(source, /displayImageUrl/);
  assert.doesNotMatch(source, /isTodayV2Enabled|TARO_APP_RECOMMENDATION_V2_ENABLED/);
});

test('Home Light snapshot rejects deep product payloads', () => {
  assert.match(source, /forbidden = \['snapshotItems', 'itemsSnapshot'/);
  assert.match(source, /thumbnailUrl', 'imageUrl'/);
  assert.match(source, /snapshot\.core\.countContract\?\.returnedCardCount/);
});

test('Home Light snapshot is exact-input bound', () => {
  assert.match(source, /inputIdentity: string/);
  assert.match(source, /snapshot\.inputIdentity !== expectedInputIdentity/);
});

test('persisted current snapshots reject zero and malformed partial count contracts', () => {
  assert.match(source, /snapshot\.core\.cardCount < 1/);
  assert.match(source, /snapshot\.core\.countContract\.limited !== \(snapshot\.core\.cardCount < 8\)/);
  assert.match(source, /new Set\(snapshot\.core\.order\)\.size/);
  assert.match(source, /if \(snapshot\.cards\.length === 0\) return null/);
  assert.match(source, /response\.light\.cards\.map/);
});

test('status patches are batch and outfit scoped', () => {
  assert.match(source, /snapshot\.batchId !== patch\.batchId/);
  assert.match(source, /card\.outfitKey === patch\.outfitKey/);
});
