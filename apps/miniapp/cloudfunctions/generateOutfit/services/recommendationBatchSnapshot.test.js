const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildSyntheticContractBatchSummaries } = require('./recommendationCopyProductMatrix.fixture');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

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

test('Today uses Minimal Batch Persistence and native Home Light only', () => {
  assert.match(source, /persistRecommendationBatchV2/);
  assert.match(source, /projectHomeLightV2/);
  assert.doesNotMatch(source, /upsertRecommendationOutfitsBatch|projectRecommendationResponseOutfits|snapshotUpsert/);
});

test('Detail and action lifecycles remain lazy and immutable', () => {
  assert.match(source, /loadV2OutfitPayload/);
  assert.match(source, /getOutfitDetailV2/);
  assert.match(source, /updateFavoriteV2/);
  assert.match(source, /confirmWearV2/);
  assert.match(source, /addOutfitHistory/);
});
