const STYLING_INSIGHT_RESOLVER_VERSION = 'styling-insight-resolver-v2.1-shadow';

// These are semantic product classes, not a global InsightCode ranking. The
// upstream candidate builder declares which class each evidence-bound insight
// belongs to; the resolver only applies deterministic selection rules.
const SELECTION_CLASS_ORDER = Object.freeze([
  'decisive_context',
  'strong_outfit_relation',
  'generic_context',
]);
const VALUE_CLASS_ORDER = Object.freeze([
  'distinctive_focus',
  'structural_relation',
  'specific_relation',
  'decisive_practicality',
  'supporting_relation',
  'context_description',
]);
const EVIDENCE_STRENGTH_ORDER = Object.freeze(['strong', 'moderate', 'supporting']);

function resolveStylingInsightsV2(candidateSet = {}) {
  const candidates = readArray(candidateSet.candidates).slice().sort(compareStableIdentity);
  const materialCandidates = candidates
    .filter((candidate) => candidate?.materiality === 'material')
    .sort(compareSelectionValue);
  const weakCandidates = candidates.filter((candidate) => candidate?.materiality === 'weak');
  const primaryInsight = materialCandidates[0] || null;
  const secondaryPool = primaryInsight
    ? materialCandidates.filter((candidate) => isIndependentSecondary(candidate, primaryInsight))
    : [];
  const selectedSecondaryInsight = secondaryPool[0] || null;
  const selectedIds = new Set([
    primaryInsight?.insightId,
    selectedSecondaryInsight?.insightId,
  ].filter(Boolean));
  const unselectedCandidates = candidates
    .filter((candidate) => !selectedIds.has(candidate.insightId))
    .map((candidate) => ({
      ...candidate,
      selectionDecision: readUnselectedDecision(candidate, primaryInsight),
    }));
  const materiality = primaryInsight ? 'material' : weakCandidates.length > 0 ? 'weak' : 'none';
  const competition = selectedSecondaryInsight ? 'competing' : primaryInsight ? 'single' : 'none';

  return {
    version: STYLING_INSIGHT_RESOLVER_VERSION,
    materiality,
    competition,
    candidateMateriality: countMateriality(candidates),
    primaryInsightId: primaryInsight?.insightId || null,
    selectedSecondaryInsightId: selectedSecondaryInsight?.insightId || null,
    unselectedCandidateIds: unselectedCandidates.map((candidate) => candidate.insightId),
    weakInsightIds: weakCandidates.map((candidate) => candidate.insightId),
    primaryInsight,
    selectedSecondaryInsight,
    unselectedCandidates,
    weakCandidates,
    decisionCodes: buildDecisionCodes({
      materialCandidates,
      primaryInsight,
      selectedSecondaryInsight,
      unselectedCandidates,
      materiality,
    }),
  };
}

function compareSelectionValue(left, right) {
  const selectionClass = orderedIndex(SELECTION_CLASS_ORDER, left?.selectionClass)
    - orderedIndex(SELECTION_CLASS_ORDER, right?.selectionClass);
  if (selectionClass !== 0) return selectionClass;
  const valueClass = orderedIndex(VALUE_CLASS_ORDER, left?.valueClass)
    - orderedIndex(VALUE_CLASS_ORDER, right?.valueClass);
  if (valueClass !== 0) return valueClass;
  const evidenceStrength = orderedIndex(EVIDENCE_STRENGTH_ORDER, left?.evidenceStrength)
    - orderedIndex(EVIDENCE_STRENGTH_ORDER, right?.evidenceStrength);
  if (evidenceStrength !== 0) return evidenceStrength;
  return compareStableIdentity(left, right);
}

function compareStableIdentity(left, right) {
  return String(left?.insightId || '').localeCompare(String(right?.insightId || ''));
}

function isIndependentSecondary(candidate, primary) {
  if (!candidate || candidate.secondaryEligible !== true) return false;
  if (!readArray(candidate.evidenceRefs).length) return false;
  if (candidate.semanticFamily === primary.semanticFamily) return false;
  return true;
}

function readUnselectedDecision(candidate, primary) {
  if (candidate.materiality === 'weak') return 'weak_structured_asset_only';
  if (primary && candidate.semanticFamily === primary.semanticFamily) return 'semantic_duplicate_of_primary';
  if (candidate.secondaryEligible !== true) return 'insufficient_independent_secondary_value';
  return 'secondary_slot_not_selected';
}

function buildDecisionCodes({
  materialCandidates,
  primaryInsight,
  selectedSecondaryInsight,
  unselectedCandidates,
  materiality,
}) {
  if (!primaryInsight) return materiality === 'weak'
    ? ['WEAK_ONLY_NO_PRIMARY', 'WEAK_PRESERVED_STRUCTURED_ONLY']
    : ['SPARSE_NO_MATERIAL_INSIGHT'];
  const codes = [
    'MATERIAL_PRIMARY_SELECTED',
    primaryDecisionCode(primaryInsight),
    ...primaryTieBreakDecisionCodes(materialCandidates),
    selectedSecondaryInsight ? 'INDEPENDENT_SECONDARY_SELECTED' : 'NO_SECONDARY_SELECTED',
  ];
  if (materialCandidates.length > 1) codes.push('MULTIPLE_MATERIAL_CANDIDATES_REVIEWED');
  if (unselectedCandidates.some((candidate) => candidate.selectionDecision === 'semantic_duplicate_of_primary')) {
    codes.push('SEMANTIC_DUPLICATE_UNSELECTED');
  }
  if (unselectedCandidates.some((candidate) => candidate.selectionDecision === 'secondary_slot_not_selected')) {
    codes.push('SECONDARY_CAP_ENFORCED');
  }
  return codes;
}

function primaryTieBreakDecisionCodes(materialCandidates) {
  const primary = materialCandidates[0];
  const runnerUp = materialCandidates[1];
  if (!primary || !runnerUp) return [];
  if (primary.selectionClass !== runnerUp.selectionClass) return ['PRIMARY_SELECTION_CLASS_DECIDED'];
  if (primary.valueClass !== runnerUp.valueClass) return ['PRIMARY_VALUE_CLASS_DECIDED'];
  if (primary.evidenceStrength !== runnerUp.evidenceStrength) return ['PRIMARY_EVIDENCE_STRENGTH_DECIDED'];
  return ['PRIMARY_STABLE_ID_TIEBREAK'];
}

function primaryDecisionCode(primary) {
  if (primary.selectionClass === 'decisive_context') return 'PRIMARY_DECISIVE_CONTEXT';
  if (primary.selectionClass === 'strong_outfit_relation') return 'PRIMARY_SPECIFIC_OUTFIT_RELATION';
  return 'PRIMARY_CONTEXT_EVIDENCE';
}

function countMateriality(candidates) {
  return {
    material: candidates.filter((candidate) => candidate.materiality === 'material').length,
    weak: candidates.filter((candidate) => candidate.materiality === 'weak').length,
    none: candidates.filter((candidate) => candidate.materiality === 'none').length,
  };
}

function orderedIndex(order, value) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function readArray(value) { return Array.isArray(value) ? value : []; }

module.exports = {
  EVIDENCE_STRENGTH_ORDER,
  SELECTION_CLASS_ORDER,
  STYLING_INSIGHT_RESOLVER_VERSION,
  VALUE_CLASS_ORDER,
  resolveStylingInsightsV2,
};
