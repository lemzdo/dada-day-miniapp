const { selectBatchEligibilityReasons } = require('./batchEligibilityReasonSelection');
const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
const { collectEligibilityReasonCandidates } = require('./recommendationEligibilityReason');
const { REPLAY_SCENES, buildRealSchemaReplay } = require('./recommendationCopyRealSchemaReplay.fixture');

function buildRecommendationReasonQaSnapshot() {
  return Object.fromEntries(REPLAY_SCENES.map((scene) => [scene, buildSceneSnapshot(scene)]));
}

function buildSceneSnapshot(scene) {
  const replay = buildRealSchemaReplay(scene);
  const weatherMode = 'live';
  const weather = { ...replay.weather, mode: weatherMode, weatherMode };
  const candidatesByOutfit = replay.candidates.map((candidate) => {
    const selectedIds = candidate.selectedOutfitItemIds;
    const items = replay.rawWardrobe.filter((item) => selectedIds.includes(item._id));
    const reasonCandidates = collectEligibilityReasonCandidates({
      scene,
      weather,
      visibleFacts: adaptLegacyVisibleFacts(items),
      sceneResult: candidate.sceneEligibility,
    }).filter((reason) => reason.subjectItemIds.every((id) => selectedIds.includes(id)));
    return {
      outfitKey: selectedIds.slice().sort().join('|'),
      candidate,
      items,
      reasonCandidates,
    };
  });
  const selections = selectBatchEligibilityReasons(candidatesByOutfit);
  return {
    fixtureKind: replay.fixtureKind,
    fixtureOrigin: replay.fixtureOrigin,
    weatherMode,
    outfits: candidatesByOutfit.map((entry, index) => {
      const selection = selections[index];
      const selected = selection.selectedReason;
      return {
        outfitKey: entry.outfitKey,
        itemSummary: entry.items.map((item) => item.subcategory).join(' + '),
        weatherMode,
        reasonCandidates: entry.reasonCandidates.map((reason) => ({
          code: reason.code,
          family: reason.family,
          qualityTier: reason.qualityTier,
          text: reason.text,
        })),
        selectedReason: { code: selected.code, text: selected.text, qualityTier: selected.qualityTier },
        enhancedReason: entry.candidate.todayReason !== selected.text ? entry.candidate.todayReason : '',
        todayReason: entry.candidate.todayReason,
        selectionBasis: selection.selectionDebug.selectionBasis,
        sameQualityAlternativeCodes: selection.selectionDebug.sameQualityAlternativeCodes,
        batchRepeatCount: selection.selectionDebug.batchRepeatCount,
      };
    }),
  };
}

module.exports = {
  buildRecommendationReasonQaSnapshot,
};
