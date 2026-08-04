const FAILED_WITHOUT_PREVIOUS = '小搭刚刚卡了一下，等会儿再来听我说说吧。';
const FAILED_WITH_PREVIOUS = '小搭刚刚卡了一下，先把上次的点评留着，晚点再试试。';

function getAiReviewPageState({
  loading = false,
  success = false,
  partial = false,
  failed = false,
  retainedPrevious = false,
  hasContent = false,
} = {}) {
  if (loading) {
    return { state: 'loading', buttonText: '让我再想想……', disabled: true, message: '' };
  }
  if (failed && retainedPrevious && hasContent) {
    return { state: 'failed_retained', buttonText: '重新点评', disabled: false, message: FAILED_WITH_PREVIOUS };
  }
  if (failed) {
    return { state: 'failed', buttonText: '再试一次', disabled: false, message: FAILED_WITHOUT_PREVIOUS };
  }
  if (success && partial && hasContent) {
    return { state: 'partial', buttonText: '重新点评', disabled: false, message: '' };
  }
  if (success && hasContent) {
    return { state: 'success', buttonText: '重新点评', disabled: false, message: '' };
  }
  return { state: 'idle', buttonText: '再听小搭说说', disabled: false, message: '' };
}

module.exports = {
  FAILED_WITHOUT_PREVIOUS,
  FAILED_WITH_PREVIOUS,
  getAiReviewPageState,
};
