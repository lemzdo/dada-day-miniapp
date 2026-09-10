'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadRecommendationInputSnapshot } = require('./inputSnapshotService');

function databaseFixture() {
  const reads = [];
  const clothes = [{
    _id: 'top-1', _openid: 'user-1', status: 'active', category: 'top',
    subcategory: 'shirt', styleTags: ['casual'], createdAt: 1,
  }];
  return {
    reads,
    collection(name) {
      return {
        where(query) { reads.push({ name, query }); return this; },
        orderBy() { return this; }, skip() { return this; }, limit() { return this; },
        async get() {
          return { data: name === 'clothes' ? clothes : [{ styleProfile: { preferredStyles: ['casual'] } }] };
        },
      };
    },
  };
}

test('input snapshot loads user and wardrobe once and creates stable normalized identity', async () => {
  const database = databaseFixture();
  const stages = [];
  const databaseOperations = [];
  const event = { scene: 'work', date: '2026-09-09', weatherMode: 'disabled', maxResults: 8 };
  const first = await loadRecommendationInputSnapshot(event, {
    database,
    openid: 'user-1',
    onStage: (stage) => stages.push(stage),
    onDatabaseOperation: (operation) => databaseOperations.push(operation),
  });
  const second = await loadRecommendationInputSnapshot(event, { database: databaseFixture(), openid: 'user-1' });
  assert.equal(first.sceneContract.sceneKey, 'work');
  assert.equal(first.sceneContract.scene, '上班');
  assert.equal(first.weatherMode, 'disabled');
  assert.deepEqual(first.recommendationProfile.styleTags, ['casual']);
  assert.equal(first.candidatePoolIdentity.identityHash, second.candidatePoolIdentity.identityHash);
  assert.equal(first.metrics.wardrobeReadCount, 1);
  assert.equal(first.metrics.databaseReadCount, 2);
  assert.equal(database.reads.some((entry) => entry.name === 'candidate_pools'), false);
  assert.deepEqual(new Set(stages), new Set(['CLOTHES_DB_START', 'PROFILE_DB_START', 'CLOTHES_DB_DONE', 'PROFILE_DB_DONE']));
  assert.deepEqual(databaseOperations.map(({ collection, action }) => ({ collection, action })), [
    { collection: 'clothes', action: 'query' },
    { collection: 'users', action: 'query' },
  ]);
  assert.ok(databaseOperations.every((operation) => operation.durationMs >= 0));
});

test('input snapshot binds refresh exclusions but performs no pool persistence', async () => {
  const database = databaseFixture();
  const snapshot = await loadRecommendationInputSnapshot({
    scene: '居家', trigger: 'refresh', recommendationBatchId: 'pool-1',
    excludedOutfitKeys: ['outfit-1', 'outfit-1', 'outfit-2'],
  }, { database, openid: 'user-1' });
  assert.equal(snapshot.isRefreshRequest, true);
  assert.equal(snapshot.requestedCandidatePoolId, 'pool-1');
  assert.deepEqual(snapshot.excludedOutfitKeys, ['outfit-1', 'outfit-2']);
  assert.deepEqual(database.reads.map((entry) => entry.name), ['clothes', 'users']);
});
