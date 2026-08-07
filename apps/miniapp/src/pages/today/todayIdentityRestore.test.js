'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('normal Today onShow restores without a detail return intent', () => {
  assert.match(source, /useDidShow\(\(\) => \{[\s\S]*?restoreTodaySnapshotFromDetail\(authContext, \{ requireReturnIntent: false \}\)/);
});

test('restore still receives the active auth context and keeps validation in the restore function', () => {
  assert.match(source, /restoreTodaySnapshotFromDetail\(authContext, \{ requireReturnIntent: false \}\)/);
  assert.match(source, /const snapshot = readTodayRestoreSnapshot\(authContext\)/);
  assert.match(source, /if \(!canRestoreTodaySnapshot\(snapshot\)\)/);
  assert.match(source, /setOutfits\(restoredOutfits\)/);
});
