const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const stateSource = fs.readFileSync(path.join(__dirname, 'outfitDetailV2.ts'), 'utf8');
const snapshotSource = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'outfitSnapshot.ts'), 'utf8');
const cloudSource = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'cloud.ts'), 'utf8');

test('V2 detail route carries identity and lazy-loads through the V2 client', () => {
  assert.match(source, /getCloudOutfitDetailV2/);
  assert.match(source, /readOutfitRefFromRoute\(router\.params\)/);
  assert.match(source, /outfitRef\.batchId/);
  assert.match(source, /outfitRef\.outfitKey/);
  assert.match(source, /outfitRef\.referenceId/);
  assert.match(stateSource, /detailIdentityReady/);
  assert.match(stateSource, /response\.referenceId !== state\.referenceId/);
});

test('V2 Detail materializes the formal renderer without legacy persisted snapshots', () => {
  assert.doesNotMatch(source, /function V2OutfitDetailView|详情已按需加载/);
  assert.doesNotMatch(source, /storeOutfitDetailDraft|storeOutfitStateSync/);
  assert.match(stateSource, /function buildFormalOutfitV2/);
  assert.match(stateSource, /itemsSnapshot: detail\.items\.map/);
  assert.match(stateSource, /detail\.outfitId \? \{ outfitId: detail\.outfitId \}/);
  assert.match(stateSource, /detail\.todayReason\s+\|\| shell\?\.todayReason/);
  assert.match(stateSource, /styleTags\[0\]/);
  assert.match(stateSource, /detail\.items\.length/);
  assert.match(stateSource, /reasonVersion: 'recommendation-detail-v2-safe-v1'/);
  assert.match(snapshotSource, /outfit\.reasonVersion === 'recommendation-detail-v2-safe-v1'/);
  assert.match(snapshotSource, /reason: validatedV2DetailReason/);
  assert.match(stateSource, /detail\.styleTags\.length > 0 \? detail\.styleTags : shell\?\.styleTags/);
  assert.match(source, /getOutfitDisplayTitle\(outfit/);
  assert.match(source, /<OutfitItemRow/);
});

test('V2 Detail exposes explicit load states and retry', () => {
  for (const state of ['LOADING', 'READY', 'NOT_FOUND', 'REMOTE_ERROR']) {
    assert.match(stateSource, new RegExp(`'${state}'`));
  }
  assert.match(source, /setV2ReloadToken\(\(current\) => current \+ 1\)/);
  assert.match(source, /readV2DetailErrorCode/);
});

test('V2 Detail wires favorite, worn, AI commentary and item navigation', () => {
  assert.match(source, /updateCloudOutfitFavoriteV2\(\{/);
  assert.match(source, /updateCloudOutfitWearV2\(\{/);
  assert.match(source, /loadCanonicalAiComment\(prepared/);
  assert.match(source, /generateCloudOutfitComment\(outfit/);
  assert.match(cloudSource, /outfit\.id\.startsWith\('ref-'\) \? undefined : outfit\.id/);
  assert.match(cloudSource, /authoritativeDetailId && outfit\.outfitKind/);
  assert.match(source, /pages\/clothing-detail\/index\?id=/);
  assert.match(source, /patchOutfitDetailV2Status/);
});
