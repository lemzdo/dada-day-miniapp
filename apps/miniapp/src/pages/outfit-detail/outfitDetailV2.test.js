const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const stateSource = fs.readFileSync(path.join(__dirname, 'outfitDetailV2.ts'), 'utf8');

test('V2 detail route carries identity and lazy-loads through the V2 client', () => {
  assert.match(source, /getCloudOutfitDetailV2/);
  assert.match(source, /v2BatchId = router\.params\.batchId/);
  assert.match(source, /v2OutfitKey = router\.params\.outfitKey/);
  assert.match(source, /v2ReferenceId = router\.params\.referenceId/);
  assert.match(stateSource, /detailIdentityReady/);
  assert.doesNotMatch(source.slice(source.indexOf('if (v2Enabled && v2DetailState)'), source.indexOf('if (loading)')), /normalizeOutfitSnapshot/);
});

test('V2 detail does not feed Light into Legacy draft storage', () => {
  const v2Block = source.slice(source.indexOf('function V2OutfitDetailView'), source.indexOf('export default function OutfitDetailPage'));
  assert.doesNotMatch(v2Block, /storeOutfitDetailDraft|normalizeOutfitSnapshot/);
});
