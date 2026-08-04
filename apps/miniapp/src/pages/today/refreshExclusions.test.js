const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSceneIdentityKey, getCurrentBatchOutfitKeys, mergeSeenOutfitKeys } = require('./refreshExclusions');

test('refresh exclusions contain every key in the visible batch, not only the active card', () => {
  const keys = getCurrentBatchOutfitKeys([
    { outfitKey: 'look-03' },
    { outfitKey: 'look-01' },
    { outfitKey: 'look-02' },
    { outfitKey: 'look-02' },
    { outfitKey: '' },
  ]);

  assert.deepEqual(keys, ['look-01', 'look-02', 'look-03']);
});

test('cumulative exclusions merge every successful batch without ordering drift', () => {
  const first = mergeSeenOutfitKeys([], ['look-03', 'look-01']);
  const second = mergeSeenOutfitKeys(first, [{ outfitKey: 'look-05' }, { outfitKey: 'look-03' }]);
  assert.deepEqual(second, ['look-01', 'look-03', 'look-05']);
});

test('A to B to C accumulates all successful batches until the candidate set is exhausted', () => {
  let seen = [];
  seen = mergeSeenOutfitKeys(seen, ['A1', 'A2']);
  assert.deepEqual(seen, ['A1', 'A2']);
  seen = mergeSeenOutfitKeys(seen, ['B1', 'B2']);
  assert.deepEqual(seen, ['A1', 'A2', 'B1', 'B2']);
  seen = mergeSeenOutfitKeys(seen, ['C1']);
  assert.deepEqual(seen, ['A1', 'A2', 'B1', 'B2', 'C1']);
  assert.deepEqual(mergeSeenOutfitKeys(seen, []), seen);
});

test('failed request inputs do not mutate the accumulated seen list', () => {
  const seen = ['A1', 'A2'];
  const next = mergeSeenOutfitKeys(seen, undefined);
  assert.deepEqual(next, seen);
  assert.deepEqual(seen, ['A1', 'A2']);
});

test('scene and identity are independent exclusion namespaces', () => {
  assert.notEqual(buildSceneIdentityKey('home', 'hash-a'), buildSceneIdentityKey('work', 'hash-a'));
  assert.notEqual(buildSceneIdentityKey('home', 'hash-a'), buildSceneIdentityKey('home', 'hash-b'));
});
