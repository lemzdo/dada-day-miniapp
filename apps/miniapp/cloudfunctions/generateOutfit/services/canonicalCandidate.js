const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { createCandidateDerivedFacts } = require('./candidateDerivedFacts');

const CANDIDATE_CORE_VERSION = 'candidate-core-v1';
const CANONICAL_CANDIDATE_VERSION = 'canonical-candidate-v1';
const REQUIRED_ROLE_KEYS = Object.freeze(['top', 'bottom', 'onepiece', 'outerwear', 'shoes']);
const QUALITY_COMPARABILITY_DELTA = 1.25;

function createCandidateCore(composition = {}, options = {}) {
  const source = composition && typeof composition === 'object' ? composition : {};
  const items = Array.isArray(source.items) ? source.items.filter(isItem) : [];
  const itemFactRefs = items.map((item) => ({
    itemId: readItemId(item),
    slot: readSlot(item),
    role: readRole(item),
  })).filter((item) => item.itemId);
  const itemIds = itemFactRefs.map((item) => item.itemId);
  const roleItemIds = buildRoleItemIds(itemFactRefs);
  const itemFactRecords = itemFactRefs.map((ref) => resolveItemFacts(ref, options)
    || { sourceItem: resolveSourceItem(ref.itemId, options) });
  const archetype = buildArchetype(roleItemIds);
  const selectionSignatures = buildSelectionSignatures({
    itemIds,
    roleItemIds,
    archetype,
    itemFactRecords,
    scene: options.scene,
  });
  const derivedFacts = options.useCandidateDerivedFacts === false
    ? null
    : createCandidateDerivedFacts({
      itemFactRefs,
      itemFactRecords,
      roleItemIds,
      archetype,
      selectionSignatures,
      instrumentation: options.instrumentation,
    });

  recordMetric(options.instrumentation, 'createCandidateCore');
  return {
    version: CANDIDATE_CORE_VERSION,
    compositionVersion: source.compositionVersion || '',
    structureType: source.structureType || '',
    itemIds,
    roleItemIds,
    itemFactRefs,
    archetype,
    derivedFacts,
    aggregateEligibilityFacts: {
      itemCount: itemIds.length,
      roleCount: Object.values(roleItemIds).filter(Boolean).length,
    },
    weatherEligibility: null,
    sceneEligibility: null,
    eligibilityReason: null,
    eligibilityReasonCandidates: [],
    scoreBreakdown: {},
    scores: {},
    totalScore: 0,
    rankingScore: 0,
    selectionSignatures,
    validatorRejectReasons: [],
    riskFlags: [],
  };
}

function materializeCanonicalCandidate(core, options = {}) {
  const candidate = requireCandidate(core);
  if (candidate.version !== CANDIDATE_CORE_VERSION) return candidate;
  const items = candidate.itemFactRefs.map((ref) => materializeItem(ref, options));
  const itemsByRole = buildItemsByRole(items);
  const outfitItemRoles = items.map((item) => ({
    id: readItemId(item),
    slot: readSlot(item),
    role: readRole(item),
    displayName: readDisplayName(item),
  }));
  const visibleFacts = options.itemFactsContext
    ? options.itemFactsContext.buildVisibleFacts(items)
    : adaptLegacyVisibleFacts(items);
  const copyFacts = buildOutfitCopyFacts({
    outfit: {
      items,
      outfitItemRoles,
      scene: options.scene,
      weatherSnapshot: options.weather,
      eligibility: candidate.eligibility,
    },
    scene: options.scene,
    weather: options.weather,
    itemFactsContext: options.itemFactsContext,
  });

  recordMetric(options.instrumentation, 'materializeCanonicalCandidate');
  recordMetric(options.instrumentation, 'materializeVisibleFacts');
  recordMetric(options.instrumentation, 'materializeCopyFacts');
  recordMetric(options.instrumentation, 'materializeDisplayFacts');
  return {
    version: CANONICAL_CANDIDATE_VERSION,
    compositionVersion: candidate.compositionVersion,
    structureType: candidate.structureType,
    itemIds: candidate.itemIds.slice(),
    roleItemIds: { ...candidate.roleItemIds },
    itemFactRefs: candidate.itemFactRefs.map((ref) => ({ ...ref })),
    archetype: candidate.archetype,
    aggregateEligibilityFacts: { ...candidate.aggregateEligibilityFacts },
    items,
    itemsByRole,
    outfitItemRoles,
    visibleFacts,
    copyFacts,
    displayFacts: buildDisplayFacts(copyFacts, options.scene, options.weather),
    weatherEligibility: candidate.weatherEligibility,
    sceneEligibility: candidate.sceneEligibility,
    eligibility: candidate.eligibility,
    eligibilityReason: candidate.eligibilityReason,
    eligibilityReasonCandidates: candidate.eligibilityReasonCandidates,
    riskFlags: candidate.riskFlags,
    validatorRejectReasons: candidate.validatorRejectReasons,
    matchedScene: candidate.matchedScene || '',
    scores: { ...candidate.scores },
    scoreBreakdown: { ...candidate.scoreBreakdown },
    totalScore: candidate.totalScore,
    rankingScore: candidate.rankingScore,
    outfitKey: candidate.outfitKey || candidate.selectionSignatures.itemSignature,
    selectionSignatures: { ...candidate.selectionSignatures },
    sceneIntent: candidate.sceneIntent,
    primaryBenefit: candidate.primaryBenefit,
    primaryBenefitCode: candidate.primaryBenefitCode,
    secondaryBenefit: candidate.secondaryBenefit,
    observationFocus: candidate.observationFocus,
    batchSelection: candidate.batchSelection,
  };
}

// Compatibility adapter for focused module tests. Production uses createCandidateCore
// and only calls materializeCanonicalCandidate after set-level selection.
function adaptCompositionCandidate(composition = {}, options = {}) {
  const sourceItemById = new Map((Array.isArray(composition.items) ? composition.items : [])
    .map((item) => [readItemId(item), item]));
  return materializeCanonicalCandidate(createCandidateCore(composition, {
    ...options,
    sourceItemById,
  }), {
    ...options,
    sourceItemById,
  });
}

function hydrateCanonicalEligibility(candidate, {
  weatherEligibility,
  sceneEligibility,
  eligibilityReason,
  eligibilityReasonCandidates,
  riskFlags,
  validatorRejectReasons,
} = {}) {
  const target = requireCandidate(candidate);
  target.weatherEligibility = weatherEligibility || null;
  target.sceneEligibility = sceneEligibility || null;
  target.eligibility = {
    weather: target.weatherEligibility,
    scene: target.sceneEligibility,
    penalty: round2((Number(target.weatherEligibility?.penalty) || 0) + (Number(target.sceneEligibility?.penalty) || 0)),
  };
  target.eligibilityReason = eligibilityReason || null;
  target.eligibilityReasonCandidates = Array.isArray(eligibilityReasonCandidates)
    ? eligibilityReasonCandidates
    : target.eligibilityReasonCandidates;
  target.riskFlags = uniqueStrings(riskFlags);
  target.validatorRejectReasons = uniqueStrings(validatorRejectReasons);
  if (target.selectionSignatures && typeof target.selectionSignatures === 'object') {
    target.selectionSignatures.reasonCodeSignature = target.eligibilityReasonCandidates[0]?.code
      || target.eligibilityReason?.code
      || '';
  }
  return target;
}

function hydrateCanonicalScore(candidate, scored = {}) {
  const target = requireCandidate(candidate);
  const scores = scored.scores && typeof scored.scores === 'object' ? scored.scores : {};
  target.matchedScene = scored.matchedScene || '';
  if (target.version === CANONICAL_CANDIDATE_VERSION) target.title = scored.title || target.title || '';
  target.scores = { ...scores };
  target.scoreBreakdown = { ...scores };
  target.totalScore = Number(scores.total) || 0;
  if (target.version === CANONICAL_CANDIDATE_VERSION) {
    target.scoreExplanations = Array.isArray(scored.scoreExplanations) ? scored.scoreExplanations : [];
    target.reasoning = scored.reasoning || '';
  }
  return target;
}

function setCanonicalReasonCandidates(candidate, reasons = []) {
  const target = requireCandidate(candidate);
  target.eligibilityReasonCandidates = Array.isArray(reasons)
    ? reasons.map((reason) => cloneReason(reason)).filter(Boolean)
    : [];
  return target;
}

function selectCanonicalCandidateBatch(candidates = [], limit = 8) {
  const remaining = (Array.isArray(candidates) ? candidates : [])
    .map(requireCandidate)
    .filter((candidate) => candidate.itemIds.length > 0)
    .slice();
  const selected = [];

  while (selected.length < limit && remaining.length > 0) {
    const bestQuality = Math.max(...remaining.map((candidate) => baseQuality(candidate)));
    const comparable = remaining.filter((candidate) => baseQuality(candidate) >= bestQuality - QUALITY_COMPARABILITY_DELTA);
    const pool = comparable.length > 0 ? comparable : remaining;
    const ranked = pool
      .map((candidate) => ({ candidate, evaluation: evaluateSetContribution(candidate, selected, bestQuality, comparable) }))
      .sort((left, right) => right.evaluation.utility - left.evaluation.utility
        || right.evaluation.baseQuality - left.evaluation.baseQuality
        || readItemSignature(left.candidate).localeCompare(readItemSignature(right.candidate)));
    const chosen = ranked[0];
    if (!chosen) break;
    chosen.candidate.batchSelection = {
      ...chosen.evaluation,
      comparableAlternativeCount: Math.max(0, comparable.length - 1),
      selectionBasis: chosen.evaluation.repeatedRoles.length > 0
        ? chosen.evaluation.reuseExplanation
        : 'set_level_diversity',
    };
    selected.push(chosen.candidate);
    const index = remaining.indexOf(chosen.candidate);
    if (index >= 0) remaining.splice(index, 1);
  }

  return selected;
}

function evaluateSetContribution(candidate, selected, bestQuality, comparableCandidates = []) {
  const repeatedRoles = [];
  let reusePenalty = 0;
  for (const role of REQUIRED_ROLE_KEYS) {
    const itemId = readRoleItemId(candidate, role);
    if (!itemId) continue;
    const reuseCount = selected.filter((entry) => readRoleItemId(entry, role) === itemId).length;
    if (reuseCount > 0) {
      repeatedRoles.push(role);
      reusePenalty += reuseCount === 1 ? 1.8 : 3.6 + reuseCount;
    }
  }
  const archetypeReuse = selected.filter((entry) => entry.archetype === candidate.archetype).length;
  const preferredReason = candidate.eligibilityReasonCandidates[0]?.code || candidate.eligibilityReason?.code || '';
  const reasonReuse = preferredReason
    ? selected.filter((entry) => (entry.eligibilityReason?.code || entry.eligibilityReasonCandidates[0]?.code) === preferredReason).length
    : 0;
  const titleSignature = readSelectionSignature(candidate, 'titleSignature');
  const titleReuse = titleSignature
    ? selected.filter((entry) => readSelectionSignature(entry, 'titleSignature') === titleSignature).length
    : 0;
  const tagSignature = displayTagSignature(candidate);
  const tagReuse = tagSignature
    ? selected.filter((entry) => displayTagSignature(entry) === tagSignature).length
    : 0;
  const structureNovelty = archetypeReuse === 0 ? 1.35 : 0;
  const reasonNovelty = reasonReuse === 0 && preferredReason ? 0.9 : 0;
  const expressionPenalty = titleReuse * 0.7 + tagReuse * 0.5 + archetypeReuse * 0.8 + reasonReuse * 0.65;
  const candidateQuality = baseQuality(candidate);
  const hasUnseenRoleAlternative = repeatedRoles.some((role) => comparableCandidates.some((entry) => (
    entry !== candidate && readRoleItemId(entry, role) && readRoleItemId(entry, role) !== readRoleItemId(candidate, role)
  )));
  const reuseExplanation = repeatedRoles.length === 0
    ? ''
    : comparableCandidates.length <= 1
      ? 'no_comparable_alternative'
      : hasUnseenRoleAlternative
        ? 'quality_tradeoff_too_large'
        : 'unavoidable_role_shortage';
  return {
    baseQuality: candidateQuality,
    bestAvailableQuality: bestQuality,
    utility: round2(candidateQuality + structureNovelty + reasonNovelty - reusePenalty - expressionPenalty),
    repeatedRoles,
    archetypeReuse,
    reasonReuse,
    titleReuse,
    tagReuse,
    tagSignature,
    reuseExplanation,
  };
}

function requireCandidate(candidate) {
  if (candidate?.version === CANDIDATE_CORE_VERSION || candidate?.version === CANONICAL_CANDIDATE_VERSION) return candidate;
  throw new Error('candidate core or canonical candidate is required after composition');
}

function requireCanonicalCandidate(candidate) {
  return requireCandidate(candidate);
}

function buildRoleItemIds(itemFactRefs) {
  const roles = { top: '', bottom: '', onepiece: '', outerwear: '', shoes: '' };
  for (const item of itemFactRefs) {
    const role = item.slot === 'skirt' ? 'bottom' : item.slot;
    if (Object.hasOwn(roles, role) && !roles[role]) roles[role] = item.itemId;
  }
  return roles;
}

function buildItemsByRole(items) {
  const roles = { top: null, bottom: null, onepiece: null, outerwear: null, shoes: null };
  for (const item of items) {
    const role = readSlot(item) === 'skirt' ? 'bottom' : readSlot(item);
    if (Object.hasOwn(roles, role) && !roles[role]) roles[role] = item;
  }
  return roles;
}

function buildArchetype(roleItemIds) {
  const parts = REQUIRED_ROLE_KEYS.filter((role) => Boolean(roleItemIds[role]));
  return parts.length > 0 ? parts.join('+') : 'unknown';
}

function buildSelectionSignatures({ itemIds, roleItemIds, archetype, itemFactRecords, scene }) {
  const styles = uniqueStrings(itemFactRecords.flatMap((facts) => facts?.copyItemFacts?.styleTags || facts?.sourceItem?.styleTags || []));
  const hasOnepiece = Boolean(roleItemIds.onepiece);
  return {
    itemSignature: itemIds.slice().sort().join('_'),
    archetype,
    reasonCodeSignature: '',
    titleSignature: JSON.stringify([String(scene || ''), hasOnepiece, styles[0] || '']),
    tagSignature: styles.slice().sort().join('|'),
  };
}

function materializeItem(ref, options) {
  const facts = resolveItemFacts(ref, options);
  const source = facts?.sourceItem || resolveSourceItem(ref.itemId, options);
  if (!source) throw new Error(`candidate materialization missing item: ${ref.itemId}`);
  return {
    ...source,
    outfitSlot: ref.slot,
    outfitRole: ref.role,
    capabilities: Array.isArray(facts?.capabilities) ? facts.capabilities : source.capabilities,
  };
}

function resolveItemFacts(ref, options) {
  const resolver = options?.itemFactsContext?.resolveItemFacts;
  if (typeof resolver !== 'function') return null;
  return resolver.call(options.itemFactsContext, { _id: ref.itemId });
}

function resolveSourceItem(itemId, options) {
  const source = options?.sourceItemById;
  if (source instanceof Map) return source.get(itemId) || null;
  if (source && typeof source === 'object') return source[itemId] || null;
  return null;
}

function readRoleItemId(candidate, role) {
  if (candidate?.roleItemIds && typeof candidate.roleItemIds === 'object') return candidate.roleItemIds[role] || '';
  return readItemId(candidate?.itemsByRole?.[role]);
}

function readSelectionSignature(candidate, name) {
  return typeof candidate?.selectionSignatures?.[name] === 'string'
    ? candidate.selectionSignatures[name]
    : name === 'titleSignature'
      ? candidate.title || ''
      : '';
}

function readItemSignature(candidate) {
  return typeof candidate?.outfitKey === 'string' && candidate.outfitKey
    ? candidate.outfitKey
    : readSelectionSignature(candidate, 'itemSignature') || candidate.itemIds.slice().sort().join('_');
}

function buildDisplayFacts(copyFacts, scene, weather) {
  const temp = Number(weather?.temp ?? weather?.temperature);
  return {
    items: Array.isArray(copyFacts?.items) ? copyFacts.items : [],
    context: {
      scene,
      temperatureBand: Number.isFinite(temp) ? temperatureBand(temp) : '',
    },
  };
}

function displayTagSignature(candidate) {
  if (candidate?.version === CANDIDATE_CORE_VERSION) return readSelectionSignature(candidate, 'tagSignature');
  return uniqueStrings(candidate.displayFacts?.items?.flatMap((item) => item.styleTags || [])).sort().join('|');
}

function baseQuality(candidate) {
  const ranking = Number(candidate.rankingScore);
  return Number.isFinite(ranking) ? ranking : Number(candidate.totalScore) || 0;
}

function readSlot(item) {
  return String(item?.outfitSlot || item?.slot || item?.category || '').trim().toLowerCase();
}

function readRole(item) {
  return ['core', 'functional', 'optional'].includes(item?.outfitRole) ? item.outfitRole : 'core';
}

function readDisplayName(item) {
  return String(item?.customName || item?.displayName || item?.subCategory || item?.subcategory || item?.name || item?.category || '').trim();
}

function readItemId(item) {
  return String(item?._id || item?.id || item?.clothingId || item?.itemId || '').trim();
}

function isItem(item) {
  return Boolean(item && typeof item === 'object' && readItemId(item));
}

function cloneReason(reason) {
  return reason && typeof reason === 'object' ? {
    ...reason,
    subjectItemIds: Array.isArray(reason.subjectItemIds) ? reason.subjectItemIds.slice() : [],
    supportingFactIds: Array.isArray(reason.supportingFactIds) ? reason.supportingFactIds.slice() : [],
    relationFactIds: Array.isArray(reason.relationFactIds) ? reason.relationFactIds.slice() : [],
    evidence: Array.isArray(reason.evidence) ? reason.evidence.map((entry) => ({ ...entry })) : [],
  } : null;
}

function temperatureBand(temp) {
  if (temp < 12) return 'cold';
  if (temp < 22) return 'cool';
  if (temp < 29) return 'mild';
  return 'hot';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))];
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

module.exports = {
  CANDIDATE_CORE_VERSION,
  CANONICAL_CANDIDATE_VERSION,
  REQUIRED_ROLE_KEYS,
  adaptCompositionCandidate,
  createCandidateCore,
  hydrateCanonicalEligibility,
  hydrateCanonicalScore,
  materializeCanonicalCandidate,
  requireCanonicalCandidate,
  selectCanonicalCandidateBatch,
  setCanonicalReasonCandidates,
};
