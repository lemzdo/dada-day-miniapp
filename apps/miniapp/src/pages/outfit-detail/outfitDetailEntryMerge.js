const COPY_CONTRACT_VERSION = 'recommendation-copy-contract-v7';

const REMOTE_AUTHORITY_FIELDS = Object.freeze([
  'id',
  'outfitId',
  'outfitKey',
  'createdAt',
  'updatedAt',
  'isFavorite',
  'favoriteOutfitId',
  'favoritedAt',
  'isWornToday',
  'todayHistoryId',
  'historyId',
  'wornAt',
  'wornDate',
  'userTitle',
  'aiComment',
  'aiReviewStatus',
  'reviewSource',
  'enhanced',
]);

function mergeRecommendationEntryDraft(remote, entryDraft) {
  if (!isObject(remote) || !isCurrentEntryDraft(entryDraft) || !sameOutfit(remote, entryDraft)) return remote;
  const merged = { ...remote, ...entryDraft };
  for (const field of REMOTE_AUTHORITY_FIELDS) {
    if (remote[field] !== undefined) merged[field] = remote[field];
  }
  return merged;
}

function isCurrentEntryDraft(value) {
  return isObject(value)
    && value.copyContractVersion === COPY_CONTRACT_VERSION
    && isObject(value.copyContract)
    && value.copyContract.copyContractVersion === COPY_CONTRACT_VERSION
    && typeof value.copyContract.todayReason === 'string'
    && value.copyContract.todayReason.trim().length > 0;
}

function sameOutfit(remote, entryDraft) {
  if (remote.outfitKey && entryDraft.outfitKey && remote.outfitKey !== entryDraft.outfitKey) return false;
  const remoteIds = new Set([remote.id, remote.outfitId].filter(Boolean));
  const entryIds = [entryDraft.id, entryDraft.outfitId].filter(Boolean);
  return remoteIds.size === 0 || entryIds.length === 0 || entryIds.some((id) => remoteIds.has(id));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  mergeRecommendationEntryDraft,
};
