'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const detailSource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const pageCacheSource = fs.readFileSync(path.join(__dirname, '../../lib/pageCache.ts'), 'utf8');
const snapshotSource = fs.readFileSync(path.join(__dirname, '../../utils/outfitSnapshot.ts'), 'utf8');

test('repeated Detail navigation cannot append full objects to L1', () => {
  assert.doesNotMatch(pageCacheSource, /setStorageSync|getStorageSync/);
  assert.doesNotMatch(snapshotSource, /setUserStorageSync|getUserStorageSync/);
  assert.doesNotMatch(detailSource, /storeOutfitDetailDraft|storeOutfitStateSync/);
});

test('V2 Detail resolves from Cloud after restart without a Today snapshot', () => {
  assert.match(detailSource, /const shell = card && snapshot\?\.batchId === v2BatchId/);
  assert.match(detailSource, /createOutfitDetailV2State\(shell\)/);
  assert.match(detailSource, /getCloudOutfitDetailV2\(\{ batchId: v2BatchId, outfitKey: v2OutfitKey, referenceId: v2ReferenceId \}\)/);
  assert.doesNotMatch(detailSource, /if \(!card \|\| snapshot\?\.batchId !== v2BatchId\) return/);
});
