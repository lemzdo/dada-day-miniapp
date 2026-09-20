const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyWriteValidateDelete,
  buildPostAuthMigrationPlan,
  buildPreAuthMigrationPlan,
  extractOutfitRef,
} = require('./storageMigrationCore');

test('pre-auth migration removes only allowlisted rebuildable families', () => {
  const plan = buildPreAuthMigrationPlan([
    'd1d:pageCache:user:outfitDetail:1',
    'generateOutfit:performance-ledger:v1',
    'd1d:userStorage:v1:scope-a:today%3AsceneSnapshot%3Arecommendation-copy-contract-v8%3Awork',
    'd1d:userStorage:v1:scope-b:today:outfitReturnSnapshot:recommendation-copy-contract-v8',
    'd1d:userStorage:v1:scope-a:uploadBatchImages%3Abatch-keep',
    'unknown:must-stay',
  ]);
  assert.deepEqual(plan.removeKeys, [
    'd1d:pageCache:user:outfitDetail:1',
    'generateOutfit:performance-ledger:v1',
    'd1d:userStorage:v1:scope-a:today%3AsceneSnapshot%3Arecommendation-copy-contract-v8%3Awork',
    'd1d:userStorage:v1:scope-b:today:outfitReturnSnapshot:recommendation-copy-contract-v8',
  ]);
});

test('post-auth migration matches scoped and encoded legacy upload keys', () => {
  const plan = buildPostAuthMigrationPlan([
    {
      key: 'd1d:userStorage:v1:scope-a:uploadBatchImages%3Abatch-1',
      value: ['image-1', 'image-1', 'image-2'],
    },
    {
      key: 'd1d:userStorage:v1:scope-b:uploadBatchImages%3Abatch-other',
      value: ['image-x'],
    },
  ], 'scope-a');
  assert.equal(plan.uploadRefs.length, 1);
  assert.equal(plan.uploadRefs[0].batchId, 'batch-1');
  assert.deepEqual(plan.uploadRefs[0].cloudImageIds, ['image-1', 'image-2']);
  assert.equal(plan.removeAfterValidation.length, 1);
});

test('legacy outfit snapshot migrates only when cloud identity is recoverable', () => {
  assert.deepEqual(extractOutfitRef({
    outfitKey: 'a_b',
    recommendationBatchId: 'batch-1',
    referenceId: 'ref-1',
  }), {
    schemaVersion: 1,
    source: 'recommendation',
    outfitKey: 'a_b',
    batchId: 'batch-1',
    referenceId: 'ref-1',
  });
  assert.equal(extractOutfitRef({ outfitKey: 'a_b', id: 'recommend:a_b', outfitKind: 'recommendation' }), null);
});

test('post-auth migration carries the compact Today snapshot and control fields', () => {
  const snapshot = { runtimeVersion: 'today-runtime-v2', schemaVersion: 'today-v2' };
  const context = { sceneKey: 'office', weatherMode: 'enabled' };
  const plan = buildPostAuthMigrationPlan([
    {
      key: 'd1d:userStorage:v1:scope-a:d1d:today:v2:home-light',
      value: snapshot,
    },
    {
      key: 'd1d:userStorage:v1:scope-a:today:recommendationInput:context',
      value: context,
    },
    {
      key: 'd1d:userStorage:v1:scope-a:today:recommendationInput:wardrobeVersion',
      value: 12,
    },
    {
      key: 'd1d:userStorage:v1:scope-b:today:recommendationInput:profileVersion',
      value: 99,
    },
    {
      key: 'd1d:userStorage:v1:scope-a:today:recommendationInput:dirty',
      value: true,
    },
  ], 'scope-a');

  assert.deepEqual(plan.todaySnapshot, snapshot);
  assert.deepEqual(plan.todayControl, {
    recommendationContext: context,
    wardrobeVersion: 12,
  });
  assert.equal(plan.removeAfterValidation.length, 4);
});

test('write-validate-delete never deletes legacy keys before validation', () => {
  const removed = [];
  const failedWrite = applyWriteValidateDelete({
    writes: [() => ({ ok: false })],
    validate: () => true,
    remove: (key) => removed.push(key),
    removeKeys: ['legacy'],
  });
  assert.equal(failedWrite.status, 'write-failed');
  assert.deepEqual(removed, []);

  const failedValidation = applyWriteValidateDelete({
    writes: [() => ({ ok: true })],
    validate: () => false,
    remove: (key) => removed.push(key),
    removeKeys: ['legacy'],
  });
  assert.equal(failedValidation.status, 'validation-failed');
  assert.deepEqual(removed, []);

  const migrated = applyWriteValidateDelete({
    writes: [() => ({ ok: true })],
    validate: () => true,
    remove: (key) => removed.push(key),
    removeKeys: ['legacy'],
  });
  assert.equal(migrated.status, 'migrated');
  assert.deepEqual(removed, ['legacy']);
});

test('migration planning is idempotent for repeated input', () => {
  const entries = [{
    key: 'd1d:userStorage:v1:scope-a:uploadBatchImages%3Abatch-1',
    value: ['image-1'],
  }];
  assert.deepEqual(
    buildPostAuthMigrationPlan(entries, 'scope-a'),
    buildPostAuthMigrationPlan(entries, 'scope-a'),
  );
});
