'use strict';

const V2_VERSION = 'recommendation-v2';
const V2_CARD_COUNT = 8;
const RUNTIME_VERSION = 'today-runtime-v2';
const SCHEMA_VERSION = 'today-v2';

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function projectHomeLightItemV2(item = {}) {
  if (item.isDeleted === true) throw new Error('V2_HOME_LIGHT_DELETED_ITEM');
  const clothingId = stringValue(item.clothingId || item.id);
  const displayImageUrl = stringValue(item.displayImageUrl);
  if (!clothingId) throw new Error('V2_HOME_LIGHT_CLOTHING_ID_REQUIRED');
  if (!displayImageUrl) throw new Error('V2_HOME_LIGHT_IMAGE_REQUIRED');
  return { clothingId, displayImageUrl, isDeleted: false };
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

function projectWeatherSnapshot(weather = {}) {
  return {
    temp: Number(weather.temp) || 0,
    humidity: Number(weather.humidity) || 0,
    weather: stringValue(weather.weather),
    wind: Number(weather.wind) || 0,
    uv: Number(weather.uv) || 0,
  };
}

function projectHomeLightV2(outfits = [], batchId = '') {
  if (!Array.isArray(outfits) || outfits.length !== V2_CARD_COUNT) throw new Error('V2_HOME_LIGHT_REQUIRES_EIGHT_CARDS');
  if (!stringValue(batchId)) throw new Error('V2_HOME_LIGHT_BATCH_ID_REQUIRED');
  return {
    runtimeVersion: RUNTIME_VERSION,
    schemaVersion: SCHEMA_VERSION,
    batchId,
    cards: outfits.map((outfit, index) => projectHomeLightCardV2(outfit, index)),
  };
}

function projectBatchCoreV2(input = {}) {
  const order = Array.isArray(input.order) ? input.order.map(stringValue).filter(Boolean) : [];
  if (order.length !== V2_CARD_COUNT) throw new Error('V2_BATCH_CORE_REQUIRES_EIGHT_ORDER_KEYS');
  const countContract = {
    requestedCardCount: Number(input.countContract?.requestedCardCount),
    returnedCardCount: Number(input.countContract?.returnedCardCount),
    limited: input.countContract?.limited === true,
    exhausted: input.countContract?.exhausted === true,
  };
  if (countContract.requestedCardCount !== 8 || countContract.returnedCardCount !== 8) throw new Error('V2_BATCH_CORE_COUNT_INVALID');
  return {
    runtimeVersion: RUNTIME_VERSION,
    schemaVersion: SCHEMA_VERSION,
    batchId: stringValue(input.batchId),
    commitToken: stringValue(input.commitToken),
    contentHash: stringValue(input.contentHash),
    sceneKey: stringValue(input.sceneKey),
    scene: stringValue(input.scene),
    targetDate: stringValue(input.targetDate || input.date),
    timeOfDay: stringValue(input.timeOfDay || 'all_day'),
    weatherMode: stringValue(input.weatherMode),
    weatherSnapshot: projectWeatherSnapshot(input.weatherSnapshot || input.weather),
    weatherFingerprint: stringValue(input.weatherFingerprint),
    inputIdentityHash: stringValue(input.inputIdentityHash),
    generatedAt: stringValue(input.generatedAt),
    countContract,
    ...(stringValue(input.notice) ? { notice: stringValue(input.notice) } : {}),
    cardCount: 8,
    order,
  };
}

module.exports = { V2_VERSION, RUNTIME_VERSION, SCHEMA_VERSION, V2_CARD_COUNT, projectHomeLightItemV2, projectHomeLightCardV2, projectHomeLightV2, projectWeatherSnapshot, projectBatchCoreV2 };
