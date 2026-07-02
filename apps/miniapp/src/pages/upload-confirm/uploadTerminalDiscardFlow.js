const WARDROBE_DISCARD_NOTICE = '本次识别已舍弃';
const WARDROBE_NOTICE_STORAGE_KEY = 'pendingWardrobeNotice';
const TERMINAL_DISCARD_FALLBACK_NOTICE = '已舍弃本次识别，请返回衣橱查看。';
const WARDROBE_TAB_URL = '/pages/wardrobe/index';
const TERMINAL_UPLOAD_BATCH_STATUSES = new Set(['saved', 'discarded', 'deleted', 'expired']);

function shouldEnterTerminalDiscardLeaving(result, batchId) {
  return Boolean(result && result.batchTerminal && batchId);
}

function normalizeTerminalDiscardStatus(status) {
  return TERMINAL_UPLOAD_BATCH_STATUSES.has(status) ? status : 'discarded';
}

function setPendingWardrobeNotice({
  authContext,
  notice = WARDROBE_DISCARD_NOTICE,
  setUserStorageSync,
} = {}) {
  if (typeof setUserStorageSync !== 'function') return;
  setUserStorageSync(WARDROBE_NOTICE_STORAGE_KEY, notice, { authContext });
}

function consumePendingWardrobeNotice({
  authContext,
  getUserStorageSync,
  removeUserStorageSync,
} = {}) {
  if (typeof getUserStorageSync !== 'function' || typeof removeUserStorageSync !== 'function') return '';
  const notice = getUserStorageSync(WARDROBE_NOTICE_STORAGE_KEY, { authContext });
  if (!notice) return '';
  removeUserStorageSync(WARDROBE_NOTICE_STORAGE_KEY, { authContext });
  return String(notice);
}

module.exports = {
  TERMINAL_DISCARD_FALLBACK_NOTICE,
  WARDROBE_DISCARD_NOTICE,
  WARDROBE_NOTICE_STORAGE_KEY,
  WARDROBE_TAB_URL,
  consumePendingWardrobeNotice,
  normalizeTerminalDiscardStatus,
  setPendingWardrobeNotice,
  shouldEnterTerminalDiscardLeaving,
};
