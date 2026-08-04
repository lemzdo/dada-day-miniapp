const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FAILED_WITHOUT_PREVIOUS,
  FAILED_WITH_PREVIOUS,
  getAiReviewPageState,
} = require('./aiReviewPageState');

test('AI 点评页面状态覆盖 idle/loading/success/partial/failure matrix', () => {
  assert.deepEqual(getAiReviewPageState(), {
    state: 'idle', buttonText: '再听小搭说说', disabled: false, message: '',
  });
  assert.equal(getAiReviewPageState({ loading: true, hasContent: true }).state, 'loading');
  assert.equal(getAiReviewPageState({ success: true, hasContent: true }).state, 'success');
  assert.equal(getAiReviewPageState({ success: true, partial: true, hasContent: true }).state, 'partial');
  assert.deepEqual(getAiReviewPageState({ failed: true }), {
    state: 'failed', buttonText: '再试一次', disabled: false, message: FAILED_WITHOUT_PREVIOUS,
  });
  assert.deepEqual(getAiReviewPageState({ failed: true, retainedPrevious: true, hasContent: true }), {
    state: 'failed_retained', buttonText: '重新点评', disabled: false, message: FAILED_WITH_PREVIOUS,
  });
});

test('详情页不再包含两段旧邀请文案', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.tsx'), 'utf8');
  assert.doesNotMatch(source, /这套，我还想多说两句/);
  assert.doesNotMatch(source, /再结合今天的天气和场景，看看有没有容易忽略的小细节/);
});
