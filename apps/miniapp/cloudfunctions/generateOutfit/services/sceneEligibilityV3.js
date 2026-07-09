const { classifyWearabilityItem, uniqueStrings } = require('./itemWearabilityFacts');
const { evaluateWeatherWearability } = require('./wearabilityGuard');

function evaluateSceneEligibilityV3({ scene, items = [] } = {}) {
  const normalizedScene = normalizeScene(scene);
  const itemFacts = items.map(classifyWearabilityItem);
  if (normalizedScene === 'work') return evaluateWork(itemFacts);
  if (normalizedScene === 'date') return evaluateDate(itemFacts);
  if (normalizedScene === 'sport') return evaluateSport(itemFacts);
  return {
    eligible: true,
    hardRejected: false,
    penalty: 0,
    acceptReasons: ['HOME_RELAXED_ALLOWED'],
    rejectReasons: [],
    warnings: [],
    sceneStrength: 'medium',
    evidence: itemFacts.map(toEvidence),
    itemFacts,
  };
}

function applyWearabilityAndSceneEligibility(candidates = [], { scene, weather } = {}) {
  const accepted = [];
  const rejected = [];
  const rejectReasonCounts = {};
  let weatherRejectedCount = 0;
  let sceneRejectedCount = 0;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const weatherResult = evaluateWeatherWearability({ items: candidate.items, weather });
    const sceneResult = weatherResult.pass
      ? evaluateSceneEligibilityV3({ scene, items: candidate.items })
      : buildSkippedSceneResult();
    const rejectReasons = uniqueStrings([
      ...(weatherResult.rejectReasons || []),
      ...(sceneResult.rejectReasons || []),
    ]);
    for (const reason of rejectReasons) rejectReasonCounts[reason] = (rejectReasonCounts[reason] || 0) + 1;
    if (!weatherResult.pass) weatherRejectedCount += 1;
    if (weatherResult.pass && sceneResult.hardRejected) sceneRejectedCount += 1;

    if (!weatherResult.pass || sceneResult.hardRejected || !sceneResult.eligible) {
      rejected.push({
        candidate,
        weather: weatherResult,
        scene: sceneResult,
        rejectReasons,
      });
      continue;
    }

    const penalty = (Number(weatherResult.penalty) || 0) + (Number(sceneResult.penalty) || 0);
    accepted.push({
      ...candidate,
      rankingScore: round2((Number(candidate.rankingScore) || 0) - penalty),
      eligibility: {
        weather: weatherResult,
        scene: sceneResult,
        penalty,
      },
      validatorRejectReasons: rejectReasons,
      riskFlags: uniqueStrings([
        ...(weatherResult.warningReasons || []),
        ...(sceneResult.warnings || []),
      ]),
    });
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
      rejectReasonCounts,
      limitedReason: accepted.length === 0 ? limitedReasonFor(scene, rejected) : '',
    },
  };
}

function evaluateWork(facts) {
  const shoe = facts.find((fact) => fact.category === 'shoes');
  const workSignalCount = facts.reduce((sum, fact) => sum + fact.workSignals.length + (fact.isFormalLike ? 1 : 0), 0);
  const homeSignalCount = facts.reduce((sum, fact) => sum + fact.homeSignals.length + (fact.isHomeShoe ? 2 : 0), 0);
  const rejectReasons = [];
  const acceptReasons = [];
  const warnings = [];
  let penalty = 0;

  if (!shoe || shoe.isHomeShoe || shoe.isSlipperLike || shoe.isCrocsLike) rejectReasons.push('WORK_INVALID_SHOE');
  if (homeSignalCount >= 3) rejectReasons.push('WORK_HOME_DOMINANT');
  if (isPlainTeeShortsShoe(facts) && workSignalCount < 3) rejectReasons.push('WORK_TOO_CASUAL_SHORTS_TEE');
  if (workSignalCount <= 0) rejectReasons.push('WORK_MISSING_POLISH_SIGNAL');

  if (shoe && (shoe.isCleanSneaker || shoe.workSignals.length > 0 || /乐福|单鞋|皮鞋|短靴|loafer|flat|leather/i.test(shoe.evidence.join(' ')))) {
    acceptReasons.push('WORK_QUALIFIED_SHOE');
  }
  if (workSignalCount > 0) acceptReasons.push('WORK_POLISHED_SIGNAL');
  if (shoe?.isCleanSneaker && workSignalCount < 2) {
    warnings.push('WORK_CLEAN_SNEAKER_NEEDS_POLISH');
    penalty += 1;
  }

  return buildSceneResult({
    rejectReasons,
    acceptReasons,
    warnings,
    penalty,
    facts,
    strong: workSignalCount >= 3 && homeSignalCount === 0,
  });
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
  const hasSportApparel = apparel.some((fact) => fact.sportSignals.length > 0 || fact.isSportDress);
  const allCoreApparelSport = apparel.length > 0 && apparel.every((fact) => {
    if (fact.isNormalDress || (fact.isSkirtLike && !fact.isSportDress)) return false;
    if (fact.isFormalLike && fact.sportSignals.length === 0) return false;
    return fact.sportSignals.length > 0 || fact.isSportDress;
  });
  const rejectReasons = [];
  const acceptReasons = [];

  if (!shoe || !shoe.isSportShoe) rejectReasons.push('SPORT_INVALID_SHOE');
  if (!hasSportApparel || !allCoreApparelSport) rejectReasons.push('SPORT_NON_SPORT_APPAREL');
  if (facts.some((fact) => fact.isNormalDress || (fact.isSkirtLike && !fact.isSportDress))) rejectReasons.push('SPORT_DRESS_OR_SKIRT_NOT_ALLOWED');

  if (shoe?.isSportShoe) acceptReasons.push('SPORT_SHOE');
  if (hasSportApparel && allCoreApparelSport) acceptReasons.push('SPORT_APPAREL');

  return buildSceneResult({
    rejectReasons,
    acceptReasons,
    warnings: [],
    penalty: 0,
    facts,
    strong: rejectReasons.length === 0,
  });
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
    itemFacts: facts,
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
  normalizeScene,
};
