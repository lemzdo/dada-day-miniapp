const CLAIM_PERMISSION_VERSION = 'recommendation-claim-permission-v2.1-shadow';
const SURFACE_PERMISSION_VERSION = 'recommendation-surface-permission-v2.1-shadow';

function buildRecommendationClaimPermissionV2({ candidateSet = {} } = {}) {
  return {
    version: CLAIM_PERMISSION_VERSION,
    authorizedClaims: readArray(candidateSet.candidates).map(toClaimPermission),
    baselineCompositionClaim: {
      claimCode: 'outfit.composition_fact',
      evidenceRefs: [candidateSet.compositionEvidenceRef].filter(Boolean),
      allowsStylingConclusion: false,
    },
    blockedClaimFamilies: [
      'body_effect',
      'sensory_effect',
      'unsupported_ease_of_matching',
    ],
  };
}

function buildRecommendationSurfacePermissionV2({ resolution = {} } = {}) {
  const primary = resolution.primaryInsight || null;
  const secondary = resolution.selectedSecondaryInsight || null;
  const visibleIds = new Set([primary?.insightId, secondary?.insightId].filter(Boolean));
  const structuredOnlyInsightIds = readArray(resolution.unselectedCandidates)
    .map((candidate) => candidate.insightId)
    .filter((insightId) => !visibleIds.has(insightId));
  return {
    version: SURFACE_PERMISSION_VERSION,
    canonicalRecommendationInsightIds: primary ? [primary.insightId] : [],
    outfitCommentaryInsightIds: [primary?.insightId, secondary?.insightId].filter(Boolean),
    structuredOnlyInsightIds,
  };
}

function toClaimPermission(candidate) {
  return {
    insightId: candidate.insightId,
    claimCode: candidate.claimCode,
    subjectItemIds: candidate.subjectItemIds.slice(),
    evidenceRefs: candidate.evidenceRefs.slice(),
    authorization: 'evidence_authorized',
  };
}

function readArray(value) { return Array.isArray(value) ? value : []; }

module.exports = {
  CLAIM_PERMISSION_VERSION,
  SURFACE_PERMISSION_VERSION,
  buildRecommendationClaimPermissionV2,
  buildRecommendationSurfacePermissionV2,
};
