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
    loading: '让我再想想……',
    inProgress: '让我再想想……',
    cooldown: '刚刚没接上话，再试一次吧。',
    providerUnavailable: '刚刚没接上话，再试一次吧。',
    incompleteOutfit: '刚刚没接上话，再试一次吧。',
    serviceNotReady: '刚刚没接上话，再试一次吧。',
    storageUnavailable: '刚刚没接上话，再试一次吧。',
    genericRetry: '刚刚没接上话，再试一次吧。',
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
