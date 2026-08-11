const { COPY_CONTRACT_VERSION } = require('./recommendationCopyContract');
const { compileRecommendationLanguageV3 } = require('./recommendationLanguageV3');
const { VOICE_BANK_VERSION } = require('./xiaodaVoiceBankV2');
const {
  FINALIZATION_MODES,
  hasAcceptedDefaultCopy,
  hideRejectedDefaultCopy,
} = require('./recommendationCopyFinalization');
const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');
const { validateEligibilityReasonPayload } = require('./recommendationEligibilityReason');
const { canonicalizeRecommendation } = require('./recommendationPresentation');

const CONTRACT_METADATA_FIELDS = [
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
];

function normalizeDefaultCopyAtResponseBoundary(outfit, context = {}) {
  if (!isPlainObject(outfit)) return outfit;
  const resolvedContext = isPlainObject(context) ? context : {};
  const mode = normalizeMode(resolvedContext.mode);
  if (outfit.copyContractVersion === COPY_CONTRACT_VERSION
    && outfit.voiceBankVersion === VOICE_BANK_VERSION
    && outfit.copyContract?.copyContractVersion === COPY_CONTRACT_VERSION
    && outfit.copyContract?.voiceBankVersion === VOICE_BANK_VERSION
    && typeof outfit.copyContract?.todayReason === 'string'
    && outfit.copyContract.todayReason.trim()
    && outfit.copyContract.gateResult === 'PASS'
    && Array.isArray(outfit.copyContract.riskFlags)
    && outfit.copyContract.riskFlags.length === 0
    && outfit.copyContract?.xiaodaStyleInsight?.version === 'xiaoda-style-insight-v1'
    && (mode === FINALIZATION_MODES.SAVED_SNAPSHOT
      || (typeof outfit.copyContract.coreEligibilityReason === 'string'
        && outfit.copyContract.coreEligibilityReason.trim()
        && Array.isArray(outfit.copyContract.coreEligibilityEvidence)
        && outfit.copyContract.coreEligibilityEvidence.length > 0))) return outfit;

  const compileSource = attachRuntimeEligibility(outfit, resolvedContext);
  const [compiled] = compileRecommendationLanguageV3({
    outfits: [compileSource],
    scene: resolvedContext.scene ?? outfit.scene,
    weather: resolvedContext.weather ?? outfit.weatherSnapshot ?? outfit.weather,
    seed: resolvedContext.seed,
    batchContext: resolvedContext.batchContext,
  });

  const canPresent = compiled?.copyContract?.gateResult === 'PASS'
    && Array.isArray(compiled?.copyContract?.riskFlags)
    && compiled.copyContract.riskFlags.length === 0
    && typeof compiled.copyContract.todayReason === 'string'
    && Boolean(compiled.copyContract.todayReason.trim());
  const presented = canPresent
    ? canonicalizeRecommendation(compiled, {
        scene: resolvedContext.scene ?? outfit.scene,
      })
    : compiled;
  const canonical = presented.copyContract;
  const patch = {
    copyContract: canonical,
    copyContractVersion: compiled.copyContractVersion,
    voiceBankVersion: compiled.voiceBankVersion,
    reasonVersion: compiled.reasonVersion,
    reason: canonical.todayReason,
    reasoning: canonical.detailExplanation,
    contentPlan: mergeContentPlan(outfit.contentPlan, presented.contentPlan),
    detailNarrativeViewModel: mergeDetailNarrativeViewModel(
      outfit.detailNarrativeViewModel,
      presented.detailNarrativeViewModel,
    ),
    reviewSource: compiled.reviewSource,
    aiComment: presented.aiComment,
    eligibility: presented.eligibility || compileSource.eligibility,
    xiaodaStyleInsight: presented.xiaodaStyleInsight,
    presentationPlan: presented.presentationPlan,
  };

  for (const field of CONTRACT_METADATA_FIELDS) patch[field] = canonical[field];
  const rehydrated = { ...outfit, ...patch, copyRehydrationMode: mode };
  return mode === FINALIZATION_MODES.SAVED_SNAPSHOT && !hasAcceptedDefaultCopy(rehydrated)
    ? hideRejectedDefaultCopy(rehydrated)
    : rehydrated;
}

function attachRuntimeEligibility(outfit, context) {
  const scene = context.scene ?? outfit.scene;
  const weather = context.weather ?? outfit.weatherSnapshot ?? outfit.weather;
  const currentScene = outfit.eligibility?.scene;
  if (validateEligibilityReasonPayload(currentScene, { scene, weather })) return outfit;
  const items = readOutfitItems(outfit);
  const sceneEligibility = evaluateSceneEligibilityV3({ scene, weather, items });
  return {
    ...outfit,
    eligibility: {
      ...(isPlainObject(outfit.eligibility) ? outfit.eligibility : {}),
      scene: sceneEligibility,
    },
  };
}

function readOutfitItems(outfit) {
  if (Array.isArray(outfit.items) && outfit.items.length > 0) return outfit.items;
  const snapshots = Array.isArray(outfit.itemsSnapshot) && outfit.itemsSnapshot.length > 0
    ? outfit.itemsSnapshot
    : Array.isArray(outfit.snapshotItems) ? outfit.snapshotItems : [];
  return snapshots.map((item) => ({
    ...item,
    _id: item._id || item.id || item.clothingId || item.itemId,
    clothingId: item.clothingId || item.itemId,
    subcategory: item.subcategory || item.subCategory || item.name || item.type,
  }));
}

function mergeContentPlan(existing, compiled) {
  const container = isPlainObject(existing) ? existing : compiled;
  return {
    ...container,
    defaultCopy: compiled.defaultCopy,
    defaultTodayReason: compiled.defaultTodayReason,
    defaultDetailExplanation: compiled.defaultDetailExplanation,
    xiaodaStyleInsight: compiled.xiaodaStyleInsight,
    personaVersion: compiled.personaVersion,
  };
}

function mergeDetailNarrativeViewModel(existing, compiled) {
  return {
    ...(isPlainObject(existing) ? existing : {}),
    defaultText: compiled.defaultText,
    source: compiled.source,
    aiStatus: compiled.aiStatus,
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeMode(value) {
  if (value === undefined || value === FINALIZATION_MODES.NEW_RECOMMENDATION) {
    return FINALIZATION_MODES.NEW_RECOMMENDATION;
  }
  if (value === FINALIZATION_MODES.SAVED_SNAPSHOT) return FINALIZATION_MODES.SAVED_SNAPSHOT;
  throw new Error(`unsupported recommendation rehydration mode: ${String(value)}`);
}

module.exports = {
  normalizeDefaultCopyAtResponseBoundary,
};
