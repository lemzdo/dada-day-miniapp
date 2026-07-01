const AI_REVIEW_ERROR_CODES = [
  'AI_REVIEW_INCOMPLETE_INPUT',
  'AI_REVIEW_PROVIDER_NOT_CONFIGURED',
  'AI_REVIEW_PROVIDER_UNAVAILABLE',
  'AI_REVIEW_STORAGE_UNAVAILABLE',
  'AI_REVIEW_TRANSACTION_UNAVAILABLE',
  'AI_REVIEW_IN_PROGRESS',
  'AI_REVIEW_COOLDOWN',
  'AI_REVIEW_UNKNOWN',
];

const USER_FACING_COPY = {
  recommendation: {
    loading: '小搭正在看看今天怎么穿更合适……',
    empty: '今天还没找到特别合适的一套，再换个场景试试。',
  },
  aiReview: {
    loading: '小搭正在看看这套哪里最出彩……',
    inProgress: '小搭正在点评这套，再等一会儿。',
    cooldown: '刚刚已经点评过啦，过几秒再试试。',
    providerUnavailable: '小搭这会儿没连上点评服务，稍后再试试。',
    incompleteOutfit: '这套的信息还不够完整，回到推荐页重新打开后再试试。',
    serviceNotReady: '点评服务还没准备好，稍后再试试。',
    storageUnavailable: '这次点评没保存下来，稍后再试试。',
    genericRetry: '小搭这会儿没能完成点评，稍后再试试。',
  },
};

const AI_REVIEW_ERROR_COPY = {
  AI_REVIEW_INCOMPLETE_INPUT: USER_FACING_COPY.aiReview.incompleteOutfit,
  AI_REVIEW_PROVIDER_NOT_CONFIGURED: USER_FACING_COPY.aiReview.serviceNotReady,
  AI_REVIEW_PROVIDER_UNAVAILABLE: USER_FACING_COPY.aiReview.providerUnavailable,
  AI_REVIEW_STORAGE_UNAVAILABLE: USER_FACING_COPY.aiReview.storageUnavailable,
  AI_REVIEW_TRANSACTION_UNAVAILABLE: USER_FACING_COPY.aiReview.storageUnavailable,
  AI_REVIEW_IN_PROGRESS: USER_FACING_COPY.aiReview.inProgress,
  AI_REVIEW_COOLDOWN: USER_FACING_COPY.aiReview.cooldown,
  AI_REVIEW_UNKNOWN: USER_FACING_COPY.aiReview.genericRetry,
};

function getAiReviewErrorCopy(code) {
  return AI_REVIEW_ERROR_COPY[code] || USER_FACING_COPY.aiReview.genericRetry;
}

module.exports = {
  AI_REVIEW_ERROR_CODES,
  AI_REVIEW_ERROR_COPY,
  USER_FACING_COPY,
  getAiReviewErrorCopy,
};
