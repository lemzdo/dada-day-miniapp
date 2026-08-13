const crypto = require('crypto');
const { buildStylingInsightCandidatesV2 } = require('./stylingInsightCandidateV2');
const { resolveStylingInsightsV2 } = require('./stylingInsightResolverV2');
const {
  buildRecommendationClaimPermissionV2,
  buildRecommendationSurfacePermissionV2,
} = require('./recommendationClaimPermissionV2');

const RECOMMENDATION_NARRATIVE_PLAN_VERSION = 'recommendation-narrative-plan-v2.1-shadow';

function buildRecommendationNarrativePlanV2(input = {}, options = {}) {
  const candidateSet = buildStylingInsightCandidatesV2(input);
  const resolution = resolveStylingInsightsV2(candidateSet);
  const claimPermission = buildRecommendationClaimPermissionV2({ candidateSet });
  const surfacePermission = buildRecommendationSurfacePermissionV2({ resolution });
  const expressionStrategy = buildExpressionStrategy({ candidateSet, resolution, input, options });
  const participatingEvidenceRefs = uniqueSorted([
    candidateSet.compositionEvidenceRef,
    ...candidateSet.candidates.flatMap((candidate) => candidate.evidenceRefs),
    ...candidateSet.limitations.flatMap((limitation) => limitation.evidenceRefs),
  ]);
  const evidenceFingerprint = hashStable({ participatingEvidenceRefs });
  const relevantContext = buildRelevantContext({ candidateSet, input, options });
  const relevantContextFingerprint = hashStable(relevantContext);
  const identity = {
    outfitComposition: {
      key: candidateSet.compositionKey,
      itemIds: candidateSet.itemIds.slice(),
    },
    recommendationInstance: {
      id: readText(options.recommendationInstanceId) || 'shadow-instance',
    },
    relevantContextFingerprint,
    evidenceFingerprint,
  };
  const insightPlan = {
    primary: resolution.primaryInsight ? cloneInsight(resolution.primaryInsight) : null,
    selectedSecondary: resolution.selectedSecondaryInsight
      ? cloneInsight(resolution.selectedSecondaryInsight) : null,
    unselected: resolution.unselectedCandidates.map(cloneUnselectedInsight),
    weak: resolution.weakCandidates.map(cloneInsight),
  };
  const core = {
    version: RECOMMENDATION_NARRATIVE_PLAN_VERSION,
    sourceVersions: candidateSet.sourceVersions,
    identity,
    relevantContext,
    resolution: stripResolutionCandidates(resolution),
    insights: insightPlan,
    claimPermission,
    surfacePermission,
    expressionStrategy,
    limitations: candidateSet.limitations.map(cloneLimitation),
    participatingEvidenceRefs,
    commentaryPlanRelationship: {
      status: 'reserved_not_implemented',
      mayUsePrimary: true,
      mayUseSelectedSecondary: true,
      mayUseRawGarmentAttributes: false,
    },
  };
  const planHash = computeRecommendationNarrativePlanHash(core);
  const plan = {
    ...core,
    planId: `${RECOMMENDATION_NARRATIVE_PLAN_VERSION}:${planHash}`,
    planHash,
  };
  const validation = validateRecommendationNarrativePlanV2(plan);
  if (!validation.valid) {
    const error = new Error(`invalid shadow narrative plan: ${validation.errors.join(',')}`);
    error.validationErrors = validation.errors;
    throw error;
  }
  return plan;
}

function buildRelevantContext({ candidateSet, input, options }) {
  const sources = [
    ...candidateSet.candidates,
    ...candidateSet.limitations,
  ];
  const usesScene = sources.some((entry) => entry.contextDependencies?.scene === true);
  const usesWeather = sources.some((entry) => entry.contextDependencies?.weather === true);
  const usesPreference = sources.some((entry) => entry.contextDependencies?.preference === true);
  const weather = options.weather || input.weather || {};
  return {
    ...(usesScene ? { scene: readText(options.scene || input.scene) } : {}),
    ...(usesWeather ? {
      weather: {
        temperature: readFiniteNumber(weather.temp ?? weather.temperature),
        mode: readText(weather.mode || weather.weatherMode),
      },
    } : {}),
    ...(usesPreference ? { preferenceEvidencePresent: true } : {}),
  };
}

function buildExpressionStrategy({ candidateSet, resolution, input, options }) {
  if (resolution.primaryInsight) {
    return {
      mode: 'primary',
      semanticMode: 'evidence_bound_primary',
      insightId: resolution.primaryInsight.insightId,
    };
  }
  const usesScene = candidateSet.candidates.some((entry) => entry.contextDependencies?.scene === true);
  const usesWeather = candidateSet.candidates.some((entry) => entry.contextDependencies?.weather === true);
  const weather = options.weather || input.weather || {};
  if (usesWeather && readText(weather.mode || weather.weatherMode) !== 'unavailable') {
    return { mode: 'baseline', semanticMode: 'weather_practicality', insightId: null };
  }
  if (usesScene && readText(options.scene || input.scene)) {
    return { mode: 'baseline', semanticMode: 'scene_practicality', insightId: null };
  }
  return {
    mode: 'baseline',
    semanticMode: candidateSet.itemIds.length > 1 ? 'direct_combination' : 'simple_baseline',
    insightId: null,
  };
}

function validateRecommendationNarrativePlanV2(plan) {
  const errors = [];
  if (plan?.version !== RECOMMENDATION_NARRATIVE_PLAN_VERSION) errors.push('PLAN_VERSION_INVALID');
  if (!readText(plan?.identity?.outfitComposition?.key)) errors.push('COMPOSITION_KEY_MISSING');
  if (plan?.planHash !== computeRecommendationNarrativePlanHash(plan)) errors.push('PLAN_HASH_MISMATCH');

  const primary = plan?.insights?.primary;
  const secondary = plan?.insights?.selectedSecondary || null;
  const authorizedClaims = readArray(plan?.claimPermission?.authorizedClaims);
  const authorizedInsightIds = new Set(authorizedClaims.map((permission) => permission.insightId));
  const canonicalInsightIds = readArray(plan?.surfacePermission?.canonicalRecommendationInsightIds);
  const commentaryInsightIds = readArray(plan?.surfacePermission?.outfitCommentaryInsightIds);
  const structuredOnlyInsightIds = readArray(plan?.surfacePermission?.structuredOnlyInsightIds);
  const expectedCommentaryInsightIds = [primary?.insightId, secondary?.insightId].filter(Boolean);
  if (primary && canonicalInsightIds.length !== 1) errors.push('PRIMARY_SURFACE_PERMISSION_MISSING');
  if (!primary && canonicalInsightIds.length !== 0) errors.push('CANONICAL_SURFACE_WITHOUT_PRIMARY');
  if (primary && canonicalInsightIds[0] !== primary.insightId) errors.push('CANONICAL_SURFACE_IDENTITY_MISMATCH');
  if (secondary && !commentaryInsightIds.includes(secondary.insightId)) errors.push('SECONDARY_COMMENTARY_SURFACE_MISSING');
  if (secondary && canonicalInsightIds.includes(secondary.insightId)) errors.push('SECONDARY_ENTERED_CANONICAL_SURFACE');
  if (canonicalInsightIds.some((insightId) => !authorizedInsightIds.has(insightId))) {
    errors.push('CANONICAL_SURFACE_WITHOUT_CLAIM_AUTHORIZATION');
  }
  if (commentaryInsightIds.some((insightId) => !authorizedInsightIds.has(insightId))) {
    errors.push('COMMENTARY_SURFACE_WITHOUT_CLAIM_AUTHORIZATION');
  }
  if (new Set(commentaryInsightIds).size !== commentaryInsightIds.length) {
    errors.push('DUPLICATE_COMMENTARY_SURFACE_PERMISSION');
  }
  if (stableSerialize(commentaryInsightIds.slice().sort()) !== stableSerialize(expectedCommentaryInsightIds.slice().sort())) {
    errors.push('COMMENTARY_SURFACE_SELECTION_MISMATCH');
  }
  if (readArray(plan?.insights?.unselected).some((item) => commentaryInsightIds.includes(item.insightId))) {
    errors.push('UNSELECTED_ENTERED_COMMENTARY_SURFACE');
  }
  if (readArray(plan?.insights?.unselected).some((item) => !structuredOnlyInsightIds.includes(item.insightId))) {
    errors.push('UNSELECTED_STRUCTURED_SURFACE_MISSING');
  }
  if (structuredOnlyInsightIds.some((insightId) => commentaryInsightIds.includes(insightId))) {
    errors.push('STRUCTURED_ONLY_ENTERED_COMMENTARY_SURFACE');
  }

  const participating = new Set(Array.isArray(plan?.participatingEvidenceRefs) ? plan.participatingEvidenceRefs : []);
  for (const permission of authorizedClaims) {
    if (!Array.isArray(permission.evidenceRefs) || permission.evidenceRefs.length === 0) errors.push('CLAIM_EVIDENCE_MISSING');
    if (permission.evidenceRefs?.some((ref) => !participating.has(ref))) errors.push('CLAIM_EVIDENCE_OUTSIDE_PLAN');
  }
  if (plan?.claimPermission?.baselineCompositionClaim?.allowsStylingConclusion !== false) errors.push('BASELINE_STYLING_CONCLUSION_ALLOWED');
  if (authorizedClaims.some((permission) => permission.claimCode === 'style.easy_to_match')) {
    errors.push('UNSUPPORTED_EASE_OF_MATCHING_CLAIM');
  }
  if (!['primary', 'baseline'].includes(plan?.expressionStrategy?.mode)) errors.push('EXPRESSION_MODE_INVALID');
  if (primary && plan?.expressionStrategy?.mode !== 'primary') errors.push('PRIMARY_EXPRESSION_MODE_MISMATCH');
  if (!primary && plan?.expressionStrategy?.mode !== 'baseline') errors.push('BASELINE_EXPRESSION_MODE_MISMATCH');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeRecommendationNarrativePlanHash(plan) {
  return hashStable({
    version: plan?.version,
    sourceVersions: plan?.sourceVersions,
    outfitComposition: plan?.identity?.outfitComposition,
    relevantContextFingerprint: plan?.identity?.relevantContextFingerprint,
    evidenceFingerprint: plan?.identity?.evidenceFingerprint,
    resolution: plan?.resolution,
    insights: plan?.insights,
    claimPermission: plan?.claimPermission,
    surfacePermission: plan?.surfacePermission,
    expressionStrategy: plan?.expressionStrategy,
    limitations: plan?.limitations,
    commentaryPlanRelationship: plan?.commentaryPlanRelationship,
  });
}

function stripResolutionCandidates(resolution) {
  return {
    version: resolution.version,
    materiality: resolution.materiality,
    competition: resolution.competition,
    candidateMateriality: { ...resolution.candidateMateriality },
    primaryInsightId: resolution.primaryInsightId,
    selectedSecondaryInsightId: resolution.selectedSecondaryInsightId,
    unselectedCandidateIds: resolution.unselectedCandidateIds.slice(),
    weakInsightIds: resolution.weakInsightIds.slice(),
    decisionCodes: resolution.decisionCodes.slice(),
  };
}

function cloneInsight(insight) {
  return {
    version: insight.version,
    insightId: insight.insightId,
    insightCode: insight.insightCode,
    materiality: insight.materiality,
    claimCode: insight.claimCode,
    semanticFamily: insight.semanticFamily,
    selectionClass: insight.selectionClass,
    valueClass: insight.valueClass,
    secondaryEligible: insight.secondaryEligible,
    evidenceType: insight.evidenceType,
    evidenceStrength: insight.evidenceStrength,
    subjectItemIds: insight.subjectItemIds.slice(),
    evidenceRefs: insight.evidenceRefs.slice(),
    sources: insight.sources.map((source) => ({ ...source })),
    contextDependencies: { ...insight.contextDependencies },
  };
}

function cloneUnselectedInsight(insight) {
  return {
    ...cloneInsight(insight),
    selectionDecision: insight.selectionDecision,
  };
}

function cloneLimitation(limitation) {
  return {
    sourceKind: limitation.sourceKind,
    sourceCode: limitation.sourceCode,
    subjectItemIds: limitation.subjectItemIds.slice(),
    evidenceRefs: limitation.evidenceRefs.slice(),
    contextDependencies: { ...limitation.contextDependencies },
  };
}

function hashStable(value) {
  return crypto.createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function uniqueSorted(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))].sort();
}

function readFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readText(value) { return typeof value === 'string' ? value.trim() : ''; }
function readArray(value) { return Array.isArray(value) ? value : []; }

module.exports = {
  RECOMMENDATION_NARRATIVE_PLAN_VERSION,
  buildRecommendationNarrativePlanV2,
  computeRecommendationNarrativePlanHash,
  validateRecommendationNarrativePlanV2,
};
