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

test('status patches are batch and outfit scoped', () => {
  assert.match(source, /snapshot\.batchId !== patch\.batchId/);
  assert.match(source, /card\.outfitKey === patch\.outfitKey/);
});
