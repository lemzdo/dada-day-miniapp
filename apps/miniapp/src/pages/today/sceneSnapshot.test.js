const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSceneSnapshotKey,
  chooseSceneTransitionState,
  shouldUseSceneSnapshot,
} = require('./sceneSnapshot');

test('scene snapshot key includes runtime date scene weather and copy version', () => {
  const key = buildSceneSnapshotKey({
    userRuntimeKey: 'user-a',
    date: '2026-07-09',
    timeOfDay: 'all_day',
    scene: '上班',
    weatherFingerprint: '26:cloudy',
    wardrobeVersion: 'wardrobe-3',
    profileVersion: 'profile-2',
    reasonVersion: 'recommendation-reason-v3',
    copyVersion: 'page-copy-v4',
  });

  assert.equal(key, 'user-a|2026-07-09|all_day|上班|26:cloudy|wardrobe-3|profile-2|recommendation-reason-v3|page-copy-v4');
});

test('scene snapshot is rejected when cache invalidation inputs change', () => {
  const snapshot = {
    key: buildSceneSnapshotKey({
      userRuntimeKey: 'user-a',
      date: '2026-07-09',
      timeOfDay: 'all_day',
      scene: '居家',
      weatherFingerprint: '26:cloudy',
      reasonVersion: 'recommendation-reason-v3',
      copyVersion: 'page-copy-v4',
    }),
    outfits: [{ id: 'outfit-1' }],
    generatedAt: Date.now(),
  };

  assert.equal(shouldUseSceneSnapshot(snapshot, { ...snapshot, key: snapshot.key }), true);
  assert.equal(shouldUseSceneSnapshot(snapshot, { ...snapshot, key: snapshot.key.replace('居家', '约会') }), false);
});

test('scene transition keeps previous cards when requested scene has no snapshot', () => {
  const currentOutfits = [{ id: 'home-1' }];
  const result = chooseSceneTransitionState({
    currentOutfits,
    snapshot: null,
    nextSceneKey: 'work',
  });

  assert.deepEqual(result.outfits, currentOutfits);
  assert.equal(result.currentIndex, 0);
  assert.equal(result.hasRecommendations, true);
  assert.equal(result.keepPreviousWhileLoading, true);
});
