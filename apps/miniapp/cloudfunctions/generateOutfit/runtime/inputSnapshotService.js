'use strict';

const { CANDIDATE_POOL_ENGINE_VERSION } = require('../services/buildVersions');
const {
  buildCandidatePoolIdentity,
} = require('../services/candidatePool');
const { loadActiveWardrobe } = require('../services/loadActiveWardrobe');
const { isRecommendationQaAuditEnabled } = require('../services/qaAuditControl');
const {
  normalizeRecommendationWeather,
  toWeatherSnapshot,
} = require('../services/recommendationWeatherMode');
const { normalizeScene } = require('../services/sceneEligibilityV3');
const { normalizeRequestedBatchSize } = require('../shared/countContract');

const SCENE_LABELS = Object.freeze({ home: '居家', work: '上班', date: '约会', sport: '运动' });

async function loadRecommendationInputSnapshot(event = {}, {
  database,
  openid,
  qaAuditEnabled = process.env.RECOMMENDATION_QA_AUDIT_ENABLED,
} = {}) {
  if (!database?.collection || !readString(openid)) throw new Error('RECOMMENDATION_INPUT_SNAPSHOT_ADAPTER_REQUIRED');
  const inputScene = readString(event.scene);
  const normalizedScene = normalizeScene(inputScene || 'home');
  const sceneKey = Object.hasOwn(SCENE_LABELS, normalizedScene) ? normalizedScene : 'home';
  const sceneContract = { sceneKey, scene: SCENE_LABELS[sceneKey] };
  const now = new Date().toISOString();
  let wardrobeReadCount = 0;
  const dataLoadStartedAt = Date.now();
  const [clothes, userRes] = await Promise.all([
    loadActiveWardrobe({
      database,
      openid,
      onRead: () => { wardrobeReadCount += 1; },
    }),
    database.collection('users').where({ _openid: openid }).limit(1).get(),
  ]);
  const dataLoadMs = Date.now() - dataLoadStartedAt;
  const recommendationProfile = normalizeRecommendationProfile(userRes.data?.[0]?.styleProfile);
  const excludeClothingIdSets = Array.isArray(event.excludeClothingIdSets) ? event.excludeClothingIdSets : [];
  const excludedOutfitKeys = readStringArray(event.excludedOutfitKeys);
  const requestedCandidatePoolId = readString(event.recommendationBatchId);
  const requestTrigger = readString(event.trigger);
  const isRefreshRequest = requestTrigger === 'refresh'
    || excludedOutfitKeys.length > 0
    || excludeClothingIdSets.length > 0
    || Boolean(requestedCandidatePoolId);
  const weather = normalizeRecommendationWeather(event.weather, event.weatherMode);
  const identityStartedAt = Date.now();
  const candidatePoolIdentity = buildCandidatePoolIdentity({
    openid,
    clothes,
    sceneKey,
    weather,
    weatherMode: weather.mode,
    recommendationProfile,
    timeOfDay: event.timeOfDay || 'all_day',
    engineVersion: CANDIDATE_POOL_ENGINE_VERSION,
  });
  return {
    event,
    openid,
    inputScene,
    scene: inputScene || undefined,
    sceneContract,
    targetDate: event.date || now.slice(0, 10),
    now,
    requestedCount: normalizeRequestedBatchSize(event.maxResults || 8),
    requestedCandidatePoolId,
    clothes,
    recommendationProfile,
    excludeClothingIdSets,
    excludedOutfitKeys,
    requestTrigger,
    isRefreshRequest,
    weather,
    weatherMode: weather.mode,
    weatherSnapshot: toWeatherSnapshot(weather),
    debugRecommendationAudit: isRecommendationQaAuditEnabled(event.debugRecommendationAudit, qaAuditEnabled),
    candidatePoolIdentity,
    metrics: {
      dataLoadMs,
      identityMs: Date.now() - identityStartedAt,
      wardrobeReadCount,
      databaseReadCount: wardrobeReadCount + 1,
    },
  };
}

function normalizeRecommendationProfile(styleProfile) {
  const profile = styleProfile || {};
  const recommendationProfile = profile.recommendationProfile || {};
  return {
    genderPreference: readEnum(recommendationProfile.genderPreference, ['male_style', 'female_style', 'neutral_style', 'all', 'unknown'], 'unknown'),
    styleTags: Array.isArray(recommendationProfile.styleTags)
      ? recommendationProfile.styleTags
      : Array.isArray(profile.preferredStyles) ? profile.preferredStyles : [],
    fitPreference: readEnum(recommendationProfile.fitPreference, ['loose', 'regular', 'slim', 'oversize', 'unknown'], 'unknown'),
    colorPreference: Array.isArray(recommendationProfile.colorPreference) ? recommendationProfile.colorPreference : [],
    avoidTags: Array.isArray(recommendationProfile.avoidTags) ? recommendationProfile.avoidTags : [],
    temperatureSensitivity: readEnum(recommendationProfile.temperatureSensitivity, ['cold_sensitive', 'normal', 'heat_sensitive'], 'normal'),
  };
}

function readEnum(value, allowed, fallback) {
  const normalized = readString(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

function readStringArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(readString).filter(Boolean))] : [];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = { loadRecommendationInputSnapshot, normalizeRecommendationProfile };
