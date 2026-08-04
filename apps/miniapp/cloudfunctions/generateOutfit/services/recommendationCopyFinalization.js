const { COPY_CONTRACT_VERSION } = require('./recommendationCopyContract');
const { VOICE_BANK_VERSION } = require('./xiaodaVoiceBankV2');
const {
  toCoreEligibilityPayload,
  validateCoreEligibilityPayload,
  validateEligibilityReason,
} = require('./recommendationEligibilityReason');

const FINALIZATION_MODES = Object.freeze({
  NEW_RECOMMENDATION: 'new_recommendation',
  SAVED_SNAPSHOT: 'saved_snapshot',
});

function finalizeAcceptedRecommendations(compiledRecommendations, options = {}) {
  const compiled = Array.isArray(compiledRecommendations) ? compiledRecommendations : [];
  const mode = normalizeMode(options.mode);
  const requestedCount = normalizeRequestedCount(options.requestedCount, compiled.length);
  const outfitEligible = mode === FINALIZATION_MODES.SAVED_SNAPSHOT
    ? compiled
    : compiled.filter(hasEligibleOutfit);
  const coverageGaps = [];
  const finalRecommendations = [];
  for (const sourceRecommendation of outfitEligible) {
    const recommendation = mode === FINALIZATION_MODES.NEW_RECOMMENDATION
      ? renderCoreEligibilityReason(sourceRecommendation)
      : sourceRecommendation;
    if (mode === FINALIZATION_MODES.NEW_RECOMMENDATION
      && finalRecommendations.length >= requestedCount) break;
    if (mode === FINALIZATION_MODES.NEW_RECOMMENDATION) {
      if (!hasAcceptedCoreEligibilityReason(recommendation) || !hasAcceptedDefaultCopy(recommendation)) {
        coverageGaps.push({
          outfitKey: recommendation?.outfitKey || recommendation?.id || '',
          code: 'CORE_REASON_COVERAGE_GAP',
          eligibilityReasonCode: recommendation?.eligibilityReason?.code || '',
        });
        continue;
      }
      finalRecommendations.push(attachCopyDiagnostics(recommendation, mode, 'visible'));
      continue;
    }
    finalRecommendations.push(hasAcceptedDefaultCopy(recommendation)
      ? attachCopyDiagnostics(recommendation, mode, 'visible')
      : hideRejectedDefaultCopy(recommendation, { mode }));
  }
  const copyAcceptedCount = finalRecommendations.reduce(
    (count, recommendation) => count + (recommendation.copyDisplay === 'visible' ? 1 : 0),
    0,
  );
  const copyHiddenCount = finalRecommendations.length - copyAcceptedCount;
  const copyRejectReasonCounts = countCopyRejectReasons(finalRecommendations);
  const coreReasonAcceptedCount = mode === FINALIZATION_MODES.NEW_RECOMMENDATION
    ? finalRecommendations.length
    : finalRecommendations.filter(hasAcceptedCoreEligibilityReason).length;
  const enhancedReasonAcceptedCount = finalRecommendations.filter((recommendation) => (
    typeof recommendation.copyContract?.enhancedReason === 'string'
      && Boolean(recommendation.copyContract.enhancedReason.trim())
  )).length;
  const coreReasonCodeCounts = countCoreReasonCodes(finalRecommendations);
  const enhancementRejectReasonCounts = countEnhancementRejectReasons(finalRecommendations);

  if (copyAcceptedCount + copyHiddenCount !== finalRecommendations.length
    || !finalRecommendations.every(hasCurrentCopyContract)) {
    throw new Error('recommendation outfit/copy finalization invariant failed');
  }
  if (mode === FINALIZATION_MODES.NEW_RECOMMENDATION
    && (coreReasonAcceptedCount !== finalRecommendations.length
      || !finalRecommendations.every((item) => typeof item.copyContract.todayReason === 'string'
        && item.copyContract.todayReason.trim().length > 0))) {
    throw new Error('new recommendation core reason invariant failed');
  }
  if (mode === FINALIZATION_MODES.SAVED_SNAPSHOT && finalRecommendations.length !== compiled.length) {
    throw new Error('saved snapshot preservation invariant failed');
  }

  return {
    mode,
    finalRecommendations,
    acceptedCount: finalRecommendations.length,
    outfitAcceptedCount: outfitEligible.length,
    outfitRejectedCount: compiled.length - outfitEligible.length,
    coreReasonAcceptedCount,
    enhancedReasonAcceptedCount,
    coreReasonCoverageGapCount: coverageGaps.length,
    coreReasonCodeCounts,
    enhancementRejectReasonCounts,
    finalRecommendationCount: finalRecommendations.length,
    copyAcceptedCount,
    copyHiddenCount,
    copyRejectReasonCounts,
    rejectedCount: copyHiddenCount,
    preservedCount: finalRecommendations.length,
    coverageGaps,
  };
}

function hasEligibleOutfit(recommendation) {
  if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) return false;
  if (recommendation.outfitGateResult === 'REJECT' || recommendation.outfitEligible === false) return false;
  const eligibility = recommendation.eligibility;
  if (!eligibility || typeof eligibility !== 'object' || Array.isArray(eligibility)) return true;
  if (eligibility.weather?.pass === false || eligibility.weather?.hardRejected === true) return false;
  if (eligibility.scene?.eligible === false || eligibility.scene?.hardRejected === true) return false;
  return true;
}

function hasCurrentCopyContract(recommendation) {
  return recommendation?.copyContractVersion === COPY_CONTRACT_VERSION
    && recommendation?.voiceBankVersion === VOICE_BANK_VERSION
    && recommendation?.copyContract?.copyContractVersion === COPY_CONTRACT_VERSION
    && recommendation?.copyContract?.voiceBankVersion === VOICE_BANK_VERSION
    && ['PASS', 'REJECT'].includes(recommendation.copyContract.gateResult)
    && Array.isArray(recommendation.copyContract.riskFlags);
}

function hasAcceptedDefaultCopy(recommendation) {
  return hasCurrentCopyContract(recommendation)
    && recommendation.copyContract.gateResult === 'PASS'
    && recommendation.copyContract.riskFlags.length === 0
    && typeof recommendation.copyContract.todayReason === 'string'
    && Boolean(recommendation.copyContract.todayReason.trim());
}

function hasAcceptedCoreEligibilityReason(recommendation) {
  const contract = recommendation?.copyContract;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return false;
  const selectedOutfitItemIds = readSelectedOutfitItemIds(recommendation);
  const context = {
    scene: recommendation.scene,
    weather: recommendation.weatherSnapshot || recommendation.weather,
    selectedOutfitItemIds,
  };
  if (!validateEligibilityReason(recommendation.eligibilityReason, context)) return false;
  const expected = toCoreEligibilityPayload(recommendation.eligibilityReason, context);
  const actual = {
    coreEligibilityReasonCode: contract.coreEligibilityReasonCode,
    coreEligibilityReason: contract.coreEligibilityReason,
    coreEligibilityEvidence: contract.coreEligibilityEvidence,
    subjectItemIds: contract.coreEligibilitySubjectItemIds,
    supportingFactIds: contract.coreEligibilitySupportingFactIds,
    relationFactIds: contract.coreEligibilityRelationFactIds,
    sourceRule: contract.coreEligibilitySourceRule,
    sourceRuleReasons: contract.coreEligibilitySourceRuleReasons,
  };
  return validateCoreEligibilityPayload(actual, context)
    && actual.coreEligibilityReasonCode === expected.coreEligibilityReasonCode
    && actual.coreEligibilityReason === expected.coreEligibilityReason
    && sameStrings(actual.subjectItemIds, expected.subjectItemIds)
    && sameStrings(actual.supportingFactIds, expected.supportingFactIds)
    && sameStrings(actual.relationFactIds, expected.relationFactIds)
    && actual.sourceRule === expected.sourceRule
    && sameStrings(actual.sourceRuleReasons, expected.sourceRuleReasons);
}

function renderCoreEligibilityReason(recommendation) {
  if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) return recommendation;
  const context = {
    scene: recommendation.scene,
    weather: recommendation.weatherSnapshot || recommendation.weather,
    selectedOutfitItemIds: readSelectedOutfitItemIds(recommendation),
  };
  const core = toCoreEligibilityPayload(recommendation.eligibilityReason, context);
  if (!core) return recommendation;
  const contract = recommendation.copyContract && typeof recommendation.copyContract === 'object'
    && !Array.isArray(recommendation.copyContract)
    ? recommendation.copyContract
    : {};
  const enhancedReason = typeof contract.enhancedReason === 'string' ? contract.enhancedReason.trim() : '';
  const todayReason = enhancedReason || core.coreEligibilityReason;
  const copyContract = {
    ...contract,
    todayReason,
    todayReasonSource: enhancedReason ? 'enhanced_qualification_core' : 'core_eligibility',
    coreEligibilityReason: core.coreEligibilityReason,
    coreEligibilityReasonCode: core.coreEligibilityReasonCode,
    coreEligibilityEvidence: core.coreEligibilityEvidence.map((record) => ({ ...record })),
    coreEligibilitySubjectItemIds: core.subjectItemIds.slice(),
    coreEligibilitySupportingFactIds: core.supportingFactIds.slice(),
    coreEligibilityRelationFactIds: core.relationFactIds.slice(),
    coreEligibilitySourceRule: core.sourceRule,
    coreEligibilitySourceRuleReasons: core.sourceRuleReasons.slice(),
  };
  return {
    ...recommendation,
    copyContract,
    reason: todayReason,
    todayReasonSource: copyContract.todayReasonSource,
    coreEligibilityReason: core.coreEligibilityReason,
    coreEligibilityReasonCode: core.coreEligibilityReasonCode,
    coreEligibilityEvidence: copyContract.coreEligibilityEvidence,
    coreEligibilitySubjectItemIds: copyContract.coreEligibilitySubjectItemIds,
    coreEligibilitySupportingFactIds: copyContract.coreEligibilitySupportingFactIds,
    coreEligibilityRelationFactIds: copyContract.coreEligibilityRelationFactIds,
    coreEligibilitySourceRule: core.sourceRule,
    coreEligibilitySourceRuleReasons: copyContract.coreEligibilitySourceRuleReasons,
  };
}

function readSelectedOutfitItemIds(recommendation) {
  const ids = Array.isArray(recommendation?.clothingIds)
    ? recommendation.clothingIds
    : Array.isArray(recommendation?.items)
      ? recommendation.items.map((item) => item?.clothingId || item?._id || item?.itemId)
      : [];
  return uniqueStrings(ids);
}

function sameStrings(left, right) {
  const a = uniqueStrings(left).slice().sort();
  const b = uniqueStrings(right).slice().sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hideRejectedDefaultCopy(recommendation, options = {}) {
  if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) return recommendation;
  const mode = normalizeMode(options.mode ?? FINALIZATION_MODES.SAVED_SNAPSHOT);
  const existingContract = recommendation.copyContract && typeof recommendation.copyContract === 'object'
    && !Array.isArray(recommendation.copyContract)
    ? recommendation.copyContract
    : {};
  const riskFlags = uniqueStrings([
    ...(Array.isArray(existingContract.riskFlags) ? existingContract.riskFlags : []),
    ...(mode === FINALIZATION_MODES.SAVED_SNAPSHOT ? ['SAVED_SNAPSHOT_COPY_HIDDEN'] : []),
  ]);
  const copyContract = {
    ...existingContract,
    copyContractVersion: COPY_CONTRACT_VERSION,
    voiceBankVersion: VOICE_BANK_VERSION,
    gateResult: 'REJECT',
    copyDisplay: 'hidden',
    todayReason: '',
    todayReasonSource: '',
    coreEligibilityReason: '',
    coreEligibilityReasonCode: '',
    coreEligibilityEvidence: [],
    coreEligibilitySubjectItemIds: [],
    coreEligibilitySupportingFactIds: [],
    coreEligibilityRelationFactIds: [],
    coreEligibilitySourceRule: '',
    coreEligibilitySourceRuleReasons: [],
    enhancedReason: undefined,
    enhancementRejectReasons: [],
    todayClaim: null,
    todayClaimId: '',
    todayEvidenceIds: [],
    todayRequiredFactIds: [],
    todayEvidenceSources: [],
    detailClaim: null,
    detailClaimId: '',
    detailEvidenceIds: [],
    detailRequiredFactIds: [],
    detailEvidenceSources: [],
    riskFlags,
  };
  delete copyContract.detailExplanation;

  const next = {
    ...recommendation,
    copyContract,
    copyContractVersion: COPY_CONTRACT_VERSION,
    voiceBankVersion: VOICE_BANK_VERSION,
    reason: '',
    reasoning: undefined,
    todayReasonSource: '',
    coreEligibilityReason: '',
    coreEligibilityReasonCode: '',
    coreEligibilityEvidence: [],
    coreEligibilitySubjectItemIds: [],
    coreEligibilitySupportingFactIds: [],
    coreEligibilityRelationFactIds: [],
    coreEligibilitySourceRule: '',
    coreEligibilitySourceRuleReasons: [],
    enhancedReason: undefined,
    enhancementRejectReasons: [],
    todayClaim: null,
    todayClaimId: '',
    todayEvidenceIds: [],
    todayRequiredFactIds: [],
    todayEvidenceSources: [],
    detailClaim: null,
    detailClaimId: '',
    detailEvidenceIds: [],
    detailRequiredFactIds: [],
    detailEvidenceSources: [],
    riskFlags,
    copyGateResult: 'REJECT',
    copyRiskFlags: riskFlags,
    copyDisplay: 'hidden',
    defaultCopyHidden: true,
    copyFinalizationMode: mode,
  };
  if (next.contentPlan && typeof next.contentPlan === 'object' && !Array.isArray(next.contentPlan)) {
    next.contentPlan = {
      ...next.contentPlan,
      defaultCopy: { ...copyContract },
      defaultTodayReason: '',
      defaultDetailExplanation: undefined,
    };
  }
  if (next.detailNarrativeViewModel && typeof next.detailNarrativeViewModel === 'object'
    && !Array.isArray(next.detailNarrativeViewModel)) {
    next.detailNarrativeViewModel = {
      ...next.detailNarrativeViewModel,
      defaultText: '',
    };
  }
  return next;
}

function attachCopyDiagnostics(recommendation, mode, copyDisplay) {
  const riskFlags = uniqueStrings(recommendation.copyContract.riskFlags || []);
  return {
    ...recommendation,
    copyContract: {
      ...recommendation.copyContract,
      copyDisplay,
    },
    copyGateResult: recommendation.copyContract.gateResult,
    copyRiskFlags: riskFlags,
    copyDisplay,
    defaultCopyHidden: copyDisplay === 'hidden',
    copyFinalizationMode: mode,
  };
}

function countCopyRejectReasons(recommendations) {
  const counts = {};
  for (const recommendation of recommendations) {
    if (recommendation.copyDisplay !== 'hidden') continue;
    const flags = uniqueStrings(recommendation.copyRiskFlags || []);
    const reasons = flags.length > 0 ? flags : ['COPY_EVIDENCE_INSUFFICIENT'];
    for (const reason of reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function countCoreReasonCodes(recommendations) {
  const counts = {};
  for (const recommendation of recommendations) {
    const code = recommendation.copyContract?.coreEligibilityReasonCode;
    if (typeof code === 'string' && code.trim()) counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

function countEnhancementRejectReasons(recommendations) {
  const counts = {};
  for (const recommendation of recommendations) {
    for (const reason of uniqueStrings(recommendation.copyContract?.enhancementRejectReasons || [])) {
      counts[reason] = (counts[reason] || 0) + 1;
    }
  }
  return counts;
}

function normalizeRequestedCount(value, fallback) {
  if (value === undefined) return fallback;
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(Math.floor(count), 0) : fallback;
}

function normalizeMode(value) {
  if (value === undefined || value === FINALIZATION_MODES.NEW_RECOMMENDATION) {
    return FINALIZATION_MODES.NEW_RECOMMENDATION;
  }
  if (value === FINALIZATION_MODES.SAVED_SNAPSHOT) return FINALIZATION_MODES.SAVED_SNAPSHOT;
  throw new Error(`unsupported recommendation finalization mode: ${String(value)}`);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

module.exports = {
  FINALIZATION_MODES,
  finalizeAcceptedRecommendations,
  hasAcceptedDefaultCopy,
  hasAcceptedCoreEligibilityReason,
  hasCurrentCopyContract,
  hasEligibleOutfit,
  hideRejectedDefaultCopy,
};
