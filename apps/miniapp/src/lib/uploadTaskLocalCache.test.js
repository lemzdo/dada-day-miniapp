const assert = require('node:assert/strict');
const test = require('node:test');

const {
  clearUploadTaskLocalCache,
  getUploadTaskLocalCache,
  markUploadBatchTerminal,
  removeUploadBatchFromLocalCache,
  writeUploadTaskLocalCache,
} = require('./uploadTaskLocalCache');

test('removes only the requested batch for the active user', () => {
  clearUploadTaskLocalCache();
  writeUploadTaskLocalCache({
    authRuntimeKey: 'user-a',
    data: [{ id: 'batch-1' }, { id: 'batch-2' }],
  });
  writeUploadTaskLocalCache({
    authRuntimeKey: 'user-b',
    data: [{ id: 'batch-1' }],
  });

  removeUploadBatchFromLocalCache({ authRuntimeKey: 'user-a', batchId: 'batch-1' });

  assert.deepEqual(getUploadTaskLocalCache({ authRuntimeKey: 'user-a' }), [{ id: 'batch-2' }]);
  assert.deepEqual(getUploadTaskLocalCache({ authRuntimeKey: 'user-b' }), [{ id: 'batch-1' }]);
});

test('terminal mark filters stale recoverable entries before refetch', () => {
  clearUploadTaskLocalCache();
  writeUploadTaskLocalCache({
    authRuntimeKey: 'user-a',
    data: [{ id: 'batch-1', status: 'ready' }, { id: 'batch-2', status: 'processing' }],
  });

  markUploadBatchTerminal({ authRuntimeKey: 'user-a', batchId: 'batch-1', status: 'discarded' });

  assert.deepEqual(getUploadTaskLocalCache({ authRuntimeKey: 'user-a' }), [{ id: 'batch-2', status: 'processing' }]);
});

test('does not remove cache when batchTerminal is false', () => {
  clearUploadTaskLocalCache();
  writeUploadTaskLocalCache({
    authRuntimeKey: 'user-a',
    data: [{ id: 'batch-1' }],
  });

  removeUploadBatchFromLocalCache({ authRuntimeKey: 'user-a', batchId: 'batch-1', batchTerminal: false });

  assert.deepEqual(getUploadTaskLocalCache({ authRuntimeKey: 'user-a' }), [{ id: 'batch-1' }]);
});

test('runtime upload list remains bounded to the cloud recovery contract', () => {
  clearUploadTaskLocalCache();
  writeUploadTaskLocalCache({
    authRuntimeKey: 'user-a',
    data: Array.from({ length: 25 }, (_, index) => ({ id: `batch-${index}` })),
  });

  assert.equal(getUploadTaskLocalCache({ authRuntimeKey: 'user-a' }).length, 10);
});
