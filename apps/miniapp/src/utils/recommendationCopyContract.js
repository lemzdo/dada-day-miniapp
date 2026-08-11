const COPY_CONTRACT_VERSION = 'recommendation-copy-contract-v8';
const VOICE_BANK_VERSION = 'xiaoda-fixed-claim-catalog-v2';
const COPY_NATURALNESS_GATE_VERSION = 'copy-naturalness-gate-v3';

const DEFAULT_COPY_FIELDS = [
  'reason',
  'reasoning',
  'reasonVersion',
  'copyContract',
  'copyContractVersion',
  'voiceBankVersion',
  'todayClaim',
  'todayClaimId',
  'todayAction',
  'todayDimension',
  'todayEvidenceIds',
  'todayRequiredFactIds',
  'todayEvidenceSources',
  'todaySentenceClusterId',
  'todaySubjectItemId',
  'todaySubjectItemIds',
  'todaySlotBindings',
  'todayReasonSource',
  'coreEligibilityReason',
  'coreEligibilityReasonCode',
  'coreEligibilityEvidence',
  'coreEligibilitySubjectItemIds',
  'coreEligibilitySupportingFactIds',
  'coreEligibilityRelationFactIds',
  'coreEligibilitySourceRule',
  'coreEligibilitySourceRuleReasons',
  'enhancedReason',
  'enhancementRejectReasons',
  'detailClaim',
  'detailClaimId',
  'detailAction',
  'detailDimension',
  'detailEvidenceIds',
  'detailRequiredFactIds',
  'detailEvidenceSources',
  'detailSentenceClusterId',
  'detailSubjectItemId',
  'detailSubjectItemIds',
  'detailSlotBindings',
  'riskFlags',
  'qualification',
  'primaryDimension',
  'primaryInsightCode',
  'evidenceCodes',
  'validatorRejectReasons',
  'todayCopyProvenance',
  'detailCopyProvenance',
  'naturalnessGateVersion',
  'naturalnessGateResult',
  'naturalnessRiskFlags',
  'structuralNaturalnessVersion',
  'structuralNaturalnessResult',
  'structuralNaturalnessRiskFlags',
  'structuralNaturalnessWarningFlags',
  'messageIntent',
  'messageCandidateId',
  'messageDimension',
  'valueAssessment',
];

const FALLBACK_REVIEW_SOURCES = new Set([
  'rule_default',
  'rule_fallback',
  'cached_fallback',
  'fallback',
  'legacy',
]);
function hasCurrentDefaultCopy(outfit) {
  return hasCurrentCopyContract(outfit)
    && outfit.copyContract.gateResult === 'PASS'
    && typeof outfit.copyContract.todayReason === 'string'
    && Boolean(outfit.copyContract.todayReason.trim())
    && Array.isArray(outfit.copyContract.riskFlags)
    && outfit.copyContract.riskFlags.length === 0
    && outfit.copyContract.naturalnessGateVersion === COPY_NATURALNESS_GATE_VERSION
    && outfit.copyContract.naturalnessGateResult === 'PASS'
    && Array.isArray(outfit.copyContract.naturalnessRiskFlags)
    && outfit.copyContract.naturalnessRiskFlags.length === 0
    && outfit.copyContract.structuralNaturalnessResult === 'PASS'
    && Array.isArray(outfit.copyContract.structuralNaturalnessRiskFlags)
    && outfit.copyContract.structuralNaturalnessRiskFlags.length === 0
    && outfit.copyContract.xiaodaStyleInsight?.version === 'xiaoda-style-insight-v3'
    && isPlainObject(outfit.copyContract.todayCopyProvenance);
}

function hasCurrentCopyContract(outfit) {
  return isPlainObject(outfit)
    && outfit.copyContractVersion === COPY_CONTRACT_VERSION
    && outfit.voiceBankVersion === VOICE_BANK_VERSION
    && isPlainObject(outfit.copyContract)
    && outfit.copyContract.copyContractVersion === COPY_CONTRACT_VERSION
    && outfit.copyContract.voiceBankVersion === VOICE_BANK_VERSION
    && ['PASS', 'REJECT'].includes(outfit.copyContract.gateResult)
    && Array.isArray(outfit.copyContract.riskFlags);
}

function hasCurrentNewRecommendationCopy(outfit) {
  return hasCurrentDefaultCopy(outfit)
    && outfit.copyFinalizationMode === 'new_recommendation'
    && typeof outfit.copyContract.coreEligibilityReason === 'string'
    && Boolean(outfit.copyContract.coreEligibilityReason.trim())
    && typeof outfit.copyContract.coreEligibilityReasonCode === 'string'
    && Boolean(outfit.copyContract.coreEligibilityReasonCode.trim())
    && Array.isArray(outfit.copyContract.coreEligibilityEvidence)
    && outfit.copyContract.coreEligibilityEvidence.length > 0;
}

function stripStaleDefaultCopy(outfit) {
  if (!isPlainObject(outfit) || hasCurrentDefaultCopy(outfit)) return outfit;
  if (hasCurrentCopyContract(outfit)) return hideCurrentDefaultCopy(outfit);

  const next = { ...outfit };
  for (const field of DEFAULT_COPY_FIELDS) delete next[field];

  if (isPlainObject(outfit.contentPlan)) {
    const contentPlan = { ...outfit.contentPlan };
    delete contentPlan.defaultCopy;
    delete contentPlan.defaultTodayReason;
    delete contentPlan.defaultDetailExplanation;
    next.contentPlan = contentPlan;
  }

  if (isPlainObject(outfit.detailNarrativeViewModel)) {
    const detailNarrativeViewModel = { ...outfit.detailNarrativeViewModel };
    delete detailNarrativeViewModel.defaultText;
    delete detailNarrativeViewModel.source;
    delete detailNarrativeViewModel.aiStatus;
    next.detailNarrativeViewModel = detailNarrativeViewModel;
  }

  if (!resolveRealAiReviewSource(outfit)) {
    delete next.aiComment;
    delete next.reviewSource;
    delete next.enhanced;
  }

  return next;
}

function hideCurrentDefaultCopy(outfit) {
  const copyContract = {
    ...outfit.copyContract,
    gateResult: 'REJECT',
    copyDisplay: 'hidden',
    todayReason: '',
    todayClaim: null,
    todayClaimId: '',
    todayEvidenceIds: [],
    todayRequiredFactIds: [],
    todayEvidenceSources: [],
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
    detailClaim: null,
    detailClaimId: '',
    detailEvidenceIds: [],
    detailRequiredFactIds: [],
    detailEvidenceSources: [],
  };
  delete copyContract.detailExplanation;
  const next = {
    ...outfit,
    copyContract,
    reason: '',
    reasoning: undefined,
    todayClaim: null,
    todayClaimId: '',
    todayEvidenceIds: [],
    todayRequiredFactIds: [],
    todayEvidenceSources: [],
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
    detailClaim: null,
    detailClaimId: '',
    detailEvidenceIds: [],
    detailRequiredFactIds: [],
    detailEvidenceSources: [],
    copyGateResult: 'REJECT',
    copyRiskFlags: copyContract.riskFlags.slice(),
    copyDisplay: 'hidden',
    defaultCopyHidden: true,
  };

  if (isPlainObject(outfit.contentPlan)) {
    next.contentPlan = {
      ...outfit.contentPlan,
      defaultCopy: { ...copyContract },
      defaultTodayReason: '',
      defaultDetailExplanation: undefined,
    };
  }
  if (isPlainObject(outfit.detailNarrativeViewModel)) {
    next.detailNarrativeViewModel = {
      ...outfit.detailNarrativeViewModel,
      defaultText: '',
    };
  }
  if (!resolveRealAiReviewSource(outfit)) {
    delete next.aiComment;
    delete next.reviewSource;
    delete next.enhanced;
  }
  return next;
}

function getSavedSnapshotDefaultCopy(outfit) {
  if (!hasCurrentDefaultCopy(outfit)) return '';
  if (typeof outfit.copyContract.detailExplanation === 'string'
    && outfit.copyContract.detailExplanation.trim()) return outfit.copyContract.detailExplanation;
  return outfit.copyContract.todayReason;
}

function resolveRealAiReviewSource(outfit) {
  if (!isPlainObject(outfit.aiComment)) return '';
  const sources = [
    outfit.reviewSource,
    outfit.aiComment.source,
    outfit.aiComment.reviewSource,
    isPlainObject(outfit.aiComment.explanationV2)
      ? outfit.aiComment.explanationV2.source
      : undefined,
  ].map(normalizeReviewSource).filter(Boolean);

  if (sources.some((source) => FALLBACK_REVIEW_SOURCES.has(source))) return '';
  if (sources.includes('cached_ai')) return 'cached_ai';
  if (sources.includes('ai')) return 'ai';
  return outfit.enhanced === true ? 'ai' : '';
}

function normalizeReviewSource(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = {
  COPY_CONTRACT_VERSION,
  COPY_NATURALNESS_GATE_VERSION,
  VOICE_BANK_VERSION,
  getSavedSnapshotDefaultCopy,
  hasCurrentCopyContract,
  hasCurrentDefaultCopy,
  hasCurrentNewRecommendationCopy,
  stripStaleDefaultCopy,
};
