'use strict';

function buildRecommendationInputIdentity({
  userRuntimeKey = '',
  sceneKey = '',
  date = '',
  timeOfDay = '',
  weatherFingerprint = '',
  wardrobeVersion = '',
  profileVersion = '',
  recommendationBatchId = '',
  excludedOutfitKeys = [],
  requestKind = 'initial',
} = {}) {
  return [
    userRuntimeKey,
    sceneKey,
    date,
    timeOfDay,
    weatherFingerprint,
    wardrobeVersion,
    profileVersion,
    recommendationBatchId,
    uniqueStrings(excludedOutfitKeys).sort().join(','),
    requestKind,
  ].map(encodePart).join('|');
}

function encodePart(value) {
  return encodeURIComponent(String(value || ''));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
}

module.exports = { buildRecommendationInputIdentity };
