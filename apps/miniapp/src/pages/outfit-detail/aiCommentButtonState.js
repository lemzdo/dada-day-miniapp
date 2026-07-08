function getAiCommentButtonBlockReason({ outfit, authContext, commentLoading } = {}) {
  if (!outfit) {
    return { state: 'unavailable', debugReason: 'missing_outfit', toast: '这套搭配还没加载好' };
  }
  if (!authContext) {
    return { state: 'unavailable', debugReason: 'missing_auth_context', toast: '登录状态过期，请重新进入页面' };
  }
  if (commentLoading) {
    return { state: 'loading', debugReason: 'request_in_flight', toast: '小搭正在想这套搭配' };
  }
  if (!hasOutfitIdentity(outfit)) {
    return { state: 'unavailable', debugReason: 'missing_outfit_identity', toast: '这套搭配信息不完整' };
  }
  return null;
}

function getAiCommentButtonState({
  commentLoading = false,
  fallbackFailed = false,
  cooldown = false,
  unavailable = false,
  hasCanonical = false,
} = {}) {
  if (commentLoading) return { state: 'loading', disabled: true, debugReason: 'request_in_flight' };
  if (unavailable) return { state: 'unavailable', disabled: true, debugReason: 'unavailable' };
  if (cooldown) return { state: 'cooldown', disabled: false, debugReason: 'cooldown' };
  if (fallbackFailed) return { state: 'failed', disabled: false, debugReason: 'last_attempt_failed' };
  if (hasCanonical) return { state: 'success', disabled: false, debugReason: 'has_canonical_review' };
  return { state: 'idle', disabled: false, debugReason: 'ready' };
}

function hasOutfitIdentity(outfit) {
  return Boolean(
    outfit
      && (outfit.outfitKey || outfit.id || outfit.outfitId)
      && Array.isArray(outfit.clothingIds)
      && outfit.clothingIds.length > 0,
  );
}

module.exports = {
  getAiCommentButtonBlockReason,
  getAiCommentButtonState,
};
