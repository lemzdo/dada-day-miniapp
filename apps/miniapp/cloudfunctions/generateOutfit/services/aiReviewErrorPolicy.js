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

const AI_REVIEW_SAFE_MESSAGES = {
  AI_REVIEW_INCOMPLETE_INPUT: '这套的信息还不够完整，回到推荐页重新打开后再试试。',
  AI_REVIEW_PROVIDER_NOT_CONFIGURED: '点评服务还没准备好，稍后再试试。',
  AI_REVIEW_PROVIDER_UNAVAILABLE: '小搭这会儿没连上点评服务，稍后再试试。',
  AI_REVIEW_STORAGE_UNAVAILABLE: '这次点评没保存下来，稍后再试试。',
  AI_REVIEW_TRANSACTION_UNAVAILABLE: '这次点评没保存下来，稍后再试试。',
  AI_REVIEW_IN_PROGRESS: '小搭正在点评这套，再等一会儿。',
  AI_REVIEW_COOLDOWN: '刚刚已经点评过啦，过几秒再试试。',
  AI_REVIEW_UNKNOWN: '小搭这会儿没能完成点评，稍后再试试。',
};

function createAiReviewServiceError(code, cause) {
  const error = new Error(getSafeAiReviewMessage(code));
  error.aiReviewCode = AI_REVIEW_SAFE_MESSAGES[code] ? code : 'AI_REVIEW_UNKNOWN';
  if (cause) error.cause = cause;
  return error;
}

function isAiReviewServiceError(error) {
  return Boolean(error && typeof error.aiReviewCode === 'string');
}

function getAiReviewInternalErrorCode(error) {
  return isAiReviewServiceError(error) ? error.aiReviewCode : 'AI_REVIEW_REQUEST_FAILED';
}

function mapAiReviewErrorCode(error) {
  const code = getAiReviewInternalErrorCode(error);
  if (AI_REVIEW_SAFE_MESSAGES[code]) return code;
  const message = String(error?.message || '');
  if (/identity|required|scene|outfit|invalid_outfit_key/i.test(message)) return 'AI_REVIEW_INCOMPLETE_INPUT';
  if (/BAILIAN|DASHSCOPE|unsupported_ai_comment_provider/i.test(message)) return 'AI_REVIEW_PROVIDER_NOT_CONFIGURED';
  if (/fetch|timeout|api_error|network|503|502|500/i.test(message)) return 'AI_REVIEW_PROVIDER_UNAVAILABLE';
  return 'AI_REVIEW_UNKNOWN';
}

function getSafeAiReviewMessage(code) {
  return AI_REVIEW_SAFE_MESSAGES[code] || AI_REVIEW_SAFE_MESSAGES.AI_REVIEW_UNKNOWN;
}

function toSafeAiReviewErrorData(error) {
  const errorCode = mapAiReviewErrorCode(error);
  return {
    errorCode,
    message: getSafeAiReviewMessage(errorCode),
  };
}

module.exports = {
  AI_REVIEW_ERROR_CODES,
  AI_REVIEW_SAFE_MESSAGES,
  createAiReviewServiceError,
  getAiReviewInternalErrorCode,
  getSafeAiReviewMessage,
  isAiReviewServiceError,
  mapAiReviewErrorCode,
  toSafeAiReviewErrorData,
};
