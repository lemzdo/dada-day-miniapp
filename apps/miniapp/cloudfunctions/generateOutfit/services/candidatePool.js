const crypto = require('crypto');

// V2 keeps the existing collection but changes the document contract. A pool
// is visible only when its manifest exists and all chunks validate.
const CANDIDATE_POOL_COLLECTION = 'recommendation_candidate_pools';
const CANDIDATE_POOL_SCHEMA_VERSION = 2;
const CANDIDATE_POOL_VERSION = 'candidate-pool-v2';
const CANDIDATE_POOL_TTL_MS = 10 * 60 * 1000;
const CANDIDATE_POOL_MAX_BYTES = 256 * 1024;
const CANDIDATE_POOL_CHUNK_DATA_BUDGET = 240 * 1024;
const CANDIDATE_POOL_RECORD_TYPES = Object.freeze({ manifest: 'manifest', chunk: 'chunk' });
const CANDIDATE_POOL_MANIFEST_STATUS = 'ready';
const CANDIDATE_POOL_DOCUMENT_ID_PREFIX = 'pool-v2';
const CANDIDATE_POOL_CHECKSUM_ALGORITHM = 'json-sha256-v1';
const PREPARED_CANDIDATE_JSON = Symbol('preparedCandidateJson');
const PREPARED_CANDIDATE_CHUNKS = Symbol('preparedCandidateChunks');
const CANDIDATE_POOL_LOOKUP_INDEX = Object.freeze([
  'ownerHash',
  'candidatePoolId',
  'recordType',
  'schemaVersion',
]);
const CANDIDATE_POOL_DIAGNOSTIC_ERROR_MESSAGE_MAX = 500;
const CANDIDATE_POOL_SENSITIVE_KEYS = new Set([
  'openid',
  'userId',
  'clothingId',
  'clothingIds',
  'itemId',
  'itemIds',
  'candidatePoolId',
  'poolId',
  'recommendationBatchId',
]);
const ROLE_KEYS = Object.freeze(['top', 'bottom', 'onepiece', 'outerwear', 'shoes']);
const ITEM_SLOT_KEYS = Object.freeze([...ROLE_KEYS, 'accessory']);

function buildCandidatePoolIdentity({
  openid,
  clothes = [],
  sceneKey,
  weather,
  weatherMode,
  recommendationProfile,
  timeOfDay,
  engineVersion,
} = {}) {
  const identity = {
    version: CANDIDATE_POOL_VERSION,
    schemaVersion: CANDIDATE_POOL_SCHEMA_VERSION,
    userIdentityHash: hashValue(readString(openid)),
    wardrobeFingerprint: fingerprintWardrobe(clothes),
    sceneKey: readString(sceneKey),
    weatherMode: readString(weatherMode || weather?.mode || weather?.weatherMode),
    weatherFingerprint: fingerprintWeather(weather),
    profileFingerprint: hashValue(stableSerialize(recommendationProfile || {})),
    timeOfDay: readString(timeOfDay) || 'all_day',
    engineVersion: readString(engineVersion),
  };
  return {
    ...identity,
    identityHash: hashValue(stableSerialize(identity)),
  };
}

function createCandidatePoolRecord({
  candidatePoolId,
  identity,
  candidates = [],
  now = Date.now(),
  ttlMs = CANDIDATE_POOL_TTL_MS,
  phaseRecorder,
} = {}) {
  const createdAtMs = normalizeTimestamp(now);
  const safeTtlMs = Math.min(Math.max(Number(ttlMs) || CANDIDATE_POOL_TTL_MS, 1), CANDIDATE_POOL_TTL_MS);
  const sourceCandidates = Array.isArray(candidates) ? candidates : [];
  measureCandidatePoolPhase(phaseRecorder, 'poolInputMaterialization', () => {
    if (!sourceCandidates.every(isAcceptedScoredCandidate)) {
      throw new Error('candidate pool may contain only accepted scored cores');
    }
  });
  const serializedCandidates = measureCandidatePoolPhase(
    phaseRecorder,
    'objectCloneNormalization',
    () => sourceCandidates.map(serializeCandidateCore),
  );
  const candidateJson = measureCandidatePoolPhase(
    phaseRecorder,
    'jsonSerialization',
    () => serializedCandidates.map((candidate) => JSON.stringify(candidate)),
  );
  const candidateChunks = measureCandidatePoolPhase(
    phaseRecorder,
    'dictionaryChunkBuild',
    () => splitCandidatesByByteBudget(serializedCandidates, candidateJson),
  );
  const checksum = measureCandidatePoolPhase(
    phaseRecorder,
    'checksumHash',
    () => checksumCandidates(
      serializedCandidates,
      CANDIDATE_POOL_CHECKSUM_ALGORITHM,
      candidateJson,
    ),
  );
  const pool = measureCandidatePoolPhase(phaseRecorder, 'poolInputMaterialization', () => ({
    schemaVersion: CANDIDATE_POOL_SCHEMA_VERSION,
    version: CANDIDATE_POOL_VERSION,
    recordType: 'assembled',
    candidatePoolId: readString(candidatePoolId),
    ownerHash: readString(identity?.userIdentityHash),
    identity: sanitizeIdentity(identity),
    candidates: serializedCandidates,
    candidateCount: serializedCandidates.length,
    chunkCount: candidateChunks.length,
    checksumAlgorithm: CANDIDATE_POOL_CHECKSUM_ALGORITHM,
    checksum,
    createdAtMs,
    expiresAtMs: createdAtMs + safeTtlMs,
    expiresAt: new Date(createdAtMs + safeTtlMs),
  }));
  if (!pool.candidatePoolId || !pool.ownerHash || !pool.identity.identityHash) {
    throw new Error('candidate pool identity is required');
  }
  if (!pool.candidates.every(isPoolCandidate)) throw new Error('candidate pool entry is malformed');
  assertNoSensitiveIdentity(pool);
  Object.defineProperty(pool, PREPARED_CANDIDATE_JSON, { value: candidateJson });
  Object.defineProperty(pool, PREPARED_CANDIDATE_CHUNKS, { value: candidateChunks });
  return pool;
}

function serializeCandidateCore(candidate = {}) {
  const source = candidate;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('candidate pool candidate must be an object');
  }
  // Pool storage is a projection, not a serialized execution object. Wardrobe
  // facts, copy contracts, evidence text, and view models are rebuilt on hit.
  const itemFactRefs = serializeItemRoles(source);
  const itemIds = uniqueStrings(source.itemIds).length > 0
    ? uniqueStrings(source.itemIds)
    : itemFactRefs.map((item) => item.itemId);
  const roleItemIds = hasRoleItemIds(source.roleItemIds)
    ? sanitizeRoleItemIds(source.roleItemIds)
    : buildRoleItemIdsFromRefs(itemFactRefs);
  const scores = compactScoreComponents(source.scores || source.scoreBreakdown);
  const eligibility = compactEligibility(source.eligibility, source.weatherEligibility, source.sceneEligibility);
  const reasonCodes = uniqueStrings([
    ...(Array.isArray(source.eligibilityReasonCandidates) ? source.eligibilityReasonCandidates : []).map((reason) => reason?.code),
    source.eligibilityReason?.code,
    source.copyContract?.coreEligibilityReasonCode,
    source.selectionSignatures?.reasonCodeSignature,
    source.eligibility?.scene?.eligibilityReason?.code,
    ...(Array.isArray(source.reasonCodes) ? source.reasonCodes : []),
  ]);
  const persisted = {
    version: readString(source.version) || 'candidate-core-v1',
    compositionVersion: readString(source.compositionVersion),
    structureType: readString(source.structureType),
    itemFactRefs,
    archetype: readString(source.archetype),
    aggregateEligibilityFacts: source.aggregateEligibilityFacts || {
      itemCount: itemIds.length,
      roleCount: Object.values(roleItemIds).filter(Boolean).length,
    },
    eligibility,
    reasonCodes,
    scores,
    totalScore: finiteNumber(source.totalScore),
    rankingScore: finiteNumber(source.rankingScore),
    selectionSignatures: sanitizeSelectionSignatures(source.selectionSignatures, {
      omitItemSignature: true,
      omitArchetype: true,
    }),
    outfitKey: readString(source.outfitKey || source.stableSortId || source.selectionSignatures?.itemSignature),
    sceneIntent: readString(source.sceneIntent),
    primaryBenefit: readString(source.primaryBenefit),
    primaryBenefitCode: readString(source.primaryBenefitCode || source.primaryBenefit),
    secondaryBenefit: readString(source.secondaryBenefit),
    observationFocus: readString(source.observationFocus),
  };
  return persisted;
}

function hydrateCandidateCore(poolCandidate, { reasonDescriptorForCode } = {}) {
  if (!isPoolCandidate(poolCandidate)) throw new Error('candidate pool entry is malformed');
  const source = cloneJsonValue(poolCandidate);
  // V2 pools are presentation-agnostic. Ignore title fields left by older
  // writers so the current wardrobe facts rebuild the canonical title.
  delete source.title;
  delete source.displayTitle;
  delete source.userTitle;
  const originalRefs = sanitizeItemRoles(
    Array.isArray(source.itemFactRefs) && source.itemFactRefs.length > 0
      ? source.itemFactRefs
      : source.itemRoles,
  );
  const itemIds = uniqueStrings(
    Array.isArray(source.itemIds) && source.itemIds.length > 0
      ? source.itemIds
      : originalRefs.map((item) => item.itemId),
  );
  const itemFactRefs = originalRefs.length === itemIds.length
    ? originalRefs
    : [];
  if (itemFactRefs.length === 0 || itemFactRefs.length !== itemIds.length) {
    throw new Error('candidate pool item roles are malformed');
  }
  const roleItemIds = hasRoleItemIds(source.roleItemIds)
    ? sanitizeRoleItemIds(source.roleItemIds)
    : buildRoleItemIdsFromRefs(itemFactRefs);
  const storedReasonCandidates = Array.isArray(source.eligibilityReasonCandidates)
    ? source.eligibilityReasonCandidates.filter((reason) => reason?.code)
    : [];
  const reasonCandidates = storedReasonCandidates.length > 0
    ? storedReasonCandidates
    : source.reasonCodes.map((code) => {
      const descriptor = typeof reasonDescriptorForCode === 'function' ? reasonDescriptorForCode(code) : null;
      if (!descriptor) throw new Error(`candidate pool reason code is unsupported: ${code}`);
      return descriptor;
    });
  if (reasonCandidates.length === 0) throw new Error('candidate pool reason codes are required');
  const poolScores = source.scores && typeof source.scores === 'object' ? source.scores : {};
  const eligibility = source.eligibility && typeof source.eligibility === 'object'
    ? source.eligibility
    : compactEligibility({}, source.weatherEligibility, source.sceneEligibility);
  const selectionSignatures = sanitizeSelectionSignatures(source.selectionSignatures);
  selectionSignatures.itemSignature ||= readString(source.outfitKey || source.stableSortId);
  selectionSignatures.archetype ||= readString(source.archetype);
  return {
    ...source,
    version: source.version || 'candidate-core-v1',
    compositionVersion: source.compositionVersion || '',
    structureType: source.structureType || '',
    itemIds,
    roleItemIds,
    itemFactRefs,
    aggregateEligibilityFacts: source.aggregateEligibilityFacts || {
      itemCount: itemIds.length,
      roleCount: Object.values(roleItemIds).filter(Boolean).length,
    },
    weatherEligibility: source.weatherEligibility || { ...(eligibility.weather || {}) },
    sceneEligibility: source.sceneEligibility || { ...(eligibility.scene || {}) },
    eligibility: cloneJsonValue(eligibility),
    eligibilityReason: source.eligibilityReason || null,
    eligibilityReasonCandidates: reasonCandidates,
    scoreBreakdown: { ...poolScores },
    scores: { ...poolScores },
    totalScore: source.totalScore,
    rankingScore: source.rankingScore,
    selectionSignatures,
    validatorRejectReasons: Array.isArray(source.validatorRejectReasons) ? source.validatorRejectReasons : [],
    riskFlags: Array.isArray(source.riskFlags) ? source.riskFlags : [],
    outfitKey: source.outfitKey || source.stableSortId || selectionSignatures.itemSignature,
  };
}

function getReasonSelectionDescriptor(code, catalog = []) {
  const entry = (Array.isArray(catalog) ? catalog : []).find((value) => value?.reasonCode === code);
  if (!entry) return null;
  return {
    code: entry.reasonCode,
    family: entry.family,
    qualityTier: entry.qualityTier,
    isGenericFallback: entry.isGenericFallback === true,
    catalogOrder: (Array.isArray(catalog) ? catalog : []).indexOf(entry),
    text: `catalog:${entry.reasonCode}`,
  };
}

function compactEligibility(value, weatherValue, sceneValue) {
  const weather = compactEligibilityResult(weatherValue || value?.weather, 'weather');
  const scene = compactEligibilityResult(sceneValue || value?.scene, 'scene');
  return {
    weather,
    scene,
    penalty: finiteNumber(value?.penalty) || 0,
  };
}

function compactEligibilityResult(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {
    penalty: finiteNumber(value.penalty) || 0,
    ...(kind === 'weather' ? { pass: value.pass === true } : {
      eligible: value.eligible === true,
      hardRejected: value.hardRejected === true,
      sceneStrength: readString(value.sceneStrength),
    }),
    acceptReasons: uniqueStrings(value.acceptReasons),
    rejectReasons: uniqueStrings(value.rejectReasons),
    warningReasons: uniqueStrings(value.warningReasons || value.warnings),
  };
  if (kind === 'weather') {
    result.mode = readString(value.mode);
    result.temperatureBand = readString(value.temperatureBand);
  }
  return result;
}

function compactScoreComponents(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = [
    'total', 'weatherAdaptation', 'colorHarmony', 'styleUnity', 'sceneMatch',
    'freshness', 'preference', 'aesthetic', 'reusePenalty', 'composition',
    'comfort', 'coolness', 'fashion', 'warmth',
  ];
  return Object.fromEntries(allowed
    .filter((key) => Object.hasOwn(value, key))
    .map((key) => [key, finiteNumber(value[key])]));
}

async function loadCandidatePool({ database, candidatePoolId, identity, now = Date.now(), timings } = {}) {
  const id = readString(candidatePoolId);
  if (!database || !id || !identity?.userIdentityHash) return { hit: false, reason: 'missing_batch_id' };
  if (timings) timings.poolDbReadCount = 0;
  let manifestResponse;
  const manifestStartedAt = Date.now();
  try {
    if (timings) timings.poolDbReadCount += 1;
    manifestResponse = await readCandidatePoolDocument(
      database.collection(CANDIDATE_POOL_COLLECTION),
      buildCandidatePoolDocumentId({
        ownerHash: identity.userIdentityHash,
        candidatePoolId: id,
        recordType: CANDIDATE_POOL_RECORD_TYPES.manifest,
      }),
    );
  } catch {
    if (timings) timings.poolManifestLoadMs = Date.now() - manifestStartedAt;
    return { hit: false, reason: 'storage_unavailable' };
  }
  if (timings) timings.poolManifestLoadMs = Date.now() - manifestStartedAt;
  let manifest = manifestResponse?.data && !Array.isArray(manifestResponse.data)
    ? manifestResponse.data
    : null;
  // Read old V2 auto-id documents during the migration window only. New writes
  // always use the deterministic document id above.
  if (!manifest) {
    try {
      if (timings) timings.poolDbReadCount += 1;
      const legacyLookup = await database.collection(CANDIDATE_POOL_COLLECTION).where({
        candidatePoolId: id,
        ownerHash: identity.userIdentityHash,
        recordType: CANDIDATE_POOL_RECORD_TYPES.manifest,
        schemaVersion: CANDIDATE_POOL_SCHEMA_VERSION,
      }).limit(1).get();
      manifest = Array.isArray(legacyLookup?.data) ? legacyLookup.data[0] : null;
    } catch {
      // A missing/blocked migration-era lookup is a normal cache miss.
    }
  }
  if (!manifest) return { hit: false, reason: 'not_found' };
  const manifestValidation = validateCandidatePoolManifest(manifest, identity, now);
  if (!manifestValidation.ok) return { hit: false, reason: manifestValidation.reason };

  let chunkResponse;
  const chunksStartedAt = Date.now();
  try {
    if (timings) timings.poolDbReadCount += 1;
    chunkResponse = await database.collection(CANDIDATE_POOL_COLLECTION).where({
      candidatePoolId: id,
      ownerHash: identity.userIdentityHash,
      recordType: CANDIDATE_POOL_RECORD_TYPES.chunk,
      schemaVersion: CANDIDATE_POOL_SCHEMA_VERSION,
    }).get();
  } catch {
    if (timings) timings.poolChunksLoadMs = Date.now() - chunksStartedAt;
    return { hit: false, reason: 'chunks_unavailable' };
  }
  if (timings) timings.poolChunksLoadMs = Date.now() - chunksStartedAt;
  const chunks = Array.isArray(chunkResponse?.data) ? chunkResponse.data.slice() : [];
  const assembled = assembleCandidatePoolFromStorage(manifest, chunks, identity, now);
  if (!assembled.ok) return { hit: false, reason: assembled.reason };
  return { hit: true, pool: assembled.pool, ageMs: assembled.ageMs };
}

async function saveCandidatePool({ database, candidatePoolId, identity, candidates, now = Date.now() } = {}) {
  const result = await tryPersistCandidatePool({ database, candidatePoolId, identity, candidates, now });
  return { saved: result.status === 'saved', pool: result.pool, ...result };
}

async function tryPersistCandidatePool({
  database,
  candidatePoolId,
  identity,
  candidates,
  now = Date.now(),
  auditId,
  debugRecommendationAudit = false,
    debugCandidatePoolProjection,
  logger = console,
} = {}) {
  const phaseRecorder = createCandidatePoolPhaseRecorder();
  const poolId = readString(candidatePoolId);
  if (!poolId || !identity?.userIdentityHash) {
    return finalizePersistenceTiming(persistenceFailure('missing_identity'), phaseRecorder);
  }
  if (!database) {
    return finalizePersistenceTiming(persistenceFailure('storage_unavailable'), phaseRecorder);
  }
  const serializationStartedAt = Date.now();
  let pool;
  let plan;
  try {
    pool = createCandidatePoolRecord({
      candidatePoolId: poolId,
      identity,
      candidates,
      now,
      phaseRecorder,
    });
  } catch (error) {
    return finalizePersistenceTiming(
      persistenceFailure(
        error.message || 'serialization_failed',
        error.message === 'candidate exceeds chunk budget' ? 'candidate_oversized' : 'serialization_failed',
        plan,
      ),
      phaseRecorder,
    );
  }
  const serializationMs = Date.now() - serializationStartedAt;
  const planStartedAt = Date.now();
  try {
    plan = buildCandidatePoolStoragePlan(pool, { phaseRecorder });
  } catch (error) {
    return finalizePersistenceTiming(
      persistenceFailure(
        error.message || 'serialization_failed',
        error.message === 'candidate exceeds chunk budget' ? 'candidate_oversized' : 'serialization_failed',
        plan,
      ),
      phaseRecorder,
    );
  }
  const planBuildMs = Date.now() - planStartedAt;
  const collection = database.collection(CANDIDATE_POOL_COLLECTION);
  const writeStartedAt = Date.now();
  const diagnosticAuditId = readDiagnosticAuditId(auditId);
  const sensitiveValues = measureCandidatePoolPhase(
    phaseRecorder,
    'cleanupTelemetryAssembly',
    () => collectCandidatePoolSensitiveValues(pool, poolId),
  );
  let successfulChunkCount = 0;
  const successfulChunkIndexes = [];

    if (debugCandidatePoolProjection === true
      || (debugCandidatePoolProjection === undefined && debugRecommendationAudit === true)) {
    measureCandidatePoolPhase(phaseRecorder, 'cleanupTelemetryAssembly', () => {
      emitCandidatePoolDiagnostic(logger, 'info', '[CandidatePoolProjectionProfile]', {
        auditId: diagnosticAuditId,
        ...buildCandidatePoolProjectionProfile({
          candidates: pool.candidates,
          chunks: plan.chunks,
          manifest: plan.manifest,
          prepared: plan.prepared,
          runtime: true,
        }),
      });
    });
  }

  // Chunks are independent deterministic documents. Write them concurrently, then
  // validate every chunk before publishing the manifest. A partial pool remains
  // invisible because the manifest is still the only commit point.
  let activeChunkWrites = 0;
  let maxActiveChunkWrites = 0;
  const chunkTasks = measureCandidatePoolPhase(
    phaseRecorder,
    'chunkTaskCreation',
    () => plan.chunks.map((chunk, chunkIndex) => async () => {
    const startedAt = monotonicNowMs();
    const documentBytes = plan.prepared?.chunkDocumentBytes?.[chunkIndex]
      ?? utf8Bytes(JSON.stringify(chunk));
    activeChunkWrites += 1;
    maxActiveChunkWrites = Math.max(maxActiveChunkWrites, activeChunkWrites);
    emitCandidatePoolDiagnostic(logger, 'info', '[CandidatePoolChunkIndex]', {
      auditId: diagnosticAuditId,
      chunkIndex,
      chunkCount: plan.chunks.length,
      documentBytes,
      indexFieldNames: CANDIDATE_POOL_LOOKUP_INDEX.slice(),
    });
    try {
      const writeResult = await writeCandidatePoolDocument(collection, chunk);
      return {
        ok: true,
        chunkIndex,
        documentBytes,
        elapsedMs: monotonicNowMs() - startedAt,
        writeResult,
      };
    } catch (error) {
      return {
        ok: false,
        chunkIndex,
        error,
        documentBytes,
        elapsedMs: monotonicNowMs() - startedAt,
      };
    } finally {
      activeChunkWrites -= 1;
    }
  }),
  );
  const chunkWriteStartedAt = monotonicNowMs();
  const chunkWriteResults = await Promise.all(chunkTasks.map((task) => task()));
  const chunkWriteMs = monotonicNowMs() - chunkWriteStartedAt;
  phaseRecorder.add('chunkRemoteWriteWall', chunkWriteMs);
  const chunkWriteTimings = measureCandidatePoolPhase(phaseRecorder, 'promiseJoin', () => {
    const timings = chunkWriteResults.map((result) => ({
      chunkIndex: result.chunkIndex,
      documentBytes: result.documentBytes,
      elapsedMs: roundTiming(result.elapsedMs),
      ok: result.ok,
    }));
    for (const result of chunkWriteResults) {
      if (!result.ok) continue;
      successfulChunkCount += 1;
      successfulChunkIndexes.push(result.chunkIndex);
    }
    return timings;
  });
  const failedChunk = chunkWriteResults.find((result) => !result.ok);
  if (failedChunk) {
    const chunk = plan.chunks[failedChunk.chunkIndex];
    const error = failedChunk.error;
    const isTimeout = isCandidatePoolTimeout(error);
    const cleanupStartedAt = monotonicNowMs();
    const cleanup = await cleanupCandidatePoolChunks({
      collection,
      plan,
      chunkIndexes: successfulChunkIndexes,
      logger,
      auditId: diagnosticAuditId,
      sensitiveValues,
    });
    phaseRecorder.add('cleanupTelemetryAssembly', monotonicNowMs() - cleanupStartedAt);
    measureCandidatePoolPhase(phaseRecorder, 'cleanupTelemetryAssembly', () => emitCandidatePoolWriteError(logger, {
      auditId: diagnosticAuditId,
      stage: 'chunk',
      chunkIndex: failedChunk.chunkIndex,
      chunkCount: plan.chunks.length,
      documentBytes: plan.prepared?.chunkDocumentBytes?.[failedChunk.chunkIndex]
        ?? utf8Bytes(JSON.stringify(chunk)),
      successfulChunkCount,
      manifestWritten: false,
      orphanChunkCount: successfulChunkCount,
      collection: CANDIDATE_POOL_COLLECTION,
      operation: 'set',
      error,
      sensitiveValues,
      elapsedMs: Date.now() - writeStartedAt,
      cleanup,
    }));
    return finalizePersistenceTiming({
      ...persistenceFailure(error?.message || (isTimeout ? 'database_timeout' : 'database_write_failed'), isTimeout ? 'database_timeout' : 'database_write_failed', plan, cleanup),
      status: isTimeout ? 'write_timeout' : 'write_failed',
      planBuildMs,
      serializationMs,
      chunkWriteMs,
      chunkWriteTimings,
      maxActiveChunkWrites,
      validationMs: 0,
      manifestWriteMs: 0,
      dbReadCount: 0,
      dbWriteCount: plan.chunks.length,
    }, phaseRecorder, chunkWriteTimings);
  }

  const validationStartedAt = monotonicNowMs();
  try {
    validateCandidatePoolStoragePlan(plan);
  } catch (error) {
    const validationMs = monotonicNowMs() - validationStartedAt;
    phaseRecorder.add('localValidation', validationMs);
    const isTimeout = isCandidatePoolTimeout(error);
    const cleanupStartedAt = monotonicNowMs();
    const cleanup = await cleanupCandidatePoolChunks({
      collection,
      plan,
      chunkIndexes: successfulChunkIndexes,
      logger,
      auditId: diagnosticAuditId,
      sensitiveValues,
    });
    phaseRecorder.add('cleanupTelemetryAssembly', monotonicNowMs() - cleanupStartedAt);
    measureCandidatePoolPhase(phaseRecorder, 'cleanupTelemetryAssembly', () => emitCandidatePoolWriteError(logger, {
      auditId: diagnosticAuditId,
      stage: 'validation',
      chunkIndex: -1,
      chunkCount: plan.chunks.length,
      documentBytes: 0,
      successfulChunkCount,
      manifestWritten: false,
      orphanChunkCount: successfulChunkCount,
      collection: CANDIDATE_POOL_COLLECTION,
      operation: 'local_checksum',
      cleanupAttempted: cleanup.attempted,
      cleanupDeletedCount: cleanup.deletedCount,
      cleanupFailedCount: cleanup.failedCount,
      error,
      elapsedMs: Date.now() - writeStartedAt,
    }));
    return finalizePersistenceTiming({
      ...persistenceFailure(
        error?.message || 'candidate_pool_chunk_validation_failed',
        isTimeout ? 'database_timeout' : 'candidate_pool_chunk_validation_failed',
        plan,
        cleanup,
      ),
      status: isTimeout ? 'write_timeout' : 'write_failed',
      planBuildMs,
      serializationMs,
      chunkWriteMs,
      validationMs,
      chunkWriteTimings,
      maxActiveChunkWrites,
      manifestWriteMs: 0,
      dbReadCount: 0,
      dbWriteCount: plan.chunks.length,
    }, phaseRecorder, chunkWriteTimings);
  }
  const validationMs = monotonicNowMs() - validationStartedAt;
  phaseRecorder.add('localValidation', validationMs);

  const manifestWriteStartedAt = monotonicNowMs();
  try {
    await writeCandidatePoolDocument(collection, plan.manifest);
  } catch (error) {
    const manifestWriteMs = monotonicNowMs() - manifestWriteStartedAt;
    phaseRecorder.add('manifestWrite', manifestWriteMs);
    const isTimeout = isCandidatePoolTimeout(error);
    const cleanupStartedAt = monotonicNowMs();
    const cleanup = await cleanupCandidatePoolChunks({
      collection,
      plan,
      chunkIndexes: successfulChunkIndexes,
      logger,
      auditId: diagnosticAuditId,
      sensitiveValues,
    });
    phaseRecorder.add('cleanupTelemetryAssembly', monotonicNowMs() - cleanupStartedAt);
    measureCandidatePoolPhase(phaseRecorder, 'cleanupTelemetryAssembly', () => emitCandidatePoolWriteError(logger, {
      auditId: diagnosticAuditId,
      stage: 'manifest',
      chunkIndex: null,
      chunkCount: plan.chunks.length,
      documentBytes: plan.manifestBytes,
      successfulChunkCount,
      manifestWritten: false,
      orphanChunkCount: successfulChunkCount,
      collection: CANDIDATE_POOL_COLLECTION,
      operation: 'set',
      error,
      sensitiveValues,
      elapsedMs: Date.now() - writeStartedAt,
      cleanup,
    }));
    return finalizePersistenceTiming({
      ...persistenceFailure(error?.message || (isTimeout ? 'database_timeout' : 'database_write_failed'), isTimeout ? 'database_timeout' : 'database_write_failed', plan, cleanup),
      status: isTimeout ? 'write_timeout' : 'write_failed',
      planBuildMs,
      serializationMs,
      chunkWriteMs,
      validationMs,
      manifestWriteMs,
      dbReadCount: 0,
      dbWriteCount: plan.chunks.length + 1,
    }, phaseRecorder, chunkWriteTimings);
  }
  const manifestWriteMs = monotonicNowMs() - manifestWriteStartedAt;
  phaseRecorder.add('manifestWrite', manifestWriteMs);

  measureCandidatePoolPhase(phaseRecorder, 'cleanupTelemetryAssembly', () => emitCandidatePoolDiagnostic(logger, 'info', '[CandidatePoolWriteDone]', {
    auditId: diagnosticAuditId,
    chunkCount: plan.chunks.length,
    successfulChunkCount,
    manifestWritten: true,
    totalChunkBytes: plan.chunksBytes,
    manifestBytes: plan.manifestBytes,
    chunkWriteMs,
    chunkWriteTimings,
    maxActiveChunkWrites,
    validationMs,
    validationReadCount: 0,
    validationMode: 'local_checksum_after_awaited_set',
    elapsedMs: Date.now() - writeStartedAt,
    cleanupAttempted: false,
  }));
  return finalizePersistenceTiming({
    status: 'saved',
    candidatePoolId: poolId,
    serializedBytes: plan.serializedBytes,
    manifestBytes: plan.manifestBytes,
    chunksBytes: plan.chunksBytes,
    chunkCount: plan.chunks.length,
    reason: null,
    pool,
    planBuildMs,
    serializationMs,
    chunkWriteMs,
    validationMs,
    manifestWriteMs,
    chunkWriteTimings,
    maxActiveChunkWrites,
    validationReadCount: 0,
    validationMode: 'local_checksum_after_awaited_set',
    dbReadCount: 0,
    dbWriteCount: plan.chunks.length + 1,
  }, phaseRecorder, chunkWriteTimings);
}

function buildCandidatePoolProjectionProfile({
  sourceCandidates = [],
  candidates = [],
  chunks = [],
  manifest,
  prepared,
  runtime = false,
} = {}) {
  if (runtime) {
    return buildRuntimeCandidatePoolProjectionProfile({
      candidates,
      chunks,
      manifest,
      prepared,
    });
  }
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const sourceCandidateList = Array.isArray(sourceCandidates) ? sourceCandidates : [];
  const candidateBytes = candidateList.map((candidate) => jsonUtf8Bytes(candidate));
  const sourceCandidateBytes = sourceCandidateList.map((candidate) => jsonUtf8Bytes(candidate));
  const sortedCandidateBytes = candidateBytes.slice().sort((left, right) => left - right);
  const sortedSourceCandidateBytes = sourceCandidateBytes.slice().sort((left, right) => left - right);
  const chunkBytes = (Array.isArray(chunks) ? chunks : []).map((chunk) => jsonUtf8Bytes(chunk));
  const manifestBytes = jsonUtf8Bytes(manifest);
  const pathStats = new Map();
  candidateList.forEach((candidate) => collectCandidateJsonPathBytes(candidate, 'candidate', pathStats));
  const allPaths = [...pathStats.entries()]
    .map(([path, stats]) => ({ path, bytes: stats.bytes, count: stats.count }))
    .sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  return {
    candidateCount: candidateList.length,
    chunkCount: chunkBytes.length,
    totalBytes: chunkBytes.reduce((sum, bytes) => sum + bytes, 0) + manifestBytes,
    totalChunkBytes: chunkBytes.reduce((sum, bytes) => sum + bytes, 0),
    unoptimizedCandidateBytes: sourceCandidateBytes.reduce((sum, bytes) => sum + bytes, 0),
    optimizedCandidateBytes: candidateBytes.reduce((sum, bytes) => sum + bytes, 0),
    reductionBytes: sourceCandidateBytes.length > 0
      ? sourceCandidateBytes.reduce((sum, bytes) => sum + bytes, 0) - candidateBytes.reduce((sum, bytes) => sum + bytes, 0)
      : 0,
    reductionRatio: sourceCandidateBytes.length > 0
      ? Math.max(0, 1 - (candidateBytes.reduce((sum, bytes) => sum + bytes, 0)
        / Math.max(1, sourceCandidateBytes.reduce((sum, bytes) => sum + bytes, 0))))
      : 0,
    averageCandidateBytes: candidateBytes.length
      ? candidateBytes.reduce((sum, bytes) => sum + bytes, 0) / candidateBytes.length
      : 0,
    p50CandidateBytes: candidatePercentile(sortedCandidateBytes, 50),
    p95CandidateBytes: candidatePercentile(sortedCandidateBytes, 95),
    maxCandidateBytes: sortedCandidateBytes.at(-1) || 0,
    unoptimizedP50CandidateBytes: candidatePercentile(sortedSourceCandidateBytes, 50),
    unoptimizedP95CandidateBytes: candidatePercentile(sortedSourceCandidateBytes, 95),
    unoptimizedMaxCandidateBytes: sortedSourceCandidateBytes.at(-1) || 0,
    chunkBytes,
    manifestBytes,
    sharedDictionaryBytes: jsonUtf8Bytes(manifest?.identity || {}),
    topJsonPathBytes: allPaths.slice(0, 30).map(({ path, bytes }) => ({ path, bytes })),
    repeatedJsonPathBytes: allPaths.filter((entry) => entry.count > 1).slice(0, 20)
      .map(({ path, bytes }) => ({ path, bytes })),
  };
}

function buildRuntimeCandidatePoolProjectionProfile({ candidates = [], chunks = [], manifest, prepared } = {}) {
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const candidateJson = Array.isArray(prepared?.candidateJson)
    ? prepared.candidateJson
    : candidateList.map((candidate) => JSON.stringify(candidate));
  const candidateBytes = candidateJson.map(utf8Bytes);
  const chunkBytes = Array.isArray(prepared?.chunkDocumentBytes)
    ? prepared.chunkDocumentBytes.slice()
    : (Array.isArray(chunks) ? chunks : []).map((chunk) => jsonUtf8Bytes(chunk));
  const manifestBytes = prepared?.manifestJson
    ? utf8Bytes(prepared.manifestJson)
    : jsonUtf8Bytes(manifest);
  const topLevelFieldBytes = {};
  let candidateStructureBytes = 0;
  const itemReferenceCounts = new Map();
  const itemReferenceEntryBytes = new Map();

  for (const candidate of candidateList) {
    const entries = Object.entries(candidate || {});
    candidateStructureBytes += 2 + Math.max(0, entries.length - 1);
    for (const [key, value] of entries) {
      const bytes = utf8Bytes(JSON.stringify(key)) + 1 + jsonUtf8Bytes(value);
      topLevelFieldBytes[key] = (topLevelFieldBytes[key] || 0) + bytes;
    }
    const refs = sanitizeItemRoles(candidate?.itemFactRefs || candidate?.itemRoles);
    refs.forEach((ref) => {
      itemReferenceCounts.set(ref.itemId, (itemReferenceCounts.get(ref.itemId) || 0) + 1);
      const bytes = jsonUtf8Bytes(ref);
      const current = itemReferenceEntryBytes.get(ref.itemId) || { total: 0, first: bytes };
      current.total += bytes;
      itemReferenceEntryBytes.set(ref.itemId, current);
    });
  }

  const optimizedCandidateBytes = candidateBytes.reduce((sum, bytes) => sum + bytes, 0);
  const fieldBytesTotal = Object.values(topLevelFieldBytes).reduce((sum, bytes) => sum + bytes, 0);
  const itemReferenceValueBytes = [...itemReferenceCounts.entries()]
    .reduce((sum, [itemId, count]) => sum + utf8Bytes(JSON.stringify(itemId)) * count, 0);
  const uniqueItemReferenceValueBytes = [...itemReferenceCounts.keys()]
    .reduce((sum, itemId) => sum + utf8Bytes(JSON.stringify(itemId)), 0);
  const categoryBytes = buildCandidatePoolCategoryBytes(
    candidateList,
    topLevelFieldBytes,
    candidateStructureBytes,
    optimizedCandidateBytes,
  );
  const sortedCandidateBytes = candidateBytes.slice().sort((left, right) => left - right);
  return {
    candidateCount: candidateList.length,
    chunkCount: chunkBytes.length,
    totalBytes: chunkBytes.reduce((sum, bytes) => sum + bytes, 0) + manifestBytes,
    totalChunkBytes: chunkBytes.reduce((sum, bytes) => sum + bytes, 0),
    optimizedCandidateBytes,
    averageCandidateBytes: candidateBytes.length ? optimizedCandidateBytes / candidateBytes.length : 0,
    p50CandidateBytes: candidatePercentile(sortedCandidateBytes, 50),
    p95CandidateBytes: candidatePercentile(sortedCandidateBytes, 95),
    maxCandidateBytes: sortedCandidateBytes.at(-1) || 0,
    chunkBytes,
    manifestBytes,
    candidateStructureBytes,
    fieldBytesConserved: fieldBytesTotal + candidateStructureBytes === optimizedCandidateBytes,
    topLevelFieldBytes: Object.entries(topLevelFieldBytes)
      .map(([field, bytes]) => ({ field, bytes }))
      .sort((left, right) => right.bytes - left.bytes || left.field.localeCompare(right.field)),
    categoryBytes,
    itemReferenceStats: {
      uniqueItemCount: itemReferenceCounts.size,
      occurrenceCount: [...itemReferenceCounts.values()].reduce((sum, count) => sum + count, 0),
      itemReferenceValueBytes,
      repeatedItemReferenceValueBytes: Math.max(0, itemReferenceValueBytes - uniqueItemReferenceValueBytes),
      itemReferenceEntryBytes: [...itemReferenceEntryBytes.values()].reduce(
        (sum, value) => sum + value.total,
        0,
      ),
      repeatedItemReferenceEntryBytes: [...itemReferenceEntryBytes.values()].reduce(
        (sum, value) => sum + Math.max(0, value.total - value.first),
        0,
      ),
    },
    refreshConsumedFields: [
      'itemFactRefs',
      'archetype',
      'eligibility',
      'reasonCodes',
      'scores',
      'totalScore',
      'rankingScore',
      'selectionSignatures',
      'outfitKey',
      'sceneIntent',
      'primaryBenefit',
      'primaryBenefitCode',
      'secondaryBenefit',
      'observationFocus',
    ],
    authoritativeDuplicateFieldsRemoved: [
      'itemIds',
      'itemRoles',
      'roleItemIds',
      'scoreBreakdown',
      'weatherEligibility',
      'sceneEligibility',
      'stableSortId',
      'selectedReasonCode',
      'presentation',
      'snapshot',
      'weatherSnapshot',
    ],
  };
}

function buildCandidatePoolCategoryBytes(
  candidateList,
  topLevelFieldBytes,
  candidateStructureBytes,
  optimizedCandidateBytes,
) {
  const byFields = (fields) => fields.reduce((sum, field) => sum + (topLevelFieldBytes[field] || 0), 0);
  let weatherBytes = 0;
  let sceneEligibilityBytes = 0;
  for (const candidate of candidateList) {
    weatherBytes += jsonPropertyBytes('weather', candidate?.eligibility?.weather);
    sceneEligibilityBytes += jsonPropertyBytes('scene', candidate?.eligibility?.scene);
  }
  const categories = {
    presentation: byFields(['presentation', 'presentationPlan', 'cardViewModel']),
    reason: byFields([
      'reasonCodes',
      'primaryBenefit',
      'primaryBenefitCode',
      'secondaryBenefit',
      'observationFocus',
    ]),
    evidence: Math.max(0, byFields(['eligibility']) - weatherBytes - sceneEligibilityBytes),
    snapshot: byFields(['snapshot', 'snapshotItems']),
    weather: weatherBytes,
    sceneEligibility: sceneEligibilityBytes,
    scores: byFields(['scores', 'totalScore', 'rankingScore']),
    itemAttributes: byFields(['items', 'itemFacts', 'wardrobeItems', 'clothingAttributes']),
    itemReferencesAndStructure: byFields([
      'itemFactRefs',
      'archetype',
      'structureType',
      'compositionVersion',
    ]) + candidateStructureBytes,
    selectionIdentity: byFields(['selectionSignatures', 'outfitKey', 'sceneIntent']),
    controlMetadata: byFields(['version', 'aggregateEligibilityFacts']),
  };
  const classifiedBytes = Object.values(categories).reduce((sum, bytes) => sum + bytes, 0);
  return {
    ...categories,
    unclassified: Math.max(0, optimizedCandidateBytes - classifiedBytes),
    conserved: classifiedBytes === optimizedCandidateBytes,
  };
}

function jsonPropertyBytes(key, value) {
  if (value === undefined) return 0;
  return utf8Bytes(JSON.stringify(key)) + 1 + jsonUtf8Bytes(value);
}

function collectCandidateJsonPathBytes(value, path, stats) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      addCandidateJsonPathBytes(stats, path, jsonUtf8Bytes(value), 1);
      return;
    }
    value.forEach((entry, index) => collectCandidateJsonPathBytes(entry, `${path}[${index}]`, stats));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      addCandidateJsonPathBytes(stats, path, jsonUtf8Bytes(value), 1);
      return;
    }
    entries.forEach(([key, entry]) => collectCandidateJsonPathBytes(entry, `${path}.${key}`, stats));
    return;
  }
  const lastPathToken = path.slice(path.lastIndexOf('.') + 1);
  const keyBytes = lastPathToken.endsWith(']')
    ? 0
    : utf8Bytes(JSON.stringify(lastPathToken)) + 1;
  addCandidateJsonPathBytes(stats, path, keyBytes + jsonUtf8Bytes(value), 1);
}

function addCandidateJsonPathBytes(stats, path, bytes, count) {
  const current = stats.get(path) || { bytes: 0, count: 0 };
  current.bytes += bytes;
  current.count += count;
  stats.set(path, current);
}

function candidatePercentile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))] || 0;
}

function jsonUtf8Bytes(value) {
  const serialized = JSON.stringify(value);
  return utf8Bytes(serialized === undefined ? 'null' : serialized);
}

function createCandidatePoolPhaseRecorder() {
  const startedAt = monotonicNowMs();
  const wallPhases = Object.create(null);

  return {
    measure(name, operation) {
      const phaseStartedAt = monotonicNowMs();
      try {
        return operation();
      } finally {
        this.add(name, monotonicNowMs() - phaseStartedAt);
      }
    },
    add(name, durationMs) {
      wallPhases[name] = (wallPhases[name] || 0) + Math.max(0, Number(durationMs) || 0);
    },
    finish({ chunkWriteTimings = [] } = {}) {
      const totalWallMs = Math.max(0, monotonicNowMs() - startedAt);
      const knownWallMs = Object.values(wallPhases).reduce((sum, value) => sum + value, 0);
      const otherRealStageMs = Math.max(0, totalWallMs - knownWallMs);
      const phaseWallMs = {
        poolInputMaterialization: wallPhases.poolInputMaterialization || 0,
        objectCloneNormalization: wallPhases.objectCloneNormalization || 0,
        dictionaryChunkBuild: wallPhases.dictionaryChunkBuild || 0,
        jsonSerialization: wallPhases.jsonSerialization || 0,
        checksumHash: wallPhases.checksumHash || 0,
        byteSizeStatistics: wallPhases.byteSizeStatistics || 0,
        chunkTaskCreation: wallPhases.chunkTaskCreation || 0,
        chunkRemoteWriteWall: wallPhases.chunkRemoteWriteWall || 0,
        promiseJoin: wallPhases.promiseJoin || 0,
        localValidation: wallPhases.localValidation || 0,
        manifestBuild: wallPhases.manifestBuild || 0,
        manifestWrite: wallPhases.manifestWrite || 0,
        cleanupTelemetryAssembly: wallPhases.cleanupTelemetryAssembly || 0,
        otherRealStage: otherRealStageMs,
      };
      const accountedWallMs = Object.values(phaseWallMs).reduce((sum, value) => sum + value, 0);
      return {
        clock: 'process.hrtime.bigint',
        totalWallMs: roundTiming(totalWallMs),
        accountedWallMs: roundTiming(accountedWallMs),
        unaccountedWallMs: roundTiming(Math.max(0, totalWallMs - accountedWallMs)),
        phaseWallMs: Object.fromEntries(
          Object.entries(phaseWallMs).map(([name, value]) => [name, roundTiming(value)]),
        ),
        parallelOperationMs: {
          chunkRemoteWriteCumulative: roundTiming(chunkWriteTimings.reduce(
            (sum, timing) => sum + (Number(timing.elapsedMs) || 0),
            0,
          )),
        },
      };
    },
  };
}

function measureCandidatePoolPhase(recorder, name, operation) {
  return recorder ? recorder.measure(name, operation) : operation();
}

function finalizePersistenceTiming(result, recorder, chunkWriteTimings = result?.chunkWriteTimings || []) {
  return {
    ...result,
    phaseTiming: recorder.finish({ chunkWriteTimings }),
  };
}

function monotonicNowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function roundTiming(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function emitCandidatePoolWriteError(logger, {
  auditId,
  stage,
  chunkIndex,
  chunkCount,
  documentBytes,
  successfulChunkCount,
  manifestWritten,
  orphanChunkCount,
  collection,
  operation,
  error,
  sensitiveValues = [],
  elapsedMs,
  cleanup = {},
}) {
  emitCandidatePoolDiagnostic(logger, 'error', '[CandidatePoolWriteError]', {
    auditId,
    stage,
    chunkIndex,
    chunkCount,
    documentBytes,
    successfulChunkCount,
    manifestWritten,
    orphanChunkCount,
    collection,
    operation,
    cleanupAttempted: cleanup.attempted === true,
    cleanupDeletedCount: Number(cleanup.deletedCount) || 0,
    cleanupFailedCount: Number(cleanup.failedCount) || 0,
    errorName: sanitizeDiagnosticText(error?.name || 'Error', sensitiveValues, 96),
    errorCode: sanitizeDiagnosticText(error?.errorCode ?? error?.code ?? error?.errCode ?? '', sensitiveValues, 96),
    errorMessage: sanitizeCandidatePoolErrorMessage(
      error?.errorMessage ?? error?.message ?? error?.errMsg ?? '',
      sensitiveValues,
    ),
    ...(readDiagnosticRequestId(error) ? { requestId: readDiagnosticRequestId(error) } : {}),
    elapsedMs: Math.max(0, Number(elapsedMs) || 0),
  });
}

async function writeCandidatePoolDocument(collection, document) {
  const documentId = readString(document?._id);
  if (!collection || !documentId || typeof collection.doc !== 'function') {
    throw new Error('candidate pool document API unavailable');
  }
  const reference = collection.doc(documentId);
  if (!reference || typeof reference.set !== 'function') {
    throw new Error('candidate pool document set API unavailable');
  }
  // CloudBase owns the document `_id` once it has been selected through
  // `doc(documentId)`. Passing it again in `data` is rejected with -501007.
  // Keep `_id` in the local storage plan for reads/cleanup, but never persist
  // it as a user field.
  const { _id: ignoredDocumentId, ...data } = document;
  void ignoredDocumentId;
  return reference.set({ data });
}

function validateCandidatePoolStoragePlan(plan) {
  if (!plan || !plan.manifest || !Array.isArray(plan.chunks) || plan.chunks.length === 0) {
    throw new Error('candidate pool storage plan is malformed');
  }
  const manifest = plan.manifest;
  const ordered = plan.chunks.slice().sort((left, right) => left.chunkIndex - right.chunkIndex);
  const candidates = [];
  for (const [index, chunk] of ordered.entries()) {
    const documentBytes = plan.prepared?.chunkDocumentBytes?.[index]
      ?? utf8Bytes(JSON.stringify(chunk));
    if (chunk._id !== buildCandidatePoolDocumentId({
      ownerHash: manifest.ownerHash,
      candidatePoolId: manifest.candidatePoolId,
      recordType: CANDIDATE_POOL_RECORD_TYPES.chunk,
      chunkIndex: index,
    })
      || chunk.recordType !== CANDIDATE_POOL_RECORD_TYPES.chunk
      || chunk.chunkIndex !== index
      || chunk.chunkCount !== ordered.length
      || chunk.candidatePoolId !== manifest.candidatePoolId
      || chunk.ownerHash !== manifest.ownerHash
      || chunk.checksum !== manifest.checksum
      || !Array.isArray(chunk.candidates)
      || chunk.candidateCount !== chunk.candidates.length
      || checksumCandidates(
        chunk.candidates,
        chunk.checksumAlgorithm || manifest.checksumAlgorithm,
        plan.prepared?.chunkCandidateJson?.[index],
      ) !== chunk.chunkChecksum
      || documentBytes > CANDIDATE_POOL_MAX_BYTES) {
      throw new Error('candidate pool chunk local validation failed');
    }
    candidates.push(...chunk.candidates);
  }
  if (manifest.chunkCount !== ordered.length
    || manifest.candidateCount !== candidates.length
    || checksumCandidates(
      candidates,
      manifest.checksumAlgorithm,
      plan.prepared?.candidateJson,
    ) !== manifest.checksum
    || plan.manifestBytes !== (
      plan.prepared?.manifestJson
        ? utf8Bytes(plan.prepared.manifestJson)
        : utf8Bytes(JSON.stringify(manifest))
    )
    || plan.chunksBytes !== ordered.reduce((sum, chunk, index) => (
      sum + (plan.prepared?.chunkDocumentBytes?.[index] ?? utf8Bytes(JSON.stringify(chunk)))
    ), 0)) {
    throw new Error('candidate pool manifest local validation failed');
  }
  return true;
}

async function readCandidatePoolDocument(collection, documentId) {
  if (!collection || !documentId || typeof collection.doc !== 'function') return { data: null };
  const reference = collection.doc(documentId);
  if (!reference || typeof reference.get !== 'function') return { data: null };
  return reference.get();
}

async function cleanupCandidatePoolChunks({
  collection,
  plan,
  chunkIndexes = [],
  logger = console,
  auditId,
  sensitiveValues = [],
} = {}) {
  const result = { attempted: chunkIndexes.length > 0, deletedCount: 0, failedCount: 0 };
  for (const chunkIndex of chunkIndexes) {
    const chunk = plan?.chunks?.[chunkIndex];
    const documentId = readString(chunk?._id);
    try {
      const reference = documentId && typeof collection?.doc === 'function'
        ? collection.doc(documentId)
        : null;
      if (!reference || typeof reference.remove !== 'function') throw new Error('candidate pool cleanup API unavailable');
      await reference.remove();
      result.deletedCount += 1;
    } catch (error) {
      result.failedCount += 1;
      emitCandidatePoolDiagnostic(logger, 'warn', '[CandidatePoolCleanupError]', {
        auditId,
        chunkIndex,
        cleanupErrorCode: sanitizeDiagnosticText(error?.code || error?.errCode || '', sensitiveValues, 96),
        cleanupErrorMessage: sanitizeCandidatePoolErrorMessage(error?.message || error?.errMsg || '', sensitiveValues),
      });
    }
  }
  if (result.attempted) {
    emitCandidatePoolDiagnostic(logger, 'warn', '[CandidatePoolCleanup]', {
      auditId,
      attempted: true,
      deletedCount: result.deletedCount,
      failedCount: result.failedCount,
    });
  }
  return result;
}

function emitCandidatePoolDiagnostic(logger, level, label, payload) {
  try {
    const write = typeof logger?.[level] === 'function'
      ? logger[level].bind(logger)
      : typeof logger?.log === 'function'
        ? logger.log.bind(logger)
        : null;
    if (write) write(label, payload);
  } catch {
    // Diagnostics must never change candidate pool persistence behavior.
  }
}

function isCandidatePoolTimeout(error) {
  return error?.code === 'ETIMEDOUT'
    || error?.code === 'ECONNABORTED'
    || /timeout|timedout/i.test(error?.message || error?.errMsg || '');
}

function readDiagnosticAuditId(value) {
  return readString(value).slice(0, 80) || 'missing-audit-id';
}

function readDiagnosticRequestId(error) {
  const requestId = error?.requestId ?? error?.request_id ?? error?.requestID;
  return typeof requestId === 'string' || typeof requestId === 'number'
    ? String(requestId).slice(0, 128)
    : '';
}

function collectCandidatePoolSensitiveValues(pool, poolId) {
  const values = new Set([poolId, pool?.ownerHash, pool?.identity?.identityHash]);
  collectSensitiveValues(pool?.candidates, values);
  return [...values].filter((value) => typeof value === 'string' && value.length > 0);
}

function collectSensitiveValues(value, values, key = '') {
  if (CANDIDATE_POOL_SENSITIVE_KEYS.has(key)) {
    if (Array.isArray(value)) value.forEach((entry) => values.add(String(entry)));
    else if (typeof value === 'string' || typeof value === 'number') values.add(String(value));
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSensitiveValues(entry, values));
    return;
  }
  Object.entries(value).forEach(([entryKey, entry]) => collectSensitiveValues(entry, values, entryKey));
}

function sanitizeCandidatePoolErrorMessage(value, sensitiveValues) {
  const raw = typeof value === 'string' ? value : String(value || 'unknown database write error');
  const trimmed = raw.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && safelyParsesJson(trimmed)) {
    return '[redacted-document]';
  }
  const sanitized = redactEmbeddedJson(sanitizeDiagnosticText(
    raw,
    sensitiveValues,
    CANDIDATE_POOL_DIAGNOSTIC_ERROR_MESSAGE_MAX,
  ))
    .replace(/(?:data|document|payload|record)\s*[:=]\s*\{[\s\S]*\}/gi, '[redacted-document]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]');
  return sanitized.slice(0, CANDIDATE_POOL_DIAGNOSTIC_ERROR_MESSAGE_MAX);
}

function safelyParsesJson(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function redactEmbeddedJson(value) {
  let text = value;
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.slice(searchFrom).search(/[[{]/);
    if (start < 0) return text;
    const absoluteStart = searchFrom + start;
    const end = findBalancedJsonEnd(text, absoluteStart);
    if (end >= absoluteStart && safelyParsesJson(text.slice(absoluteStart, end + 1))) {
      text = `${text.slice(0, absoluteStart)}[redacted-document]${text.slice(end + 1)}`;
      searchFrom = absoluteStart + '[redacted-document]'.length;
    } else {
      searchFrom = absoluteStart + 1;
    }
  }
  return text;
}

function findBalancedJsonEnd(value, start) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      stack.push(character);
      continue;
    }
    if (character !== '}' && character !== ']') continue;
    const expected = character === '}' ? '{' : '[';
    if (stack.pop() !== expected) return -1;
    if (stack.length === 0) return index;
  }
  return -1;
}

function sanitizeDiagnosticText(value, sensitiveValues, maxLength) {
  let text = typeof value === 'string' ? value : String(value ?? '');
  for (const sensitiveValue of sensitiveValues.slice().sort((left, right) => right.length - left.length)) {
    text = text.split(sensitiveValue).join('[redacted]');
  }
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/(["']?(?:openid|userId|clothingId|clothingIds|itemId|itemIds|candidatePoolId|poolId|recommendationBatchId)["']?\s*[:=]\s*)(?:\[[^\]]*\]|"[^"]*"|'[^']*'|[^,\s}]+)/gi, '$1[redacted]')
    .slice(0, maxLength);
}

function validateCandidatePool(pool, identity, now = Date.now()) {
  if (!pool || typeof pool !== 'object' || pool.schemaVersion !== CANDIDATE_POOL_SCHEMA_VERSION || pool.version !== CANDIDATE_POOL_VERSION) {
    return { ok: false, reason: 'schema_invalid' };
  }
  if (pool.ownerHash !== identity?.userIdentityHash) return { ok: false, reason: 'user_mismatch' };
  if (pool.identity?.identityHash !== identity?.identityHash) return { ok: false, reason: 'identity_changed' };
  const timeValidation = validateExpiry(pool, now);
  if (!timeValidation.ok) return timeValidation;
  if (!Array.isArray(pool.candidates) || pool.candidates.length !== Number(pool.candidateCount) || !pool.candidates.every(isPoolCandidate)) {
    return { ok: false, reason: 'pool_corrupt' };
  }
  if (pool.checksum !== checksumCandidates(pool.candidates, pool.checksumAlgorithm)) {
    return { ok: false, reason: 'checksum_mismatch' };
  }
  return { ok: true, ageMs: timeValidation.ageMs };
}

function validateCandidatePoolManifest(manifest, identity, now) {
  if (!manifest || manifest.recordType !== CANDIDATE_POOL_RECORD_TYPES.manifest
    || manifest.status !== CANDIDATE_POOL_MANIFEST_STATUS
    || manifest.schemaVersion !== CANDIDATE_POOL_SCHEMA_VERSION
    || manifest.version !== CANDIDATE_POOL_VERSION) {
    return { ok: false, reason: 'schema_invalid' };
  }
  if (manifest.ownerHash !== identity?.userIdentityHash) return { ok: false, reason: 'user_mismatch' };
  if (manifest.identity?.identityHash !== identity?.identityHash) return { ok: false, reason: 'identity_changed' };
  if (manifest.checksumAlgorithm && manifest.checksumAlgorithm !== CANDIDATE_POOL_CHECKSUM_ALGORITHM) {
    return { ok: false, reason: 'checksum_algorithm_unsupported' };
  }
  if (!Number.isInteger(manifest.chunkCount) || manifest.chunkCount < 1) return { ok: false, reason: 'manifest_corrupt' };
  return validateExpiry(manifest, now);
}

function assembleCandidatePoolFromStorage(manifest, chunks, identity, now) {
  const expectedChunks = (Array.isArray(chunks) ? chunks : []).filter((chunk) => (
    Number.isInteger(chunk?.chunkIndex)
      && chunk.chunkIndex >= 0
      && chunk.chunkIndex < manifest.chunkCount
  ));
  if (expectedChunks.length !== manifest.chunkCount) return { ok: false, reason: 'chunks_missing' };
  if (new Set(expectedChunks.map((chunk) => chunk.chunkIndex)).size !== expectedChunks.length) {
    return { ok: false, reason: 'chunks_missing' };
  }
  const ordered = expectedChunks.slice().sort((left, right) => Number(left.chunkIndex) - Number(right.chunkIndex));
  const candidates = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const chunk = ordered[index];
    if (!chunk || chunk.recordType !== CANDIDATE_POOL_RECORD_TYPES.chunk
      || chunk.schemaVersion !== CANDIDATE_POOL_SCHEMA_VERSION
      || chunk.candidatePoolId !== manifest.candidatePoolId
      || chunk.ownerHash !== manifest.ownerHash
      || chunk.chunkIndex !== index
      || chunk.chunkCount !== manifest.chunkCount
      || (chunk.checksumAlgorithm || '') !== (manifest.checksumAlgorithm || '')
      || chunk.checksum !== manifest.checksum
      || !Array.isArray(chunk.candidates)
      || checksumCandidates(chunk.candidates, chunk.checksumAlgorithm) !== chunk.chunkChecksum
      || utf8Bytes(JSON.stringify(chunk)) > CANDIDATE_POOL_MAX_BYTES) {
      return { ok: false, reason: 'chunk_invalid' };
    }
    candidates.push(...chunk.candidates);
  }
  if (candidates.length !== Number(manifest.candidateCount)) return { ok: false, reason: 'chunk_invalid' };
  const pool = {
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    recordType: 'assembled',
    candidatePoolId: manifest.candidatePoolId,
    ownerHash: manifest.ownerHash,
    identity: manifest.identity,
    candidates,
    candidateCount: manifest.candidateCount,
    chunkCount: manifest.chunkCount,
    checksum: manifest.checksum,
    checksumAlgorithm: manifest.checksumAlgorithm,
    createdAtMs: manifest.createdAtMs,
    expiresAtMs: manifest.expiresAtMs,
    expiresAt: manifest.expiresAt,
  };
  const validation = validateCandidatePool(pool, identity, now);
  return validation.ok ? { ok: true, pool, ageMs: validation.ageMs } : validation;
}

function buildCandidatePoolStoragePlan(pool, { phaseRecorder } = {}) {
  const preparedCandidateJson = Array.isArray(pool?.[PREPARED_CANDIDATE_JSON])
    ? pool[PREPARED_CANDIDATE_JSON]
    : measureCandidatePoolPhase(
      phaseRecorder,
      'jsonSerialization',
      () => pool.candidates.map((candidate) => JSON.stringify(candidate)),
    );
  const candidateChunks = Array.isArray(pool?.[PREPARED_CANDIDATE_CHUNKS])
    ? pool[PREPARED_CANDIDATE_CHUNKS]
    : measureCandidatePoolPhase(
      phaseRecorder,
      'dictionaryChunkBuild',
      () => splitCandidatesByByteBudget(pool.candidates, preparedCandidateJson),
    );
  if (candidateChunks.length === 0) candidateChunks.push([]);
  const chunkCount = candidateChunks.length;
  let candidateOffset = 0;
  const chunkCandidateJson = measureCandidatePoolPhase(phaseRecorder, 'dictionaryChunkBuild', () => candidateChunks.map((candidates) => {
    const values = preparedCandidateJson.slice(candidateOffset, candidateOffset + candidates.length);
    candidateOffset += candidates.length;
    return values;
  }));
  const chunks = candidateChunks.map((candidates, chunkIndex) => {
    const serializedCandidates = chunkCandidateJson[chunkIndex] || [];
    const chunkChecksum = measureCandidatePoolPhase(
      phaseRecorder,
      'checksumHash',
      () => checksumCandidates(
        candidates,
        pool.checksumAlgorithm,
        serializedCandidates,
      ),
    );
    return measureCandidatePoolPhase(phaseRecorder, 'dictionaryChunkBuild', () => ({
      _id: buildCandidatePoolDocumentId({
        ownerHash: pool.ownerHash,
        candidatePoolId: pool.candidatePoolId,
        recordType: CANDIDATE_POOL_RECORD_TYPES.chunk,
        chunkIndex,
      }),
      schemaVersion: CANDIDATE_POOL_SCHEMA_VERSION,
      version: CANDIDATE_POOL_VERSION,
      recordType: CANDIDATE_POOL_RECORD_TYPES.chunk,
      candidatePoolId: pool.candidatePoolId,
      ownerHash: pool.ownerHash,
      identityHash: pool.identity.identityHash,
      chunkIndex,
      chunkCount,
      candidateCount: candidates.length,
      checksumAlgorithm: pool.checksumAlgorithm || CANDIDATE_POOL_CHECKSUM_ALGORITHM,
      checksum: pool.checksum,
      chunkChecksum,
      createdAtMs: pool.createdAtMs,
      expiresAtMs: pool.expiresAtMs,
      expiresAt: pool.expiresAt,
      candidates,
    }));
  });
  const manifest = measureCandidatePoolPhase(phaseRecorder, 'manifestBuild', () => ({
    _id: buildCandidatePoolDocumentId({
      ownerHash: pool.ownerHash,
      candidatePoolId: pool.candidatePoolId,
      recordType: CANDIDATE_POOL_RECORD_TYPES.manifest,
    }),
    schemaVersion: CANDIDATE_POOL_SCHEMA_VERSION,
    version: CANDIDATE_POOL_VERSION,
    recordType: CANDIDATE_POOL_RECORD_TYPES.manifest,
    status: CANDIDATE_POOL_MANIFEST_STATUS,
    candidatePoolId: pool.candidatePoolId,
    ownerHash: pool.ownerHash,
    identity: pool.identity,
    candidateCount: pool.candidateCount,
    chunkCount,
    checksumAlgorithm: pool.checksumAlgorithm || CANDIDATE_POOL_CHECKSUM_ALGORITHM,
    checksum: pool.checksum,
    createdAtMs: pool.createdAtMs,
    expiresAtMs: pool.expiresAtMs,
    expiresAt: pool.expiresAt,
  }));
  const manifestJson = measureCandidatePoolPhase(
    phaseRecorder,
    'jsonSerialization',
    () => JSON.stringify(manifest),
  );
  const chunkJson = measureCandidatePoolPhase(
    phaseRecorder,
    'jsonSerialization',
    () => chunks.map((chunk) => JSON.stringify(chunk)),
  );
  const manifestBytes = measureCandidatePoolPhase(
    phaseRecorder,
    'byteSizeStatistics',
    () => utf8Bytes(manifestJson),
  );
  const chunkDocumentBytes = measureCandidatePoolPhase(
    phaseRecorder,
    'byteSizeStatistics',
    () => chunkJson.map(utf8Bytes),
  );
  const chunksBytes = measureCandidatePoolPhase(
    phaseRecorder,
    'byteSizeStatistics',
    () => chunkDocumentBytes.reduce((sum, bytes) => sum + bytes, 0),
  );
  if (manifestBytes > CANDIDATE_POOL_MAX_BYTES || chunkDocumentBytes.some((bytes) => bytes > CANDIDATE_POOL_MAX_BYTES)) {
    throw new Error('candidate pool chunk exceeds storage budget');
  }
  return {
    manifest,
    chunks,
    manifestBytes,
    chunksBytes,
    serializedBytes: manifestBytes + chunksBytes,
    prepared: {
      candidateJson: preparedCandidateJson,
      chunkCandidateJson,
      chunkDocumentBytes,
      chunkJson,
      manifestJson,
    },
  };
}

function splitCandidatesByByteBudget(candidates, preparedCandidateJson) {
  const result = [];
  let current = [];
  let currentBytes = 2;
  const list = Array.isArray(candidates) ? candidates : [];
  const candidateJson = Array.isArray(preparedCandidateJson)
    ? preparedCandidateJson
    : list.map((candidate) => JSON.stringify(candidate));
  for (let index = 0; index < list.length; index += 1) {
    const candidate = list[index];
    const serialized = candidateJson[index] ?? JSON.stringify(candidate);
    const candidateBytes = utf8Bytes(serialized);
    const nextBytes = currentBytes + candidateBytes + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && nextBytes > CANDIDATE_POOL_CHUNK_DATA_BUDGET) {
      result.push(current);
      current = [candidate];
      currentBytes = 2 + candidateBytes;
    } else {
      current.push(candidate);
      currentBytes = nextBytes;
    }
    if (current.length === 1 && currentBytes > CANDIDATE_POOL_CHUNK_DATA_BUDGET) {
      throw new Error('candidate exceeds chunk budget');
    }
  }
  if (current.length > 0) result.push(current);
  return result;
}

function persistenceFailure(reason, normalizedReason = reason, plan, cleanup = {}) {
  return {
    status: 'write_failed',
    candidatePoolId: null,
    serializedBytes: plan?.serializedBytes || 0,
    manifestBytes: plan?.manifestBytes || 0,
    chunksBytes: plan?.chunksBytes || 0,
    chunkCount: plan?.chunks?.length || 0,
    reason: normalizedReason || reason,
    cleanupAttempted: cleanup.attempted === true,
    cleanupDeletedCount: Number(cleanup.deletedCount) || 0,
    cleanupFailedCount: Number(cleanup.failedCount) || 0,
  };
}

function buildCandidatePoolDocumentId({ ownerHash, candidatePoolId, recordType, chunkIndex } = {}) {
  const ownerHashHash = hashValue(readString(ownerHash));
  const candidatePoolIdHash = hashValue(readString(candidatePoolId));
  const suffix = recordType === CANDIDATE_POOL_RECORD_TYPES.chunk
    ? `:chunk:${Number.isInteger(chunkIndex) ? chunkIndex : 0}`
    : ':manifest';
  return `${CANDIDATE_POOL_DOCUMENT_ID_PREFIX}:${ownerHashHash}:${candidatePoolIdHash}${suffix}`;
}

function validateExpiry(value, now) {
  const createdAtMs = normalizeTimestamp(value.createdAtMs);
  const expiresAtMs = normalizeTimestamp(value.expiresAtMs);
  const currentMs = normalizeTimestamp(now);
  if (!createdAtMs || !expiresAtMs || expiresAtMs <= currentMs) return { ok: false, reason: 'expired' };
  if (expiresAtMs - createdAtMs > CANDIDATE_POOL_TTL_MS) return { ok: false, reason: 'ttl_invalid' };
  return { ok: true, ageMs: Math.max(0, currentMs - createdAtMs) };
}

function assertNoSensitiveIdentity(value) {
  if (/\bopenid\b/i.test(JSON.stringify(value.identity || {}))) throw new Error('candidate pool identity contains openid');
}

function checksumCandidates(candidates, algorithm, preparedCandidateJson) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (algorithm === CANDIDATE_POOL_CHECKSUM_ALGORITHM) {
    const serialized = Array.isArray(preparedCandidateJson)
      ? `[${preparedCandidateJson.join(',')}]`
      : JSON.stringify(list);
    return hashValue(serialized);
  }
  return hashValue(stableSerialize(list));
}

function fingerprintWardrobe(clothes) {
  const entries = (Array.isArray(clothes) ? clothes : [])
    .map((item) => ({ id: readString(item?._id || item?.id), updatedAt: readString(item?.updatedAt) }))
    .filter((item) => item.id)
    .sort((left, right) => left.id.localeCompare(right.id) || left.updatedAt.localeCompare(right.updatedAt));
  return hashValue(stableSerialize(entries));
}

function fingerprintWeather(weather = {}) {
  return hashValue(stableSerialize({
    mode: readString(weather?.mode || weather?.weatherMode),
    temp: finiteNumber(weather?.temp ?? weather?.temperature),
    humidity: finiteNumber(weather?.humidity),
    weather: readString(weather?.weather),
    condition: readString(weather?.condition),
    wind: finiteNumber(weather?.wind),
    uv: finiteNumber(weather?.uv),
  }));
}

function sanitizeIdentity(identity = {}) {
  return {
    version: readString(identity.version),
    schemaVersion: Number(identity.schemaVersion) || CANDIDATE_POOL_SCHEMA_VERSION,
    userIdentityHash: readString(identity.userIdentityHash),
    wardrobeFingerprint: readString(identity.wardrobeFingerprint),
    sceneKey: readString(identity.sceneKey),
    weatherMode: readString(identity.weatherMode),
    weatherFingerprint: readString(identity.weatherFingerprint),
    profileFingerprint: readString(identity.profileFingerprint),
    timeOfDay: readString(identity.timeOfDay),
    engineVersion: readString(identity.engineVersion),
    identityHash: readString(identity.identityHash),
  };
}

function sanitizeRoleItemIds(value = {}) {
  return ROLE_KEYS.reduce((result, role) => {
    result[role] = readString(value?.[role]);
    return result;
  }, {});
}

function serializeItemRoles(candidate = {}) {
  const refsByItemId = new Map((Array.isArray(candidate.itemFactRefs) ? candidate.itemFactRefs : [])
    .map((item) => ({
      itemId: readString(item?.itemId || item?.id),
      slot: readString(item?.slot),
      role: readString(item?.role),
    }))
    .filter((item) => item.itemId && ITEM_SLOT_KEYS.includes(item.slot) && item.role)
    .map((item) => [item.itemId, item]));
  const roleItemIds = sanitizeRoleItemIds(candidate.roleItemIds);
  const itemIds = uniqueStrings(candidate.itemIds).length > 0
    ? uniqueStrings(candidate.itemIds)
    : [...refsByItemId.keys()];
  return itemIds.map((itemId) => {
    const ref = refsByItemId.get(itemId);
    if (ref) return ref;
    const slot = ROLE_KEYS.find((role) => roleItemIds[role] === itemId) || '';
    return { itemId, slot, role: slot ? 'core' : '' };
  });
}

function sanitizeItemRoles(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).reduce((result, item) => {
    const itemId = readString(item?.itemId);
    const slot = readString(item?.slot);
    const role = readString(item?.role);
    if (!itemId || !ITEM_SLOT_KEYS.includes(slot) || !role || seen.has(itemId)) return result;
    seen.add(itemId);
    result.push({ itemId, slot, role });
    return result;
  }, []);
}

function sanitizeSelectionSignatures(value = {}, options = {}) {
  return ['itemSignature', 'archetype', 'reasonCodeSignature', 'titleSignature', 'tagSignature']
    .filter((key) => !(options.omitItemSignature && key === 'itemSignature'))
    .filter((key) => !(options.omitArchetype && key === 'archetype'))
    .reduce((result, key) => {
      result[key] = readString(value?.[key]);
      return result;
    }, {});
}

function isPoolCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  const itemRoles = sanitizeItemRoles(
    Array.isArray(candidate.itemFactRefs) && candidate.itemFactRefs.length > 0
      ? candidate.itemFactRefs
      : candidate.itemRoles,
  );
  const itemIds = uniqueStrings(
    Array.isArray(candidate.itemIds) && candidate.itemIds.length > 0
      ? candidate.itemIds
      : itemRoles.map((item) => item.itemId),
  );
  if (itemIds.length === 0 || itemRoles.length !== itemIds.length) return false;
  const roleItemIds = hasRoleItemIds(candidate.roleItemIds)
    ? sanitizeRoleItemIds(candidate.roleItemIds)
    : buildRoleItemIdsFromRefs(itemRoles);
  const roleIds = Object.values(roleItemIds).filter(Boolean);
  if (!roleIds.every((id) => itemIds.includes(id))) return false;
  if (itemRoles.length !== itemIds.length || !itemRoles.every((item) => itemIds.includes(item.itemId))) return false;
  if (!Array.isArray(candidate.reasonCodes) || candidate.reasonCodes.length === 0) return false;
  if (!candidate.reasonCodes.every((code) => typeof code === 'string' && code)) return false;
  if (!Number.isFinite(Number(candidate.totalScore)) || !Number.isFinite(Number(candidate.rankingScore))) return false;
  if (!readString(candidate.outfitKey || candidate.stableSortId || candidate.selectionSignatures?.itemSignature)) return false;
  return true;
}

function hasRoleItemIds(value) {
  return value && typeof value === 'object'
    && Object.values(sanitizeRoleItemIds(value)).some(Boolean);
}

function buildRoleItemIdsFromRefs(itemFactRefs) {
  const result = sanitizeRoleItemIds({});
  for (const ref of Array.isArray(itemFactRefs) ? itemFactRefs : []) {
    const role = ref.slot === 'skirt' ? 'bottom' : ref.slot;
    if (Object.hasOwn(result, role) && !result[role]) result[role] = ref.itemId;
  }
  return result;
}

function isAcceptedScoredCandidate(candidate) {
  const scene = candidate?.eligibility?.scene;
  return scene?.eligible === true
    && scene?.hardRejected !== true
    && Number.isFinite(Number(candidate?.totalScore))
    && Number.isFinite(Number(candidate?.rankingScore));
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function utf8Bytes(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function normalizeTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
}

module.exports = {
  CANDIDATE_POOL_COLLECTION,
  CANDIDATE_POOL_SCHEMA_VERSION,
  CANDIDATE_POOL_RECORD_TYPES,
  CANDIDATE_POOL_MANIFEST_STATUS,
  CANDIDATE_POOL_LOOKUP_INDEX,
  CANDIDATE_POOL_MAX_BYTES,
  CANDIDATE_POOL_CHUNK_DATA_BUDGET,
  CANDIDATE_POOL_TTL_MS,
  CANDIDATE_POOL_VERSION,
  buildCandidatePoolIdentity,
  buildCandidatePoolDocumentId,
  buildCandidatePoolProjectionProfile,
  buildCandidatePoolStoragePlan,
  validateCandidatePoolStoragePlan,
  createCandidatePoolRecord,
  fingerprintWardrobe,
  getReasonSelectionDescriptor,
  hydrateCandidateCore,
  loadCandidatePool,
  saveCandidatePool,
  tryPersistCandidatePool,
  serializeCandidateCore,
  validateCandidatePool,
  validateCandidatePoolManifest,
};
