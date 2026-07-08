const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  getAiCommentButtonBlockReason,
  getAiCommentButtonState,
} = require('./aiCommentButtonState');

test('AI comment button state exposes blocked early returns with user feedback', () => {
  assert.deepEqual(getAiCommentButtonBlockReason({ outfit: null, authContext: {} }), {
    state: 'unavailable',
    debugReason: 'missing_outfit',
    toast: '这套搭配还没加载好',
  });
  assert.deepEqual(getAiCommentButtonBlockReason({ outfit: { id: 'o1' }, authContext: null }), {
    state: 'unavailable',
    debugReason: 'missing_auth_context',
    toast: '登录状态过期，请重新进入页面',
  });
  assert.deepEqual(getAiCommentButtonBlockReason({ outfit: { id: 'o1' }, authContext: {}, commentLoading: true }), {
    state: 'loading',
    debugReason: 'request_in_flight',
    toast: '小搭正在想这套搭配',
  });
});

test('AI comment button state is retryable after failure and cooldown is diagnosable', () => {
  assert.equal(getAiCommentButtonState({ commentLoading: false, fallbackFailed: true }).state, 'failed');
  assert.equal(getAiCommentButtonState({ cooldown: true }).state, 'cooldown');
  assert.equal(getAiCommentButtonState({ hasCanonical: true }).state, 'success');
  assert.equal(getAiCommentButtonState({}).state, 'idle');
});

test('outfit detail page calls button guard before generating AI comment', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

  assert.match(source, /getAiCommentButtonBlockReason/);
  assert.match(source, /logAiCommentButtonBlock/);
  assert.match(source, /setAiCommentButtonState/);
});
