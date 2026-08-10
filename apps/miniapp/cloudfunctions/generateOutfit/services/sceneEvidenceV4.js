const { deriveSceneEligibilityFacts, uniqueStrings } = require('./itemWearabilityFacts');
const { evaluateWeatherWearability } = require('./wearabilityGuard');
const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
const { hydrateCanonicalEligibility } = require('./canonicalCandidate');
const {
  cloneEligibilityReason,
  collectEligibilityReasonCandidates,
  resolveEligibilityReason,
} = require('./recommendationEligibilityReason');
const {
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_VERSION,
  evaluateOptionalItemPolicy,
  evaluateRegistry,
  scoreEvidence,
} = require('./sceneEvidenceRegistryV4');

const ELIGIBILITY_REASON_CANDIDATES = Symbol('eligibilityReasonCandidates');

function evaluateSceneEvidenceV4({
  scene,
  items = [],
  weather = {},
  visibleFacts,
  derivedFacts,
  itemFactsContext,
  recommendationProfile = {},
  instrumentation,
} = {}) {
  recordMetric(instrumentation, 'evaluateSceneEvidenceV4');
  recordMetric(instrumentation, 'evaluateSceneEligibilityV3');
  const normalizedScene = normalizeScene(scene);
  const candidateVisibleFacts = visibleFacts
    || derivedFacts?.visibleFactsView
    || buildCandidateVisibleFacts(items, itemFactsContext, instrumentation);
  const itemFacts = Array.isArray(derivedFacts?.sceneFacts)
    ? derivedFacts.sceneFacts
    : itemFactsContext
      ? items.map((item) => itemFactsContext.resolveItemFacts(item).sceneEligibilityItemFacts)
      : items.map((item) => deriveSceneEligibilityFacts(
        item,
        candidateVisibleFacts.items.find((entry) => entry.id === itemId(item)),
        { instrumentation },
      ));
  const colorRelations = deriveColorRelations(itemFacts);
  const sceneEvidence = evaluateRegistry({
    scene: normalizedScene,
    facts: itemFacts,
    preferredStyles: recommendationProfile.preferredStyles || recommendationProfile.styleTags || [],
    colorRelations,
    weather,
  });
  const hardConflicts = sceneEvidence.filter((entry) => entry.hardConflict);
  const score = scoreEvidence(sceneEvidence);
  const negativeEvidence = sceneEvidence.filter((entry) => entry.severity === 'NEGATIVE_SIGNAL');
  const positiveEvidence = sceneEvidence.filter((entry) => entry.rankingContribution > 0);
  const baseResult = {
    eligible: hardConflicts.length === 0,
    hardRejected: hardConflicts.length > 0,
    canEnterScene: hardConflicts.length === 0,
    penalty: round2(Math.abs(negativeEvidence.reduce((sum, entry) => sum + Number(entry.rankingContribution || 0), 0))),
    acceptReasons: positiveEvidence.map((entry) => entry.id),
    rejectReasons: hardConflicts.map((entry) => entry.id),
    warnings: negativeEvidence.map((entry) => entry.id),
    sceneStrength: strengthFor(score.sceneFitScore, positiveEvidence),
    sceneFitScore: score.sceneFitScore,
    sceneFitContribution: score.contribution,
    sceneFitContributionByFamily: score.contributionByFamily,
    sceneEvidence,
    sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
    sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
    evidence: itemFacts.map(toEvidence),
    itemFacts: itemFacts.map(toPublicItemFacts),
  };
  if (baseResult.hardRejected) return baseResult;

  const reasonContext = {
    scene: normalizedScene,
    weather,
    visibleFacts: candidateVisibleFacts,
    sceneResult: baseResult,
    instrumentation,
  };
  const catalogCandidates = collectEligibilityReasonCandidates(reasonContext);
  const eligibilityReasonCandidates = selectEvidenceBoundReasons(catalogCandidates, sceneEvidence);
  const eligibilityReason = resolveEligibilityReason(reasonContext, eligibilityReasonCandidates);
  const explanationDiagnostic = eligibilityReason
    ? undefined
    : buildExplanationCoverageDiagnostic({
        scene: normalizedScene,
        candidateVisibleFacts,
        sceneEvidence,
      });
  const result = {
    ...baseResult,
    ...(eligibilityReason ? { eligibilityReason: cloneEligibilityReason(eligibilityReason) } : {}),
    ...(explanationDiagnostic ? { eligibilityDiagnostic: explanationDiagnostic } : {}),
  };
  attachEligibilityReasonCandidates(result, eligibilityReasonCandidates);
  return result;
}

function applyWearabilityAndSceneEvidenceV4(candidates = [], {
  scene,
  weather,
  recommendationProfile,
  itemFactsContext,
  sourceItemById,
  instrumentation,
} = {}) {
  const accepted = [];
  const rejected = [];
  const rejectReasonCounts = {};
  let weatherRejectedCount = 0;
  let sceneRejectedCount = 0;
  let explanationCoverageGapCount = 0;
  const explanationCoverageGaps = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateItems = Array.isArray(candidate.itemFactRefs)
      ? itemFactsContext
        ? candidate.itemFactRefs
        : candidate.itemFactRefs.map((ref) => sourceItemById?.get(ref.itemId) || ref)
      : Array.isArray(candidate.items) ? candidate.items : [];
    const weatherResult = evaluateWeatherWearability({
      items: candidateItems,
      weather,
      derivedFacts: candidate.derivedFacts,
      itemFactsContext,
      instrumentation,
    });
    const sceneResult = weatherResult.pass
      ? evaluateSceneEvidenceV4({
          scene,
          items: candidateItems,
          weather,
          visibleFacts: candidate.visibleFacts,
          derivedFacts: candidate.derivedFacts,
          itemFactsContext,
          recommendationProfile,
          instrumentation,
        })
      : buildSkippedSceneResult();
    const rejectReasons = uniqueStrings([
      ...(weatherResult.rejectReasons || []),
      ...(sceneResult.rejectReasons || []),
    ]);
    for (const reason of rejectReasons) rejectReasonCounts[reason] = (rejectReasonCounts[reason] || 0) + 1;
    if (!weatherResult.pass) weatherRejectedCount += 1;
    if (weatherResult.pass && sceneResult.hardRejected) sceneRejectedCount += 1;
    if (sceneResult.eligibilityDiagnostic?.code === 'EXPLANATION_EVIDENCE_MAPPING_GAP') {
      explanationCoverageGapCount += 1;
      explanationCoverageGaps.push(toExplanationCoverageGap(candidate, sceneResult, scene));
    }

    if (!weatherResult.pass || sceneResult.hardRejected) {
      rejected.push({
        candidate,
        rejectionStage: !weatherResult.pass ? 'wearability_guard' : 'scene_hard_conflict',
        weather: weatherResult,
        scene: sceneResult,
        rejectReasons,
      });
      continue;
    }

    const eligibilityReasonCandidates = getEligibilityReasonCandidates(sceneResult);
    const riskFlags = uniqueStrings([
      ...(weatherResult.warningReasons || []),
      ...(sceneResult.warnings || []),
    ]);
    const eligibilityPayload = {
      weatherEligibility: weatherResult,
      sceneEligibility: sceneResult,
      eligibilityReason: cloneEligibilityReason(sceneResult.eligibilityReason),
      eligibilityReasonCandidates,
      riskFlags,
      validatorRejectReasons: rejectReasons,
    };
    const acceptedCandidate = candidate.version
      ? hydrateCanonicalEligibility(candidate, eligibilityPayload)
      : {
          ...candidate,
          eligibilityReason: cloneEligibilityReason(sceneResult.eligibilityReason),
          eligibilityReasonCandidates,
          eligibility: {
            weather: weatherResult,
            scene: sceneResult,
            penalty: (Number(weatherResult.penalty) || 0) + (Number(sceneResult.penalty) || 0),
          },
          validatorRejectReasons: rejectReasons,
          riskFlags,
        };
    acceptedCandidate.sceneEvidenceVersion = SCENE_EVIDENCE_VERSION;
    acceptedCandidate.sceneEvidenceFingerprint = SCENE_EVIDENCE_FINGERPRINT;
    acceptedCandidate.sceneFitScore = sceneResult.sceneFitScore;
    accepted.push(acceptedCandidate);
  }
  return {
    accepted,
    rejected,
    debug: {
      guardCandidateCount: Array.isArray(candidates) ? candidates.length : 0,
      guardAcceptedCount: accepted.length,
      guardRejectedCount: rejected.length,
      weatherRejectedCount,
      sceneRejectedCount,
      eligibilityReasonCoverageGapCount: explanationCoverageGapCount,
      explanationCoverageGapCount,
      rejectReasonCounts,
      unmappedEligibilityPaths: [],
      explanationCoverageGaps,
      sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
      sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
      limitedReason: accepted.length === 0 ? limitedReasonFor(scene, rejected) : '',
    },
  };
}

function deriveColorRelations(facts) {
  const entries = facts.flatMap((fact) => (fact.colorFacts || []).map((color) => ({ ...color, itemId: fact.itemId })));
  const families = uniqueStrings(entries.map((entry) => entry.family));
  const itemIds = uniqueStrings(entries.map((entry) => entry.itemId));
  if (entries.length < 2) return { coordinated: false, itemIds, families };
  const allNeutral = entries.every((entry) => entry.isNeutral);
  const sameFamily = families.length === 1;
  const brightCount = entries.filter((entry) => entry.isBright).length;
  const neutralCount = entries.filter((entry) => entry.isNeutral).length;
  const adjacent = families.length === 2 && areAdjacentFamilies(families[0], families[1]);
  return {
    coordinated: sameFamily || allNeutral || adjacent || (brightCount === 1 && neutralCount >= 1),
    sameFamily,
    allNeutral,
    adjacent,
    brightWithNeutral: brightCount === 1 && neutralCount >= 1,
    itemIds,
    families,
  };
}

function selectEvidenceBoundReasons(catalogCandidates = [], sceneEvidence = []) {
  const authorizedCodes = new Set(sceneEvidence.flatMap((entry) => entry.explanationCodes || []));
  const hasWeatherEvidence = sceneEvidence.some((entry) => entry.evidenceFamily === 'weather_layering');
  return catalogCandidates.filter((reason) => (
    authorizedCodes.has(reason.code)
    || (reason.family === 'weather' && hasWeatherEvidence)
  ));
}

function areAdjacentFamilies(left, right) {
  const groups = [
    new Set(['blue', 'navy', 'green']),
    new Set(['red', 'pink', 'purple']),
    new Set(['red', 'orange', 'yellow', 'brown']),
    new Set(['black', 'white', 'gray', 'beige', 'brown', 'navy']),
  ];
  return groups.some((group) => group.has(left) && group.has(right));
}

function buildCandidateVisibleFacts(items, itemFactsContext, instrumentation) {
  recordMetric(instrumentation, 'composeLegacyVisibleFactsForEligibility');
  return itemFactsContext
    ? itemFactsContext.buildVisibleFacts(items)
    : adaptLegacyVisibleFacts(items, { instrumentation });
}

function buildExplanationCoverageDiagnostic({ scene, candidateVisibleFacts, sceneEvidence }) {
  return {
    code: 'EXPLANATION_EVIDENCE_MAPPING_GAP',
    scene,
    sourceRule: 'sceneEvidenceV4',
    sourceRuleReasons: sceneEvidence.map((entry) => entry.id),
    visibleFactsByItem: Object.fromEntries(candidateVisibleFacts.items.map((item) => [
      item.id,
      item.factRecords.map((record) => record.fact),
    ])),
  };
}

function toExplanationCoverageGap(candidate, sceneResult, scene) {
  return {
    selectedOutfitItemIds: Array.isArray(candidate?.itemIds) ? candidate.itemIds.slice() : [],
    scene: sceneResult.eligibilityDiagnostic?.scene || normalizeScene(scene),
    sourceRule: 'sceneEvidenceV4',
    sourceRuleReasons: uniqueStrings(sceneResult.eligibilityDiagnostic?.sourceRuleReasons || []),
  };
}

function strengthFor(sceneFitScore, positiveEvidence) {
  if (positiveEvidence.some((entry) => entry.severity === 'STRONG_POSITIVE') && sceneFitScore >= 7) return 'strong';
  if (positiveEvidence.some((entry) => entry.severity === 'MEDIUM_POSITIVE') && sceneFitScore >= 6) return 'medium';
  if (positiveEvidence.length > 0) return 'weak';
  return 'none';
}

function buildSkippedSceneResult() {
  return {
    eligible: false,
    hardRejected: false,
    canEnterScene: false,
    penalty: 0,
    acceptReasons: [],
    rejectReasons: [],
    warnings: [],
    sceneStrength: 'none',
    sceneFitScore: 0,
    sceneEvidence: [],
    sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
    sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
    evidence: [],
  };
}

function limitedReasonFor(scene, rejected) {
  if (rejected.some((entry) => entry.weather?.rejectReasons?.length)) return 'weather_guard_no_candidate';
  return `${normalizeScene(scene)}_scene_hard_conflict_no_candidate`;
}

function toEvidence(fact) {
  return {
    itemId: fact.itemId,
    category: fact.category,
    normalizedType: fact.normalizedType,
    canonicalFacts: fact.canonicalFacts,
    evidence: fact.evidence,
  };
}

function toPublicItemFacts(fact) { return fact.wearabilityFacts || fact; }

function attachEligibilityReasonCandidates(sceneResult, candidates) {
  Object.defineProperty(sceneResult, ELIGIBILITY_REASON_CANDIDATES, {
    value: Array.isArray(candidates) ? candidates : [],
    enumerable: false,
    configurable: false,
  });
}

function getEligibilityReasonCandidates(sceneResult) {
  const candidates = sceneResult?.[ELIGIBILITY_REASON_CANDIDATES];
  return Array.isArray(candidates) ? candidates : [];
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function normalizeScene(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['home', '居家'].includes(raw)) return 'home';
  if (['work', '上班', '通勤', '正式', '开会'].includes(raw)) return 'work';
  if (['date', '约会'].includes(raw)) return 'date';
  if (['sport', 'sports', '运动'].includes(raw)) return 'sport';
  return raw || 'home';
}

function itemId(item) { return item?._id || item?.id || item?.clothingId || item?.itemId; }
function round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }

module.exports = {
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_VERSION,
  applyWearabilityAndSceneEligibility: applyWearabilityAndSceneEvidenceV4,
  applyWearabilityAndSceneEvidenceV4,
  evaluateOptionalItemPolicy,
  evaluateSceneEligibilityV3: evaluateSceneEvidenceV4,
  evaluateSceneEvidenceV4,
  getEligibilityReasonCandidates,
  normalizeScene,
  selectEvidenceBoundReasons,
};
