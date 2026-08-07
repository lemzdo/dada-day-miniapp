const TODAY_SCENE_COPY_VERSION = 'recommendation-copy-contract-v3';
const TODAY_SCENE_VOICE_VERSION = 'xiaoda-fixed-claim-catalog-v2';
const TODAY_SCENE_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const { hasCurrentCopyContract } = require('../../utils/recommendationCopyContract');
const { validateRecommendationCountContract } = require('./sceneResponseValidation');

function buildSceneSnapshotKey({
  userRuntimeKey = '',
  date = '',
  timeOfDay = '',
  scene = '',
  weatherFingerprint = '',
  wardrobeVersion = '',
  profileVersion = '',
  reasonVersion = '',
  copyVersion = TODAY_SCENE_COPY_VERSION,
} = {}) {
  return [
    userRuntimeKey,
    date,
    timeOfDay,
    scene,
    weatherFingerprint,
    wardrobeVersion,
    profileVersion,
    reasonVersion,
    copyVersion,
  ].map(normalizeSceneSnapshotKeyPart).join('|');
}

function normalizeSceneSnapshotKeyPart(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  return String(value);
}

function shouldUseSceneSnapshot(snapshot, expected) {
  if (!snapshot || !expected) return false;
  if (!snapshot.key || snapshot.key !== expected.key) return false;
  if (!Array.isArray(snapshot.outfits)) return false;
  const now = Number(expected.now ?? Date.now());
  const ttlMs = Math.min(
    Math.max(Number(expected.ttlMs) || TODAY_SCENE_SNAPSHOT_TTL_MS, 1),
    TODAY_SCENE_SNAPSHOT_TTL_MS,
  );
  if (!Number.isFinite(snapshot.generatedAt) || snapshot.generatedAt <= 0) return false;
  if (!Number.isFinite(now) || now - snapshot.generatedAt > ttlMs || snapshot.generatedAt - now > 1000) return false;
  if (!isValidSceneSnapshotCountState(snapshot)) return false;
  if (!snapshot.outfits.every(hasCurrentCopyContract)) return false;
  return true;
}

function chooseSceneTransitionState({ currentOutfits = [], snapshot = null, nextSceneKey = '' } = {}) {
  if (snapshot && Array.isArray(snapshot.outfits)) {
    return {
      selectedSceneKey: nextSceneKey,
      outfits: snapshot.outfits,
      currentIndex: clampIndex(snapshot.currentIndex || 0, snapshot.outfits.length),
      hasRecommendations: snapshot.hasRecommendations !== false,
      keepPreviousWhileLoading: false,
      recommendationBatchId: snapshot.recommendationBatchId || '',
      batchLimited: Boolean(snapshot.batchLimited),
      batchExhausted: Boolean(snapshot.batchExhausted),
      noMoreRecommendations: snapshot.noMoreRecommendations === true,
      countContract: snapshot.countContract || null,
      lastVisibleBatch: snapshot.lastVisibleBatch || null,
      recommendationNotice: snapshot.recommendationNotice || '',
    };
  }
  return {
    selectedSceneKey: nextSceneKey,
    outfits: [],
    currentIndex: 0,
    hasRecommendations: true,
    keepPreviousWhileLoading: false,
    recommendationBatchId: '',
    batchLimited: false,
    batchExhausted: false,
    noMoreRecommendations: false,
    countContract: null,
    lastVisibleBatch: null,
    recommendationNotice: '',
  };
}

function buildExhaustedSnapshotState({
  outfits = [],
  currentIndex = 0,
  recommendationBatchId = '',
  countContract = null,
  recommendationNotice = '',
} = {}) {
  if (!isTerminalExhaustionCountContract(countContract)) return null;
  const visibleOutfits = Array.isArray(outfits) ? outfits : [];
  const outfitKeys = visibleOutfits.map((outfit) => String(outfit?.outfitKey || outfit?.id || '')).filter(Boolean);
  return {
    outfits: visibleOutfits,
    currentIndex: clampIndex(currentIndex, visibleOutfits.length),
    hasRecommendations: visibleOutfits.length > 0,
    recommendationBatchId,
    batchLimited: true,
    batchExhausted: true,
    noMoreRecommendations: true,
    countContract,
    lastVisibleBatch: visibleOutfits.length > 0 ? {
      recommendationBatchId,
      outfitKeys,
      returnedCardCount: visibleOutfits.length,
    } : null,
    recommendationNotice,
  };
}

function isValidSceneSnapshotCountState(snapshot) {
  if (isRetainedExhaustedSnapshot(snapshot)) return true;
  if (!validateRecommendationCountContract(snapshot).ok) return false;
  return snapshot.outfits.length > 0 || isTerminalEmptySnapshot(snapshot);
}

function isRetainedExhaustedSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.outfits) || snapshot.outfits.length === 0) return false;
  if (snapshot.hasRecommendations === false || snapshot.batchExhausted !== true) return false;
  if (snapshot.noMoreRecommendations !== true || !isTerminalExhaustionCountContract(snapshot.countContract)) return false;
  const identity = snapshot.lastVisibleBatch;
  if (!identity || typeof identity !== 'object') return false;
  const outfitKeys = snapshot.outfits.map((outfit) => String(outfit?.outfitKey || outfit?.id || '')).filter(Boolean);
  return identity.recommendationBatchId === (snapshot.recommendationBatchId || '')
    && identity.returnedCardCount === snapshot.outfits.length
    && Array.isArray(identity.outfitKeys)
    && outfitKeys.length === snapshot.outfits.length
    && identity.outfitKeys.length === outfitKeys.length
    && identity.outfitKeys.every((key, index) => key === outfitKeys[index]);
}

function isTerminalExhaustionCountContract(countContract) {
  return validateRecommendationCountContract({ outfits: [], countContract }).ok
    && countContract.returnedCardCount === 0
    && countContract.expectedCardCount === 0
    && countContract.poolExhaustedAfterConsume === true;
}

function isNoMoreRecommendationState(value) {
  return value?.batchExhausted === true
    && isTerminalExhaustionCountContract(value?.countContract);
}

function isTerminalEmptySnapshot(snapshot) {
  return snapshot.hasRecommendations === false
    && snapshot.batchExhausted === true
    && Number(snapshot.countContract?.returnedCardCount) === 0
    && Number(snapshot.countContract?.expectedCardCount) === 0;
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Number(index) || 0, length - 1));
}

module.exports = {
  TODAY_SCENE_COPY_VERSION,
  TODAY_SCENE_SNAPSHOT_TTL_MS,
  TODAY_SCENE_VOICE_VERSION,
  buildExhaustedSnapshotState,
  buildSceneSnapshotKey,
  chooseSceneTransitionState,
  isNoMoreRecommendationState,
  isValidSceneSnapshotCountState,
  shouldUseSceneSnapshot,
};
