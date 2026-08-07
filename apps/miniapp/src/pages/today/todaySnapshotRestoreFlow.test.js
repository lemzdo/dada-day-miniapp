'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function runRestoreFlow({
  authContext = { userScope: 'user-a' },
  requireReturnIntent = false,
  hasReturnIntent = false,
  snapshot = { id: 'snapshot' },
  valid = true,
}) {
  const events = [];
  if (!authContext) return { events, result: false, reason: 'NO_LOCAL_IDENTITY' };
  if (requireReturnIntent && !hasReturnIntent) {
    return { events, result: false, reason: 'RETURN_INTENT_REQUIRED' };
  }

  events.push('localIdentityReady');
  events.push('restoreInvoked');
  events.push('snapshotReadStart');
  events.push('snapshotRead');
  if (!snapshot) return { events, result: false, reason: 'EMPTY' };
  events.push('snapshotValidation');
  if (!valid) return { events, result: false, reason: 'INVALID' };
  events.push('snapshotFound');
  events.push('snapshotValid');
  events.push('statusApply');
  events.push('setOutfits');
  return { events, result: true, reason: '' };
}

test('normal Today enters the complete hot snapshot path before remote identity work', () => {
  const result = runRestoreFlow({ snapshot: { id: 'same-user' } });
  assert.deepEqual(result.events, [
    'localIdentityReady',
    'restoreInvoked',
    'snapshotReadStart',
    'snapshotRead',
    'snapshotValidation',
    'snapshotFound',
    'snapshotValid',
    'statusApply',
    'setOutfits',
  ]);
  assert.equal(result.result, true);
  assert.equal(result.reason, '');
});

test('the only pre-read exits are missing identity and an explicitly required detail intent', () => {
  assert.deepEqual(runRestoreFlow({ authContext: null }).events, []);
  assert.equal(runRestoreFlow({ authContext: null }).reason, 'NO_LOCAL_IDENTITY');
  assert.deepEqual(runRestoreFlow({ requireReturnIntent: true, hasReturnIntent: false }).events, []);
  assert.equal(
    runRestoreFlow({ requireReturnIntent: true, hasReturnIntent: false }).reason,
    'RETURN_INTENT_REQUIRED',
  );
});

test('detail return and tab return both read when their identity is current', () => {
  assert.equal(runRestoreFlow({ requireReturnIntent: true, hasReturnIntent: true }).result, true);
  assert.equal(runRestoreFlow({ requireReturnIntent: false, hasReturnIntent: false }).result, true);
});

test('empty and invalid snapshots stop after the read and validation stages', () => {
  assert.deepEqual(runRestoreFlow({ snapshot: null }).events, [
    'localIdentityReady', 'restoreInvoked', 'snapshotReadStart', 'snapshotRead',
  ]);
  assert.deepEqual(runRestoreFlow({ valid: false }).events, [
    'localIdentityReady', 'restoreInvoked', 'snapshotReadStart', 'snapshotRead',
    'snapshotValidation',
  ]);
});
