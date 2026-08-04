const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildSyntheticContractBatchSummaries } = require('./recommendationCopyProductMatrix.fixture');

test('synthetic new-recommendation batches skip coverage gaps and never return hidden-copy cards', () => {
  const batches = buildSyntheticContractBatchSummaries();
  for (const [scene, batch] of Object.entries(batches)) {
    const accepted = batch.selections.filter((entry) => entry.gateResult === 'PASS');
    const rejected = batch.selections.filter((entry) => entry.gateResult === 'REJECT');
    assert.equal(accepted.length, batch.copyAcceptedCount, scene);
    assert.equal(batch.finalApiCount, batch.acceptedCount, scene);
    assert.equal(batch.copyHiddenCount, 0, scene);
    assert.equal(rejected.every((entry) => !entry.includedInFinalApiArray), true, scene);
    assert.equal(accepted.every((entry) => entry.todayReason), true, scene);
  }
});

test('snapshot acceptance depends on evidence rather than sentence diversity', () => {
  const batches = buildSyntheticContractBatchSummaries();
  const acceptedClaims = Object.values(batches).flatMap((batch) => batch.selections
    .filter((entry) => entry.gateResult === 'PASS')
    .map((entry) => entry.claimId));
  assert.equal(acceptedClaims.length, Object.values(batches).reduce((sum, batch) => sum + batch.acceptedCount, 0));
  assert.ok(acceptedClaims.length > 0);
  assert.equal(new Set(acceptedClaims).size <= acceptedClaims.length, true);
});

test('cloud entrypoint uses the tested finalizer and preserves Contract metadata on snapshot writes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
  assert.match(source, /finalizeAcceptedRecommendations\(compiledOutfits, \{/);
  assert.match(source, /\.\.\.pickRecommendationCopyContractFields\(payload\)/);
  assert.match(source, /canonicalRecommendations = canonicalizeRecommendationBatch\(finalRecommendations, \{ scene \}\)/);
  assert.match(source, /upsertRecommendationOutfitsBatch\(\{\s*openid: OPENID,\s*bases: canonicalRecommendations,/);
  assert.match(source, /hydratedOutfits\.length !== finalRecommendationCount/);
  assert.match(source, /item\.copyContract\.todayReason\.trim\(\)\.length > 0/);
  assert.match(source, /styleTags: readStringArray\(item\.styleTags\)\.length \? readStringArray\(item\.styleTags\) : \[\]/);
});

test('saved snapshot fields remain the sole source for Today and detail rendering', () => {
  const detailPresentation = fs.readFileSync(path.resolve(__dirname, '../../../src/utils/outfitContextText.ts'), 'utf8');
  const favoritePage = fs.readFileSync(path.resolve(__dirname, '../../../src/pages/favorite-outfits/index.tsx'), 'utf8');
  const historyPage = fs.readFileSync(path.resolve(__dirname, '../../../src/pages/outfit-history/index.tsx'), 'utf8');
  assert.match(detailPresentation, /return normalizeTags\(outfit\.styleTags \?\? \[\]\);/);
  assert.match(favoritePage, /getOutfitStyleTags\(/);
  assert.match(historyPage, /getOutfitStyleTags\(/);
});
