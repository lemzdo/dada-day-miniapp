'use strict';

const V2_VERSION = 'recommendation-v2';
const V2_CARD_COUNT = 8;

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function projectHomeLightItemV2(item = {}) {
  const projected = {
    clothingId: stringValue(item.clothingId || item.id),
    thumbnailUrl: stringValue(item.thumbnailUrl || item.displayImageUrl || item.imageUrl),
    isDeleted: item.isDeleted === true,
  };
  const imageUrl = stringValue(item.imageUrl);
  if (imageUrl) projected.imageUrl = imageUrl;
  return projected;
}

function projectHomeLightCardV2(outfit = {}, position = 0) {
  const items = Array.isArray(outfit.items) ? outfit.items.map(projectHomeLightItemV2) : [];
  const clothingIds = Array.isArray(outfit.clothingIds)
    ? outfit.clothingIds.map(stringValue).filter(Boolean)
    : items.map((item) => item.clothingId).filter(Boolean);
  return {
    referenceId: stringValue(outfit.referenceId || outfit.id || outfit._id),
    outfitKey: stringValue(outfit.outfitKey),
    position,
    displayTitle: stringValue(outfit.displayTitle || outfit.title),
    todayReason: stringValue(outfit.todayReason || outfit.reason),
    styleTags: Array.isArray(outfit.styleTags) ? outfit.styleTags.map(stringValue).filter(Boolean).slice(0, 3) : [],
    clothingIds,
    items,
    isFavorite: outfit.isFavorite === true,
    isWornToday: outfit.isWornToday === true,
  };
}

function projectHomeLightV2(outfits = [], batchId = '') {
  if (!Array.isArray(outfits) || outfits.length !== V2_CARD_COUNT) throw new Error('V2_HOME_LIGHT_REQUIRES_EIGHT_CARDS');
  if (!stringValue(batchId)) throw new Error('V2_HOME_LIGHT_BATCH_ID_REQUIRED');
  return {
    version: V2_VERSION,
    batchId,
    cards: outfits.map((outfit, index) => projectHomeLightCardV2(outfit, index)),
  };
}

function projectBatchCoreV2(input = {}) {
  const order = Array.isArray(input.order) ? input.order.map(stringValue).filter(Boolean) : [];
  if (order.length !== V2_CARD_COUNT) throw new Error('V2_BATCH_CORE_REQUIRES_EIGHT_ORDER_KEYS');
  return {
    version: V2_VERSION,
    batchId: stringValue(input.batchId),
    commitToken: stringValue(input.commitToken),
    contentHash: stringValue(input.contentHash),
    scene: stringValue(input.scene),
    date: stringValue(input.date),
    timeOfDay: stringValue(input.timeOfDay || 'all_day'),
    weather: input.weather && typeof input.weather === 'object' ? { ...input.weather } : {},
    inputIdentityHash: stringValue(input.inputIdentityHash),
    generatedAt: stringValue(input.generatedAt),
    countContract: { expected: 8, actual: 8 },
    ...(stringValue(input.notice) ? { notice: stringValue(input.notice) } : {}),
    cardCount: 8,
    order,
  };
}

module.exports = { V2_VERSION, V2_CARD_COUNT, projectHomeLightItemV2, projectHomeLightCardV2, projectHomeLightV2, projectBatchCoreV2 };
