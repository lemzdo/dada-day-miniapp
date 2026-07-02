const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  WARDROBE_DISCARD_NOTICE,
  WARDROBE_NOTICE_STORAGE_KEY,
  consumePendingWardrobeNotice,
  shouldEnterTerminalDiscardLeaving,
  setPendingWardrobeNotice,
} = require('./uploadTerminalDiscardFlow');

test('enters leaving only for terminal draft discard with a batch id', () => {
  assert.equal(shouldEnterTerminalDiscardLeaving({ batchTerminal: true }, 'batch-1'), true);
  assert.equal(shouldEnterTerminalDiscardLeaving({ batchTerminal: false }, 'batch-1'), false);
  assert.equal(shouldEnterTerminalDiscardLeaving({ batchTerminal: true }, ''), false);
});

test('wardrobe notice is one-shot and scoped to its dedicated key', () => {
  const storage = new Map();
  const calls = [];
  const authContext = { openid: 'user-a' };

  setPendingWardrobeNotice({
    authContext,
    setUserStorageSync: (key, value, options) => {
      calls.push(['set', key, value, options]);
      storage.set(key, value);
    },
  });

  assert.equal(storage.get(WARDROBE_NOTICE_STORAGE_KEY), WARDROBE_DISCARD_NOTICE);
  assert.deepEqual(calls[0], ['set', WARDROBE_NOTICE_STORAGE_KEY, WARDROBE_DISCARD_NOTICE, { authContext }]);

  const first = consumePendingWardrobeNotice({
    authContext,
    getUserStorageSync: (key, options) => {
      calls.push(['get', key, options]);
      return storage.get(key);
    },
    removeUserStorageSync: (key, options) => {
      calls.push(['remove', key, options]);
      storage.delete(key);
    },
  });

  const second = consumePendingWardrobeNotice({
    authContext,
    getUserStorageSync: (key) => storage.get(key),
    removeUserStorageSync: (key) => storage.delete(key),
  });

  assert.equal(first, WARDROBE_DISCARD_NOTICE);
  assert.equal(second, '');
  assert.equal(storage.has(WARDROBE_NOTICE_STORAGE_KEY), false);
});

test('upload-confirm terminal draft discard does not use a 500ms delayed navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.equal(/setTimeout\s*\([^)]*500/s.test(source), false);
});
