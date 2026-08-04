const CLIENT_RECOMMEND_LOG_MAX_BYTES = 8 * 1024;
const DIAGNOSTIC_ENVIRONMENTS = new Set(['develop', 'trial']);
const LOG_LEVEL_BY_LABEL = {
  '[RecommendStart]': 'log',
  '[RecommendResponse]': 'info',
  '[RecommendDone]': 'info',
  '[RecommendReject]': 'warn',
  '[RecommendError]': 'error',
  '[RecommendationQA]': 'info',
  '[RecommendationImagePerf]': 'info',
};
const FORBIDDEN_OBJECT_KEYS = new Set([
  'data', 'debug', 'outfits', 'candidate', 'candidates', 'facts',
  'clothingId', 'clothingIds', 'itemId', 'itemIds', 'openid', 'userId',
  'image', 'imageUrl', 'thumbnail', 'thumbnailUrl', 'url',
]);
const QA_GATE_COUNT_KEYS = ['candidate', 'generated', 'accepted', 'rejected', 'selected'];
const QA_GATE_NUMBER_KEYS = [
  'finalCardCount', 'alternativeCandidateCount', 'placeholderTitleCount',
  'syntheticSuffixCount', 'availableDifferentiatorCount', 'titleDuplicateWarningCount',
  'unsupportedClaimCount', 'tagSceneMismatchCount', 'cardConsistencyFailures',
];

function createRecommendationAuditId(seed = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `rec_${seed ? `${String(seed).slice(0, 12)}_` : ''}${timestamp}_${random}`;
}

function isRecommendationLifecycleLoggingEnabled(envVersion) {
  return DIAGNOSTIC_ENVIRONMENTS.has(typeof envVersion === 'string' ? envVersion : '');
}

function logRecommendationEvent(label, payload, logger = console) {
  const level = LOG_LEVEL_BY_LABEL[label];
  if (!level) return null;
  const safePayload = limitLogPayload(payload);
  const log = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : logger?.log?.bind(logger);
  if (typeof log === 'function') log(label, safePayload);
  return { label, payload: safePayload, bytes: serializedLogBytes(label, safePayload) };
}

function buildRecommendationQaLogSummary(audit) {
  if (!audit || typeof audit !== 'object') return null;
  const qaGateSummary = sanitizeQaGateSummary(audit.qaGateSummary);
  const summary = {
    auditId: readText(audit.auditId, 80),
    ...(qaGateSummary ? { qaGateSummary } : {}),
    version: readText(audit.version, 64),
    cloudBuild: readText(audit.cloudBuild, 80),
    executionMode: readText(audit.executionMode, 32),
    candidatePoolIdentityHash: readText(audit.candidatePoolIdentityHash, 64),
    candidatePoolAgeMs: readNonNegativeNumber(audit.candidatePoolAgeMs),
    cacheHit: audit.cacheHit === true,
    cacheMissReason: readText(audit.cacheMissReason, 48),
    candidatePoolSaveStatus: readText(audit.candidatePoolSaveStatus, 32),
    candidatePoolSaveReason: readText(audit.candidatePoolSaveReason, 64),
    candidatePoolSerializedBytes: readNonNegativeNumber(audit.candidatePoolSerializedBytes),
    candidatePoolChunkCount: readNonNegativeNumber(audit.candidatePoolChunkCount),
    candidatePoolManifestBytes: readNonNegativeNumber(audit.candidatePoolManifestBytes),
    candidatePoolChunksBytes: readNonNegativeNumber(audit.candidatePoolChunksBytes),
    countContract: sanitizeCountContract(audit.countContract),
    candidatePoolCleanupAttempted: audit.candidatePoolCleanupAttempted === true,
    candidatePoolCleanupDeletedCount: readNonNegativeNumber(audit.candidatePoolCleanupDeletedCount),
    candidatePoolCleanupFailedCount: readNonNegativeNumber(audit.candidatePoolCleanupFailedCount),
    recommendationBatchIdPresent: audit.recommendationBatchIdPresent === true,
    recommendationBatchIdLength: readNonNegativeNumber(audit.recommendationBatchIdLength),
    requestedCandidatePoolIdPresent: audit.requestedCandidatePoolIdPresent === true,
    requestedCandidatePoolIdLength: readNonNegativeNumber(audit.requestedCandidatePoolIdLength),
    counts: compactObject(audit.counts, 8, 1),
    rejectionReasonHistogram: compactArray(audit.rejectionReasonHistogram, 8, 1),
    archetypeHistogram: compactArray(audit.archetypeHistogram, 6, 1),
    finalCardCount: qaGateSummary?.finalCardCount
      ?? (Array.isArray(audit.finalCards) ? audit.finalCards.length : 0),
    ...(qaGateSummary && Object.prototype.hasOwnProperty.call(qaGateSummary, 'alternativeCandidateCount')
      ? { alternativeCandidateCount: qaGateSummary.alternativeCandidateCount }
      : {}),
    exclusionsAppliedCount: readNonNegativeNumber(audit.exclusionsAppliedCount),
    requestedExcludedCount: readNonNegativeNumber(audit.requestedExcludedCount),
    actualExcludedCandidateCount: readNonNegativeNumber(audit.actualExcludedCandidateCount),
    remainingCandidateCount: readNonNegativeNumber(audit.remainingCandidateCount),
    reuseExplanations: compactArray(audit.reuseExplanations, 8, 1),
    exactTitleDuplicateGroups: compactArray(audit.exactTitleDuplicateGroups, 8, 1),
    normalizedTitleDuplicateGroups: compactArray(audit.normalizedTitleDuplicateGroups, 8, 1),
    exactReasonDuplicateGroups: compactArray(audit.exactReasonDuplicateGroups, 8, 1),
    normalizedReasonDuplicateGroups: compactArray(audit.normalizedReasonDuplicateGroups, 8, 1),
    titleTokenDuplicateGroups: compactArray(audit.titleTokenDuplicateGroups, 8, 1),
    placeholderTitleCount: readNonNegativeNumber(audit.placeholderTitleCount),
    syntheticSuffixCount: readNonNegativeNumber(audit.syntheticSuffixCount),
    availableDifferentiatorCount: readNonNegativeNumber(audit.availableDifferentiatorCount),
    duplicateCause: readText(audit.duplicateCause, 32),
    titleDuplicateWarningCount: readNonNegativeNumber(audit.titleDuplicateWarningCount),
    gateStatus: readText(audit.gateStatus, 32),
    qaGatePassed: audit.qaGatePassed !== false,
    qaBlockReasons: compactArray(audit.qaBlockReasons, 8, 1),
    tagSceneMismatchCount: readNonNegativeNumber(audit.tagSceneMismatchCount),
    cardConsistencyFailures: readNonNegativeNumber(audit.cardConsistencyFailures),
    timings: compactDiagnosticMap(audit.timings),
    responseBytes: compactDiagnosticMap(audit.responseBytes),
    qaTruncated: qaGateSummary?.qaTruncated ?? Boolean(audit.qaTruncated),
  };
  const eligibilityRejectionAudit = buildEligibilityRejectionAuditLogSummary(audit.eligibilityRejectionAudit);
  if (eligibilityRejectionAudit) {
    summary.eligibilityRejectionAudit = eligibilityRejectionAudit;
    fitEligibilityRejectionAuditLogToBudget(summary);
  }
  return summary;
}

function fitEligibilityRejectionAuditLogToBudget(summary) {
  const audit = summary?.eligibilityRejectionAudit;
  if (!audit) return;
  while (serializedLogBytes('[RecommendationQA]', summary) >= CLIENT_RECOMMEND_LOG_MAX_BYTES
    && audit.samples.length > 0) {
    audit.samples.pop();
    audit.truncated = true;
  }
}

function buildEligibilityRejectionAuditLogSummary(audit) {
  if (!audit || typeof audit !== 'object') return null;
  return {
    version: readText(audit.version, 64),
    generatedCount: readNonNegativeNumber(audit.generatedCount),
    guardEnteredCount: readNonNegativeNumber(audit.guardEnteredCount),
    guardAcceptedCount: readNonNegativeNumber(audit.guardAcceptedCount),
    guardRejectedCount: readNonNegativeNumber(audit.guardRejectedCount),
    rejectionStageHistogram: compactCountObject(audit.rejectionStageHistogram),
    rejectionReasonHistogram: compactCountObject(audit.rejectionReasonHistogram),
    rejectionReasonCombinationHistogram: compactCountObject(audit.rejectionReasonCombinationHistogram),
    categoryDistribution: buildEligibilityCategoryDistribution(audit.categoryDistribution),
    samples: Array.isArray(audit.samples)
      ? audit.samples.slice(0, 12).map(buildEligibilitySample).filter(Boolean)
      : [],
    truncated: audit.truncated === true,
    serializedBytes: readNonNegativeNumber(audit.serializedBytes),
  };
}

function buildEligibilityCategoryDistribution(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    top: buildEligibilityRoleDistribution(value.top),
    bottom: buildEligibilityRoleDistribution(value.bottom),
    shoes: buildEligibilityRoleDistribution(value.shoes),
    roleCompleteness: compactCountObject(value.roleCompleteness),
    sportFactCounts: compactCountObject(value.sportFactCounts),
    safeSportCandidate: {
      exists: value.safeSportCandidate?.exists === true,
      count: readNonNegativeNumber(value.safeSportCandidate?.count),
    },
  };
}

function buildEligibilityRoleDistribution(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    categories: compactCountObject(value.categories),
    subtypes: compactCountObject(value.subtypes),
  };
}

function buildEligibilitySample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  return {
    sampleIndex: readNonNegativeNumber(sample.sampleIndex),
    rejectionStage: readText(sample.rejectionStage, 64),
    rejectionCodes: Array.isArray(sample.rejectionCodes)
      ? sample.rejectionCodes.slice(0, 12).map((value) => readText(value, 96)).filter(Boolean)
      : [],
    top: buildEligibilityRoleSnapshot(sample.top),
    bottom: buildEligibilityRoleSnapshot(sample.bottom),
    shoes: buildEligibilityRoleSnapshot(sample.shoes),
    roleCompleteness: sample.roleCompleteness === true,
    weather: {
      mode: readText(sample.weather?.mode, 24),
      temperatureBucket: readText(sample.weather?.temperatureBucket, 24),
      precipitationPresent: sample.weather?.precipitationPresent === true,
    },
  };
}

function buildEligibilityRoleSnapshot(value) {
  return {
    category: readText(value?.category, 32),
    subtype: readText(value?.subtype, 48),
    sportFacts: compactBooleanObject(value?.sportFacts),
  };
}

function compactCountObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) >= 0)
    .map(([key, count]) => [readText(key, 96), readNonNegativeNumber(count)])
    .filter(([key]) => Boolean(key)));
}

function compactBooleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, flag]) => typeof flag === 'boolean')
    .map(([key, flag]) => [readText(key, 64), flag])
    .filter(([key]) => Boolean(key)));
}

function readNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function serializedLogBytes(label, payload) {
  return utf8ByteLength(JSON.stringify({ label, payload }));
}

function limitLogPayload(payload) {
  const safePayload = compactObject(payload, 20, 2);
  const qaGateSummary = sanitizeQaGateSummary(payload?.qaGateSummary);
  if (qaGateSummary) safePayload.qaGateSummary = qaGateSummary;
  if (payload?.eligibilityRejectionAudit) {
    safePayload.eligibilityRejectionAudit = buildEligibilityRejectionAuditLogSummary(payload.eligibilityRejectionAudit);
  }
  const auditId = readText(payload?.auditId, 80) || 'missing-audit-id';
  safePayload.auditId = auditId;
  if (serializedLogBytes('', safePayload) <= CLIENT_RECOMMEND_LOG_MAX_BYTES) return safePayload;
  return { auditId, ...(qaGateSummary ? { qaGateSummary } : {}), truncated: true };
}

function sanitizeQaGateSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const summary = {};
  if (Object.prototype.hasOwnProperty.call(value, 'version')) summary.version = readText(value.version, 64);
  if (value.counts && typeof value.counts === 'object' && !Array.isArray(value.counts)) {
    summary.counts = {};
    for (const key of QA_GATE_COUNT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value.counts, key)) {
        summary.counts[key] = readNonNegativeNumber(value.counts[key]);
      }
    }
  }
  for (const key of QA_GATE_NUMBER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) summary[key] = readNonNegativeNumber(value[key]);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'qaGatePassed')) summary.qaGatePassed = value.qaGatePassed === true;
  if (Object.prototype.hasOwnProperty.call(value, 'gateStatus')) summary.gateStatus = readText(value.gateStatus, 32);
  if (Object.prototype.hasOwnProperty.call(value, 'qaBlockReasons')) {
    summary.qaBlockReasons = Array.isArray(value.qaBlockReasons)
      ? value.qaBlockReasons.slice(0, 8).map((reason) => readText(reason, 96)).filter(Boolean)
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(value, 'duplicateCause')) summary.duplicateCause = readText(value.duplicateCause, 32);
  if (Object.prototype.hasOwnProperty.call(value, 'qaTruncated')) summary.qaTruncated = value.qaTruncated === true;
  return summary;
}

function compactObject(value, maxKeys, depth) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of Object.keys(value).slice(0, maxKeys)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key) && value[key] && typeof value[key] === 'object') continue;
    if (key === 'timings' || key === 'responseBytes' || key === 'clientTimings') {
      result[key] = compactDiagnosticMap(value[key]);
    } else {
      result[key] = compactValue(value[key], depth);
    }
  }
  return result;
}

function compactDiagnosticMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => typeof entry === 'boolean' || Number.isFinite(Number(entry)))
    .map(([key, entry]) => [readText(key, 64), typeof entry === 'boolean' ? entry : readNonNegativeNumber(entry)])
    .filter(([key]) => Boolean(key)));
}

function sanitizeCountContract(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    requestedBatchSize: readNonNegativeNumber(value.requestedBatchSize),
    expectedCardCount: readNonNegativeNumber(value.expectedCardCount),
    returnedCardCount: readNonNegativeNumber(value.returnedCardCount),
    remainingUniqueBeforeConsume: readNonNegativeNumber(value.remainingUniqueBeforeConsume),
    remainingUniqueAfterConsume: readNonNegativeNumber(value.remainingUniqueAfterConsume),
    tailBatchAuthorized: value.tailBatchAuthorized === true,
    poolExhaustedAfterConsume: value.poolExhaustedAfterConsume === true,
    executionMode: readText(value.executionMode, 32),
    candidatePoolId: null,
  };
}

function compactArray(value, maxItems, depth) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => compactValue(item, depth));
}

function compactValue(value, depth) {
  if (typeof value === 'string') return value.slice(0, 512);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth <= 0) return typeof value;
  if (Array.isArray(value)) return compactArray(value, 8, depth - 1);
  if (value && typeof value === 'object') return compactObject(value, 12, depth - 1);
  return undefined;
}

function readText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

module.exports = {
  CLIENT_RECOMMEND_LOG_MAX_BYTES,
  buildRecommendationQaLogSummary,
  createRecommendationAuditId,
  isRecommendationLifecycleLoggingEnabled,
  logRecommendationEvent,
  serializedLogBytes,
};
