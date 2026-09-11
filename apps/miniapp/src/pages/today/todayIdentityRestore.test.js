'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('normal Today onShow restores without a detail return intent', () => {
  assert.match(source, /useDidShow/);
  assert.match(source, /readTodayV2Snapshot/);
});

test('restore still receives the active auth context and keeps validation in the restore function', () => {
  assert.match(source, /isAuthContextCurrent\(authContext\)/);
  assert.match(source, /commitCanonicalSnapshotForRender/);
  assert.match(source, /setV2Snapshot/);
});
