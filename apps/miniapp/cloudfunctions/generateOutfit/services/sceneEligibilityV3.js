const { deriveSceneEligibilityFacts, uniqueStrings } = require('./itemWearabilityFacts');
const { evaluateWeatherWearability } = require('./wearabilityGuard');
const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
const { hydrateCanonicalEligibility } = require('./canonicalCandidate');
const {
  cloneEligibilityReason,
  collectEligibilityReasonCandidates,
  resolveEligibilityReason,
} = require('./recommendationEligibilityReason');

const ELIGIBILITY_REASON_CANDIDATES = Symbol('eligibilityReasonCandidates');

function evaluateSceneEligibilityV3({ scene, items = [], weather = {}, visibleFacts, derivedFacts, itemFactsContext, instrumentation } = {}) {
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
        candidateVisibleFacts.items.find((entry) => entry.id === (item?._id || item?.id || item?.clothingId || item?.itemId)),
        { instrumentation },
      ));
  const baseResult = normalizedScene === 'work'
    ? evaluateWork(itemFacts)
    : normalizedScene === 'date'
      ? evaluateDate(itemFacts)
      : normalizedScene === 'sport'
        ? evaluateSport(itemFacts)
        : {
            eligible: true,
            hardRejected: false,
            penalty: 0,
            acceptReasons: ['HOME_RELAXED_ALLOWED'],
            rejectReasons: [],
            warnings: [],
            sceneStrength: 'medium',
            evidence: itemFacts.map(toEvidence),
            itemFacts: itemFacts.map(toPublicItemFacts),
          };
  if (!baseResult.eligible || baseResult.hardRejected) return baseResult;

  const reasonContext = {
    scene: normalizedScene,
    weather,
    visibleFacts: candidateVisibleFacts,
    sceneResult: baseResult,
    instrumentation,
  };
  const eligibilityReasonCandidates = collectEligibilityReasonCandidates(reasonContext);
  const eligibilityReason = resolveEligibilityReason(reasonContext, eligibilityReasonCandidates);
  if (!eligibilityReason) {
    return {
      ...baseResult,
      eligible: false,
      hardRejected: false,
      rejectReasons: uniqueStrings([...baseResult.rejectReasons, 'UNMAPPED_ELIGIBILITY_PATH']),
      eligibilityDiagnostic: {
        code: 'UNMAPPED_ELIGIBILITY_PATH',
        scene: normalizedScene,
        sourceRule: 'sceneEligibilityV3',
        sourceRuleReasons: uniqueStrings(baseResult.acceptReasons),
        visibleFactsByItem: Object.fromEntries(candidateVisibleFacts.items.map((item) => [
          item.id,
          item.factRecords.map((record) => record.fact),
        ])),
      },
    };
  }

  const eligibilityDiagnostic = normalizedScene === 'work' && eligibilityReason.isGenericFallback
    ? buildUnmappedEligibilityDiagnostic({
        scene: normalizedScene,
        candidateVisibleFacts,
        acceptReasons: baseResult.acceptReasons,
      })
    : undefined;
  const result = {
    ...baseResult,
    eligibilityReason: cloneEligibilityReason(eligibilityReason),
    ...(eligibilityDiagnostic ? { eligibilityDiagnostic } : {}),
  };
  attachEligibilityReasonCandidates(result, eligibilityReasonCandidates);
  return result;
}

function buildCandidateVisibleFacts(items, itemFactsContext, instrumentation) {
  recordMetric(instrumentation, 'composeLegacyVisibleFactsForEligibility');
  return itemFactsContext
    ? itemFactsContext.buildVisibleFacts(items)
    : adaptLegacyVisibleFacts(items, { instrumentation });
}

function applyWearabilityAndSceneEligibility(candidates = [], {
  scene,
  weather,
  itemFactsContext,
  sourceItemById,
  instrumentation,
} = {}) {
  const accepted = [];
  const rejected = [];
  const rejectReasonCounts = {};
  let weatherRejectedCount = 0;
  let sceneRejectedCount = 0;
  let eligibilityReasonCoverageGapCount = 0;
  const unmappedEligibilityPaths = [];
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
      ? evaluateSceneEligibilityV3({
          scene,
          items: candidateItems,
          weather,
          visibleFacts: candidate.visibleFacts,
          derivedFacts: candidate.derivedFacts,
          itemFactsContext,
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
    if (sceneResult.eligibilityDiagnostic?.code === 'UNMAPPED_ELIGIBILITY_PATH') {
      eligibilityReasonCoverageGapCount += 1;
      unmappedEligibilityPaths.push(toUnmappedEligibilityPath(candidate, sceneResult, scene));
    }

    if (!weatherResult.pass || sceneResult.hardRejected || !sceneResult.eligible) {
      rejected.push({
        candidate,
        rejectionStage: !weatherResult.pass ? 'wearability_guard' : 'scene_eligibility',
        weather: weatherResult,
        scene: sceneResult,
        rejectReasons,
      });
      continue;
    }

    const penalty = (Number(weatherResult.penalty) || 0) + (Number(sceneResult.penalty) || 0);
    const eligibilityReasonCandidates = getEligibilityReasonCandidates(sceneResult);
    const riskFlags = uniqueStrings([
      ...(weatherResult.warningReasons || []),
      ...(sceneResult.warnings || []),
    ]);
    const acceptedCandidate = candidate.version
      ? hydrateCanonicalEligibility(candidate, {
          weatherEligibility: weatherResult,
          sceneEligibility: sceneResult,
          eligibilityReason: cloneEligibilityReason(sceneResult.eligibilityReason),
          eligibilityReasonCandidates,
          riskFlags,
          validatorRejectReasons: rejectReasons,
        })
      : {
          ...candidate,
          rankingScore: round2((Number(candidate.rankingScore) || 0) - penalty),
          eligibilityReason: cloneEligibilityReason(sceneResult.eligibilityReason),
          eligibilityReasonCandidates,
          eligibility: {
            weather: weatherResult,
            scene: sceneResult,
            penalty,
          },
          validatorRejectReasons: rejectReasons,
          riskFlags,
        };
    acceptedCandidate.rankingScore = round2((Number(candidate.rankingScore) || 0) - penalty);
    accepted.push(acceptedCandidate);
  }
  if (!accepted.every((candidate) => candidate.eligibilityReason?.code)) {
    throw new Error('guard accepted candidate eligibility reason invariant failed');
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
      eligibilityReasonCoverageGapCount,
      rejectReasonCounts,
      unmappedEligibilityPaths,
      limitedReason: accepted.length === 0 ? limitedReasonFor(scene, rejected) : '',
    },
  };
}

function buildUnmappedEligibilityDiagnostic({ scene, candidateVisibleFacts, acceptReasons }) {
  return {
    code: 'UNMAPPED_ELIGIBILITY_PATH',
    scene,
    sourceRule: 'sceneEligibilityV3',
    sourceRuleReasons: uniqueStrings(acceptReasons),
    visibleFactsByItem: Object.fromEntries(candidateVisibleFacts.items.map((item) => [
      item.id,
      item.factRecords.map((record) => record.fact),
    ])),
  };
}

function toUnmappedEligibilityPath(candidate, sceneResult, scene) {
  return {
    selectedOutfitItemIds: Array.isArray(candidate?.itemIds)
      ? candidate.itemIds.slice()
      : (candidate?.itemFactRefs || candidate?.items || [])
        .map((item) => item?._id || item?.clothingId || item?.itemId)
        .filter(Boolean),
    scene: sceneResult.eligibilityDiagnostic?.scene || normalizeScene(scene),
    sourceRule: sceneResult.eligibilityDiagnostic?.sourceRule || '',
    sourceRuleReasons: uniqueStrings(sceneResult.eligibilityDiagnostic?.sourceRuleReasons || []),
    visibleFactsByItem: sceneResult.eligibilityDiagnostic?.visibleFactsByItem || {},
  };
}

function evaluateWork(facts) {
  const shoe = facts.find((fact) => fact.category === 'shoes');
  const polishEvidenceCount = facts.reduce((sum, fact) => sum + fact.polishEvidence.length, 0);
  const homeSignalCount = facts.reduce((sum, fact) => sum + fact.explicitHomeSignals.length + (fact.isHomeShoe ? 2 : 0), 0);
  const baseWorkSignalCount = facts.reduce((sum, fact) => sum
    + fact.wearabilityFacts.workSignals.length
    + (fact.wearabilityFacts.isFormalLike ? 1 : 0), 0);
  const baseHomeSignalCount = facts.reduce((sum, fact) => sum
    + fact.wearabilityFacts.homeSignals.length
    + (fact.wearabilityFacts.isHomeShoe ? 2 : 0), 0);
  const rejectReasons = [];
  const acceptReasons = [];
  const warnings = [];
  const hasQualifiedWorkShoe = Boolean(shoe && !shoe.invalidWorkShoe
    && (shoe.isCleanSneaker || shoe.polishEvidence.length > 0 || shoe.workSignals.length > 0));
  const hasSimpleDressWorkSet = facts.some((fact) => fact.category === 'onepiece'
    && fact.visibleFacts.includes('simple_style')) && hasQualifiedWorkShoe;

  if (!shoe || shoe.invalidWorkShoe) rejectReasons.push('WORK_INVALID_SHOE');
  if (homeSignalCount >= 2) rejectReasons.push('WORK_HOME_DOMINANT');
  if (isPlainTeeShortsShoe(facts) && polishEvidenceCount < 3) rejectReasons.push('WORK_TOO_CASUAL_SHORTS_TEE');
  if (polishEvidenceCount === 0) warnings.push('WORK_MISSING_POLISH_SIGNAL');

  if (hasQualifiedWorkShoe) {
    acceptReasons.push('WORK_QUALIFIED_SHOE');
  }
  if (polishEvidenceCount > 0) acceptReasons.push('WORK_POLISHED_SIGNAL');
  if (shoe?.isCleanSneaker && polishEvidenceCount < 2) {
    warnings.push('WORK_CLEAN_SNEAKER_NEEDS_POLISH');
  }

  const workConfidence = (baseWorkSignalCount >= 3 || hasSimpleDressWorkSet) && baseHomeSignalCount === 0
    ? 'high'
    : polishEvidenceCount >= 2 && hasQualifiedWorkShoe && baseHomeSignalCount === 0
      ? 'medium'
      : 'low';
  if (workConfidence === 'low') warnings.push('WORK_LOW_CONFIDENCE_SUPPLEMENT');

  const result = buildSceneResult({
    rejectReasons,
    acceptReasons,
    warnings,
    penalty: 0,
    facts,
    strong: workConfidence === 'high',
  });
  return {
    ...result,
    sceneStrength: result.eligible ? workConfidence : 'none',
    sceneConfidence: workConfidence,
  };
}

function evaluateDate(facts) {
  const shoe = facts.find((fact) => fact.category === 'shoes');
  const dateSignalCount = facts.reduce((sum, fact) => sum + fact.dateSignals.length + (fact.isDressLike || fact.isSkirtLike ? 1 : 0), 0);
  const homeSignalCount = facts.reduce((sum, fact) => sum + fact.homeSignals.length + (fact.isHomeShoe ? 2 : 0), 0);
  const rejectReasons = [];
  const acceptReasons = [];
  const warnings = [];
  let penalty = 0;

  if (!shoe || shoe.isHomeShoe || shoe.isSlipperLike || shoe.isCrocsLike) rejectReasons.push('DATE_INVALID_SHOE');
  if (homeSignalCount >= 3) rejectReasons.push('DATE_HOME_DOMINANT');
  if (isPlainTeeShortsShoe(facts) && dateSignalCount < 2) rejectReasons.push('DATE_TOO_CASUAL_SHORTS_TEE');
  if (dateSignalCount <= 0 && !hasCleanComplete(facts)) rejectReasons.push('DATE_MISSING_FRIENDLY_SIGNAL');

  if (dateSignalCount > 0) acceptReasons.push('DATE_FRIENDLY_SIGNAL');
  if (hasCleanComplete(facts)) acceptReasons.push('DATE_CLEAN_COMPLETE');
  if (shoe?.isCleanSneaker && dateSignalCount < 2) {
    warnings.push('DATE_CLEAN_SNEAKER_NEEDS_STYLING');
    penalty += 1;
  }

  return buildSceneResult({
    rejectReasons,
    acceptReasons,
    warnings,
    penalty,
    facts,
    strong: dateSignalCount >= 2 && homeSignalCount === 0,
  });
}

function evaluateSport(facts) {
  const shoe = facts.find((fact) => fact.category === 'shoes');
  const apparel = facts.filter((fact) => ['top', 'bottom', 'skirt', 'onepiece'].includes(fact.category));
  const hasSportBottom = apparel.some((fact) => fact.category === 'bottom' && fact.sportBottomEvidence);
  const hasSportTop = apparel.some((fact) => fact.category === 'top' && fact.sportApparelEvidence);
  const hasCompatibleSportTop = apparel.some((fact) => fact.category === 'top' && fact.sportCompatibleTop);
  const hasCompatibleSportBottom = apparel.some((fact) => fact.category === 'bottom' && fact.sportCompatibleBottom);
  const hasSportDress = apparel.some((fact) => fact.isSportDress);
  const hasSportApparel = hasSportDress || ((hasSportBottom || hasCompatibleSportBottom) && (hasSportTop || hasCompatibleSportTop));
  const provenLightSportBaseline = isProvenLightSportBaseline(facts);
  const allCoreApparelSport = apparel.length > 0 && apparel.every((fact) => {
    if (fact.isNormalDress || (fact.isSkirtLike && !fact.isSportDress)) return false;
    if (fact.category === 'onepiece') return fact.isSportDress;
    if (fact.category === 'bottom') return fact.sportBottomEvidence || fact.sportCompatibleBottom;
    if (fact.category === 'top') return fact.sportApparelEvidence || ((hasSportBottom || hasCompatibleSportBottom) && fact.sportCompatibleTop);
    return true;
  });
  const rejectReasons = [];
  const acceptReasons = [];

  if (!shoe || shoe.invalidSportShoe || (!shoe.isStableSportShoe && !shoe.visibleFacts.includes('sport_shoe'))) rejectReasons.push('SPORT_INVALID_SHOE');
  if ((!hasSportApparel || !allCoreApparelSport) && !provenLightSportBaseline) rejectReasons.push('SPORT_NON_SPORT_APPAREL');
  if (facts.some((fact) => fact.isNormalDress || (fact.isSkirtLike && !fact.isSportDress))) rejectReasons.push('SPORT_DRESS_OR_SKIRT_NOT_ALLOWED');

  if (shoe && (shoe.isStableSportShoe || shoe.visibleFacts.includes('sport_shoe'))) acceptReasons.push('SPORT_SHOE');
  if (hasSportApparel && allCoreApparelSport) acceptReasons.push('SPORT_APPAREL');
  if (provenLightSportBaseline) acceptReasons.push('SPORT_LIGHT_ACTIVITY_BASELINE');

  return buildSceneResult({
    rejectReasons,
    acceptReasons,
    warnings: [],
    penalty: 0,
    facts,
    strong: rejectReasons.length === 0,
  });
}

function isProvenLightSportBaseline(facts = []) {
  const top = facts.find((fact) => fact.category === 'top');
  const bottom = facts.find((fact) => fact.category === 'bottom');
  const shoes = facts.find((fact) => fact.category === 'shoes');
  const coreApparel = facts.filter((fact) => ['top', 'bottom', 'skirt', 'onepiece'].includes(fact.category));

  return coreApparel.length === 2
    && Boolean(top && bottom && shoes)
    && top.isTshirtLike === true
    && top.sportApparelEvidence === true
    && bottom.isShorts === true
    && shoes.isSportShoe === true
    && shoes.invalidSportShoe !== true
    && shoes.isHomeShoe !== true
    && shoes.isSlipperLike !== true
    && shoes.isCrocsLike !== true;
}

function buildSceneResult({ rejectReasons, acceptReasons, warnings, penalty, facts, strong }) {
  const uniqueRejectReasons = uniqueStrings(rejectReasons);
  return {
    eligible: uniqueRejectReasons.length === 0,
    hardRejected: uniqueRejectReasons.length > 0,
    penalty: round2(penalty),
    acceptReasons: uniqueStrings(acceptReasons),
    rejectReasons: uniqueRejectReasons,
    warnings: uniqueStrings(warnings),
    sceneStrength: uniqueRejectReasons.length > 0 ? 'none' : strong ? 'strong' : 'medium',
    evidence: facts.map(toEvidence),
    itemFacts: facts.map(toPublicItemFacts),
  };
}

function buildSkippedSceneResult() {
  return {
    eligible: false,
    hardRejected: false,
    penalty: 0,
    acceptReasons: [],
    rejectReasons: [],
    warnings: [],
    sceneStrength: 'none',
    evidence: [],
  };
}

function isPlainTeeShortsShoe(facts) {
  const hasTee = facts.some((fact) => fact.isTshirtLike);
  const hasShorts = facts.some((fact) => fact.isShorts);
  const hasCasualShoe = facts.some((fact) => fact.category === 'shoes' && (fact.isSportShoe || fact.isHomeShoe || fact.isSlipperLike || fact.isCrocsLike));
  return hasTee && hasShorts && hasCasualShoe;
}

function hasCleanComplete(facts) {
  const hasApparel = facts.some((fact) => ['top', 'onepiece'].includes(fact.category))
    && facts.some((fact) => ['bottom', 'skirt', 'onepiece'].includes(fact.category));
  const hasShoe = facts.some((fact) => fact.category === 'shoes' && !fact.isHomeShoe);
  const hasMessy = facts.some((fact) => /邋遢|破洞|脏|睡衣|家居/i.test(fact.evidence.join(' ')));
  return hasApparel && hasShoe && !hasMessy;
}

function limitedReasonFor(scene, rejected) {
  const normalizedScene = normalizeScene(scene);
  if (rejected.some((entry) => entry.weather?.rejectReasons?.length)) return 'weather_guard_no_candidate';
  if (normalizedScene === 'work') return 'work_scene_eligible_no_candidate';
  if (normalizedScene === 'date') return 'date_scene_eligible_no_candidate';
  if (normalizedScene === 'sport') return 'sport_scene_eligible_no_candidate';
  return 'guard_no_candidate';
}

function toEvidence(fact) {
  return {
    itemId: fact.itemId,
    category: fact.category,
    normalizedType: fact.normalizedType,
    evidence: fact.evidence,
  };
}

function toPublicItemFacts(fact) {
  return fact.wearabilityFacts || fact;
}

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

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = {
  applyWearabilityAndSceneEligibility,
  evaluateSceneEligibilityV3,
  getEligibilityReasonCandidates,
  isProvenLightSportBaseline,
  normalizeScene,
};
