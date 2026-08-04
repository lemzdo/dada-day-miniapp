const { planRecommendationNarrative } = require('./recommendationNarrativePlanner');
const {
  COPY_ACCEPTANCE_PASS,
  inspectRecommendationCopy,
  inspectRecommendationPair,
} = require('./recommendationCopyAcceptanceGate');
const { VOICE_BANK_VERSION } = require('./xiaodaVoiceBankV2');
const { toCoreEligibilityPayload } = require('./recommendationEligibilityReason');

const COPY_CONTRACT_VERSION = 'recommendation-copy-contract-v3';

function buildRecommendationCopyContract(input = {}) {
  const source = asObject(input);
  const plan = asObject(source.narrativePlan);
  const narrativePlan = plan.todayClaim || plan.qualification
    ? plan
    : planRecommendationNarrative(source);
  const gateContext = buildGateContext(source);
  const coreEligibility = toCoreEligibilityPayload(
    source.eligibilityReason || narrativePlan.eligibilityReason,
    {
      scene: source.scene || narrativePlan.scene,
      weather: source.weather,
      selectedOutfitItemIds: gateContext.selectedOutfitItemIds,
    },
  );

  if (!coreEligibility) {
    return canonicalResult(narrativePlan, null, null, null, uniqueStrings([
      ...asArray(narrativePlan.qualification?.reasons),
      'CORE_REASON_COVERAGE_GAP',
    ]), 'REJECT', ['COPY_EVIDENCE_INSUFFICIENT']);
  }

  let enhanced = buildCandidate(narrativePlan.todayClaim, 'today');
  let enhancementRejectReasons = [];
  if (enhanced) {
    const enhancedInspection = inspectRecommendationCopy(enhanced, gateContext);
    if (enhancedInspection.result !== COPY_ACCEPTANCE_PASS) {
      enhancementRejectReasons = enhancedInspection.riskFlags;
      enhanced = null;
    }
  } else {
    enhancementRejectReasons = ['COPY_EVIDENCE_INSUFFICIENT'];
  }

  let detail = buildCandidate(narrativePlan.detailClaim, 'detail');
  if (detail) {
    const detailInspection = inspectRecommendationCopy(detail, gateContext);
    const pairInspection = detailInspection.result === COPY_ACCEPTANCE_PASS && enhanced
      ? inspectRecommendationPair({ today: enhanced, detail }, gateContext)
      : detailInspection;
    const repeatsCoreEvidence = !enhanced
      && detail.evidenceFactIds.some((factId) => coreEligibility.supportingFactIds.includes(factId));
    if (pairInspection.result !== COPY_ACCEPTANCE_PASS || repeatsCoreEvidence) detail = null;
  }

  return canonicalResult(
    narrativePlan,
    coreEligibility,
    enhanced,
    detail,
    [],
    'PASS',
    enhancementRejectReasons,
  );
}

function buildCandidate(claimValue, surface) {
  const claim = asObject(claimValue);
  if (!readString(claim.claimId) || !readString(claim.text)) return null;
  const subjectItemIds = uniqueStrings(claim.subjectItemIds);
  const evidenceFactIds = uniqueStrings(claim.evidenceFactIds);
  const requiredFactIds = uniqueStrings(claim.requiredFactIds);
  return {
    text: claim.text,
    scene: claim.scene,
    surface,
    action: claim.action,
    dimension: claim.dimension,
    claimId: claim.claimId,
    sentenceClusterId: claim.claimId,
    subjectItemIds,
    subjectItemId: subjectItemIds[0] || '',
    requiredFactIds,
    requiredFacts: requiredFactIds,
    evidenceFactIds,
    evidenceIds: evidenceFactIds,
    evidenceSources: asArray(claim.evidenceSources).map((entry) => ({ ...entry })),
    slotBindings: { ...asObject(claim.slotBindings) },
    userValue: claim.userValue,
    priority: claim.priority,
    sentence: {
      text: claim.text,
      requiredFactIds: uniqueStrings(claim.sentence?.requiredFactIds || requiredFactIds),
    },
  };
}

function buildGateContext(source) {
  const facts = asObject(source.facts);
  const itemFactsById = asObject(facts.itemFactsById);
  const relationFacts = asArray(facts.relationFacts);
  const selectedOutfitItemIds = uniqueStrings(
    asArray(facts.items).map((item) => readString(item?.id || item?.clothingId || item?.itemId)),
  );
  return { selectedOutfitItemIds, itemFactsById, relationFacts };
}

function canonicalResult(plan, coreEligibility, enhanced, detail, riskFlags, gateResult, enhancementRejectReasons) {
  const todayClaim = enhanced ? canonicalClaim(enhanced) : null;
  const detailClaim = detail ? canonicalClaim(detail) : null;
  const todayReason = enhanced?.text || coreEligibility?.coreEligibilityReason || '';
  const result = {
    copyContractVersion: COPY_CONTRACT_VERSION,
    voiceBankVersion: VOICE_BANK_VERSION,
    gateResult,
    copyDisplay: gateResult === 'PASS' ? 'visible' : 'hidden',
    todayReason,
    todayReasonSource: enhanced ? 'enhanced_qualification_core' : 'core_eligibility',
    coreEligibilityReason: coreEligibility?.coreEligibilityReason || '',
    coreEligibilityReasonCode: coreEligibility?.coreEligibilityReasonCode || '',
    coreEligibilityEvidence: cloneEvidenceSources(coreEligibility?.coreEligibilityEvidence),
    coreEligibilitySubjectItemIds: coreEligibility?.subjectItemIds?.slice() || [],
    coreEligibilitySupportingFactIds: coreEligibility?.supportingFactIds?.slice() || [],
    coreEligibilityRelationFactIds: coreEligibility?.relationFactIds?.slice() || [],
    coreEligibilitySourceRule: coreEligibility?.sourceRule || '',
    coreEligibilitySourceRuleReasons: coreEligibility?.sourceRuleReasons?.slice() || [],
    enhancedReason: enhanced?.text || undefined,
    enhancementRejectReasons: uniqueStrings(enhancementRejectReasons),
    todayClaim,
    todayClaimId: enhanced?.claimId || '',
    todayAction: enhanced?.action || null,
    todayDimension: enhanced?.dimension || null,
    todayEvidenceIds: enhanced?.evidenceFactIds.slice() || [],
    todayRequiredFactIds: enhanced?.requiredFactIds.slice() || [],
    todayEvidenceSources: cloneEvidenceSources(enhanced?.evidenceSources),
    todaySentenceClusterId: enhanced?.claimId || '',
    todaySubjectItemId: enhanced?.subjectItemId || '',
    todaySubjectItemIds: enhanced?.subjectItemIds.slice() || [],
    todaySlotBindings: { ...asObject(enhanced?.slotBindings) },
    detailClaim,
    detailClaimId: detail?.claimId || '',
    detailAction: detail?.action || null,
    detailDimension: detail?.dimension || null,
    detailEvidenceIds: detail?.evidenceFactIds.slice() || [],
    detailRequiredFactIds: detail?.requiredFactIds.slice() || [],
    detailEvidenceSources: cloneEvidenceSources(detail?.evidenceSources),
    detailSentenceClusterId: detail?.claimId || '',
    detailSubjectItemId: detail?.subjectItemId || '',
    detailSubjectItemIds: detail?.subjectItemIds.slice() || [],
    detailSlotBindings: { ...asObject(detail?.slotBindings) },
    riskFlags: uniqueStrings(riskFlags),
    qualification: asObject(plan.qualification),
  };
  if (detail?.text) result.detailExplanation = detail.text;
  return result;
}

function canonicalClaim(candidate) {
  return {
    claimId: candidate.claimId,
    scene: candidate.scene,
    action: candidate.action,
    dimension: candidate.dimension,
    subjectItemIds: candidate.subjectItemIds.slice(),
    requiredFactIds: candidate.requiredFactIds.slice(),
    evidenceFactIds: candidate.evidenceFactIds.slice(),
    evidenceSources: cloneEvidenceSources(candidate.evidenceSources),
    slotBindings: { ...candidate.slotBindings },
    userValue: candidate.userValue,
    priority: candidate.priority,
  };
}

function collectAuthorizedFacts(input = {}) {
  const facts = asObject(asObject(input).facts);
  return uniqueStrings(Object.values(asObject(facts.itemFactsById)).flatMap((scope) =>
    asArray(scope?.factRecords).map((record) => readString(record?.fact))));
}

function cloneEvidenceSources(values) {
  return asArray(values).map((entry) => ({ ...entry }));
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map(readString).filter(Boolean))];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

module.exports = {
  COPY_CONTRACT_VERSION,
  buildRecommendationCopyContract,
  collectAuthorizedFacts,
};
