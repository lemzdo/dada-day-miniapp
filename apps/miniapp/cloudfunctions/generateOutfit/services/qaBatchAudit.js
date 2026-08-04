const crypto = require('crypto');
const { requireCanonicalCandidate } = require('./canonicalCandidate');
const {
  buildEligibilityRejectionAudit,
  fitEligibilityRejectionAuditToBudget,
} = require('./eligibilityRejectionAudit');
const {
  hasSyntheticSuffix,
  buildCanonicalTitleFacts,
  normalizePresentationText,
} = require('./recommendationPresentation');
const {
  buildPresentationFactModel,
  buildPresentationPlan,
  readPresentationPlan,
} = require('./presentationFactModel');

const QA_BATCH_AUDIT_VERSION = 'qa-batch-audit-v6-1-semantic-presentation';
const QA_BYTE_LIMIT = 16 * 1024;
const MAX_FINAL_CARDS = 8;
const MAX_ALTERNATIVES = 8;
const MAX_REJECTION_REASONS = 8;
const MAX_ARCHETYPES = 6;
const MAX_REJECTION_SAMPLES = 3;
const DUPLICATE_CAUSES = Object.freeze({
  NONE: 'NONE',
  FACT_EQUIVALENCE: 'FACT_EQUIVALENCE',
  DIFFERENTIATOR_IGNORED: 'DIFFERENTIATOR_IGNORED',
  SYNTHETIC_VARIATION: 'SYNTHETIC_VARIATION',
});

function buildQaBatchAudit(input = {}) {
  return buildQaAuditSummaries(input).clientAudit;
}

function buildQaAuditSummaries({
  auditId = '',
  sceneKey = '',
  eligibilityRejectionAuditEnabled = false,
  requestScene = '',
  responseScene = '',
  weatherMode = 'disabled',
  hasUsableWeather = false,
  weatherSnapshotPresent = false,
  weather,
  weatherSnapshot,
  temperatureBandApplied = false,
  cloudBuild = '',
  guardAcceptedCandidates = [],
  guardRejectedCandidates = [],
  acceptedCandidates = [],
  counts = {},
  rejectionReasonCounts = {},
  selectedOutfits = [],
  compiledOutfits = [],
  finalOutfits = [],
  timings = {},
  execution = {},
} = {}) {
  const accepted = canonicalList(
    guardAcceptedCandidates.length > 0 ? guardAcceptedCandidates : acceptedCandidates,
  );
  const rejected = canonicalRejectedList(guardRejectedCandidates);
  const selected = canonicalList(selectedOutfits);
  const selectedKeys = new Set(selected.map((candidate) => candidate.outfitKey).filter(Boolean));
  const itemAliasMap = buildItemAliasMap([...accepted, ...rejected.map((entry) => entry.candidate)]);
  const rejectionCounts = new Map();
  const archetypeCounts = new Map();
  const rejectionSamples = new Map();
  const scores = [];
  const alternatives = [];
  const eligibilityRejectionAudit = buildEligibilityRejectionAudit({
    enabled: eligibilityRejectionAuditEnabled === true,
    sceneKey,
    generatedCount: counts.generated ?? counts.candidate ?? accepted.length + rejected.length,
    guardEnteredCount: execution.guardCandidateCount ?? counts.candidate ?? accepted.length + rejected.length,
    guardAcceptedCount: execution.guardAcceptedCount ?? counts.accepted ?? accepted.length,
    guardRejectedCount: execution.guardRejectedCount ?? counts.rejected ?? rejected.length,
    guardAcceptedCandidates: accepted,
    guardRejectedCandidates: rejected,
    weatherMode,
    weather,
    weatherSnapshot,
  });

  for (const candidate of accepted) {
    incrementMap(archetypeCounts, candidate.archetype || 'unknown');
    const score = numericScore(candidate);
    if (Number.isFinite(score)) scores.push(score);
    if (!selectedKeys.has(candidate.outfitKey)) {
      insertTopCandidate(alternatives, candidate, MAX_ALTERNATIVES);
    }
  }

  for (const entry of rejected) {
    for (const reason of entry.rejectReasons) {
      incrementMap(rejectionCounts, reason);
      const samples = rejectionSamples.get(reason) || [];
      if (samples.length < MAX_REJECTION_SAMPLES) {
        samples.push(aliasIds(entry.candidate.itemIds, itemAliasMap));
        rejectionSamples.set(reason, samples);
      }
    }
  }
  mergeReasonCounts(rejectionCounts, rejectionReasonCounts);

  const compiledByKey = new Map(
    (Array.isArray(compiledOutfits) ? compiledOutfits : [])
      .filter((outfit) => outfit && typeof outfit === 'object')
      .map((outfit) => [outfit.outfitKey, outfit]),
  );
  const expectedCardCount = Number.isInteger(execution.countContract?.expectedCardCount)
    ? execution.countContract.expectedCardCount
    : selected.length;
  if (selected.length !== expectedCardCount) {
    throw new Error(`QA selected card count mismatch: expected ${expectedCardCount}, got ${selected.length}`);
  }
  const finalCards = selected.slice(0, Math.min(MAX_FINAL_CARDS, expectedCardCount)).map((candidate) => buildCardSummary(
    candidate,
    (Array.isArray(finalOutfits) ? finalOutfits : []).find((outfit) => outfit?.outfitKey === candidate.outfitKey)
      || compiledByKey.get(candidate.outfitKey),
    itemAliasMap,
  ));
  const visibleOutfits = Array.isArray(finalOutfits) && finalOutfits.length > 0 ? finalOutfits : compiledOutfits;
  const exactTitleDuplicateGroups = buildExactTitleDuplicateGroups(visibleOutfits);
  const exactReasonDuplicateGroups = buildExactReasonDuplicateGroups(visibleOutfits);
  const titleTokenDuplicateGroups = buildTitleTokenDuplicateGroups(visibleOutfits);
  const placeholderTitleCount = visibleOutfits.filter((outfit) => isPlaceholderTitle(readVisibleTitle(outfit))).length;
  const normalizedTitleDuplicateGroups = buildNormalizedDuplicateGroups(visibleOutfits, readVisibleTitle);
  const normalizedReasonDuplicateGroups = buildNormalizedDuplicateGroups(visibleOutfits, readVisibleReason);
  const syntheticSuffixCount = visibleOutfits.reduce((count, outfit) => count
    + (hasSyntheticSuffix(readVisibleTitle(outfit)) ? 1 : 0)
    + (hasSyntheticSuffix(readVisibleReason(outfit)) ? 1 : 0), 0);
  const visibleRecords = buildVisibleOutfitRecords(visibleOutfits, selected);
  const availableDifferentiatorCount = countAvailableDifferentiators(visibleRecords);
  const semanticEquivalentGroups = buildSemanticEquivalentGroups(visibleRecords);
  const semanticEquivalentCounts = new Map(semanticEquivalentGroups.map((group) => [group.signatureHash, group.count]));
  for (const card of finalCards) {
    card.semanticEquivalentGroupCount = semanticEquivalentCounts.get(card.presentationFactSignatureHash) || 0;
  }
  const differentiatorIgnoredGroups = buildDifferentiatorIgnoredGroups(visibleRecords);
  const titleDuplicateWarningCount = countDuplicateTitleCards(
    exactTitleDuplicateGroups,
    normalizedTitleDuplicateGroups,
  );
  const duplicateCause = resolveDuplicateCause({
    titleDuplicateWarningCount,
    availableDifferentiatorCount,
    syntheticSuffixCount,
    placeholderTitleCount,
    factEquivalentDuplicateCount: semanticEquivalentGroups.filter((group) => group.count > 1).length,
    differentiatorIgnoredDuplicateCount: differentiatorIgnoredGroups.length,
  });
  const semanticDuplicateWarningCount = [
    DUPLICATE_CAUSES.FACT_EQUIVALENCE,
    DUPLICATE_CAUSES.DIFFERENTIATOR_IGNORED,
  ].includes(duplicateCause) ? titleDuplicateWarningCount : 0;
  const duplicateOutfitKeyCount = countDuplicateValues(visibleRecords.map((record) => record.outfitKey));
  const duplicateItemSetCount = countDuplicateValues(visibleRecords.map((record) => record.itemSetSignature));
  const missingOutfitKeyCount = visibleRecords.filter((record) => !record.outfitKey).length;
  const missingItemSetCount = visibleRecords.filter((record) => !record.itemSetSignature).length;
  const tagSceneMismatchCount = visibleOutfits.filter((outfit) => hasTagSceneMismatch(outfit)).length;
  const cardConsistencyFailures = finalCards.filter((card) => card.consistency === false).length;
  const qualificationFailureCount = visibleRecords.filter((record) => hasQualificationFailure(record)).length;
  const safetyFailureCount = visibleRecords.filter((record) => hasSafetyFailure(record)).length;
  const qaBlockReasons = buildQaBlockReasons({
    duplicateCause,
    syntheticSuffixCount,
    placeholderTitleCount,
    duplicateOutfitKeyCount,
    duplicateItemSetCount,
    missingOutfitKeyCount,
    missingItemSetCount,
    tagSceneMismatchCount,
    cardConsistencyFailures,
    qualificationFailureCount,
    safetyFailureCount,
  });
  const gateStatus = qaBlockReasons.length > 0
    ? 'failed'
    : semanticDuplicateWarningCount > 0
      ? 'passed_with_warnings'
      : 'passed';
  const fallbackReasonCount = selected.filter((candidate) => candidate.eligibilityReason?.isGenericFallback === true).length;
  const reuseExplanations = buildReuseExplanations(visibleOutfits, itemAliasMap);
  const alternativeCandidateCount = alternatives.length;
  const clientAudit = {
    version: QA_BATCH_AUDIT_VERSION,
    auditId: safeText(auditId, 80),
    cloudBuild: safeText(cloudBuild, 80),
    identity: {
      scene: {
        requestScene: safeText(requestScene, 40),
        responseScene: safeText(responseScene, 40),
      },
      weather: {
        mode: safeText(weatherMode, 24),
        hasUsableWeather: Boolean(hasUsableWeather),
        snapshotPresent: Boolean(weatherSnapshotPresent),
        temperatureBandApplied: Boolean(temperatureBandApplied),
      },
    },
    counts: normalizeCounts(counts, {
      candidate: accepted.length + rejected.length,
      generated: accepted.length + rejected.length,
      accepted: accepted.length,
      rejected: rejected.length,
      selected: selected.length,
    }),
    countContract: execution.countContract || null,
    rejectionReasonHistogram: topHistogram(rejectionCounts, MAX_REJECTION_REASONS),
    archetypeHistogram: topHistogram(archetypeCounts, MAX_ARCHETYPES),
    scoreDistribution: scoreDistribution(scores),
    executionMode: safeText(execution.executionMode, 32),
    candidatePoolIdentityHash: safeText(execution.candidatePoolIdentityHash, 64),
    candidatePoolAgeMs: safeNonNegativeNumber(execution.candidatePoolAgeMs),
    cacheHit: execution.cacheHit === true,
    cacheMissReason: safeText(execution.cacheMissReason, 48),
    exclusionsAppliedCount: safeNonNegativeNumber(execution.exclusionsAppliedCount),
    candidatePoolSaveStatus: safeText(execution.candidatePoolSaveStatus, 32),
    candidatePoolSaveReason: safeText(execution.candidatePoolSaveReason, 64),
    candidatePoolSerializedBytes: safeNonNegativeNumber(execution.candidatePoolSerializedBytes),
    candidatePoolChunkCount: safeNonNegativeNumber(execution.candidatePoolChunkCount),
    candidatePoolManifestBytes: safeNonNegativeNumber(execution.candidatePoolManifestBytes),
    candidatePoolChunksBytes: safeNonNegativeNumber(execution.candidatePoolChunksBytes),
    candidatePoolChunkWriteTimings: Array.isArray(execution.candidatePoolChunkWriteTimings)
      ? execution.candidatePoolChunkWriteTimings.map((entry) => ({
        chunkIndex: safeNonNegativeNumber(entry?.chunkIndex),
        documentBytes: safeNonNegativeNumber(entry?.documentBytes),
        elapsedMs: safeNonNegativeNumber(entry?.elapsedMs),
        ok: entry?.ok === true,
      }))
      : [],
    candidatePoolMaxActiveChunkWrites: safeNonNegativeNumber(execution.candidatePoolMaxActiveChunkWrites),
    candidatePoolValidationReadCount: safeNonNegativeNumber(execution.candidatePoolValidationReadCount),
    candidatePoolValidationMode: safeText(execution.candidatePoolValidationMode, 64),
    candidatePoolCleanupAttempted: execution.candidatePoolCleanupAttempted === true,
    candidatePoolCleanupDeletedCount: safeNonNegativeNumber(execution.candidatePoolCleanupDeletedCount),
    candidatePoolCleanupFailedCount: safeNonNegativeNumber(execution.candidatePoolCleanupFailedCount),
    recommendationBatchIdPresent: execution.recommendationBatchIdPresent === true,
    recommendationBatchIdLength: safeNonNegativeNumber(execution.recommendationBatchIdLength),
    requestedCandidatePoolIdPresent: execution.requestedCandidatePoolIdPresent === true,
    requestedCandidatePoolIdLength: safeNonNegativeNumber(execution.requestedCandidatePoolIdLength),
    exactTitleDuplicateGroups,
    normalizedTitleDuplicateGroups,
    exactReasonDuplicateGroups,
    normalizedReasonDuplicateGroups,
    titleTokenDuplicateGroups,
    placeholderTitleCount,
    syntheticSuffixCount,
    availableDifferentiatorCount,
    duplicateCause,
    presentationFactSignatureHash: visibleRecords[0]?.presentationFactSignatureHash || null,
    primaryRelationCode: visibleRecords[0]?.primaryRelationCode || null,
    unsupportedClaimCount: visibleRecords.reduce((sum, record) => sum + record.unsupportedClaimCount, 0),
    reasonSemanticSkeleton: visibleRecords[0]?.reasonSemanticSkeleton || '',
    titleSemanticSkeleton: visibleRecords[0]?.titleSemanticSkeleton || '',
    semanticEquivalentGroupCount: semanticEquivalentGroups.filter((group) => group.count > 1).length,
    titleDuplicateWarningCount: semanticDuplicateWarningCount,
    gateStatus,
    qaGatePassed: gateStatus !== 'failed',
    qaBlockReasons,
    tagSceneMismatchCount,
    cardConsistencyFailures,
    fallbackReasonCount,
    reuseExplanations,
    finalCards,
    alternativeCandidateCount,
    alternativeCandidates: alternatives.map((candidate) => buildCardSummary(candidate, null, itemAliasMap)),
    timings: normalizeTimings(timings),
    responseBytes: {},
    qaTruncated: false,
    ...(eligibilityRejectionAudit ? { eligibilityRejectionAudit } : {}),
  };
  clientAudit.qaGateSummary = buildQaGateSummary(clientAudit);
  const serverSummary = {
    auditId: clientAudit.auditId,
    generated: clientAudit.counts.generated,
    candidate: clientAudit.counts.candidate,
    accepted: clientAudit.counts.accepted,
    rejected: clientAudit.counts.rejected,
    selected: clientAudit.counts.selected,
    countContract: clientAudit.countContract,
    rejectionSamples: topHistogram(rejectionCounts, MAX_REJECTION_REASONS).map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      itemAliasSamples: rejectionSamples.get(entry.reason) || [],
    })),
    timings: clientAudit.timings,
    executionMode: clientAudit.executionMode,
    cacheHit: clientAudit.cacheHit,
    cacheMissReason: clientAudit.cacheMissReason,
    candidatePoolIdentityHash: clientAudit.candidatePoolIdentityHash,
    candidatePoolAgeMs: clientAudit.candidatePoolAgeMs,
    exclusionsAppliedCount: clientAudit.exclusionsAppliedCount,
    candidatePoolSaveStatus: clientAudit.candidatePoolSaveStatus,
    candidatePoolSaveReason: clientAudit.candidatePoolSaveReason,
    candidatePoolSerializedBytes: clientAudit.candidatePoolSerializedBytes,
    candidatePoolChunkCount: clientAudit.candidatePoolChunkCount,
    candidatePoolManifestBytes: clientAudit.candidatePoolManifestBytes,
    candidatePoolChunksBytes: clientAudit.candidatePoolChunksBytes,
    candidatePoolChunkWriteTimings: clientAudit.candidatePoolChunkWriteTimings,
    candidatePoolMaxActiveChunkWrites: clientAudit.candidatePoolMaxActiveChunkWrites,
    candidatePoolValidationReadCount: clientAudit.candidatePoolValidationReadCount,
    candidatePoolValidationMode: clientAudit.candidatePoolValidationMode,
    candidatePoolCleanupAttempted: clientAudit.candidatePoolCleanupAttempted,
    candidatePoolCleanupDeletedCount: clientAudit.candidatePoolCleanupDeletedCount,
    candidatePoolCleanupFailedCount: clientAudit.candidatePoolCleanupFailedCount,
    recommendationBatchIdPresent: clientAudit.recommendationBatchIdPresent,
    recommendationBatchIdLength: clientAudit.recommendationBatchIdLength,
    requestedCandidatePoolIdPresent: clientAudit.requestedCandidatePoolIdPresent,
    requestedCandidatePoolIdLength: clientAudit.requestedCandidatePoolIdLength,
    exactTitleDuplicateGroups: clientAudit.exactTitleDuplicateGroups,
    normalizedTitleDuplicateGroups: clientAudit.normalizedTitleDuplicateGroups,
    exactReasonDuplicateGroups: clientAudit.exactReasonDuplicateGroups,
    normalizedReasonDuplicateGroups: clientAudit.normalizedReasonDuplicateGroups,
    titleTokenDuplicateGroups: clientAudit.titleTokenDuplicateGroups,
    placeholderTitleCount: clientAudit.placeholderTitleCount,
    syntheticSuffixCount: clientAudit.syntheticSuffixCount,
    availableDifferentiatorCount: clientAudit.availableDifferentiatorCount,
    duplicateCause: clientAudit.duplicateCause,
    titleDuplicateWarningCount: clientAudit.titleDuplicateWarningCount,
    gateStatus: clientAudit.gateStatus,
    qaGatePassed: clientAudit.qaGatePassed,
    qaBlockReasons: clientAudit.qaBlockReasons,
    tagSceneMismatchCount: clientAudit.tagSceneMismatchCount,
    cardConsistencyFailures: clientAudit.cardConsistencyFailures,
    fallbackReasonCount: clientAudit.fallbackReasonCount,
    reuseExplanations: clientAudit.reuseExplanations,
    presentationFactSignatureHash: clientAudit.presentationFactSignatureHash,
    primaryRelationCode: clientAudit.primaryRelationCode,
    unsupportedClaimCount: clientAudit.unsupportedClaimCount,
    reasonSemanticSkeleton: clientAudit.reasonSemanticSkeleton,
    titleSemanticSkeleton: clientAudit.titleSemanticSkeleton,
    semanticEquivalentGroupCount: clientAudit.semanticEquivalentGroupCount,
    ...(eligibilityRejectionAudit ? { eligibilityRejectionAudit } : {}),
  };
  return {
    clientAudit: fitQaBatchAuditToBudget(clientAudit),
    serverSummary: fitServerQaSummaryToBudget(serverSummary),
  };
}

function fitQaBatchAuditToBudget(audit, byteLimit = QA_BYTE_LIMIT) {
  if (!audit?.qaGateSummary
    || !Object.prototype.hasOwnProperty.call(audit.qaGateSummary, 'alternativeCandidateCount')) {
    throw new Error('QA authoritative summary is missing alternativeCandidateCount');
  }
  if (serializedBytes(audit) < byteLimit) return audit;
  audit.qaTruncated = true;
  if (audit.qaGateSummary) audit.qaGateSummary.qaTruncated = true;
  delete audit.alternativeCandidates;
  if (serializedBytes(audit) < byteLimit) return audit;
  delete audit.rejectionSamples;
  if (serializedBytes(audit) < byteLimit) return audit;
  if (audit.eligibilityRejectionAudit) {
    fitEligibilityRejectionAuditToBudget(
      audit.eligibilityRejectionAudit,
      byteLimit,
      () => serializedBytes(audit),
    );
    if (serializedBytes(audit) < byteLimit) return audit;
  }
  audit.rejectionReasonHistogram = audit.rejectionReasonHistogram.slice(0, 4);
  audit.archetypeHistogram = audit.archetypeHistogram.slice(0, 3);
  return audit;
}

function buildQaGateSummary(audit) {
  if (!Object.prototype.hasOwnProperty.call(audit || {}, 'alternativeCandidateCount')) {
    throw new Error('QA authoritative summary cannot derive alternativeCandidateCount from candidate details');
  }
  return {
    version: safeText(audit?.version, 64),
    counts: normalizeCounts(audit?.counts, {
      candidate: 0,
      generated: 0,
      accepted: 0,
      rejected: 0,
      selected: 0,
    }),
    finalCardCount: Array.isArray(audit?.finalCards) ? audit.finalCards.length : 0,
    alternativeCandidateCount: requireNonNegativeInteger(audit.alternativeCandidateCount, 'alternativeCandidateCount'),
    qaGatePassed: audit?.qaGatePassed === true,
    gateStatus: safeText(audit?.gateStatus, 32),
    qaBlockReasons: Array.isArray(audit?.qaBlockReasons)
      ? audit.qaBlockReasons.slice(0, 8).map((reason) => safeText(reason, 96)).filter(Boolean)
      : [],
    duplicateCause: safeText(audit?.duplicateCause, 32),
    placeholderTitleCount: safeNonNegativeNumber(audit?.placeholderTitleCount),
    syntheticSuffixCount: safeNonNegativeNumber(audit?.syntheticSuffixCount),
    availableDifferentiatorCount: safeNonNegativeNumber(audit?.availableDifferentiatorCount),
    titleDuplicateWarningCount: safeNonNegativeNumber(audit?.titleDuplicateWarningCount),
    unsupportedClaimCount: safeNonNegativeNumber(audit?.unsupportedClaimCount),
    tagSceneMismatchCount: safeNonNegativeNumber(audit?.tagSceneMismatchCount),
    cardConsistencyFailures: safeNonNegativeNumber(audit?.cardConsistencyFailures),
    qaTruncated: audit?.qaTruncated === true,
  };
}

function fitServerQaSummaryToBudget(summary, byteLimit = QA_BYTE_LIMIT) {
  if (serializedBytes(summary) < byteLimit) return summary;
  summary.rejectionSamples = summary.rejectionSamples.map((entry) => ({
    ...entry,
    itemAliasSamples: entry.itemAliasSamples.slice(0, 1),
  }));
  if (serializedBytes(summary) < byteLimit) return summary;
  summary.rejectionSamples = summary.rejectionSamples.slice(0, 4);
  return summary;
}

function canonicalList(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map(requireCanonicalCandidate);
}

function canonicalRejectedList(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    candidate: requireCanonicalCandidate(entry?.candidate || entry),
    rejectionStage: entry?.rejectionStage,
    rejectReasons: uniqueStrings(entry?.rejectReasons),
  }));
}

function buildItemAliasMap(candidates) {
  const ids = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    for (const id of candidate?.itemIds || []) ids.add(String(id));
  }
  return new Map([...ids].sort().map((id, index) => [id, `I${String(index + 1).padStart(2, '0')}`]));
}

function insertTopCandidate(list, candidate, limit) {
  list.push(candidate);
  list.sort((left, right) => numericScore(right) - numericScore(left));
  if (list.length > limit) list.pop();
}

function buildCardSummary(candidate, compiledOutfit, aliasMap) {
  const selectionSignatures = candidate?.selectionSignatures || {};
  const presentationSource = { ...(candidate || {}), ...(compiledOutfit || {}) };
  const sharedPlan = readPresentationPlan(presentationSource);
  const presentationFactModel = sharedPlan?.factModel || buildPresentationFactModel(presentationSource);
  const presentationPlan = sharedPlan || buildPresentationPlan(presentationFactModel);
  const title = readVisibleTitle(compiledOutfit) || candidate.title || '';
  const tags = Array.isArray(compiledOutfit?.styleTags) ? compiledOutfit.styleTags : [];
  const todayReason = readVisibleReason(compiledOutfit);
  const expectedTitle = readVisibleTitle(compiledOutfit);
  const expectedTags = Array.isArray(compiledOutfit?.styleTags) ? compiledOutfit.styleTags : [];
  return {
    itemAliases: aliasIds(candidate.itemIds, aliasMap),
    archetype: safeText(candidate.archetype || 'unknown', 48),
    score: numericScore(candidate),
    reasonCode: safeText(candidate.eligibilityReason?.code || '', 64),
    visibleTitle: safeText(title, 160),
    visibleTags: expectedTags.map((tag) => safeText(tag, 32)).slice(0, 8),
    todayReason: safeText(todayReason, 240),
    titleSignature: textSignature(title || selectionSignatures.titleSignature || ''),
    tagSignature: textSignature(tags.length > 0 ? tags.slice().sort().join('|') : selectionSignatures.tagSignature || ''),
    presentationFactSignatureHash: presentationFactModel.presentationFactSignature
      ? textSignature(`presentation-fact-v2|${presentationFactModel.presentationFactSignature}`)
      : null,
    primaryRelationCode: presentationPlan.primaryRelation.relationCode || null,
    unsupportedClaimCount: presentationPlan.unsupportedClaims.length,
    reasonSemanticSkeleton: buildReasonSemanticSkeleton(presentationPlan),
    titleSemanticSkeleton: buildTitleSemanticSkeleton(presentationPlan),
    semanticEquivalentGroupCount: 0,
    consistency: title === expectedTitle
      && JSON.stringify(expectedTags) === JSON.stringify(tags)
      && todayReason === readVisibleReason(compiledOutfit),
  };
}

function buildExactTitleDuplicateGroups(outfits) {
  const groups = new Map();
  for (const outfit of Array.isArray(outfits) ? outfits : []) {
    const title = readVisibleTitle(outfit);
    if (!title) continue;
    groups.set(title, (groups.get(title) || 0) + 1);
  }
  return [...groups.entries()]
    .filter(([, count]) => count > 1)
    .map(([title, count]) => ({ titleHash: textSignature(title), count }));
}

function buildNormalizedDuplicateGroups(outfits, reader) {
  const groups = new Map();
  for (const outfit of Array.isArray(outfits) ? outfits : []) {
    const normalized = normalizePresentationText(reader(outfit));
    if (!normalized) continue;
    groups.set(normalized, (groups.get(normalized) || 0) + 1);
  }
  return [...groups.entries()]
    .filter(([, count]) => count > 1)
    .map(([normalized, count]) => ({ textHash: textSignature(normalized), count }));
}

function buildQaBlockReasons({
  duplicateCause = DUPLICATE_CAUSES.NONE,
  syntheticSuffixCount = 0,
  placeholderTitleCount = 0,
  duplicateOutfitKeyCount = 0,
  duplicateItemSetCount = 0,
  missingOutfitKeyCount = 0,
  missingItemSetCount = 0,
  tagSceneMismatchCount = 0,
  cardConsistencyFailures = 0,
  qualificationFailureCount = 0,
  safetyFailureCount = 0,
} = {}) {
  const reasons = [];
  if (syntheticSuffixCount > 0) reasons.push('SYNTHETIC_SUFFIX');
  if (placeholderTitleCount > 0) reasons.push('PLACEHOLDER_TITLE');
  if (duplicateCause === DUPLICATE_CAUSES.DIFFERENTIATOR_IGNORED) reasons.push('DIFFERENTIATOR_IGNORED');
  if (duplicateOutfitKeyCount > 0) reasons.push('DUPLICATE_OUTFIT_KEY');
  if (duplicateItemSetCount > 0) reasons.push('DUPLICATE_ITEM_SET');
  if (missingOutfitKeyCount > 0) reasons.push('MISSING_OUTFIT_KEY');
  if (missingItemSetCount > 0) reasons.push('MISSING_ITEM_SET');
  if (tagSceneMismatchCount > 0) reasons.push('TAG_SCENE_MISMATCH');
  if (cardConsistencyFailures > 0) reasons.push('CARD_CONSISTENCY');
  if (qualificationFailureCount > 0) reasons.push('QUALIFICATION_INVALID');
  if (safetyFailureCount > 0) reasons.push('SAFETY_INVALID');
  return reasons;
}

function buildVisibleOutfitRecords(outfits, selected) {
  const selectedByKey = new Map(
    selected.map((candidate) => [String(candidate?.outfitKey || ''), candidate]),
  );
  return (Array.isArray(outfits) ? outfits : []).map((outfit, index) => {
    const key = String(outfit?.outfitKey || '');
    const candidate = selectedByKey.get(key) || selected[index] || null;
    const presentationSource = { ...(candidate || {}), ...(outfit || {}) };
    const sharedPlan = readPresentationPlan(presentationSource);
    const presentationFactModel = sharedPlan?.factModel || buildPresentationFactModel(presentationSource);
    const presentationPlan = sharedPlan || buildPresentationPlan(presentationFactModel);
    return {
      outfit,
      candidate,
      outfitKey: key || String(candidate?.outfitKey || ''),
      itemSetSignature: buildItemSetSignature(outfit, candidate),
      presentationFactSignature: presentationFactModel.presentationFactSignature,
      presentationFactSignatureHash: presentationFactModel.presentationFactSignature
        ? textSignature(`presentation-fact-v2|${presentationFactModel.presentationFactSignature}`)
        : null,
      primaryRelationCode: presentationPlan.primaryRelation.relationCode || null,
      availableDifferentiatorCount: Array.isArray(presentationFactModel.availableDifferentiators)
        ? presentationFactModel.availableDifferentiators.length
        : 0,
      unsupportedClaimCount: presentationPlan.unsupportedClaims.length,
      reasonSemanticSkeleton: buildReasonSemanticSkeleton(presentationPlan),
      titleSemanticSkeleton: buildTitleSemanticSkeleton(presentationPlan),
    };
  });
}

function buildSemanticEquivalentGroups(records) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const key = record.presentationFactSignatureHash;
    if (!key) continue;
    const entry = groups.get(key) || { signatureHash: key, count: 0, primaryRelationCodes: new Set() };
    entry.count += 1;
    if (record.primaryRelationCode) entry.primaryRelationCodes.add(record.primaryRelationCode);
    groups.set(key, entry);
  }
  return [...groups.values()].map((entry) => ({
    signatureHash: entry.signatureHash,
    count: entry.count,
    primaryRelationCodes: [...entry.primaryRelationCodes].sort(),
  }));
}

function buildDifferentiatorIgnoredGroups(records) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const reason = readVisibleReason(record.outfit);
    if (!reason) continue;
    const key = `${normalizePresentationText(reason)}|${record.reasonSemanticSkeleton}`;
    const entry = groups.get(key) || { signatures: new Set(), count: 0 };
    entry.signatures.add(record.presentationFactSignatureHash || 'missing');
    entry.count += 1;
    groups.set(key, entry);
  }
  return [...groups.values()].filter((entry) => entry.count > 1 && entry.signatures.size > 1);
}

function buildReasonSemanticSkeleton(plan) {
  return [
    plan?.primaryRelation?.relationCode || '',
    plan?.reasonClaim?.relationCode || '',
    plan?.sceneConclusion || '',
  ].join('|');
}

function buildTitleSemanticSkeleton(plan) {
  return [
    plan?.titleConcept || '',
    plan?.primaryRelation?.relationCode || '',
  ].join('|');
}

function countAvailableDifferentiators(records) {
  return (Array.isArray(records) ? records : []).reduce((total, record) => {
    return total + (Number.isFinite(record?.availableDifferentiatorCount)
      ? record.availableDifferentiatorCount
      : 0);
  }, 0);
}

function buildDifferentiatorProfile(outfit, candidate) {
  const profile = new Map();
  const items = readVisibleItems(outfit).length > 0
    ? readVisibleItems(outfit)
    : readVisibleItems(candidate);
  const titleFacts = buildCanonicalTitleFacts(items, outfit || candidate || {});
  for (const category of ['onepiece', 'top', 'bottom', 'skirt', 'shoes']) {
    const facts = titleFacts[category];
    if (!facts) continue;
    setDifferentiator(profile, `${category}:color`, facts.color);
    setDifferentiator(profile, `${category}:subtype`, facts.subtype);
  }

  for (const item of items) {
    const category = normalizeItemCategory(item);
    const prefix = category || 'item';
    setDifferentiator(profile, `${prefix}:pattern`, firstText(item?.pattern, item?.patternType, item?.aestheticFeatures?.patternType));
    setDifferentiator(profile, `${prefix}:fit`, firstText(item?.fit, item?.silhouette, item?.aestheticFeatures?.fit));
    addFactRecordDifferentiators(profile, item?.factRecords, prefix);
    addFactRecordDifferentiators(profile, item?.factEvidence, prefix);
  }

  const copyFactScopes = [
    outfit?.copyFacts?.itemFactsById,
    outfit?.visibleFacts?.itemFactsById,
    candidate?.copyFacts?.itemFactsById,
    candidate?.visibleFacts?.itemFactsById,
  ];
  for (const scopes of copyFactScopes) {
    for (const scope of Object.values(scopes || {})) {
      addFactRecordDifferentiators(profile, scope?.factRecords, normalizeItemCategory(scope));
    }
  }

  setDifferentiator(profile, 'archetype', candidate?.archetype || outfit?.archetype);
  setDifferentiator(profile, 'structure', candidate?.structureType || outfit?.structureType);
  return profile;
}

function addFactRecordDifferentiators(profile, records, prefix) {
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || record.authorized === false) continue;
    const fact = safeFactName(record.fact || record.factId);
    if (!fact || NON_DIFFERENTIATING_FACTS.has(fact)) continue;
    const value = record.value === true || record.value === undefined ? fact : record.value;
    setDifferentiator(profile, `${prefix || 'item'}:${fact}`, value);
  }
}

function setDifferentiator(profile, dimension, value) {
  const normalized = normalizeDifferentiatorValue(value);
  if (!normalized) return;
  profile.set(dimension, normalized);
}

function buildItemSetSignature(outfit, candidate) {
  const visibleItems = readVisibleItems(outfit);
  const ids = visibleItems.length > 0
    ? visibleItems.map(readItemId)
    : Array.isArray(candidate?.itemIds) ? candidate.itemIds : [];
  return uniqueStrings(ids.map((id) => String(id || '').trim())).sort().join('|');
}

function countDuplicateTitleCards(exactGroups, normalizedGroups) {
  const groups = Array.isArray(normalizedGroups) && normalizedGroups.length > 0
    ? normalizedGroups
    : exactGroups;
  return groups.reduce((total, group) => total + safeNonNegativeNumber(group?.count), 0);
}

function countDuplicateValues(values) {
  const counts = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string' || !value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.values()]
    .filter((count) => count > 1)
    .reduce((total, count) => total + count, 0);
}

function resolveDuplicateCause({
  titleDuplicateWarningCount = 0,
  syntheticSuffixCount = 0,
  placeholderTitleCount = 0,
  factEquivalentDuplicateCount = 0,
  differentiatorIgnoredDuplicateCount = 0,
} = {}) {
  if (syntheticSuffixCount > 0 || placeholderTitleCount > 0) return DUPLICATE_CAUSES.SYNTHETIC_VARIATION;
  if (titleDuplicateWarningCount === 0) return DUPLICATE_CAUSES.NONE;
  if (differentiatorIgnoredDuplicateCount > 0) return DUPLICATE_CAUSES.DIFFERENTIATOR_IGNORED;
  if (factEquivalentDuplicateCount > 0) return DUPLICATE_CAUSES.FACT_EQUIVALENCE;
  return DUPLICATE_CAUSES.NONE;
}

function hasQualificationFailure(record) {
  const candidate = record?.candidate || {};
  const scene = candidate.sceneEligibility || candidate.eligibility?.scene || record?.outfit?.eligibility?.scene;
  return scene?.eligible === false || scene?.hardRejected === true
    || (!candidate.eligibilityReason?.code && !record?.outfit?.copyContract?.coreEligibilityReasonCode);
}

function hasSafetyFailure(record) {
  const candidate = record?.candidate || {};
  const outfit = record?.outfit || {};
  return [
    candidate.riskFlags,
    candidate.validatorRejectReasons,
    outfit.riskFlags,
    outfit.validatorRejectReasons,
    outfit.copyContract?.riskFlags,
  ].some((flags) => Array.isArray(flags) && flags.length > 0);
}

function normalizeItemCategory(item) {
  const value = String(item?.category || item?.slot || item?.outfitSlot || '').trim().toLowerCase();
  if (value === 'skirt') return 'skirt';
  if (value === 'onepiece') return 'onepiece';
  if (value === 'shoes' || value === 'shoe') return 'shoes';
  if (value === 'bottom') return 'bottom';
  if (value === 'top') return 'top';
  return value;
}

function readItemId(item) {
  return item && typeof item === 'object'
    ? item.clothingId || item.itemId || item._id || item.id || ''
    : item;
}

function firstText(...values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .find((value) => typeof value === 'string' && value.trim()) || '';
}

function normalizeDifferentiatorValue(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : String(value || '').trim().toLowerCase();
  if (!text || /#[0-9a-f]{3,8}/i.test(text) || /\d/.test(text)) return '';
  return text.slice(0, 96);
}

function safeFactName(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const match = /^item:[^:]+:(.+)$/.exec(text);
  return (match ? match[1] : text).replace(/[^a-z0-9_:-]/g, '_');
}

const NON_DIFFERENTIATING_FACTS = new Set([
  'category', 'sport_top', 'sport_bottom', 'sport_shoe', 'outing_shoe', 'home_shoe',
  'simple_style', 'casual_style', 'scene', 'weather', 'work_eligible', 'color_coordinated',
]);

function buildTitleTokenDuplicateGroups(outfits) {
  const groups = [];
  for (const outfit of Array.isArray(outfits) ? outfits : []) {
    const title = readVisibleTitle(outfit);
    const match = title.match(/(.{2,8})\1/);
    if (match) groups.push({ tokenHash: textSignature(match[1]), count: 1 });
  }
  return groups;
}

function topHistogram(counts, limit) {
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason: safeText(reason, 80), count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, limit);
}

function scoreDistribution(scores) {
  const sorted = scores.slice().sort((left, right) => left - right);
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

function normalizeTimings(timings) {
  const names = [
    'dataLoadMs',
    'identityMs',
    'candidatePoolLoadMs',
    'poolManifestLoadMs',
    'poolChunksLoadMs',
    'poolHydrateMs',
    'candidatePoolSaveMs',
    'candidatePoolPlanMs',
    'candidatePoolSerializationMs',
    'candidatePoolChunkWriteMs',
    'candidatePoolValidationMs',
    'candidatePoolManifestWriteMs',
    'exclusionMs',
    'compositionMs',
    'canonicalizeMs',
    'eligibilityMs',
    'scoringMs',
    'batchSelectionMs',
    'cardCompilationMs',
    'qaAuditMs',
    'snapshotUpsertMs',
    'enrichMs',
    'exposureMs',
    'serializationMs',
    'totalMs',
  ];
  return names.reduce((result, name) => {
    const value = Number(timings?.[name]);
    result[name] = Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    return result;
  }, {});
}

function buildExactReasonDuplicateGroups(compiledOutfits) {
  const groups = new Map();
  for (const outfit of Array.isArray(compiledOutfits) ? compiledOutfits : []) {
    const sentence = safeText(outfit?.copyContract?.todayReason || outfit?.reason, 240);
    if (!sentence) continue;
    const factSignature = buildReasonFactSignature(outfit);
    const entry = groups.get(sentence) || {
      sentenceHash: textSignature(sentence),
      count: 0,
      factSignatures: new Set(),
    };
    entry.count += 1;
    entry.factSignatures.add(factSignature);
    groups.set(sentence, entry);
  }
  return [...groups.values()]
    .filter((entry) => entry.count > 1)
    .map((entry) => ({
      sentenceHash: entry.sentenceHash,
      count: entry.count,
      factSignatureCount: entry.factSignatures.size,
      allowed: entry.factSignatures.size === 1,
      explanation: entry.factSignatures.size === 1
        ? 'same_fact_signature'
        : 'different_fact_signature_requires_copy_variant',
    }))
    .sort((left, right) => right.count - left.count || left.sentenceHash.localeCompare(right.sentenceHash));
}

function buildReuseExplanations(outfits, aliasMap) {
  const itemStats = new Map();
  for (const outfit of Array.isArray(outfits) ? outfits : []) {
    const roleMap = new Map(
      (Array.isArray(outfit?.outfitItemRoles) ? outfit.outfitItemRoles : [])
        .map((entry) => [String(entry.id || entry.itemId || ''), entry.role || entry.slot || 'item']),
    );
    for (const item of readVisibleItems(outfit)) {
      const id = String(item?.clothingId || item?.itemId || item?._id || item?.id || '');
      if (!id) continue;
      const role = String(item?.outfitRole || item?.outfitSlot || roleMap.get(id) || 'item');
      const current = itemStats.get(id) || { count: 0, roles: new Set() };
      current.count += 1;
      current.roles.add(role);
      itemStats.set(id, current);
    }
  }
  return [...itemStats.entries()]
    .filter(([, value]) => value.count > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 8)
    .map(([id, value]) => ({
      code: 'item_reuse_visible_batch',
      itemAlias: aliasMap.get(id) || '',
      repeatedRoles: [...value.roles].sort().slice(0, 5),
      count: value.count,
    }));
}

function readVisibleItems(outfit) {
  if (Array.isArray(outfit?.items) && outfit.items.length > 0) return outfit.items;
  if (Array.isArray(outfit?.snapshotItems) && outfit.snapshotItems.length > 0) return outfit.snapshotItems;
  return Array.isArray(outfit?.itemsSnapshot) ? outfit.itemsSnapshot : [];
}

function readVisibleTitle(outfit) {
  const value = outfit?.displayTitle || outfit?.userTitle || outfit?.title;
  return typeof value === 'string' ? value.trim() : '';
}

function readVisibleReason(outfit) {
  const value = outfit?.copyContract?.todayReason || outfit?.todayReason || outfit?.reason;
  return typeof value === 'string' ? value.trim() : '';
}

function isPlaceholderTitle(title) {
  return /关系组合|完整标题|默认标题|今日搭配|推荐组合|日常搭配/.test(String(title || ''));
}

function hasTagSceneMismatch(outfit) {
  const scene = String(outfit?.scene || '').toLowerCase();
  const tags = new Set(Array.isArray(outfit?.styleTags) ? outfit.styleTags : []);
  if ((scene === 'work' || scene === '上班' || scene === '通勤') && tags.has('关系组合')) return true;
  if ((scene === 'sport' || scene === '运动') && tags.has('通勤')) return true;
  return false;
}

function buildReasonFactSignature(outfit) {
  const contract = outfit?.copyContract || {};
  const values = uniqueStrings([
    ...(Array.isArray(contract.todayRequiredFactIds) ? contract.todayRequiredFactIds : []),
    ...(Array.isArray(contract.todayEvidenceIds) ? contract.todayEvidenceIds : []),
    safeText(contract.coreEligibilityReasonCode || outfit?.eligibilityReason?.code || '', 96),
    ...readVisibleItems(outfit).map((item) => item?.clothingId || item?.itemId || item?._id || item?.id),
  ]).sort();
  return textSignature(values.join('|') || safeText(outfit?.outfitKey, 96));
}

function normalizeCounts(input, fallback) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    candidate: safeNonNegativeNumber(source.candidate ?? fallback.candidate),
    generated: safeNonNegativeNumber(source.generated ?? fallback.generated),
    accepted: safeNonNegativeNumber(source.accepted ?? fallback.accepted),
    rejected: safeNonNegativeNumber(source.rejected ?? fallback.rejected),
    selected: safeNonNegativeNumber(source.selected ?? fallback.selected),
  };
}

function mergeReasonCounts(target, source) {
  if (!source || typeof source !== 'object') return;
  for (const [reason, count] of Object.entries(source)) {
    const safeCount = safeNonNegativeNumber(count);
    if (safeCount > 0) target.set(safeText(reason, 80), safeCount);
  }
}

function aliasIds(itemIds, aliasMap) {
  return (Array.isArray(itemIds) ? itemIds : [])
    .map((id) => aliasMap.get(String(id)) || '')
    .filter(Boolean);
}

function numericScore(candidate) {
  const value = Number(candidate?.rankingScore ?? candidate?.totalScore ?? candidate?.scores?.total ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function textSignature(value) {
  if (!value) return '';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function incrementMap(map, key) {
  const normalized = safeText(key, 80);
  if (normalized) map.set(normalized, (map.get(normalized) || 0) + 1);
}

function percentile(sorted, percentage) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentage / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value))];
}

function safeText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function safeNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`QA authoritative summary field ${field} must be a non-negative integer`);
  }
  return value;
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

module.exports = {
  MAX_ALTERNATIVES,
  MAX_ARCHETYPES,
  MAX_FINAL_CARDS,
  MAX_REJECTION_REASONS,
  QA_BATCH_AUDIT_VERSION,
  QA_BYTE_LIMIT,
  buildItemAliasMap,
  buildQaAuditSummaries,
  buildQaBatchAudit,
  buildQaGateSummary,
  fitQaBatchAuditToBudget,
  fitEligibilityRejectionAuditToBudget,
  serializedBytes,
};
