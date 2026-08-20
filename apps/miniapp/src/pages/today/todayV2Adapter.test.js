const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'todayV2Adapter.ts'), 'utf8');

test('Today V2 adapter uses an independent snapshot key and whitelist copy', () => {
  assert.match(source, /TODAY_V2_SNAPSHOT_KEY/);
  assert.match(source, /runtimeVersion/);
  assert.match(source, /batchId/);
  assert.doesNotMatch(source, /normalizeOutfitSnapshot|storeOutfitDetailDraft/);
});

test('Today V2 flag is a build-time constant, not a runtime Node dependency', () => {
  assert.match(source, /process\.env\.TARO_APP_RECOMMENDATION_V2_ENABLED/);
  const config = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'index.ts'), 'utf8');
  assert.match(config, /defineConstants/);
  assert.match(config, /TARO_APP_RECOMMENDATION_V2_ENABLED/);
});

test('Today V2 status patch is batch and outfit scoped', () => {
  assert.match(source, /snapshot\.batchId !== patch\.batchId/);
  assert.match(source, /card\.outfitKey === patch\.outfitKey/);
});

test('Today V2 snapshot requires minimal core and rejects deep storage fields', () => {
  assert.match(source, /core: response\.batch/);
  assert.match(source, /snapshot\.core\.countContract\?\.requestedCardCount/);
  assert.match(source, /forbidden = \['snapshotItems', 'itemsSnapshot'/);
});
