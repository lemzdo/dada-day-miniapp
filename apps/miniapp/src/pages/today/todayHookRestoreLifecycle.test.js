'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

function runTodayHookLifecycle({ staleBeforeRestore = false, snapshot = true } = {}) {
  const events = [];
  let authEpoch = 7;
  const localContext = { userScope: 'owner-a', confirmedOpenid: 'redacted', authEpoch };
  const currentContext = () => ({ ...localContext, authEpoch });
  const isCurrent = (context) => context.userScope === currentContext().userScope
    && context.authEpoch === currentContext().authEpoch;
  const restore = (context) => {
    events.push('restoreDispatchAttempt');
    events.push('restoreFunctionEntered');
    const current = isCurrent(context);
    events.push(`authContextCurrentChecked=${current}`);
    if (!current) return 'AUTH_CONTEXT_STALE';
    events.push('snapshotReadStart');
    if (!snapshot) return 'SNAPSHOT_EMPTY';
    events.push('snapshotValid');
    events.push('setOutfits');
    return 'RESTORE_COMPLETED';
  };

  events.push('todayOnShow');
  events.push('localIdentityReady');
  const onShowContext = currentContext();
  if (staleBeforeRestore) authEpoch += 1;
  const returnReason = restore(onShowContext);
  return { events, returnReason };
}

test('useDidShow local identity restores before delayed same-user remote identity', () => {
  const result = runTodayHookLifecycle();
  assert.deepEqual(result.events, [
    'todayOnShow', 'localIdentityReady', 'restoreDispatchAttempt',
    'restoreFunctionEntered', 'authContextCurrentChecked=true',
    'snapshotReadStart', 'snapshotValid', 'setOutfits',
  ]);
  assert.equal(result.returnReason, 'RESTORE_COMPLETED');
  assert.match(source, /useDidShow\(\(\) => \{[\s\S]*?localIdentityReady[\s\S]*?restoreTodaySnapshotFromDetail/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?identityRemoteStart[\s\S]*?restoreTodaySnapshotFromDetail/);
});

test('a genuinely stale auth context is recorded with an explicit reason', () => {
  const result = runTodayHookLifecycle({ staleBeforeRestore: true });
  assert.equal(result.returnReason, 'AUTH_CONTEXT_STALE');
  assert.deepEqual(result.events, [
    'todayOnShow', 'localIdentityReady', 'restoreDispatchAttempt',
    'restoreFunctionEntered', 'authContextCurrentChecked=false',
  ]);
  assert.match(source, /recordTodayRestoreReturn\('AUTH_CONTEXT_STALE'\)/);
});
