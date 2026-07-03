const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  WARDROBE_DISCARD_NOTICE,
  WARDROBE_NOTICE_STORAGE_KEY,
  finalizeTerminalDiscard,
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

test('upload-confirm uses the shared terminal discard finalizer for both terminal entries', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.match(source, /finalizeTerminalDiscard\(\{\s*source:\s*'draft'/s);
  assert.match(source, /finalizeTerminalDiscard\(\{\s*source:\s*'batch'/s);
  assert.equal(source.includes("Taro.showToast({ title: '已舍弃本次识别'"), false);
  assert.equal(/setTimeout\s*\([^)]*600/s.test(source), false);
});

test('terminal discard finalizer updates cache and notice before one immediate navigation', async () => {
  const draftEvents = [];
  const batchEvents = [];

  await finalizeTerminalDiscard(makeFinalizeInput({ source: 'draft', events: draftEvents, batchStatus: 'deleted' }));
  await finalizeTerminalDiscard(makeFinalizeInput({ source: 'batch', events: batchEvents }));

  assert.deepEqual(normalizeEvents(draftEvents), normalizeEvents(batchEvents));
  assert.equal(draftEvents.filter((event) => event[0] === 'switchTab').length, 1);
  assert.equal(batchEvents.filter((event) => event[0] === 'switchTab').length, 1);

  const draftEventNames = draftEvents.map((event) => event[0]);
  assert.ok(draftEventNames.indexOf('markTerminal') < draftEventNames.indexOf('switchTab'));
  assert.ok(draftEventNames.indexOf('removeLocalCache') < draftEventNames.indexOf('switchTab'));
  assert.ok(draftEventNames.indexOf('setNotice') < draftEventNames.indexOf('switchTab'));
  assert.ok(draftEventNames.indexOf('invalidate') < draftEventNames.indexOf('switchTab'));
  assert.deepEqual(draftEvents[0], ['setLeaving', true]);
});

test('terminal discard finalizer exits leaving and keeps terminal fallback on navigation failure', async () => {
  for (const source of ['draft', 'batch']) {
    const events = [];

    const result = await finalizeTerminalDiscard(makeFinalizeInput({ source, events, failNavigation: true }));

    assert.deepEqual(result, { navigated: false });
    assert.deepEqual(events.at(-2), ['setLeaving', false]);
    assert.deepEqual(events.at(-1), ['navigationFailure', source, 'discarded']);
    assert.ok(events.some((event) => event[0] === 'markTerminal'));
    assert.ok(events.some((event) => event[0] === 'setNotice'));
    assert.equal(events.filter((event) => event[0] === 'switchTab').length, 1);
  }
});

test('upload-confirm blocks repeated discard actions while terminal discard is leaving', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.match(source, /if \(!batchId \|\| discardingBatch \|\| discardRequestedRef\.current \|\| isLeavingAfterDiscard\) return;/);
  assert.match(source, /if \(isLeavingAfterDiscard \|\| discardRequestedRef\.current \|\| discardingDraftIds\.has\(draft\.id\)\) return;/);
});

function makeFinalizeInput({
  source,
  events,
  batchStatus = 'discarded',
  failNavigation = false,
}) {
  const authContext = { openid: 'user-a' };
  return {
    source,
    batchId: 'batch-1',
    batchStatus,
    authContext,
    flowRuntimeKey: 'runtime-a',
    isFlowCurrent: () => true,
    setIsLeavingAfterDiscard: (value) => events.push(['setLeaving', value]),
    buildAuthRuntimeKey: () => 'auth-runtime-a',
    buildUserStorageBusinessKey: (key, id) => `storage:${key}:${id}`,
    removeUserStorageSync: (key, options) => events.push(['removeStorage', key, options.authContext.openid]),
    markUploadBatchTerminal: (payload) => events.push(['markTerminal', payload.batchId, payload.status]),
    removeUploadBatchFromLocalCache: (payload) => {
      events.push(['removeLocalCache', payload.batchId, payload.batchTerminal]);
    },
    setUserStorageSync: (key, value, options) => events.push(['setNotice', key, value, options.authContext.openid]),
    invalidateAfterUploadTaskMutation: async ({ authContext: inputAuthContext }) => {
      events.push(['invalidate', inputAuthContext.openid]);
    },
    navigateToWardrobe: async () => {
      events.push(['switchTab']);
      if (failNavigation) throw new Error('switch failed');
      return true;
    },
    onNavigationFailure: ({ source: failedSource, terminalStatus }) => {
      events.push(['navigationFailure', failedSource, terminalStatus]);
    },
  };
}

function normalizeEvents(events) {
  return events
    .filter((event) => !['navigationFailure'].includes(event[0]))
    .map((event) => (event[0] === 'markTerminal' ? [event[0], event[1], 'terminal'] : event));
}
