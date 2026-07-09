const TODAY_SCENE_COPY_VERSION = 'today-scene-copy-v1';

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
  ].map((value) => String(value || '')).join('|');
}

function shouldUseSceneSnapshot(snapshot, expected) {
  if (!snapshot || !expected) return false;
  if (!snapshot.key || snapshot.key !== expected.key) return false;
  if (!Array.isArray(snapshot.outfits) || snapshot.outfits.length === 0) return false;
  return true;
}

function chooseSceneTransitionState({ currentOutfits = [], snapshot = null, nextSceneKey = '' } = {}) {
  if (snapshot && Array.isArray(snapshot.outfits) && snapshot.outfits.length > 0) {
    return {
      selectedSceneKey: nextSceneKey,
      outfits: snapshot.outfits,
      currentIndex: clampIndex(snapshot.currentIndex || 0, snapshot.outfits.length),
      hasRecommendations: snapshot.hasRecommendations !== false,
      keepPreviousWhileLoading: false,
      recommendationBatchId: snapshot.recommendationBatchId || '',
      batchLimited: Boolean(snapshot.batchLimited),
      batchExhausted: Boolean(snapshot.batchExhausted),
      recommendationNotice: snapshot.recommendationNotice || '',
    };
  }
  return {
    selectedSceneKey: nextSceneKey,
    outfits: currentOutfits,
    currentIndex: 0,
    hasRecommendations: currentOutfits.length > 0,
    keepPreviousWhileLoading: currentOutfits.length > 0,
    recommendationBatchId: '',
    batchLimited: false,
    batchExhausted: false,
    recommendationNotice: '',
  };
}

function clampIndex(index, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(Number(index) || 0, length - 1));
}

module.exports = {
  TODAY_SCENE_COPY_VERSION,
  buildSceneSnapshotKey,
  chooseSceneTransitionState,
  shouldUseSceneSnapshot,
};
