const PRODUCT_STATE_COPY = Object.freeze({
  loading: '小搭正在看天气和衣橱信息，稍等一下。',
  empty: '衣橱里还没有可以搭配的衣物，先添加几件常穿的吧。',
  exhausted: '这一轮可用方案已经看完，换个场景再试也可以。',
  stale_waiting: '衣橱信息有变化，新建议还在准备，请稍等一下。',
  retry: '刚才没有加载成功，可以稍后再试一次。',
  error_neutral: '这次暂时没拿到结果，已为你保留当前页面。',
  refreshing: '衣橱信息有更新，小搭正在重新整理建议。',
});

const LIMITED_REASON_COPY = Object.freeze({});

function getProductStateCopy(state) {
  return typeof state === 'string' && Object.hasOwn(PRODUCT_STATE_COPY, state)
    ? PRODUCT_STATE_COPY[state]
    : '';
}

module.exports = {
  PRODUCT_STATE_COPY,
  LIMITED_REASON_COPY,
  getProductStateCopy,
};
