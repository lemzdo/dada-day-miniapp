const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('node:util');
const MODULE_LOADED_AT = Date.now();
const MODULE_INSTANCE_ID = crypto.randomBytes(4).toString('hex');
const SERVER_LEDGER_VERSION = 'generateOutfit-phase-ledger-v2';
const MAX_AI_COMMENT_PROVIDER_ATTEMPTS = 3;

const { attachAestheticEvaluation } = require('./services/aestheticCompatibility');
const {
  isRecommendationStylingShadowEnabled,
  runRecommendationStylingShadowV2Safely,
} = require('./services/recommendationStylingShadowV2');
const {
  buildRecommendationVoiceRendererExecution,
  runRecommendationVoiceRendererShadowV2Safely,
} = require('./services/recommendationVoiceRendererShadowV2');
const {
  applyCanonicalCopyToOutfit,
  assertRecommendationCanonicalCopiesV2,
  attachRecommendationCanonicalCopiesV2,
  authorizeRecommendationCanonicalCopyRuntimeV2,
  buildFailedCanonicalCopy,
  buildMaterializedCanonicalCopy,
  buildRecommendationCanonicalCopyBatchV2,
  isRecommendationCanonicalCopyRuntimeV2Enabled,
  resolveCanonicalCopyForStorage,
} = require('./services/recommendationCanonicalCopyRuntimeV2');
const { loadActiveWardrobe } = require('./services/loadActiveWardrobe');
const {
  createAiReviewServiceError,
  getAiReviewInternalErrorCode,
  getSafeAiReviewMessage,
  isAiReviewServiceError,
  mapAiReviewErrorCode,
} = require('./services/aiReviewErrorPolicy');
const {
  createAiRawSummary,
  createAiReviewDebug,
  logAiReviewDebug,
  toSafeAiReviewDebug,
  updateAiReviewDebug,
} = require('./services/aiReviewDebug');
const {
  buildAiReviewCacheDecision,
  isFallbackAiReview,
  isReusableAiReview,
} = require('./services/aiReviewCachePolicy');
const { buildStylistEvidenceV1 } = require('./services/stylistEvidence');
const {
  COPY_POLICY_VERSION,
  STYLIST_PROMPT_VERSION,
  STYLIST_REVIEW_VERSION,
  VOICE_POLICY_VERSION,
  buildStylistPromptV2,
  buildStylistReviewDocument,
  parseStylistExplanationJson,
  traceStylistExplanationValidationV2,
  toLegacyAiComment,
  validateStylistExplanationV2,
} = require('./services/stylistExplanationV2');
const { compileRecommendationLanguageV3 } = require('./services/recommendationLanguageV3');
const {
  FINALIZATION_MODES,
  finalizeAcceptedRecommendations,
  hasCurrentCopyContract,
} = require('./services/recommendationCopyFinalization');
const {
  getMissingRequiredFacts,
  getMissingRequiredRoles,
  getPartialRecommendationNotice,
  resolveRecommendationAvailability,
} = require('./services/recommendationAvailability');
const {
  normalizeDefaultCopyAtResponseBoundary,
} = require('./services/recommendationCopyRehydration');
const { COPY_CONTRACT_VERSION } = require('./services/recommendationCopyContract');
const {
  classifyLimitedReason,
} = require('./services/xiaodaVoiceBankV2');
const {
  mapAiReviewAtBoundary,
  resolveRealAiReviewSource,
} = require('./services/recommendationReviewProvenance');
const {
  buildOutfitCandidatesV1,
  createCompositionItemFacts,
} = require('./services/outfitCompositionV1');
const { buildOutfitCardViewModel } = require('./services/outfitCardViewModel');
const {
  applyWearabilityAndSceneEligibility,
  evaluateOptionalItemPolicy,
  normalizeScene,
} = require('./services/sceneEligibilityV3');
const { buildItemFactsContext } = require('./services/itemFactsContext');
const {
  createCandidateCore,
  hydrateCanonicalScore,
  materializeCanonicalCandidate,
  selectCanonicalCandidateBatch,
} = require('./services/canonicalCandidate');
const {
  cloneEligibilityReason,
  collectEligibilityReasonCandidates,
  ELIGIBILITY_REASON_CATALOG,
} = require('./services/recommendationEligibilityReason');
const { selectBatchEligibilityReasons } = require('./services/batchEligibilityReasonSelection');
const {
  buildQaAuditSummaries,
  fitEligibilityRejectionAuditToBudget,
  fitQaBatchAuditToBudget,
  QA_BATCH_AUDIT_VERSION,
  serializedBytes,
} = require('./services/qaBatchAudit');
const {
  buildCanonicalTitle,
  assertFinalPresentation,
  canonicalizeRecommendationBatch,
} = require('./services/recommendationPresentation');
const { PRESENTATION_FACT_MODEL_BUILD } = require('./services/presentationFactModel');
const {
  buildPresentationEvidence,
  isPresentationEvidenceMode,
  PRESENTATION_EVIDENCE_MAX_BYTES,
  PRESENTATION_EVIDENCE_VERSION,
  serializedBytes: serializedPresentationEvidenceBytes,
} = require('./services/presentationEvidence');
const {
  isRecommendationQaAuditEnabled,
  isSceneEvidenceAcceptanceAuditEnabled,
} = require('./services/qaAuditControl');
const {
  AI_REVIEW_VERSION,
  CANDIDATE_POOL_ENGINE_VERSION,
  CLOUD_BUILD_VERSION,
  REASON_CATALOG_VERSION,
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_VERSION,
} = require('./services/buildVersions');
const {
  buildCandidatePoolIdentity,
  getReasonSelectionDescriptor,
  hydrateCandidateCore,
  loadCandidatePool,
  tryPersistCandidatePool,
} = require('./services/candidatePool');
const {
  hasRealRecommendationWeather,
  normalizeRecommendationWeather,
  toWeatherSnapshot,
} = require('./services/recommendationWeatherMode');
const {
  assertRecommendationCountContract,
  assertReturnedCardCount,
  buildRecommendationCountContract,
  normalizeRequestedBatchSize,
} = require('./shared/countContract');
const {
  canPersistAiReviewAsReady,
  resolveAiReviewFailureSettlement,
} = require('./services/aiReviewSettlement');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DELETED_STATUS = 'deleted';
const AI_REVIEW_COLLECTION = 'outfit_ai_reviews';
const AI_COMMENT_PROMPT_VERSION = STYLIST_PROMPT_VERSION;
const BAILIAN_BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const AI_COMMENT_PROVIDER = process.env.AI_COMMENT_PROVIDER || 'aliyun-bailian';
const AI_COMMENT_MODEL = process.env.XIAODA_AI_COMMENT_MODEL || 'qwen3.7-max';
const AI_COMMENT_TIMEOUT_MS = Number(
  process.env.XIAODA_AI_COMMENT_TIMEOUT_MS || process.env.AI_COMMENT_TIMEOUT_MS || 15000,
);
const AI_COMMENT_LEASE_TIMEOUT_MS = Math.max(AI_COMMENT_TIMEOUT_MS + 5000, 10000);
const AI_COMMENT_FORCE_COOLDOWN_MS = 5 * 1000;
const RECOMMENDATION_SCENE_LABELS = Object.freeze({
  home: '居家',
  work: '上班',
  date: '约会',
  sport: '运动',
});

exports.main = async (event = {}) => {
  const action = event.action || 'generate';
  const handlerStartedAt = Date.now();
  if (action === 'transport_probe' || action === 'transport_probe_small' || action === 'transport_probe_payload') {
    if (event.diagnostic !== true) return fail(createBusinessError('TRANSPORT_PROBE_DIAGNOSTIC_ONLY', 'transport_probe requires diagnostic=true'));
    if (action === 'transport_probe_payload') {
      return ok(buildTransportPayloadProbeResult(handlerStartedAt, event.payloadBytes));
    }
    return ok(buildTransportProbeResult(handlerStartedAt));
  }
  const recommendationDiagnostics = action === 'generate'
    ? createRecommendationDiagnostics(event, handlerStartedAt)
    : null;
  if (action === 'generate' && isCanonicalCopyRuntimeV2Acceptance(event)) {
    authorizeRecommendationCanonicalCopyRuntimeV2(event);
  }
  try {
    if (action === 'detail') return ok(await getOutfitDetail(event));
    if (action === 'renameOutfit') return ok(await renameOutfit(event));
    if (action === 'favorite') return ok(await updateFavorite(event.id, Boolean(event.isFavorite), event.outfit));
    if (action === 'wear') return ok(await confirmWear(event.id, event.date, event.outfit));
    if (action === 'list') return ok(await listOutfits(event));
    if (action === 'saveFavoriteOutfit') return ok(await saveFavoriteOutfit(event.id, event.outfit, event.aiComment));
    if (action === 'removeFavoriteOutfit') return ok(await removeFavoriteOutfit(event.favoriteOutfitId || event.id, event.outfitKey));
    if (action === 'listFavoriteOutfits') return ok(await listFavoriteOutfits(event));
    if (action === 'addOutfitHistory') return ok(await addOutfitHistory(event));
    if (action === 'listOutfitHistory') return ok(await listOutfitHistory(event));
    if (action === 'getAiComment') return ok(await getAiComment(event));
    if (action === 'aiComment') return ok(await generateAiComment(event));
    if (action === 'materializeRecommendationCopyV2') {
      return ok(await materializeRecommendationCanonicalCopyV2(event));
    }

    return ok(await generate(event, recommendationDiagnostics));
  } catch (error) {
    const isAiReviewAction = action === 'getAiComment' || action === 'aiComment';
    if (error?.businessCode === 'OUTFIT_REFERENCE_WRITE_FAILED') {
      // Keep this log deliberately narrow: the complete transaction error can contain payloads or cycles.
      console.error('[OutfitReferenceWriteFailure]', {
        auditId: recommendationDiagnostics?.auditId || null,
        cause: getSafeOutfitReferenceCause(error.cause),
      });
    }
    if (recommendationDiagnostics) {
      console.error('[RecommendationServerError]', {
        auditId: recommendationDiagnostics.auditId,
        stage: recommendationDiagnostics.stage,
        errorCode: getRecommendationErrorCode(error),
        message: getSafeRecommendationErrorMessage(error),
        totalMs: Date.now() - recommendationDiagnostics.startedAt,
      });
    } else {
      console.error(
        isAiReviewAction ? '[generateOutfit] aiReview failed' : '[generateOutfit] failed',
        isAiReviewAction ? { code: getAiReviewInternalErrorCode(error) } : error,
      );
    }
    if (isAiReviewAction) {
      return fail(createSafeAiReviewClientError(mapAiReviewErrorCode(error)));
    }
    return fail(error);
  }
};

function isCanonicalCopyRuntimeV2Acceptance(event) {
  return event?.canonicalCopyRuntimeV2Acceptance === true
    && event?.performanceDiagnostics === true
    && typeof event?.acceptanceRunId === 'string'
    && event.acceptanceRunId.length > 0
    && typeof event?.captureId === 'string'
    && event.captureId.length > 0;
}

function validateCandidatePoolAvailability(recommendations, requestedCount) {
  if (!Array.isArray(recommendations)) {
    throw createBusinessError('CANDIDATE_POOL_AVAILABILITY_CONTRACT_INVALID', 'recommendations must be array');
  }
  if (typeof recommendations.limited !== 'boolean') {
    throw createBusinessError('CANDIDATE_POOL_AVAILABILITY_CONTRACT_INVALID', 'limited must be boolean');
  }
  if (typeof recommendations.exhausted !== 'boolean') {
    throw createBusinessError('CANDIDATE_POOL_AVAILABILITY_CONTRACT_INVALID', 'exhausted must be boolean');
  }
  if (!recommendations.debug || typeof recommendations.debug !== 'object') {
    throw createBusinessError('CANDIDATE_POOL_AVAILABILITY_CONTRACT_INVALID', 'debug must exist and be object');
  }

  const contract = recommendations.countContract;
  try {
    assertRecommendationCountContract(contract);
    assertReturnedCardCount(contract, recommendations.length);
  } catch (error) {
    throw createBusinessError('CANDIDATE_POOL_AVAILABILITY_CONTRACT_INVALID', error.message);
  }
  if (contract.requestedBatchSize !== normalizeRequestedBatchSize(requestedCount)) {
    throw createBusinessError('CANDIDATE_POOL_AVAILABILITY_CONTRACT_INVALID', 'requestedBatchSize conflicts with count contract');
  }
  const limited = contract.expectedCardCount < contract.requestedBatchSize;
  return {
    limited,
    limitedReason: limited ? 'DIVERSITY_EXHAUSTED' : null,
    exhausted: contract.poolExhaustedAfterConsume,
    countContract: contract,
  };
}

function buildTransportProbeResult(handlerStartedAt) {
  const handlerEndedAt = Date.now();
  const moduleAgeMs = Math.max(0, handlerStartedAt - MODULE_LOADED_AT);
  return {
    transportProbe: true,
    ledgerVersion: SERVER_LEDGER_VERSION,
    cloudBuildVersion: CLOUD_BUILD_VERSION,
    sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
    sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
    moduleLoadedAt: MODULE_LOADED_AT,
    moduleAgeMs,
    moduleInstanceId: MODULE_INSTANCE_ID,
    coldModule: moduleAgeMs < 2000,
    phaseLedger: [
      { phase: 'moduleInit', startAt: MODULE_LOADED_AT, endAt: handlerStartedAt, duration: moduleAgeMs },
      { phase: 'handlerStart', startAt: handlerStartedAt, endAt: handlerStartedAt, duration: 0 },
      { phase: 'handlerEnd', startAt: handlerStartedAt, endAt: handlerEndedAt, duration: handlerEndedAt - handlerStartedAt },
    ],
    serverHandlerStart: handlerStartedAt,
    serverHandlerEnd: handlerEndedAt,
    serverHandlerDurationMs: handlerEndedAt - handlerStartedAt,
  };
}

function buildTransportPayloadProbeResult(handlerStartedAt, requestedBytes) {
  const targetBytes = Math.max(8 * 1024, Math.min(Number(requestedBytes) || 96 * 1024, 768 * 1024));
  const filler = 'x'.repeat(Math.max(0, Math.floor((targetBytes - 1024) / 8)));
  const data = {
    transportProbe: true,
    probeKind: 'payload',
    synthetic: true,
    outfits: Array.from({ length: 8 }, (_, index) => ({
      id: `synthetic-${index}`,
      outfitId: `synthetic-${index}`,
      itemCount: 3,
      title: 'synthetic transport payload',
      reason: 'synthetic transport payload',
      filler,
    })),
  };
  const handlerEndedAt = Date.now();
  return {
    ...data,
    responseBytes: serializedBytes(data),
    serverHandlerStart: handlerStartedAt,
    serverHandlerEnd: handlerEndedAt,
    serverHandlerDurationMs: handlerEndedAt - handlerStartedAt,
  };
}

async function generate(event, diagnostics = createRecommendationDiagnostics(event)) {
  const requestParseStartedAt = diagnostics.startedAt;
  diagnostics.stage = 'loadWardrobe';
  recordServerPhase(diagnostics, 'requestParse', requestParseStartedAt);
  const authStartedAt = Date.now();
  const { OPENID } = cloud.getWXContext();
  recordServerPhase(diagnostics, 'authContext', authStartedAt);
  const inputScene = typeof event.scene === 'string' ? event.scene.trim() : '';
  const scene = inputScene || undefined;
  const sceneContract = createRecommendationSceneContract(inputScene);
  const targetDate = event.date || new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const requestedCount = normalizeRequestedBatchSize(event.maxResults || 8);
  const requestedCandidatePoolId = readString(event.recommendationBatchId);
  diagnostics.requestedCandidatePoolIdPresent = Boolean(requestedCandidatePoolId);
  diagnostics.requestedCandidatePoolIdLength = requestedCandidatePoolId.length;
  let recommendationBatchId = requestedCandidatePoolId || createRecommendationBatchId(now);
  const dataLoadStartedAt = Date.now();
  let wardrobeReadCount = 0;
  const [clothes, userRes] = await Promise.all([
    loadActiveWardrobe({
      database: db,
      openid: OPENID,
      onRead: () => {
        wardrobeReadCount += 1;
      },
    }),
    db.collection('users').where({ _openid: OPENID }).limit(1).get(),
  ]);
  diagnostics.timings.dataLoadMs = Date.now() - dataLoadStartedAt;
  recordServerPhase(diagnostics, 'userAndWardrobeRead', dataLoadStartedAt);
  diagnostics.databaseOps.reads += wardrobeReadCount + 1;
  const recommendationProfile = normalizeRecommendationProfile(userRes.data?.[0]?.styleProfile);
  const exclude = Array.isArray(event.excludeClothingIdSets) ? event.excludeClothingIdSets : [];
  const excludedOutfitKeys = readStringArray(event.excludedOutfitKeys);
  const requestTrigger = readString(event.trigger);
  const isRefreshRequest = requestTrigger === 'refresh'
    || excludedOutfitKeys.length > 0
    || exclude.length > 0
    || Boolean(requestedCandidatePoolId);
  const weather = normalizeRecommendationWeather(event.weather, event.weatherMode);
  const weatherMode = weather.mode;
  const weatherSnapshot = toWeatherSnapshot(weather);
  const presentationEvidenceEnabled = isPresentationEvidenceMode(event.presentationEvidenceMode);
  const sceneEvidenceAcceptanceAudit = isSceneEvidenceAcceptanceAuditEnabled(event);
  const performanceOnlyDiagnostics = event.performanceDiagnostics === true && !sceneEvidenceAcceptanceAudit;
  const debugRecommendationAudit = sceneEvidenceAcceptanceAudit || (!performanceOnlyDiagnostics
    && isRecommendationQaAuditEnabled(event.debugRecommendationAudit, process.env.RECOMMENDATION_QA_AUDIT_ENABLED));
  const identityStartedAt = Date.now();
  const candidatePoolIdentity = buildCandidatePoolIdentity({
    openid: OPENID,
    clothes,
    sceneKey: sceneContract.sceneKey,
    weather,
    weatherMode,
    recommendationProfile,
    timeOfDay: event.timeOfDay || 'all_day',
    engineVersion: CANDIDATE_POOL_ENGINE_VERSION,
  });
  diagnostics.timings.identityMs = Date.now() - identityStartedAt;
  recordServerPhase(diagnostics, 'candidatePoolIdentity', identityStartedAt);
  let recommendations;
  let executionMode = 'full_compute';
  let candidatePoolAgeMs = 0;
  let cacheHit = false;
  let cacheMissReason = resolveInitialCacheMissReason({
    isRefreshRequest,
    requestedCandidatePoolId,
  });
  let baseRecommendationBatchId = undefined;

  if (requestedCandidatePoolId) {
    const candidatePoolLoadStartedAt = Date.now();
    const poolResult = await loadCandidatePool({
      database: db,
      candidatePoolId: requestedCandidatePoolId,
      identity: candidatePoolIdentity,
      now: Date.now(),
      timings: diagnostics.timings,
    });
    diagnostics.timings.candidatePoolLoadMs = Date.now() - candidatePoolLoadStartedAt;
    recordServerPhase(diagnostics, 'candidatePoolLoad', candidatePoolLoadStartedAt);
    diagnostics.databaseOps.reads += diagnostics.timings.poolDbReadCount || 0;
    if (poolResult.hit) {
      try {
        recommendations = generateCandidatePoolRecommendations({
          pool: poolResult.pool,
          clothes,
          scene,
          weather,
          weatherMode,
          excludedOutfitKeys,
          excludeClothingIdSets: exclude,
          maxResults: requestedCount,
          timings: diagnostics.timings,
        });
        assertCandidatePoolExclusions(recommendations, excludedOutfitKeys, exclude);
        executionMode = 'candidate_pool_hit';
        candidatePoolAgeMs = poolResult.ageMs;
        cacheHit = true;
        cacheMissReason = '';
      } catch (error) {
        if (error?.businessCode === 'CANDIDATE_POOL_EXCLUSION_VIOLATION') throw error;
        cacheMissReason = 'pool_corrupt';
        recommendationBatchId = createRecommendationBatchId(now);
        executionMode = 'fallback_recompute';
      }
    } else {
      cacheMissReason = mapCandidatePoolLoadReason(poolResult.reason);
      recommendationBatchId = createRecommendationBatchId(now);
      executionMode = 'fallback_recompute';
    }
  }

  let candidatePoolPersistPromise = Promise.resolve(null);
  let candidatePoolPersistenceInput = null;
  if (!recommendations) {
    const candidateGenerationStartedAt = Date.now();
    recommendations = generateRuleRecommendations({
      clothes,
      scene,
      weather,
      weatherMode,
      recommendationProfile,
      excludeClothingIdSets: exclude,
      excludedOutfitKeys,
      maxResults: requestedCount,
      debugRecommendationAudit,
      timings: diagnostics.timings,
      diagnostics,
    });
    recordServerPhase(diagnostics, 'candidateGeneration', candidateGenerationStartedAt);
    baseRecommendationBatchId = recommendationBatchId;
    candidatePoolPersistenceInput = {
      candidatePoolId: recommendationBatchId,
      candidates: recommendations.candidatePoolCandidates,
      debugCandidatePoolProjection: event.debugCandidatePoolProjection === true,
    };
  }
  // Phase A shadow branch: consume only selected-candidate facts and evidence.
  // It intentionally runs before, and independently from, Legacy Presentation.
  const canonicalCopyRuntimeV2Enabled = isRecommendationCanonicalCopyRuntimeV2Enabled(event);
  const stylingShadow = (isRecommendationStylingShadowEnabled(event) || canonicalCopyRuntimeV2Enabled)
    ? runRecommendationStylingShadowV2Safely({
        recommendations,
        scene,
        weather,
        recommendationInstanceSeed: `${diagnostics.auditId}:${candidatePoolIdentity.identityHash}`,
      })
    : null;
  diagnostics.stylingIntelligenceShadow = stylingShadow?.diagnostics || null;
  if (canonicalCopyRuntimeV2Enabled) {
    diagnostics.timings.tCoreMs = Date.now() - diagnostics.startedAt;
    diagnostics.runtimeV2 = {
      enabled: true,
      plansReadyAt: Date.now(),
      aiOnNecessaryCriticalPath: false,
      aiMaterializationMode: 'post_response_action',
    };
  }
  const voiceRendererExecution = buildRecommendationVoiceRendererExecution(event, stylingShadow, recommendations);
  const voiceRendererShadowPromise = voiceRendererExecution.promise || Promise.resolve(null);
  if (voiceRendererExecution.enabled && voiceRendererExecution.waitForResult !== true) {
    diagnostics.recommendationVoiceRendererShadow = {
      status: 'materializing_non_blocking',
      waitForResult: false,
      planCount: stylingShadow?.plans?.length || 0,
    };
    voiceRendererShadowPromise.then((result) => {
      console.log('[RecommendationVoiceRendererMaterialized]', {
        auditId: diagnostics.auditId,
        status: result?.status || 'unknown',
        latencyMs: result?.latencyMs || 0,
        ttftMs: result?.ttftMs || 0,
        cacheHitCount: result?.cacheHitCount || 0,
        cacheMissCount: result?.cacheMissCount || 0,
      });
    });
  }
  const safeCopyStartedAt = Date.now();
  const canonicalCopyBatchV2 = canonicalCopyRuntimeV2Enabled
    ? buildRecommendationCanonicalCopyBatchV2({
        plans: stylingShadow?.plans || [],
        recommendations,
        aiMaterializationRequested: canonicalCopyRuntimeV2Enabled || voiceRendererExecution.enabled === true,
      })
    : null;
  if (canonicalCopyRuntimeV2Enabled) {
    diagnostics.timings.tSafeMs = Date.now() - safeCopyStartedAt;
    diagnostics.runtimeV2.safeReadyAt = Date.now();
    diagnostics.canonicalCopyRuntimeV2 = {
      version: canonicalCopyBatchV2.version,
      status: canonicalCopyBatchV2.status,
      expectedCopyCount: canonicalCopyBatchV2.expectedCopyCount,
      resolvedCopyCount: canonicalCopyBatchV2.resolvedCopyCount,
      aiCacheHitCount: canonicalCopyBatchV2.aiCacheHitCount,
      safeCopyCount: canonicalCopyBatchV2.safeCopyCount,
      legacyEmergencyCount: canonicalCopyBatchV2.legacyEmergencyCount,
    };
  }
  let snapshotPromise = null;
  let snapshotOps = null;
  let snapshotUpsertStartedAt = 0;
  const cardCompilationPromise = recommendations.length === 0
    ? Promise.resolve({ compiledOutfits: [], finalRecommendations: [], canonicalRecommendations: [] })
    : Promise.resolve().then(() => compileRecommendationsForResponse({
        recommendations,
        openid: OPENID,
        scene,
        targetDate,
        timeOfDay: event.timeOfDay || 'all_day',
        weather: weatherSnapshot,
        weatherMode,
        now,
        recommendationBatchId,
        diagnostics,
      })).then(({ compiledOutfits, startedAt }) => {
        const finalizationStartedAt = Date.now();
        const finalized = finalizeAcceptedRecommendations(compiledOutfits, {
          mode: 'new_recommendation',
          requestedCount,
        });
        diagnostics.timings.cardPreparation.finalizationMs = Date.now() - finalizationStartedAt;
        const finalRecommendations = finalized.finalRecommendations;
        const canonicalizationStartedAt = Date.now();
        let canonicalRecommendations = canonicalizeRecommendationBatch(finalRecommendations, { scene });
        if (canonicalCopyBatchV2) {
          canonicalRecommendations = attachRecommendationCanonicalCopiesV2(
            canonicalRecommendations,
            canonicalCopyBatchV2,
            stylingShadow?.plans || [],
          );
        }
        diagnostics.timings.cardPreparation.canonicalizationMs = Date.now() - canonicalizationStartedAt;
        const snapshotInputStartedAt = Date.now();
        diagnostics.snapshotPayloadBytes = serializedBytes(canonicalRecommendations);
        diagnostics.timings.cardPreparation.cloneSerializeMs = Date.now() - snapshotInputStartedAt;

        // The candidate pool id is already stable at this point. Start the
        // snapshot write immediately after its complete input is materialized;
        // candidate-pool persistence remains an independently awaited promise.
        snapshotUpsertStartedAt = Date.now();
        snapshotOps = { reads: 0, writes: 0 };
        snapshotPromise = upsertRecommendationOutfitsBatch({
          openid: OPENID,
          bases: canonicalRecommendations,
          now,
          availableClothingIds: clothes
            .filter((item) => item && item.status !== DELETED_STATUS)
            .map((item) => item._id),
          operationCounts: snapshotOps,
        });
        diagnostics.timings.cardPreparation.snapshotInputConstructionMs = Date.now() - snapshotInputStartedAt;
        diagnostics.timings.cardCompilationMs = snapshotUpsertStartedAt - startedAt;
        recordServerPhase(diagnostics, 'cardCompilation', startedAt, snapshotUpsertStartedAt);
        return { ...finalized, compiledOutfits, canonicalRecommendations };
      });
  if (candidatePoolPersistenceInput) {
    // Keep the first synchronous part of candidate-pool planning off the card
    // compilation turn. An async function does not yield until its first await.
    // The card microtask is queued first, so its startAt is directly after
    // candidate generation rather than after pool-plan construction.
    candidatePoolPersistPromise = Promise.resolve().then(() => persistGeneratedCandidatePool({
      diagnostics,
      candidatePoolId: candidatePoolPersistenceInput.candidatePoolId,
      identity: candidatePoolIdentity,
      candidates: candidatePoolPersistenceInput.candidates,
      debugRecommendationAudit,
      debugCandidatePoolProjection: candidatePoolPersistenceInput.debugCandidatePoolProjection,
    }));
  }
  const generatedCandidates = Array.isArray(recommendations?.candidatePoolCandidates)
    ? recommendations.candidatePoolCandidates
    : [];
  const candidateDebug = recommendations?.debug || {};
  diagnostics.candidateMetrics = {
    wardrobeItemCount: clothes.length,
    combinationCount: Number(candidateDebug.candidateCountBeforeTemperatureFilter)
      || Number(candidateDebug.candidateCount)
      || generatedCandidates.length,
    generatedCandidateCount: Number(candidateDebug.generatedCount) || generatedCandidates.length,
    acceptedCandidateCount: Number(candidateDebug.guardAcceptedCount) || 0,
    uniqueCandidateCount: new Set(generatedCandidates.map((candidate) => candidate?.outfitKey || candidate?.id)).size,
    selectedCandidateCount: recommendations.length,
    candidatePoolPersistedCount: candidatePoolPersistenceInput?.candidates?.length
      || (executionMode === 'candidate_pool_hit' ? Number(candidateDebug.candidateCount) || 0 : 0),
  };
  let poolPersist = null;
  if (recommendations.length === 0) {
    if (voiceRendererExecution.waitForResult === true) {
      diagnostics.recommendationVoiceRendererShadow = await voiceRendererShadowPromise;
    }
    poolPersist = await candidatePoolPersistPromise;
    if (poolPersist && poolPersist.status !== 'saved') {
      recommendationBatchId = undefined;
      cacheMissReason = 'candidate_pool_not_saved';
    }
  }
  const rawCountContract = recommendations.countContract;
  assertRecommendationCountContract(rawCountContract);
  assertReturnedCardCount(rawCountContract, recommendations.length);
  let persistedCandidatePoolId = executionMode === 'candidate_pool_hit'
    ? requestedCandidatePoolId
    : (baseRecommendationBatchId || null);
  let responseCountContract = buildRecommendationCountContract({
    ...rawCountContract,
    candidatePoolId: persistedCandidatePoolId,
  });
  recommendations.countContract = responseCountContract;
  assertReturnedCardCount(responseCountContract, recommendations.length);
  const recommendationBatchIdPresentAtResponse = Boolean(recommendationBatchId);
  const recommendationBatchIdLengthAtResponse = recommendationBatchId ? recommendationBatchId.length : 0;
  const debug = {
    auditId: diagnostics.auditId,
    candidateCount: recommendations.debug?.candidateCount ?? 0,
    generatedCount: recommendations.debug?.generatedCount ?? 0,
    acceptedCount: recommendations.debug?.guardAcceptedCount ?? 0,
    rejectedCount: recommendations.debug?.guardRejectedCount ?? 0,
    selectedCount: recommendations.length,
    limitedReason: recommendations.debug?.limitedReason || '',
    cloudBuildVersion: CLOUD_BUILD_VERSION,
    sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
    sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
    PRESENTATION_FACT_MODEL_BUILD,
    executionMode,
    candidatePoolIdentityHash: candidatePoolIdentity.identityHash,
    candidatePoolAgeMs,
    cacheHit,
    cacheMissReason,
    requestedExcludedCount: recommendations.debug?.requestedExcludedCount ?? getRequestedExclusionCount(excludedOutfitKeys, exclude),
    actualExcludedCandidateCount: recommendations.debug?.actualExcludedCandidateCount ?? 0,
    remainingCandidateCount: recommendations.debug?.remainingCandidateCount ?? 0,
    exclusionsAppliedCount: recommendations.debug?.actualExcludedCandidateCount ?? 0,
    timings: diagnostics.timings,
    responseBytes: {},
    candidatePoolSaveStatus: diagnostics.candidatePoolSaveStatus,
    candidatePoolSaveReason: diagnostics.candidatePoolSaveReason,
    candidatePoolSerializedBytes: diagnostics.candidatePoolSerializedBytes,
    candidatePoolChunkCount: diagnostics.candidatePoolChunkCount,
    candidatePoolSerializationMs: diagnostics.timings.candidatePoolSerializationMs,
    candidatePoolManifestBytes: diagnostics.candidatePoolManifestBytes,
    candidatePoolChunksBytes: diagnostics.candidatePoolChunksBytes,
    candidatePoolChunkWriteTimings: diagnostics.candidatePoolChunkWriteTimings,
    candidatePoolMaxActiveChunkWrites: diagnostics.candidatePoolMaxActiveChunkWrites,
    candidatePoolValidationReadCount: diagnostics.candidatePoolValidationReadCount,
    candidatePoolValidationMode: diagnostics.candidatePoolValidationMode,
    candidatePoolCleanupAttempted: diagnostics.candidatePoolCleanupAttempted === true,
    candidatePoolCleanupDeletedCount: diagnostics.candidatePoolCleanupDeletedCount || 0,
    candidatePoolCleanupFailedCount: diagnostics.candidatePoolCleanupFailedCount || 0,
    candidatePoolPhaseTiming: diagnostics.candidatePoolPhaseTiming,
    databaseOps: { ...diagnostics.databaseOps },
    recommendationBatchIdPresent: recommendationBatchIdPresentAtResponse,
    recommendationBatchIdLength: recommendationBatchIdLengthAtResponse,
    requestedCandidatePoolIdPresent: diagnostics.requestedCandidatePoolIdPresent ?? false,
    requestedCandidatePoolIdLength: diagnostics.requestedCandidatePoolIdLength ?? 0,
    countContract: responseCountContract,
    ...(diagnostics.canonicalCopyRuntimeV2
      ? { canonicalCopyRuntimeV2: diagnostics.canonicalCopyRuntimeV2 }
      : {}),
    ...(diagnostics.diagnosticsRequested === true && diagnostics.performanceOnly !== true
      ? { phaseLedger: diagnostics.phases }
      : {}),
  };
  const missingRoles = getMissingRequiredRoles(clothes, scene);
  const missingFacts = getMissingRequiredFacts(clothes, scene);

  if (recommendations.length === 0) {
    let availability;
    if (executionMode === 'candidate_pool_hit') {
      const validated = validateCandidatePoolAvailability(recommendations, requestedCount);
      availability = {
        limited: validated.limited,
        limitedReason: validated.limitedReason,
        missingRoles: [],
        missingFacts: [],
        exhausted: validated.exhausted,
        countContract: validated.countContract,
        copyDiagnosticReason: null,
      };
    } else {
      availability = resolveRecommendationAvailability({
        requestedCount,
        finalRecommendationCount: 0,
        missingRoles,
        missingFacts,
        candidateCount: debug.candidateCount,
        guardAcceptedCount: debug.acceptedCount,
        weatherRejectedCount: recommendations.debug?.weatherRejectedCount ?? 0,
        generatedCount: 0,
        excludedOutfitKeyCount: excludedOutfitKeys.length,
        copyHiddenCount: 0,
      });
    }
    debug.selectedCount = 0;
    debug.limitedReason = availability.limitedReason;
    debug.missingRoles = availability.missingRoles;
    debug.missingFacts = availability.missingFacts;
    const qaResult = buildRecommendationQaSummaries({
      enabled: debugRecommendationAudit,
      auditId: diagnostics.auditId,
      sceneKey: sceneContract.sceneKey,
      inputScene,
      scene,
      weather,
      weatherInput: event.weather,
      weatherMode,
      weatherSnapshot,
      recommendations,
      compiledOutfits: [],
      finalOutfits: [],
      timings: diagnostics.timings,
      diagnostics,
      execution: debug,
    });
    if (presentationEvidenceEnabled) {
      debug.presentationEvidenceStatus = {
        status: 'not_applicable_empty_batch',
        countContract: rawCountContract,
      };
    }
    delete recommendations.debug?._auditGuardAcceptedCandidates;
    delete recommendations.debug?._auditGuardRejectedCandidates;
    const emptyCountContract = buildRecommendationCountContract({
      ...rawCountContract,
      returnedCardCount: 0,
      candidatePoolId: persistedCandidatePoolId,
    });
    debug.countContract = emptyCountContract;
    return finalizeRecommendationResponse({
    sceneContract,
    diagnostics,
    qaResult,
    rejectionReasonCounts: recommendations.debug?.rejectReasonCounts,
    data: {
      outfits: [],
      countContract: emptyCountContract,
    ...(weatherSnapshot ? { weather: weatherSnapshot } : {}),
    weatherMode,
    recommendationNotice: '',
    ...(recommendationBatchId ? { recommendationBatchId } : {}),
    missingRoles: availability.missingRoles,
    missingFacts: availability.missingFacts,
    limited: availability.limited,
    exhausted: emptyCountContract.poolExhaustedAfterConsume,
    debug,
    meta: {
      auditId: diagnostics.auditId,
      cloudBuildVersion: CLOUD_BUILD_VERSION,
      PRESENTATION_FACT_MODEL_BUILD,
      reasonCatalogVersion: REASON_CATALOG_VERSION,
      aiReviewVersion: AI_REVIEW_VERSION,
    },
    },
  });
  }

  const {
    compiledOutfits,
    finalRecommendations,
    acceptedCount,
    finalRecommendationCount,
    copyHiddenCount,
    canonicalRecommendations,
  } = await cardCompilationPromise;
  if (voiceRendererExecution.waitForResult === true) {
    diagnostics.recommendationVoiceRendererShadow = await voiceRendererShadowPromise;
  }
  poolPersist = await candidatePoolPersistPromise;
  if (poolPersist && poolPersist.status !== 'saved') {
    recommendationBatchId = undefined;
    cacheMissReason = 'candidate_pool_not_saved';
  }
  persistedCandidatePoolId = executionMode === 'candidate_pool_hit'
    ? requestedCandidatePoolId
    : (diagnostics.candidatePoolSaveStatus === 'saved' ? baseRecommendationBatchId : null);
  responseCountContract = buildRecommendationCountContract({
    ...rawCountContract,
    candidatePoolId: persistedCandidatePoolId,
  });
  recommendations.countContract = responseCountContract;
  assertReturnedCardCount(responseCountContract, recommendations.length);
  let availability;
  if (executionMode === 'candidate_pool_hit') {
    const validated = validateCandidatePoolAvailability(recommendations, requestedCount);
    availability = {
      limited: validated.limited,
      limitedReason: validated.limitedReason,
      missingRoles: [],
      missingFacts: [],
      exhausted: validated.exhausted,
      countContract: validated.countContract,
      copyDiagnosticReason: copyHiddenCount > 0 ? 'COPY_EVIDENCE_INSUFFICIENT' : null,
    };
  } else {
    availability = resolveRecommendationAvailability({
      requestedCount,
      finalRecommendationCount: finalRecommendations.length,
      missingRoles,
      missingFacts,
      candidateCount: debug.candidateCount,
      guardAcceptedCount: debug.acceptedCount,
      weatherRejectedCount: recommendations.debug?.weatherRejectedCount ?? 0,
      generatedCount: recommendations.length,
      excludedOutfitKeyCount: excludedOutfitKeys.length,
      copyHiddenCount,
    });
  }
  const countContract = buildRecommendationCountContract({
    requestedBatchSize: requestedCount,
    returnedCardCount: finalRecommendations.length,
    remainingUniqueBeforeConsume: rawCountContract.remainingUniqueBeforeConsume,
    executionMode,
    candidatePoolId: persistedCandidatePoolId,
  });
  assertReturnedCardCount(countContract, finalRecommendations.length);
  debug.countContract = countContract;
  availability.limited = countContract.expectedCardCount < countContract.requestedBatchSize;
  availability.exhausted = countContract.poolExhaustedAfterConsume;
  availability.limitedReason = availability.limited ? 'DIVERSITY_EXHAUSTED' : null;
  const recommendationNotice = availability.limited && acceptedCount > 0
    ? getPartialRecommendationNotice(acceptedCount)
    : '';
  debug.selectedCount = finalRecommendations.length;
  debug.limitedReason = availability.limitedReason;
  debug.missingRoles = availability.missingRoles;
  debug.missingFacts = availability.missingFacts;
  const outfitRecords = await snapshotPromise;
  if (diagnostics.canonicalCopyRuntimeV2) {
    diagnostics.canonicalCopyRuntimeV2.durableAiCacheHitCount = outfitRecords.filter((record) => (
      record?.canonicalRecommendationCopyV2?.source === 'ai_cache'
      && record?.canonicalRecommendationCopyV2?.aiState === 'ready'
    )).length;
    debug.canonicalCopyRuntimeV2 = { ...diagnostics.canonicalCopyRuntimeV2 };
  }
  diagnostics.timings.snapshotUpsertMs = Date.now() - snapshotUpsertStartedAt;
  recordServerPhase(diagnostics, 'snapshotPersistence', snapshotUpsertStartedAt);
  diagnostics.snapshotPersistence = snapshotOps;
  if (diagnostics.diagnosticsRequested === true) debug.snapshotPersistence = snapshotOps;
  diagnostics.databaseOps.reads += snapshotOps?.reads || 0;
  diagnostics.databaseOps.writes += snapshotOps?.writeRoundTrips || snapshotOps?.writes || 0;
  const idMappingStartedAt = Date.now();
  const outfits = canonicalRecommendations.map((tempOutfit, index) => {
    const outfitRecord = outfitRecords[index];
    return {
      ...tempOutfit,
      id: outfitRecord._id,
      outfitId: outfitRecord._id,
      outfitKind: 'recommendation',
    };
  });
  diagnostics.timings.cardPreparation.idMappingMs = Date.now() - idMappingStartedAt;
  const enrichStartedAt = Date.now();
  const hydratedOutfits = await enrichOutfitsState(outfits, {
    openid: OPENID,
    targetDate,
    generatedAt: now,
    recommendationBatchId,
    copyMode: 'new_recommendation',
    canonicalCopyEnabled: canonicalCopyRuntimeV2Enabled,
    assetRecords: outfitRecords,
  });
  diagnostics.databaseOps.reads += hydratedOutfits.length > 0 ? 2 : 0;
  if (canonicalCopyRuntimeV2Enabled) assertRecommendationCanonicalCopiesV2(hydratedOutfits);
  else assertFinalPresentation(hydratedOutfits, scene);
  diagnostics.timings.enrichMs = Date.now() - enrichStartedAt;
  recordServerPhase(diagnostics, 'presentationEnrichment', enrichStartedAt);
  if (hydratedOutfits.length !== finalRecommendationCount
    || !hydratedOutfits.every((item) => hasCurrentCopyContract(item)
      && typeof item.copyContract?.todayReason === 'string'
      && item.copyContract.todayReason.trim().length > 0)) {
    throw new Error('final recommendation response invariant failed');
  }
  const responseOutfits = projectRecommendationResponseOutfits(hydratedOutfits);
  const exposureStartedAt = Date.now();
  await saveOutfitExposures({
    openid: OPENID,
    outfits: hydratedOutfits,
    scene,
    batchId: recommendationBatchId,
    shownAt: now,
  });
  diagnostics.databaseOps.writes += hydratedOutfits.length;
  diagnostics.timings.exposureMs = Date.now() - exposureStartedAt;
  recordServerPhase(diagnostics, 'exposurePersistence', exposureStartedAt);
  const qaResult = buildRecommendationQaSummaries({
    enabled: debugRecommendationAudit,
    auditId: diagnostics.auditId,
    sceneKey: sceneContract.sceneKey,
    inputScene,
    scene,
    weather,
    weatherInput: event.weather,
    weatherMode,
    weatherSnapshot,
    recommendations,
    compiledOutfits,
    finalOutfits: hydratedOutfits,
    timings: diagnostics.timings,
    diagnostics,
    execution: debug,
  });
  if (debugRecommendationAudit) {
    debug.sceneEvidenceAcceptance = buildSceneEvidenceAcceptanceDiagnostics(recommendations);
  }
  if (presentationEvidenceEnabled) {
    attachPresentationEvidenceDebug(debug, {
      auditId: diagnostics.auditId,
      scene: sceneContract.sceneKey,
      selectedCandidates: recommendations,
      presentationPlans: compiledOutfits,
      canonicalCards: canonicalRecommendations,
      finalCards: hydratedOutfits,
        countContract,
    });
  }
  delete recommendations.debug?._auditGuardAcceptedCandidates;
  delete recommendations.debug?._auditGuardRejectedCandidates;
  debug.databaseOps = { ...diagnostics.databaseOps };

  if (baseRecommendationBatchId !== undefined) {
    const finalizeResult = finalizeFullComputeAfterPoolPersist({
      diagnostics,
      baseRecommendationBatchId,
      cacheMissReason,
      sceneContract,
      qaResult,
      rejectionReasonCounts: recommendations.debug?.rejectReasonCounts,
      outfits: responseOutfits,
      weatherSnapshot,
      weatherMode,
      recommendationNotice,
      missingRoles,
      missingFacts,
      limited: countContract.expectedCardCount < countContract.requestedBatchSize,
      exhausted: countContract.poolExhaustedAfterConsume,
      countContract,
      debug,
      meta: {
        auditId: diagnostics.auditId,
        cloudBuildVersion: CLOUD_BUILD_VERSION,
        PRESENTATION_FACT_MODEL_BUILD,
        reasonCatalogVersion: REASON_CATALOG_VERSION,
        aiReviewVersion: AI_REVIEW_VERSION,
        sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
        sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
      },
    });
    return finalizeResult.response;
  }

  return finalizeRecommendationResponse({
    sceneContract,
    diagnostics,
    qaResult,
    rejectionReasonCounts: recommendations.debug?.rejectReasonCounts,
    data: {
    outfits: responseOutfits,
    ...(weatherSnapshot ? { weather: weatherSnapshot } : {}),
    weatherMode,
    recommendationNotice,
    ...(recommendationBatchId ? { recommendationBatchId } : {}),
    missingRoles,
    missingFacts,
    limited: countContract.expectedCardCount < countContract.requestedBatchSize,
    exhausted: countContract.poolExhaustedAfterConsume,
      countContract,
    debug,
    meta: {
      auditId: diagnostics.auditId,
      cloudBuildVersion: CLOUD_BUILD_VERSION,
      PRESENTATION_FACT_MODEL_BUILD,
      reasonCatalogVersion: REASON_CATALOG_VERSION,
      aiReviewVersion: AI_REVIEW_VERSION,
      sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
      sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
    },
    },
  });
}

async function materializeRecommendationCanonicalCopyV2(event, {
  database = db,
  runVoiceRenderer = runRecommendationVoiceRendererShadowV2Safely,
} = {}) {
  if (!isRecommendationCanonicalCopyRuntimeV2Enabled(event)) {
    throw createBusinessError('CANONICAL_COPY_RUNTIME_V2_DISABLED', 'canonical copy runtime v2 is disabled');
  }
  const { OPENID } = cloud.getWXContext();
  const recommendationBatchId = readString(event.recommendationBatchId);
  if (!recommendationBatchId || recommendationBatchId.length > 160) {
    throw createBusinessError('CANONICAL_COPY_BATCH_ID_INVALID', 'recommendationBatchId is required');
  }
  const response = await database.collection('outfits')
    .where({ _openid: OPENID, recommendationBatchId })
    .limit(8)
    .get();
  const records = (Array.isArray(response.data) ? response.data : [])
    .filter((record) => record?._id && record?.canonicalRecommendationCopyV2)
    .sort((left, right) => (
      Number(left.canonicalRecommendationCopyV2?.batchIndex)
      - Number(right.canonicalRecommendationCopyV2?.batchIndex)
    ));
  if (records.length === 0) {
    return {
      version: 'recommendation-canonical-copy-materialization-v2.0',
      status: 'not_found',
      recommendationBatchId,
      recordCount: 0,
      materializedCount: 0,
    };
  }
  const pending = records.filter((record) => {
    const canonical = record.canonicalRecommendationCopyV2;
    return !(canonical.source === 'ai_cache' && canonical.aiState === 'ready')
      && record.recommendationVoiceMaterializationV2;
  });
  if (pending.length === 0) {
    return {
      version: 'recommendation-canonical-copy-materialization-v2.0',
      status: 'ready_cache_hit',
      recommendationBatchId,
      recordCount: records.length,
      materializedCount: 0,
      cacheHitCount: records.length,
    };
  }
  const result = await runVoiceRenderer({
    preparedEntries: pending.map((record) => record.recommendationVoiceMaterializationV2),
    mode: 'batch',
    cacheMode: 'use',
    includeCopies: true,
  });
  if (result.status !== 'completed') {
    const failureCode = Object.keys(result.failureCodes || {})[0] || 'VOICE_RENDERER_FAILED';
    await Promise.all(pending.map((record) => persistCanonicalCopyMaterialization(database, record, {
      status: 'failed',
      failureCode,
    })));
    return {
      version: 'recommendation-canonical-copy-materialization-v2.0',
      status: 'failed_open',
      recommendationBatchId,
      recordCount: records.length,
      materializedCount: 0,
      failureCode,
      latencyMs: Number(result.latencyMs) || 0,
    };
  }
  const copiesByPlanId = new Map((Array.isArray(result.materializedCopies) ? result.materializedCopies : [])
    .map((copy) => [copy.planId, copy]));
  let materializedCount = 0;
  let mismatchCount = 0;
  await Promise.all(pending.map(async (record) => {
    const planId = record.recommendationVoiceMaterializationV2?.plan?.planId;
    const copy = copiesByPlanId.get(planId);
    const canonical = buildMaterializedCanonicalCopy(record.canonicalRecommendationCopyV2, copy);
    if (!canonical) {
      await persistCanonicalCopyMaterialization(database, record, {
        status: 'failed',
        failureCode: 'VOICE_RENDERER_COPY_MISMATCH',
      });
      mismatchCount += 1;
      return;
    }
    await persistCanonicalCopyMaterialization(database, record, { status: 'ready', canonical });
    materializedCount += 1;
  }));
  return {
    version: 'recommendation-canonical-copy-materialization-v2.0',
    status: mismatchCount === 0 ? 'ready' : 'partially_failed_open',
    recommendationBatchId,
    recordCount: records.length,
    materializedCount,
    mismatchCount,
    cacheHitCount: Number(result.cacheHitCount) || 0,
    latencyMs: Number(result.latencyMs) || 0,
    ttftMs: Number(result.ttftMs) || 0,
  };
}

async function persistCanonicalCopyMaterialization(database, record, update) {
  const existing = record.canonicalRecommendationCopyV2;
  const canonical = update.status === 'ready'
    ? update.canonical
    : buildFailedCanonicalCopy(existing, update.failureCode);
  if (!canonical) return;
  const text = canonical.text;
  const copyContract = record.copyContract
    ? { ...record.copyContract, todayReason: text }
    : record.copyContract;
  const data = {
    canonicalRecommendationCopyV2: replaceDocumentField(database, canonical),
    reason: text,
    reasoning: text,
    ...(copyContract ? { copyContract: replaceDocumentField(database, copyContract) } : {}),
    updatedAt: new Date().toISOString(),
  };
  await database.collection('outfits').doc(record._id).update({ data });
}

function replaceDocumentField(database, value) {
  return typeof database?.command?.set === 'function' ? database.command.set(value) : value;
}

function createRecommendationSceneContract(inputScene) {
  const normalizedSceneKey = normalizeScene(inputScene || 'home');
  const sceneKey = Object.hasOwn(RECOMMENDATION_SCENE_LABELS, normalizedSceneKey)
    ? normalizedSceneKey
    : 'home';
  return {
    sceneKey,
    scene: RECOMMENDATION_SCENE_LABELS[sceneKey],
  };
}

function buildRecommendationResponseData(sceneContract, data) {
  return {
    ...data,
    outfits: data.outfits,
    sceneKey: sceneContract.sceneKey,
    scene: sceneContract.scene,
  };
}

function buildSceneEvidenceAcceptanceDiagnostics(recommendations = []) {
  const debug = recommendations?.debug || {};
  const accepted = Array.isArray(debug._auditGuardAcceptedCandidates)
    ? debug._auditGuardAcceptedCandidates
    : [];
  const rejected = Array.isArray(debug._auditGuardRejectedCandidates)
    ? debug._auditGuardRejectedCandidates
    : [];
  const ranked = accepted.map((candidate) => {
    const sceneResult = candidate?.sceneEligibility || candidate?.eligibility?.scene || {};
    const evidence = Array.isArray(sceneResult.sceneEvidence) ? sceneResult.sceneEvidence : [];
    return {
      outfitKey: candidate?.outfitKey || candidate?.selectionSignatures?.itemSignature || '',
      sceneFitScore: Number(sceneResult.sceneFitScore ?? candidate?.sceneFitScore) || 0,
      rankingScore: Number(candidate?.rankingScore) || 0,
      positiveFamilies: uniqueSorted(evidence
        .filter((entry) => /_POSITIVE$/.test(String(entry?.severity || '')))
        .map((entry) => entry.evidenceFamily)),
      negativeFamilies: uniqueSorted(evidence
        .filter((entry) => entry?.severity === 'NEGATIVE_SIGNAL')
        .map((entry) => entry.evidenceFamily)),
      evidenceIds: uniqueSorted(evidence.map((entry) => entry?.id)),
    };
  }).sort((left, right) => right.rankingScore - left.rankingScore
    || right.sceneFitScore - left.sceneFitScore
    || left.outfitKey.localeCompare(right.outfitKey));
  const selectedKeys = new Set((Array.isArray(recommendations) ? recommendations : [])
    .map((candidate) => candidate?.outfitKey)
    .filter(Boolean));
  const scores = ranked.map((candidate) => candidate.sceneFitScore).sort((left, right) => left - right);
  const hardRejected = rejected.filter((entry) => entry?.rejectionStage === 'scene_hard_conflict');
  const wearabilityRejected = rejected.filter((entry) => entry?.rejectionStage === 'wearability_guard');
  return {
    version: SCENE_EVIDENCE_VERSION,
    fingerprint: SCENE_EVIDENCE_FINGERPRINT,
    generated: Number(debug.candidateCount) || accepted.length + rejected.length,
    eligible: accepted.length,
    hardRejected: hardRejected.length,
    wearabilityRejected: wearabilityRejected.length,
    selected: selectedKeys.size,
    sceneFitDistribution: {
      min: scores[0] ?? null,
      median: scores.length > 0 ? scores[Math.floor((scores.length - 1) / 2)] : null,
      max: scores[scores.length - 1] ?? null,
      buckets: {
        low: scores.filter((score) => score < 4).length,
        neutral: scores.filter((score) => score >= 4 && score < 6).length,
        positive: scores.filter((score) => score >= 6 && score < 8).length,
        strong: scores.filter((score) => score >= 8).length,
      },
    },
    topEvidenceFamilies: countRankedValues(ranked.flatMap((candidate) => candidate.positiveFamilies)),
    negativeFamilies: countRankedValues(ranked.flatMap((candidate) => candidate.negativeFamilies)),
    candidates: ranked.map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      selected: selectedKeys.has(candidate.outfitKey),
    })),
  };
}

function countRankedValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family));
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value))].sort();
}

// Persistence keeps the full fact-bearing snapshot. The recommendation response
// already carries the fact-bearing `items` array, so sending the same evidence a
// second time in `snapshotItems` needlessly multiplies the 8-card payload.
function projectRecommendationResponseOutfits(outfits) {
  return (Array.isArray(outfits) ? outfits : []).map((outfit) => {
    const snapshotItems = Array.isArray(outfit?.snapshotItems)
      ? outfit.snapshotItems.map((item) => ({
          itemId: item.itemId,
          name: item.name,
          category: item.category,
          color: item.color,
          imageUrl: item.imageUrl,
          displayImageUrl: item.displayImageUrl,
          thumbnailUrl: item.thumbnailUrl,
          isDeleted: Boolean(item.isDeleted),
        }))
      : [];
    const projected = pickPublicOutfitFields(outfit);
    projected.snapshotItems = snapshotItems;
    if (projected.contentPlan && typeof projected.contentPlan === 'object') {
      projected.contentPlan = projectPublicContentPlan(projected.contentPlan);
    }
    if (projected.xiaodaStyleInsight && typeof projected.xiaodaStyleInsight === 'object') {
      projected.xiaodaStyleInsight = projectPublicXiaodaStyleInsight(projected.xiaodaStyleInsight);
    }
    if (projected.aestheticEvaluation && typeof projected.aestheticEvaluation === 'object') {
      projected.aestheticEvaluation = { ...projected.aestheticEvaluation };
      if (!Array.isArray(projected.aestheticEvaluation.evidenceCodes)
        && Array.isArray(projected.aestheticEvaluation.evidence)) {
        projected.aestheticEvaluation.evidenceCodes = projected.aestheticEvaluation.evidence
          .map((item) => item?.code)
          .filter((code) => typeof code === 'string' && code.length > 0)
          .slice(0, 32);
      }
      delete projected.aestheticEvaluation.evidence;
    }
    if (Array.isArray(projected.items)) {
      projected.items = projected.items.map(projectRecommendationResponseItem);
    }
    return projected;
  });
}

const PUBLIC_OUTFIT_RESPONSE_FIELDS = [
  'id', 'outfitId', 'title', 'userTitle', 'displayTitle', 'clothingIds', 'outfitKey',
  'outfitKind', 'incomplete', 'deletedItemCount', 'scene', 'targetDate', 'timeOfDay',
  'weatherSnapshot', 'weatherMode', 'scores', 'generationType', 'source', 'sourceFavoriteOutfitId',
  'favoritedAt', 'favoriteOutfitId', 'wornAt', 'wornDate', 'isFavorite', 'isWornToday',
  'todayHistoryId', 'historyId', 'lastWornAt', 'recommendationBatchId', 'generatedAt',
  'styleTags', 'createdAt', 'updatedAt', 'reason', 'reasoning', 'reasonVersion', 'copyContract',
  'copyContractVersion', 'voiceBankVersion', 'riskFlags', 'copyGateResult', 'copyRiskFlags',
  'copyDisplay', 'defaultCopyHidden', 'copyFinalizationMode', 'aestheticEvaluation',
  'contentPlan', 'xiaodaStyleInsight', 'canonicalRecommendationCopyV2',
  'items', 'snapshotItems', 'outfitKind', 'outfitReferenceStage',
];

function pickPublicOutfitFields(outfit) {
  const projected = {};
  for (const field of PUBLIC_OUTFIT_RESPONSE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(outfit || {}, field)) projected[field] = outfit[field];
  }
  if (projected.copyContract && typeof projected.copyContract === 'object') {
    projected.copyContract = projectPublicCopyContract(projected.copyContract);
  }
  if (Array.isArray(projected.items)) projected.items = projected.items.map(projectRecommendationResponseItem);
  return projected;
}

function projectPublicCopyContract(contract) {
  const projected = {};
  for (const field of [
    'copyContractVersion', 'voiceBankVersion', 'gateResult', 'copyDisplay', 'todayReason',
    'todayReasonSource', 'coreEligibilityReason', 'coreEligibilityReasonCode',
    'coreEligibilitySubjectItemIds', 'coreEligibilitySupportingFactIds',
    'coreEligibilityRelationFactIds', 'coreEligibilitySourceRule',
    'coreEligibilitySourceRuleReasons', 'enhancedReason', 'enhancementRejectReasons',
    'todayClaim', 'todayClaimId', 'todayAction', 'todayDimension', 'todaySentenceClusterId',
    'todaySubjectItemId', 'todaySubjectItemIds', 'todaySlotBindings', 'detailExplanation',
    'detailClaim', 'detailClaimId', 'detailAction', 'detailDimension',
    'detailSentenceClusterId', 'detailSubjectItemId', 'detailSubjectItemIds',
    'detailSlotBindings', 'riskFlags', 'qualification', 'primaryRelationCode',
    'todayCopyProvenance', 'detailCopyProvenance', 'naturalnessGateVersion',
    'naturalnessGateResult', 'naturalnessRiskFlags',
    'structuralNaturalnessVersion', 'structuralNaturalnessResult',
    'structuralNaturalnessRiskFlags', 'messageIntent', 'messageCandidateId',
    'structuralNaturalnessWarningFlags', 'messageDimension', 'valueAssessment',
    'unsupportedClaimCount', 'xiaodaStyleInsight',
  ]) {
    if (Object.prototype.hasOwnProperty.call(contract, field)) projected[field] = contract[field];
  }
  projected.coreEligibilityEvidence = (Array.isArray(contract.coreEligibilityEvidence)
    ? contract.coreEligibilityEvidence
    : []).map(projectPublicEligibilityEvidence);
  if (projected.todayCopyProvenance && typeof projected.todayCopyProvenance === 'object') {
    projected.todayCopyProvenance = projectPublicCopyProvenance(projected.todayCopyProvenance);
  }
  if (projected.detailCopyProvenance && typeof projected.detailCopyProvenance === 'object') {
    projected.detailCopyProvenance = projectPublicCopyProvenance(projected.detailCopyProvenance);
  }
  if (projected.xiaodaStyleInsight && typeof projected.xiaodaStyleInsight === 'object') {
    projected.xiaodaStyleInsight = projectPublicXiaodaStyleInsight(projected.xiaodaStyleInsight);
  }
  return projected;
}

function projectPublicCopyProvenance(provenance) {
  const projected = {};
  for (const field of [
    'version', 'surface', 'scene', 'relationCode', 'messageIntent', 'messageDimension',
    'openingFamily', 'endingFamily', 'compositionPattern', 'text', 'fallbackStrategy',
  ]) {
    if (Object.prototype.hasOwnProperty.call(provenance, field)) projected[field] = provenance[field];
  }
  return projected;
}

function projectPublicXiaodaStyleInsight(insight) {
  const projected = {};
  for (const field of ['version', 'personaVersion']) {
    if (Object.prototype.hasOwnProperty.call(insight, field)) projected[field] = insight[field];
  }
  return projected;
}

function projectPublicEligibilityEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return evidence;
  const projected = {};
  for (const field of [
    'factId', 'relationFactId', 'itemId', 'fact', 'value', 'subjectItemIds',
    'supportingFactIds', 'source', 'confidence', 'authorized',
  ]) {
    if (Object.prototype.hasOwnProperty.call(evidence, field)) projected[field] = evidence[field];
  }
  return projected;
}

function projectPublicContentPlan(contentPlan) {
  const projected = {};
  for (const field of [
    'version', 'sceneIntent', 'items', 'observations', 'primaryBenefit',
    'secondaryBenefit', 'suggestion', 'personaVersion', 'xiaodaStyleInsight',
  ]) {
    if (Object.prototype.hasOwnProperty.call(contentPlan, field)) projected[field] = contentPlan[field];
  }
  if (projected.xiaodaStyleInsight && typeof projected.xiaodaStyleInsight === 'object') {
    projected.xiaodaStyleInsight = projectPublicXiaodaStyleInsight(projected.xiaodaStyleInsight);
  }
  return projected;
}

// Raw fact records are required by candidate generation and QA, but are not a
// client response contract. The copy contract and scalar item facts remain;
// removing the repeated evidence carrier prevents the same wardrobe facts
// being serialized once per card and again in every nested diagnostic model.
function projectRecommendationResponseItem(item) {
  if (!item || typeof item !== 'object') return item;
  const projected = {};
  for (const field of [
    'clothingId', 'category', 'subcategory', 'imageUrl', 'displayImageUrl', 'thumbnailUrl',
    'colorPalette', 'isDeleted', 'confidence', 'recognitionConfidence', 'aiConfidence',
    'factConfidence', 'fit', 'silhouette', 'shoulderFit', 'shoulderLine', 'sleeveLength',
    'sleeve', 'pantsLength', 'patternType', 'styleComplexity', 'thickness', 'material',
    'neckline', 'collar', 'closure', 'shoeClosure', 'shoeType', 'materialGuess', 'userEdited',
    'fieldSource', 'styleTags', 'sceneTags',
  ]) {
    if (Object.prototype.hasOwnProperty.call(item, field)) projected[field] = item[field];
  }
  return projected;
}

function projectSnapshotItemsForCardPreparation(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    itemId: item.itemId,
    name: item.name,
    category: item.category,
    color: item.color,
    imageUrl: item.imageUrl,
    displayImageUrl: item.displayImageUrl,
    thumbnailUrl: item.thumbnailUrl,
    isDeleted: Boolean(item.isDeleted),
  }));
}

function createRecommendationDiagnostics(event = {}, handlerStartAt = Date.now()) {
  return {
    auditId: readAuditId(event.auditId),
    stage: 'received',
    startedAt: handlerStartAt,
    diagnosticsRequested: event.diagnostics === true || event.performanceDiagnostics === true,
    performanceOnly: event.performanceDiagnostics === true,
    handlerStartAt,
    snapshotPayloadBytes: 0,
    candidatePoolPayloadBytes: 0,
    phases: [],
    timings: {
      dataLoadMs: 0,
      identityMs: 0,
      candidatePoolLoadMs: 0,
      candidatePoolSaveMs: 0,
      candidatePoolPlanMs: 0,
      candidatePoolSerializationMs: 0,
      candidatePoolChunkWriteMs: 0,
      candidatePoolValidationMs: 0,
      candidatePoolManifestWriteMs: 0,
      exclusionMs: 0,
      compositionMs: 0,
      candidateFactPreparationMs: 0,
      candidateConstructionMs: 0,
      canonicalizeMs: 0,
      eligibilityMs: 0,
      wearabilitySceneEligibilityMs: 0,
      scoringMs: 0,
      scoringPreparationMs: 0,
      filteringMs: 0,
      dedupeMs: 0,
      batchSelectionMs: 0,
      cardCompilationMs: 0,
      qaAuditMs: 0,
      poolManifestLoadMs: 0,
      poolChunksLoadMs: 0,
      poolHydrateMs: 0,
      poolDbReadCount: 0,
      materializationMs: 0,
      snapshotUpsertMs: 0,
      enrichMs: 0,
      exposureMs: 0,
      presentationEvidenceMs: 0,
      cardPreparation: {
        canonicalRecommendationConstructionMs: 0,
        factPresentationPreparationMs: 0,
        finalizationMs: 0,
        canonicalizationMs: 0,
        snapshotInputConstructionMs: 0,
        cloneSerializeMs: 0,
        idMappingMs: 0,
      },
      serializationMs: 0,
      totalMs: 0,
    },
    candidatePoolManifestBytes: 0,
    candidatePoolChunksBytes: 0,
    candidatePoolChunkWriteTimings: [],
    candidatePoolMaxActiveChunkWrites: 0,
    candidatePoolValidationReadCount: 0,
    candidatePoolValidationMode: 'local_checksum_after_awaited_set',
    candidatePoolCleanupAttempted: false,
    candidatePoolCleanupDeletedCount: 0,
    candidatePoolCleanupFailedCount: 0,
    candidatePoolPhaseTiming: null,
    databaseOps: {
      reads: 0,
      writes: 0,
    },
  };
}

function recordServerPhase(diagnostics, phase, startAt, endAt = Date.now()) {
  if (!diagnostics || !phase) return;
  const start = Number(startAt) || endAt;
  const end = Number(endAt) || Date.now();
  diagnostics.phases.push({
    phase,
    startAt: start,
    endAt: end,
    duration: Math.max(0, end - start),
  });
}

async function persistGeneratedCandidatePool({
  diagnostics,
  candidatePoolId,
  identity,
  candidates,
  debugRecommendationAudit,
  debugCandidatePoolProjection = false,
}) {
  const startedAt = Date.now();
  const poolPersist = await tryPersistCandidatePool({
    database: db,
    candidatePoolId,
    identity,
    candidates,
    now: Date.now(),
    auditId: diagnostics.auditId,
    debugRecommendationAudit,
    debugCandidatePoolProjection,
  });
  diagnostics.timings.candidatePoolSaveMs = Date.now() - startedAt;
  diagnostics.candidatePoolPayloadBytes = Math.max(
    0,
    Number(poolPersist.serializedBytes)
      || Number(poolPersist.manifestBytes || 0) + Number(poolPersist.chunksBytes || 0),
  );
  recordServerPhase(diagnostics, 'candidatePoolPersistence', startedAt);
  diagnostics.timings.candidatePoolPlanMs = poolPersist.planBuildMs || 0;
  diagnostics.timings.candidatePoolSerializationMs = poolPersist.serializationMs || 0;
  diagnostics.timings.candidatePoolChunkWriteMs = poolPersist.chunkWriteMs || 0;
  diagnostics.timings.candidatePoolValidationMs = poolPersist.validationMs || 0;
  diagnostics.timings.candidatePoolManifestWriteMs = poolPersist.manifestWriteMs || 0;
  diagnostics.databaseOps.reads += poolPersist.dbReadCount || 0;
  diagnostics.databaseOps.writes += poolPersist.dbWriteCount || 0;
  diagnostics.candidatePoolSaveStatus = poolPersist.status;
  diagnostics.candidatePoolSaveReason = poolPersist.reason;
  diagnostics.candidatePoolSerializedBytes = poolPersist.serializedBytes;
  diagnostics.candidatePoolChunkCount = poolPersist.chunkCount;
  diagnostics.candidatePoolManifestBytes = poolPersist.manifestBytes || 0;
  diagnostics.candidatePoolChunksBytes = poolPersist.chunksBytes || 0;
  diagnostics.candidatePoolChunkWriteTimings = poolPersist.chunkWriteTimings || [];
  diagnostics.candidatePoolMaxActiveChunkWrites = poolPersist.maxActiveChunkWrites || 0;
  diagnostics.candidatePoolValidationReadCount = poolPersist.validationReadCount || 0;
  diagnostics.candidatePoolValidationMode = poolPersist.validationMode || 'local_checksum_after_awaited_set';
  diagnostics.candidatePoolCleanupAttempted = poolPersist.cleanupAttempted === true;
  diagnostics.candidatePoolCleanupDeletedCount = poolPersist.cleanupDeletedCount || 0;
  diagnostics.candidatePoolCleanupFailedCount = poolPersist.cleanupFailedCount || 0;
  diagnostics.candidatePoolPhaseTiming = poolPersist.phaseTiming
    ? {
        ...poolPersist.phaseTiming,
        wrapperWallMs: diagnostics.timings.candidatePoolSaveMs,
        wrapperDeltaMs: Math.max(
          0,
          diagnostics.timings.candidatePoolSaveMs - Number(poolPersist.phaseTiming.totalWallMs || 0),
        ),
      }
    : null;
  return poolPersist;
}

function compileRecommendationsForResponse({
  recommendations,
  openid,
  scene,
  targetDate,
  timeOfDay,
  weather,
  weatherMode,
  now,
  recommendationBatchId,
  diagnostics,
}) {
  diagnostics.stage = 'cardCompilation';
  const startedAt = Date.now();
  const constructionStartedAt = Date.now();
  const tempOutfits = recommendations.map((recommendation) =>
    toTempOutfit(recommendation, {
      openid,
      scene,
      targetDate,
      timeOfDay,
      weather,
      weatherMode,
      now,
      recommendationBatchId,
    }),
  );
  diagnostics.timings.cardPreparation.canonicalRecommendationConstructionMs = Date.now() - constructionStartedAt;
  const factPreparationStartedAt = Date.now();
  const compiledOutfits = compileRecommendationLanguageV3({
    outfits: tempOutfits,
    scene,
    weather,
  });
  diagnostics.timings.cardPreparation.factPresentationPreparationMs = Date.now() - factPreparationStartedAt;
  assertEligibilityReasons(compiledOutfits, { node: 'beforeFinalization', scene, weather });
  diagnostics.timings.cardPreparation.finalizationMs = 0;
  diagnostics.timings.cardCompilationMs = Date.now() - startedAt;
  return { compiledOutfits, startedAt };
}

function readAuditId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80);
  return `rec_srv_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function getRecommendationErrorCode(error) {
  const value = error?.businessCode || error?.code || error?.name;
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 80) : 'UNKNOWN';
}

function getSafeRecommendationErrorMessage(error) {
  return typeof error?.message === 'string' ? error.message.slice(0, 240) : 'unknown error';
}

function attachPresentationEvidenceDebug(debug, input) {
  const startedAt = Date.now();
  const evidence = buildPresentationEvidence({
    ...input,
    qaVersion: QA_BATCH_AUDIT_VERSION,
  });
  const actualBytes = serializedPresentationEvidenceBytes(evidence);
  if (actualBytes >= PRESENTATION_EVIDENCE_MAX_BYTES) {
    delete debug.presentationEvidence;
    debug.presentationEvidenceStatus = {
      status: 'omitted_over_budget',
      version: PRESENTATION_EVIDENCE_VERSION,
      actualBytes,
      limitBytes: PRESENTATION_EVIDENCE_MAX_BYTES,
    };
    if (debug.timings) debug.timings.presentationEvidenceMs = Date.now() - startedAt;
    return null;
  }
  delete debug.presentationEvidenceStatus;
  debug.presentationEvidence = evidence;
  if (debug.timings) debug.timings.presentationEvidenceMs = Date.now() - startedAt;
  return evidence;
}

function buildRecommendationQaSummaries({
  enabled,
  auditId,
  sceneKey,
  inputScene,
  scene,
  weather,
  weatherInput,
  weatherMode,
  weatherSnapshot,
  recommendations,
  compiledOutfits,
  finalOutfits,
  timings,
  diagnostics,
  execution,
}) {
  if (!enabled) return null;
  if (diagnostics) diagnostics.stage = 'qaAudit';
  const startedAt = Date.now();
  const result = buildQaAuditSummaries({
    auditId,
    sceneKey,
    eligibilityRejectionAuditEnabled: enabled,
    requestScene: inputScene,
    responseScene: scene || '',
    weatherMode,
    weather: weatherInput || weather,
    hasUsableWeather: Boolean(recommendations.debug?.hasUsableWeather),
    weatherSnapshotPresent: Boolean(weatherSnapshot),
    temperatureBandApplied: Boolean(recommendations.debug?.temperatureBandApplied),
    cloudBuild: CLOUD_BUILD_VERSION,
    PRESENTATION_FACT_MODEL_BUILD,
    guardAcceptedCandidates: recommendations.debug?._auditGuardAcceptedCandidates || [],
    guardRejectedCandidates: recommendations.debug?._auditGuardRejectedCandidates || [],
    acceptedCandidates: recommendations.debug?._auditAcceptedCandidates || [],
    counts: {
      candidate: recommendations.debug?.candidateCount ?? 0,
      generated: recommendations.debug?.generatedCount ?? 0,
      accepted: recommendations.debug?.guardAcceptedCount ?? 0,
      rejected: recommendations.debug?.guardRejectedCount ?? 0,
      selected: recommendations.length,
    },
    rejectionReasonCounts: recommendations.debug?.rejectReasonCounts || {},
    selectedOutfits: recommendations,
    compiledOutfits,
    finalOutfits,
    timings,
    execution: {
      ...execution,
      guardCandidateCount: recommendations.debug?.guardCandidateCount ?? execution?.guardCandidateCount,
      guardAcceptedCount: recommendations.debug?.guardAcceptedCount ?? execution?.guardAcceptedCount,
      guardRejectedCount: recommendations.debug?.guardRejectedCount ?? execution?.guardRejectedCount,
    },
  });
  timings.qaAuditMs = Date.now() - startedAt;
  recordServerPhase(diagnostics, 'qaAcceptance', startedAt);
  return result;
}

function finalizeFullComputeAfterPoolPersist({
  diagnostics,
  baseRecommendationBatchId,
  cacheMissReason,
  sceneContract,
  qaResult,
  rejectionReasonCounts,
  outfits,
  weatherSnapshot,
  weatherMode,
  recommendationNotice,
  missingRoles,
  missingFacts,
  limited,
  exhausted,
  countContract,
  debug,
  meta,
}) {
  const poolSaveStatus = diagnostics.candidatePoolSaveStatus;
  let recommendationBatchId;
  let finalCacheMissReason = cacheMissReason;

  if (poolSaveStatus === 'saved') {
    recommendationBatchId = baseRecommendationBatchId;
  } else {
    recommendationBatchId = undefined;
    finalCacheMissReason = 'candidate_pool_not_saved';
  }

  const recommendationBatchIdPresent = Boolean(recommendationBatchId);
  const recommendationBatchIdLength = recommendationBatchId ? recommendationBatchId.length : 0;
  const finalDebug = {
    ...debug,
    candidatePoolSaveStatus: diagnostics.candidatePoolSaveStatus,
    candidatePoolSaveReason: diagnostics.candidatePoolSaveReason,
    candidatePoolSerializedBytes: diagnostics.candidatePoolSerializedBytes,
    candidatePoolChunkCount: diagnostics.candidatePoolChunkCount,
    candidatePoolSerializationMs: diagnostics.timings.candidatePoolSerializationMs,
    candidatePoolManifestBytes: diagnostics.candidatePoolManifestBytes,
    candidatePoolChunksBytes: diagnostics.candidatePoolChunksBytes,
    candidatePoolChunkWriteTimings: diagnostics.candidatePoolChunkWriteTimings,
    candidatePoolMaxActiveChunkWrites: diagnostics.candidatePoolMaxActiveChunkWrites,
    candidatePoolValidationReadCount: diagnostics.candidatePoolValidationReadCount,
    candidatePoolValidationMode: diagnostics.candidatePoolValidationMode,
    candidatePoolCleanupAttempted: diagnostics.candidatePoolCleanupAttempted === true,
    candidatePoolCleanupDeletedCount: diagnostics.candidatePoolCleanupDeletedCount || 0,
    candidatePoolCleanupFailedCount: diagnostics.candidatePoolCleanupFailedCount || 0,
    candidatePoolPhaseTiming: diagnostics.candidatePoolPhaseTiming,
    recommendationBatchIdPresent,
    recommendationBatchIdLength,
    requestedCandidatePoolIdPresent: diagnostics.requestedCandidatePoolIdPresent ?? false,
    requestedCandidatePoolIdLength: diagnostics.requestedCandidatePoolIdLength ?? 0,
    cacheMissReason: finalCacheMissReason || debug.cacheMissReason,
  };

  const response = finalizeRecommendationResponse({
    sceneContract,
    diagnostics,
    qaResult,
    rejectionReasonCounts,
    data: {
      outfits,
      ...(weatherSnapshot ? { weather: weatherSnapshot } : {}),
      weatherMode,
      recommendationNotice,
      ...(recommendationBatchId ? { recommendationBatchId } : {}),
      missingRoles,
      missingFacts,
      limited,
      exhausted,
      countContract,
      debug: finalDebug,
      meta,
    },
  });

  return {
    response,
    recommendationBatchId,
    cacheMissReason: finalCacheMissReason,
  };
}

function finalizeRecommendationResponse({
  sceneContract,
  diagnostics,
  qaResult,
  rejectionReasonCounts,
  data,
}) {
  diagnostics.stage = 'serialization';
  const serializationStartedAt = Date.now();
  let responseSerializationMs = 0;
  const measureResponse = () => {
    const startedAt = Date.now();
    const measured = measureRecommendationResponse(responseData);
    responseSerializationMs += Date.now() - startedAt;
    return measured;
  };
  const responseBuildStartedAt = Date.now();
  const responseData = buildRecommendationResponseData(sceneContract, {
    ...data,
    ...(qaResult?.clientAudit ? { qaBatchAudit: qaResult.clientAudit } : {}),
  });
  diagnostics.timings.responseBuildMs = Date.now() - responseBuildStartedAt;
  let budget = measureResponse();
  syncRecommendationResponseDiagnostics(responseData, diagnostics.timings, budget, qaResult?.clientAudit);
  if (qaResult?.clientAudit) fitQaBatchAuditToBudget(qaResult.clientAudit);
  budget = measureResponse();
  if (qaResult?.clientAudit && budget.totalDataBytes >= 768 * 1024) {
    truncateQaForResponseBudget(qaResult.clientAudit);
    budget = measureResponse();
  }
  diagnostics.timings.serializationMs = Date.now() - serializationStartedAt;
  recordServerPhase(diagnostics, 'responseSerialization', serializationStartedAt);
  diagnostics.timings.totalMs = Date.now() - diagnostics.startedAt;
  recordServerPhase(diagnostics, 'handlerEnd', diagnostics.startedAt);
  if (diagnostics.diagnosticsRequested === true && diagnostics.performanceOnly !== true) {
    responseData.debug.phaseLedger = diagnostics.phases;
  }
  syncRecommendationResponseDiagnostics(responseData, diagnostics.timings, budget, qaResult?.clientAudit);
  if (diagnostics.diagnosticsRequested === true) {
    responseData.diagnostics = {
      performance: buildRecommendationPerformanceLedger(diagnostics, budget, responseData),
      ...(diagnostics.recommendationVoiceRendererShadow?.benchmark === true
        ? { voiceRendererShadowBenchmark: diagnostics.recommendationVoiceRendererShadow }
        : {}),
    };
  }
  budget = measureResponse();
  if (responseData.diagnostics?.performance) {
    responseData.diagnostics.performance.responsePayloadBytes = budget.totalDataBytes;
    budget = measureResponse();
  }
  syncRecommendationResponseDiagnostics(responseData, diagnostics.timings, budget, qaResult?.clientAudit);
  if (diagnostics.performanceOnly === true || diagnostics.diagnosticsRequested !== true) {
    stripResponseDiagnosticsForBusinessResponse(responseData, { performanceOnly: diagnostics.performanceOnly === true });
    budget = measureResponse();
    if (responseData.diagnostics?.performance) {
      responseData.diagnostics.performance.responsePayloadBytes = budget.totalDataBytes;
    }
  }
  diagnostics.timings.responseSerializationMs = responseSerializationMs;
  diagnostics.timings.responseFinalizationMs = Date.now() - serializationStartedAt;
  diagnostics.serverResponseReadyAt = Date.now();
  if (responseData.diagnostics?.performance) {
    responseData.diagnostics.performance.responseFinalization = compactPerformanceNumbers({
      buildMs: diagnostics.timings.responseBuildMs,
      serializationMs: responseSerializationMs,
      totalMs: diagnostics.timings.responseFinalizationMs,
    });
    responseData.diagnostics.performance.serverResponseReadyAt = diagnostics.serverResponseReadyAt;
    responseData.diagnostics.performance.serverTotalThroughResponseReadyMs = Math.max(
      0,
      diagnostics.serverResponseReadyAt - (Number(diagnostics.handlerStartAt) || Number(diagnostics.startedAt) || 0),
    );
  }
  emitRecommendationServerDone({
    auditId: diagnostics.auditId,
    scene: responseData.scene,
    debug: responseData.debug,
    stylingIntelligenceShadow: diagnostics.stylingIntelligenceShadow,
    recommendationVoiceRendererShadow: diagnostics.recommendationVoiceRendererShadow,
    budget,
    rejectionReasonCounts,
  });
  if (qaResult?.serverSummary) {
    qaResult.serverSummary.timings = { ...diagnostics.timings };
    qaResult.serverSummary.responseBytes = { ...budget };
    console.info('[RecommendationQA_SERVER]', qaResult.serverSummary);
  }
  return responseData;
}

function buildRecommendationPerformanceLedger(diagnostics, budget, responseData) {
  const phases = Array.isArray(diagnostics.phases)
    ? diagnostics.phases.map((phase) => ({
        phase: String(phase.phase || ''),
        startAt: Number(phase.startAt) || 0,
        endAt: Number(phase.endAt) || 0,
        duration: Math.max(0, Number(phase.duration) || 0),
      }))
    : [];
  const phaseByName = new Map(phases.map((phase) => [phase.phase, phase]));
  const orderedPath = [
    'candidateGeneration',
    'cardCompilation',
    'snapshotPersistence',
    'candidatePoolPersistence',
    'presentationEnrichment',
    'exposurePersistence',
    'responseSerialization',
    'handlerEnd',
  ];
  const criticalPath = orderedPath.filter((phase) => phaseByName.has(phase));
  const handlerEnd = phaseByName.get('handlerEnd');
  const candidateGeneration = phaseByName.get('candidateGeneration');
  const cardCompilation = phaseByName.get('cardCompilation');
  const handlerStart = Number(diagnostics.handlerStartAt) || Number(diagnostics.startedAt) || 0;
  const handlerEndAt = handlerEnd?.endAt || Date.now();
  return {
    ledgerVersion: SERVER_LEDGER_VERSION,
    moduleInstanceId: MODULE_INSTANCE_ID,
    moduleLoadedAt: MODULE_LOADED_AT,
    handlerStart,
    handlerEnd: handlerEndAt,
    serverTotalMs: Math.max(0, handlerEndAt - handlerStart),
    phases,
    criticalPath,
    dbRoundTrips: Math.max(0, Number(diagnostics.databaseOps?.reads) || 0)
      + Math.max(0, Number(diagnostics.databaseOps?.writes) || 0),
    snapshotPayloadBytes: Math.max(0, Number(diagnostics.snapshotPayloadBytes) || 0),
    candidatePoolPayloadBytes: Math.max(0, Number(diagnostics.candidatePoolPayloadBytes) || 0),
    responsePayloadBytes: Math.max(0, Number(budget?.totalDataBytes) || 0),
    candidateMetrics: diagnostics.candidateMetrics || {},
    runtimeV2: diagnostics.runtimeV2?.enabled === true
      ? {
          enabled: true,
          tReadServerProxyMs: Number(phaseByName.get('userAndWardrobeRead')?.duration) || 0,
          tCoreInclusiveMs: Number(diagnostics.timings?.tCoreMs) || 0,
          tCorePhaseProxyMs: (Number(phaseByName.get('candidateGeneration')?.duration) || 0)
            + (Number(phaseByName.get('cardCompilation')?.duration) || 0),
          tSafeMs: Number(diagnostics.timings?.tSafeMs) || 0,
          tAiNecessaryCriticalPathMs: 0,
          aiOnNecessaryCriticalPath: diagnostics.runtimeV2.aiOnNecessaryCriticalPath === true,
          aiMaterializationMode: diagnostics.runtimeV2.aiMaterializationMode,
          plansReadyAt: Number(diagnostics.runtimeV2.plansReadyAt) || 0,
          safeReadyAt: Number(diagnostics.runtimeV2.safeReadyAt) || 0,
          canonicalCopy: diagnostics.canonicalCopyRuntimeV2 || {},
        }
      : { enabled: false },
    cardPreparation: {
      ...compactPerformanceNumbers(diagnostics.timings?.cardPreparation),
      toTempOutfitMs: Number(diagnostics.timings?.cardPreparation?.canonicalRecommendationConstructionMs) || 0,
      compileRecommendationLanguageV3Ms: Number(diagnostics.timings?.cardPreparation?.factPresentationPreparationMs) || 0,
      finalizeAcceptedRecommendationsMs: Number(diagnostics.timings?.cardPreparation?.finalizationMs) || 0,
      canonicalizeRecommendationBatchMs: Number(diagnostics.timings?.cardPreparation?.canonicalizationMs) || 0,
      snapshotSerializeInputMs: Number(diagnostics.timings?.cardPreparation?.snapshotInputConstructionMs) || 0,
      idMappingMs: Number(diagnostics.timings?.cardPreparation?.idMappingMs) || 0,
    },
    businessPayloadByteBreakdown: measureRecommendationResponseBreakdown(responseData, 20),
    cardCompilationStartDelayMs: candidateGeneration && cardCompilation
      ? Math.max(0, cardCompilation.startAt - candidateGeneration.endAt)
      : 0,
    snapshotPersistence: compactPerformanceNumbers({
      ...diagnostics.snapshotPersistence,
      ...diagnostics.snapshotPersistence?.snapshot,
      durationMs: phaseByName.get('snapshotPersistence')?.duration,
    }),
    candidatePoolPersistence: compactPerformanceNumbers({
      saveMs: diagnostics.timings?.candidatePoolSaveMs,
      planMs: diagnostics.timings?.candidatePoolPlanMs,
      serializationMs: diagnostics.timings?.candidatePoolSerializationMs,
      chunkWriteMs: diagnostics.timings?.candidatePoolChunkWriteMs,
      validationMs: diagnostics.timings?.candidatePoolValidationMs,
      manifestWriteMs: diagnostics.timings?.candidatePoolManifestWriteMs,
      dbReadCount: diagnostics.candidatePoolValidationReadCount,
      chunkCount: diagnostics.candidatePoolChunkCount,
    }),
  };
}

function compactPerformanceNumbers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => Number.isFinite(Number(entry)))
    .map(([key, entry]) => [key, Math.max(0, Number(entry))]));
}

function syncRecommendationResponseDiagnostics(data, timings, budget, qaBatchAudit) {
  data.debug.timings = { ...timings };
  data.debug.responseBytes = { ...budget };
    data.debug.qaTruncated = Boolean(qaBatchAudit?.qaTruncated);
  if (!qaBatchAudit) return;
  qaBatchAudit.timings = { ...timings };
  qaBatchAudit.responseBytes = { ...budget };
}

function stripResponseDiagnosticsForBusinessResponse(data, { performanceOnly = false } = {}) {
  if (!data?.debug || typeof data.debug !== 'object') return;
  for (const field of [
    'timings', 'responseBytes', 'phaseLedger', 'snapshotPersistence', 'databaseOps',
  ]) delete data.debug[field];
  if (performanceOnly) delete data.debug.candidatePoolSaveReason;
}

function measureRecommendationResponse(data) {
  const eligibilityRejectionAuditBytes = data.qaBatchAudit?.eligibilityRejectionAudit?.serializedBytes;
  return {
    outfitsBytes: serializedBytes(data.outfits || []),
    debugBytes: serializedBytes(data.debug || {}),
    qaBytes: serializedBytes(data.qaBatchAudit || {}),
    totalDataBytes: serializedBytes(data),
    ...(Number.isFinite(eligibilityRejectionAuditBytes)
      ? { eligibilityRejectionAuditBytes }
      : {}),
  };
}

function measureRecommendationResponseFields(data) {
  const source = data && typeof data === 'object' ? data : {};
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, serializedBytes(value)]));
}

function measureRecommendationResponseBreakdown(value, limit = 20) {
  const rows = [];
  const visit = (current, path) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = `${path}.${key}`;
      rows.push({ path: childPath, bytes: serializedBytes(child === undefined ? null : child) });
      if (child && typeof child === 'object' && !Array.isArray(child)) visit(child, childPath);
      if (Array.isArray(child)) {
        child.forEach((item, index) => {
          const itemPath = `${childPath}[${index + 1}]`;
          rows.push({ path: itemPath, bytes: serializedBytes(item === undefined ? null : item) });
          if (item && typeof item === 'object' && !Array.isArray(item)) visit(item, itemPath);
        });
      }
    }
  };
  visit(value, 'response');
  return rows.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path)).slice(0, limit);
}

function truncateQaForResponseBudget(audit) {
  audit.qaTruncated = true;
  if (audit.qaGateSummary) audit.qaGateSummary.qaTruncated = true;
  if (audit.eligibilityRejectionAudit) {
    fitEligibilityRejectionAuditToBudget(audit.eligibilityRejectionAudit);
  }
  delete audit.alternativeCandidates;
  delete audit.rejectionSamples;
  audit.rejectionReasonHistogram = (audit.rejectionReasonHistogram || []).slice(0, 4);
  audit.archetypeHistogram = (audit.archetypeHistogram || []).slice(0, 3);
}

function emitRecommendationServerDone({
  auditId,
  scene,
  debug,
  stylingIntelligenceShadow,
  recommendationVoiceRendererShadow,
  budget,
  rejectionReasonCounts,
}) {
  const payload = {
    auditId,
    scene,
    candidate: debug.candidateCount,
    accepted: debug.acceptedCount,
    rejected: debug.rejectedCount,
    selected: debug.selectedCount,
    topRejectionReasons: topRejectionReasons(rejectionReasonCounts),
    totalMs: debug.timings?.totalMs ?? null,
    responseBytes: budget.totalDataBytes,
    qaBytes: budget.qaBytes,
    buildVersion: CLOUD_BUILD_VERSION,
    ...(stylingIntelligenceShadow
      ? { stylingIntelligenceShadow }
      : {}),
    ...(recommendationVoiceRendererShadow
      ? { recommendationVoiceRendererShadow }
      : {}),
  };
  // Cloud logging formats nested objects with limited depth, which turns the
  // Shadow distribution and sampled cases into "[Object]". Emit the already
  // privacy-bounded payload as one JSON value so offline review can recover it.
  console.log('[RecommendationServerDone]', JSON.stringify(payload));
}

function topRejectionReasons(counts) {
  return Object.entries(counts || {})
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .map(([reason, count]) => ({ reason: String(reason).slice(0, 80), count: Number(count) }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, 8);
}

async function getOutfitDetail(event) {
  const source = event.source || event.type;
  if (source === 'favorite') return getFavoriteOutfitById(event.id);
  if (source === 'history') return getHistoryById(event.id);
  return getOutfit(event.id);
}

async function getOutfit(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const outfit = await db.collection('outfits').doc(id).get();
  if (!outfit.data || outfit.data._openid !== OPENID) throw new Error('outfit not found');
  const clothes = await loadClothesByIds(OPENID, outfit.data.clothingIds || []);
  return enrichSingleOutfitState(toOutfit(outfit.data, clothes), { openid: OPENID });
}

async function renameOutfit(event) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const nextUserTitle = normalizeUserTitleInput(event.userTitle);
  validateUserTitle(nextUserTitle);

  const payload = normalizeOutfitPayload(event.outfit);
  let current = null;

  if (event.outfitId) {
    try {
      const res = await db.collection('outfits').doc(event.outfitId).get();
      if (res.data && res.data._openid === OPENID) current = res.data;
    } catch {
      current = null;
    }
  }

  const lookupKey = event.outfitKey || payload?.outfitKey || getOutfitKey(readBaseClothingIds(payload));
  if (!current && lookupKey) {
    current = await findOutfitByKey(OPENID, lookupKey);
  }

  if (!current && payload && readBaseClothingIds(payload).length > 0) {
    current = await upsertOutfitByKey({
      openid: OPENID,
      base: payload,
      patch: {},
      now,
    });
  }

  if (!current) throw new Error('outfit not found');

  const title = current.title || payload?.title || `${current.scene || payload?.scene || '今日'}搭配`;
  const displayTitle = getDisplayTitle({ userTitle: nextUserTitle, title }, `${current.scene || payload?.scene || '今日'}搭配`);
  const data = {
    userTitle: nextUserTitle,
    displayTitle,
    updatedAt: now,
  };

  await db.collection('outfits').doc(current._id).update({ data });

  const updated = {
    ...current,
    ...data,
    title,
  };
  const clothes = await loadClothesByIds(OPENID, updated.clothingIds || []);
  return enrichSingleOutfitState(toOutfit(updated, clothes), {
    openid: OPENID,
    targetDate: updated.targetDate || payload?.targetDate,
  });
}

async function updateFavorite(id, isFavorite, outfitPayload) {
  if (!isFavorite) {
    return removeFavoriteOutfit(id);
  }

  return saveFavoriteOutfit(id, outfitPayload);
}

async function confirmWear(id, date, outfitPayload) {
  return addOutfitHistory({
    id,
    outfit: outfitPayload,
    source: outfitPayload && outfitPayload.isFavorite ? 'favorite' : 'recommendation',
    sourceFavoriteOutfitId: outfitPayload && outfitPayload.isFavorite ? id : undefined,
    date,
  });
}

async function listOutfits(event) {
  if (event.isFavorite === true) return listFavoriteOutfits(event);
  if (shouldListWorn(event)) return listOutfitHistory(event);
  return listFavoriteOutfits(event);
}

async function getAiComment(event) {
  const context = await buildAiCommentContext(event);
  const aiReviewDebug = createAiCommentDebug('getAiComment', context);
  logAiReviewDebug('start', aiReviewDebug);
  const review = await readAiReview(context.reviewId);
  const cacheDecision = buildAiReviewCacheDecision(review, context, normalizeAiComment);
  updateAiReviewDebug(aiReviewDebug, {
    cacheDecision,
    aiAttempted: false,
    saved: false,
  });
  logAiReviewDebug('cache', aiReviewDebug);
  logAiReviewDebug('result', aiReviewDebug);
  return buildAiReviewResponse(context, review, {
    cacheHit: cacheDecision === 'hit',
    saved: false,
    aiReviewDebug,
  });
}

async function generateAiComment(event) {
  let context = null;
  let lease = null;
  let aiReviewDebug = null;

  try {
    context = await buildAiCommentContext(event);
    aiReviewDebug = createAiCommentDebug('aiComment', context);
    logAiReviewDebug('start', aiReviewDebug);
    const forceRegenerate = event.forceRegenerate === true;
    lease = await acquireAiReviewLease(context, { forceRegenerate });
    updateAiReviewDebug(aiReviewDebug, {
      cacheDecision: getAiReviewCacheDecision(lease),
      aiAttempted: false,
      saved: false,
    });
    logAiReviewDebug('cache', aiReviewDebug);

    if (lease.cacheHit || lease.inProgress || lease.cooldown) {
      logAiReviewDebug('result', aiReviewDebug);
      return buildAiReviewResponse(context, lease.review, {
        cacheHit: Boolean(lease.cacheHit),
        saved: false,
        inProgress: Boolean(lease.inProgress),
        cooldown: Boolean(lease.cooldown),
        retryAfterMs: lease.retryAfterMs,
        errorCode: lease.inProgress ? 'AI_REVIEW_IN_PROGRESS' : lease.cooldown ? 'AI_REVIEW_COOLDOWN' : undefined,
        aiReviewDebug,
      });
    }

    const aiComment = await callAiCommentModel(context.evidenceInput, aiReviewDebug);
    let finishResult;
    try {
      finishResult = await finishAiReviewSuccess(context, lease.generationToken, aiComment);
    } catch (error) {
      updateAiReviewDebug(aiReviewDebug, {
        saved: false,
        errorCode: mapAiReviewErrorCode(error),
      });
      logAiReviewDebug('save', aiReviewDebug);
      throw error;
    }
    updateAiReviewDebug(aiReviewDebug, {
      fallbackUsed: aiComment.reviewSource === 'rule_fallback' || aiComment.source === 'rule_fallback',
      fallbackReason: aiComment.fallbackReason || '',
      saved: Boolean(finishResult.saved),
    });
    logAiReviewDebug('save', aiReviewDebug);
    const review = finishResult.review || await readAiReview(context.reviewId);
    logAiReviewDebug('result', aiReviewDebug);
    return buildAiReviewResponse(context, review, {
      cacheHit: false,
      saved: finishResult.saved,
      inProgress: finishResult.superseded && review?.status === 'generating',
      superseded: finishResult.superseded,
      aiReviewDebug,
    });
  } catch (error) {
    const errorCode = mapAiReviewErrorCode(error);
    if (aiReviewDebug) {
      const storageCause = error?.cause || error;
      updateAiReviewDebug(aiReviewDebug, {
        fallbackUsed: true,
        fallbackReason: getAiReviewFallbackReason(error),
        saved: false,
        errorCode,
        ...(errorCode === 'AI_REVIEW_STORAGE_UNAVAILABLE' || errorCode === 'AI_REVIEW_TRANSACTION_UNAVAILABLE'
          ? {
              storageErrorCode: String(storageCause?.errCode || storageCause?.code || storageCause?.name || ''),
              storageErrorMessage: String(storageCause?.errMsg || storageCause?.message || ''),
            }
          : {}),
      });
      logAiReviewDebug('fallback', aiReviewDebug);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[xiaoda-review]', 'fallback', {
        requestId: '',
        action: 'aiComment',
        cacheDecision: 'context_failed',
        aiAttempted: false,
        fallbackUsed: true,
        fallbackReason: 'context_failed',
        saved: false,
        errorCode,
      });
    }
    const failureResult = context && lease?.generationToken
      ? await finishAiReviewFailure(context, lease.generationToken).catch(() => null)
      : null;
    const review = failureResult?.review || (context ? await readAiReview(context.reviewId).catch(() => null) : null);
    if (aiReviewDebug) logAiReviewDebug('result', aiReviewDebug);
    return {
      ...buildAiReviewResponse(context, review, {
        cacheHit: false,
        saved: false,
        fallback: true,
        retainedPrevious: Boolean(failureResult?.restored),
        errorCode,
        aiReviewDebug,
      }),
      success: false,
      message: getSafeAiReviewMessage(errorCode),
    };
  }
}

async function buildAiCommentContext(event) {
  const { OPENID } = cloud.getWXContext();
  const payload = normalizeOutfitPayload(event.outfit);
  const payloadIds = uniqueStrings([
    ...readBaseClothingIds(payload),
    ...readStringArray(event.clothingIds),
  ]);
  const requestedScene = normalizeAiCommentScene(event.scene || payload?.scene);
  const requestedOutfitKey = normalizeOutfitKey(event.outfitKey || payload?.outfitKey);
  const payloadOutfitKey = payloadIds.length > 0 ? getOutfitKey(payloadIds) : '';
  if (requestedOutfitKey && payloadOutfitKey && requestedOutfitKey !== payloadOutfitKey) {
    throw new Error('invalid_outfit_key');
  }

  const lookupOutfitKey = requestedOutfitKey || payloadOutfitKey;
  if (!lookupOutfitKey) throw new Error('outfit identity is required');

  const assetSource = await findAuthoritativeAiCommentAsset(OPENID, event, payload, lookupOutfitKey, requestedScene);
  const loadedSource = assetSource
    ? await buildAiCommentSourceFromOutfitAsset(OPENID, assetSource.asset, requestedScene, {
        useSnapshotItems: assetSource.kind === 'favorite' || assetSource.kind === 'history',
      })
    : await buildAiCommentSourceFromOwnedClothes(OPENID, payload, {
        outfitKey: lookupOutfitKey,
        scene: requestedScene,
        weather: event.weather,
        scores: event.scores,
        aestheticEvaluation: event.aestheticEvaluation,
        reason: event.reason,
      });
  const source = alignAiCommentSourceWithRequestedPresentation(
    canonicalizeAiCommentSource(loadedSource),
    payload,
  );
  if (!source.aestheticEvaluation && payload?.aestheticEvaluation) {
    source.aestheticEvaluation = payload.aestheticEvaluation;
  }
  if (!source.scene) throw new Error('scene is required');

  const evidenceInput = buildStylistEvidenceV1({
    outfit: {
      clothingIds: source.clothingIds,
      items: source.items,
      scene: source.scene,
      weatherSnapshot: source.weather,
      scores: source.scores,
      styleTags: source.styleTags,
      aestheticEvaluation: source.aestheticEvaluation,
      outfitItemRoles: source.outfitItemRoles,
      contentPlan: source.contentPlan,
      contentPlanVersion: source.contentPlanVersion,
      sceneIntent: source.sceneIntent,
      primaryBenefitCode: source.primaryBenefitCode,
    },
    scene: source.scene,
    weather: source.weather,
  });
  const inputHash = evidenceInput.inputDigest;
  const reviewId = getAiReviewId(OPENID, source.outfitKey, source.scene);

  return {
    openid: OPENID,
    reviewId,
    outfitKey: source.outfitKey,
    scene: source.scene,
    inputHash,
    inputDigest: evidenceInput.inputDigest,
    evidenceInput,
    evidenceVersion: evidenceInput.evidenceVersion,
    contentPlanVersion: evidenceInput.contentPlan?.version,
    sceneIntent: evidenceInput.contentPlan?.sceneIntent,
    primaryBenefitCode: evidenceInput.contentPlan?.primaryBenefit,
    promptVersion: AI_COMMENT_PROMPT_VERSION,
    reviewVersion: STYLIST_REVIEW_VERSION,
    copyPolicyVersion: COPY_POLICY_VERSION,
    voicePolicyVersion: VOICE_POLICY_VERSION,
    provider: AI_COMMENT_PROVIDER,
    model: AI_COMMENT_MODEL,
  };
}

async function buildAiCommentSourceFromOutfitAsset(openid, asset, requestedScene, { useSnapshotItems = false } = {}) {
  const clothingIds = uniqueStrings(asset.clothingIds || []);
  const outfitKey = getOutfitKey(clothingIds);
  if (!outfitKey) throw new Error('outfit asset has no clothing ids');
  const scene = normalizeAiCommentScene(asset.scene || requestedScene);
  const clothes = useSnapshotItems ? [] : await loadClothesByIds(openid, clothingIds);
  const items = buildAiCommentItemsFromAsset(asset, clothes, { useSnapshotItems });
  if (!items.length) throw new Error('outfit asset has no comment items');

  return {
    outfitKey,
    scene,
    weather: normalizeWeather(asset.weatherSnapshot || asset.weather) || null,
    items,
    clothingIds,
    scores: sanitizeScores(asset.scores || {}),
    styleTags: readStringArray(asset.styleTags),
    aestheticEvaluation: asset.aestheticEvaluation,
    ...pickOutfitStoryFields(asset),
    reason: normalizeAiCommentReason(asset.reasoning || asset.reason),
  };
}

function canonicalizeAiCommentSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  const canonical = normalizeDefaultCopyAtResponseBoundary({
    ...source,
    weatherSnapshot: source.weatherSnapshot || source.weather,
  }, {
    scene: source.scene,
    weather: source.weatherSnapshot || source.weather,
    mode: 'saved_snapshot',
  });
  const canonicalStyleInsight = canonical.copyContract?.xiaodaStyleInsight || canonical.xiaodaStyleInsight;
  const canonicalContentPlan = canonical.contentPlan && canonicalStyleInsight
    ? { ...canonical.contentPlan, xiaodaStyleInsight: canonicalStyleInsight }
    : canonical.contentPlan;
  return {
    ...source,
    copyContract: canonical.copyContract,
    ...pickRecommendationCopyContractFields(canonical),
    ...pickOutfitStoryFields({ ...canonical, contentPlan: canonicalContentPlan }, source),
  };
}

function alignAiCommentSourceWithRequestedPresentation(source, payload) {
  if (!source || !payload) return source;
  const requestedPlan = normalizeContentPlan(payload.contentPlan);
  const requestedInsight = requestedPlan?.xiaodaStyleInsight;
  const contractInsight = payload.copyContract?.xiaodaStyleInsight;
  const currentPresentation = payload.copyContractVersion === COPY_CONTRACT_VERSION
    && payload.copyContract?.copyContractVersion === COPY_CONTRACT_VERSION
    && requestedInsight?.version === 'xiaoda-style-insight-v3'
    && contractInsight?.version === 'xiaoda-style-insight-v3'
    && requestedInsight.primary?.code
    && requestedInsight.primary.code === contractInsight.primary?.code;
  if (!currentPresentation) return source;
  return {
    ...source,
    contentPlan: requestedPlan,
    contentPlanVersion: requestedPlan.version,
    sceneIntent: requestedPlan.sceneIntent,
    primaryBenefitCode: requestedPlan.primaryBenefit,
  };
}

async function buildAiCommentSourceFromOwnedClothes(openid, payload, fallback) {
  const clothingIds = uniqueStrings(readBaseClothingIds(payload));
  if (!clothingIds.length) throw new Error('clothing ids are required');
  const outfitKey = getOutfitKey(clothingIds);
  if (fallback.outfitKey && fallback.outfitKey !== outfitKey) throw new Error('invalid_outfit_key');

  const clothes = await loadClothesByIds(openid, clothingIds);
  assertOwnedClothes(clothingIds, clothes);
  const scene = normalizeAiCommentScene(fallback.scene || payload?.scene);

  return {
    outfitKey,
    scene,
    weather: normalizeWeather(fallback.weather || payload?.weatherSnapshot || payload?.weather) || null,
    items: buildAiCommentItemsFromClothes(clothes),
    clothingIds,
    scores: sanitizeScores(fallback.scores || payload?.scores || {}),
    styleTags: readStringArray(payload?.styleTags),
    aestheticEvaluation: fallback.aestheticEvaluation || payload?.aestheticEvaluation,
    ...pickOutfitStoryFields(payload, fallback),
    reason: normalizeAiCommentReason(fallback.reason || payload?.reasoning || payload?.reason),
  };
}

function buildAiCommentItemsFromAsset(asset, clothes, { useSnapshotItems = false } = {}) {
  const clothesMap = new Map((clothes || []).map((item) => [item._id, item]));
  const snapshots = buildDetailedSnapshotItems(asset.clothingIds || [], {
    itemsSnapshot: asset.itemsSnapshot,
    snapshotItems: asset.snapshotItems,
    items: asset.items,
  });
  return snapshots
    .map((snapshot) => {
      const clothing = clothesMap.get(snapshot.clothingId);
      if (!useSnapshotItems && clothing && clothing.status !== DELETED_STATUS) {
        return buildAiCommentItemFromClothing(clothing);
      }
      return {
        id: snapshot.clothingId,
        type: limitText(snapshot.name || snapshot.type || snapshot.category, 24),
        color: limitText(snapshot.color, 24),
        style: limitText(snapshot.style, 48),
        thickness: limitText(snapshot.thickness, 24),
        material: limitText(snapshot.material, 24),
      };
    })
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildAiCommentItemsFromClothes(clothes) {
  return (clothes || [])
    .map(buildAiCommentItemFromClothing)
    .filter((item) => item.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildAiCommentItemFromClothing(item) {
  return {
    id: item._id,
    clothingId: item._id,
    category: item.category || '',
    subcategory: item.subcategory || item.subCategory || '',
    type: limitText(item.subcategory || item.subCategory || item.category || '', 24),
    color: limitText(readColorText(item), 24),
    colorPalette: Array.isArray(item.colorPalette) ? item.colorPalette : [],
    style: limitText(readArray(item.styleTags).join(' / '), 48),
    styleTags: readStringArray(item.styleTags),
    thickness: limitText(item.thickness || '', 24),
    material: limitText(item.material || item.materialGuess || '', 24),
    fit: item.fit,
    length: item.length,
    silhouette: item.silhouette,
    patternType: item.patternType,
    designElements: item.designElements,
    formalityLevel: item.formalityLevel,
    aestheticFeatures: item.aestheticFeatures,
  };
}

async function callAiCommentModel(
  input,
  aiReviewDebug,
  attempt = 1,
  retryReasons = [],
  retryRejectedTerms = [],
) {
  updateAiReviewDebug(aiReviewDebug, {
    aiAttempted: true,
    providerConfigured: isAiCommentProviderConfigured(),
    providerAttemptCount: attempt,
  });
  if (AI_COMMENT_PROVIDER !== 'aliyun-bailian') {
    updateAiReviewDebug(aiReviewDebug, {
      fallbackUsed: true,
      fallbackReason: 'provider_not_configured',
      errorCode: 'AI_REVIEW_PROVIDER_NOT_CONFIGURED',
    });
    throw createAiReviewServiceError('AI_REVIEW_PROVIDER_NOT_CONFIGURED');
  }

  const apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    updateAiReviewDebug(aiReviewDebug, {
      fallbackUsed: true,
      fallbackReason: 'provider_not_configured',
      errorCode: 'AI_REVIEW_PROVIDER_NOT_CONFIGURED',
    });
    throw createAiReviewServiceError('AI_REVIEW_PROVIDER_NOT_CONFIGURED');
  }

  const fetch = require('node-fetch');
  const prompt = buildStylistPromptV2(input, { retryReasons, retryRejectedTerms });
  updateAiReviewDebug(aiReviewDebug, {
    providerRequestStarted: true,
    providerConfigured: true,
  });
  logAiReviewDebug('provider_start', aiReviewDebug);
  let response;
  try {
    response = await fetch(`${BAILIAN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_COMMENT_MODEL,
        enable_thinking: false,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        temperature: attempt > 1 ? 0.1 : 0.3,
        max_tokens: 700,
        stream: false,
        response_format: { type: 'json_object' },
      }),
      timeout: AI_COMMENT_TIMEOUT_MS,
    });
  } catch (error) {
    updateAiReviewDebug(aiReviewDebug, {
      providerRequestFinished: true,
      providerStatus: 0,
    });
    logAiReviewDebug('provider_done', aiReviewDebug);
    throw createAiReviewServiceError('AI_REVIEW_PROVIDER_UNAVAILABLE', error);
  }
  updateAiReviewDebug(aiReviewDebug, {
    providerRequestFinished: true,
    providerStatus: response.status,
  });
  logAiReviewDebug('provider_done', aiReviewDebug);

  if (!response.ok) {
    throw createAiReviewServiceError(
      'AI_REVIEW_PROVIDER_UNAVAILABLE',
      new Error(`ai_comment_api_error_${response.status}`),
    );
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  let parsed;
  const jsonParsePassTrace = { check: 'json_parse', pass: true, detail: 'provider content parsed as JSON' };
  try {
    parsed = parseStylistExplanationJson(content);
    updateAiReviewDebug(aiReviewDebug, {
      aiRawSummary: createAiRawSummary({
        providerReturned: content !== undefined && content !== null,
        statusCode: response.status,
        rawText: content,
        parsedJson: true,
        parsedValue: parsed,
      }),
      validatorTrace: [jsonParsePassTrace],
    });
  } catch (error) {
    const safeRejectReasons = ['SCHEMA_PARSE_FAILED'];
    if (attempt < MAX_AI_COMMENT_PROVIDER_ATTEMPTS) {
      updateAiReviewDebug(aiReviewDebug, {
        validatorResult: 'retrying',
        validatorRejectReasons: safeRejectReasons,
        validatorTrace: [{ check: 'json_parse', pass: false, code: 'SCHEMA_PARSE_FAILED', detail: getValidatorRejectReason(error) }],
        fallbackUsed: false,
        fallbackReason: '',
      });
      logAiReviewDebug('validator_retry', aiReviewDebug);
      return callAiCommentModel(input, aiReviewDebug, attempt + 1, safeRejectReasons);
    }
    updateAiReviewDebug(aiReviewDebug, {
      aiRawSummary: createAiRawSummary({
        providerReturned: content !== undefined && content !== null,
        statusCode: response.status,
        rawText: content,
        parsedJson: false,
        parseErrorCode: 'SCHEMA_PARSE_FAILED',
      }),
      validatorResult: 'rejected',
      validatorRejectReasons: safeRejectReasons,
      validatorTrace: [{ check: 'json_parse', pass: false, code: 'SCHEMA_PARSE_FAILED', detail: getValidatorRejectReason(error) }],
      fallbackUsed: true,
      fallbackReason: 'validator_rejected',
    });
    logAiReviewDebug('validator', aiReviewDebug);
    logAiReviewDebug('fallback', aiReviewDebug);
    const serviceError = createAiReviewServiceError('AI_REVIEW_UNKNOWN', error);
    serviceError.validatorRejectReasons = safeRejectReasons;
    throw serviceError;
  }

  try {
    const explanation = validateStylistExplanationV2(parsed, input, {
      provider: AI_COMMENT_PROVIDER,
      model: AI_COMMENT_MODEL,
      generatedAt: new Date().toISOString(),
    });
    updateAiReviewDebug(aiReviewDebug, {
      validatorResult: explanation.partial ? 'accepted_partial' : 'accepted',
      validatorRejectReasons: explanation.partial ? explanation.adviceRejectReasons : [],
      validatorTrace: [
        jsonParsePassTrace,
        ...traceStylistExplanationValidationV2(parsed, input),
      ],
    });
    logAiReviewDebug('validator', aiReviewDebug);
    return toLegacyAiComment(explanation);
  } catch (error) {
    const validatorRejectReasons = readStringArray(error?.validatorRejectReasons);
    const fallbackTrace = Array.isArray(error?.validatorTrace) ? error.validatorTrace : traceStylistExplanationValidationV2(parsed, input);
    const traceRejectReasons = readStringArray(fallbackTrace
      .filter((entry) => entry && entry.pass === false && entry.code)
      .map((entry) => entry.code));
    const safeRejectReasons = validatorRejectReasons.length > 0
      ? validatorRejectReasons
      : traceRejectReasons.length > 0
        ? traceRejectReasons
      : [getValidatorRejectReason(error)];
    const safeRetryTerms = readSafeAiRetryTerms(fallbackTrace);
    if (attempt < MAX_AI_COMMENT_PROVIDER_ATTEMPTS) {
      updateAiReviewDebug(aiReviewDebug, {
        validatorResult: 'retrying',
        validatorRejectReasons: safeRejectReasons,
        validatorTrace: [jsonParsePassTrace, ...fallbackTrace],
        fallbackUsed: false,
        fallbackReason: '',
      });
      logAiReviewDebug('validator_retry', aiReviewDebug);
      return callAiCommentModel(
        input,
        aiReviewDebug,
        attempt + 1,
        safeRejectReasons,
        safeRetryTerms,
      );
    }
    updateAiReviewDebug(aiReviewDebug, {
      validatorResult: 'rejected',
      validatorRejectReasons: safeRejectReasons,
      validatorTrace: [
        jsonParsePassTrace,
        ...fallbackTrace,
      ],
      fallbackUsed: true,
      fallbackReason: 'validator_rejected',
    });
    logAiReviewDebug('validator', aiReviewDebug);
    logAiReviewDebug('fallback', aiReviewDebug);
    const serviceError = createAiReviewServiceError('AI_REVIEW_UNKNOWN', error);
    serviceError.validatorRejectReasons = safeRejectReasons;
    throw serviceError;
  }
}

function readSafeAiRetryTerms(trace) {
  const safeCodes = new Set(['MECHANICAL_COPY', 'UNSUPPORTED_SENSATION']);
  return [...new Set((Array.isArray(trace) ? trace : []).flatMap((entry) => {
    if (!entry || entry.pass !== false || !safeCodes.has(entry.code)) return [];
    const detail = typeof entry.detail === 'string' ? entry.detail : '';
    if (!detail.startsWith('matched:')) return [];
    return detail.slice('matched:'.length).split(',').map((term) => term.trim()).filter(Boolean);
  }))].slice(0, 8);
}

function normalizeAiComment(value) {
  if (!value || typeof value !== 'object') return null;
  const title = limitText(value.title, 16);
  const reason = limitText(value.reason, 160);
  const tip = limitText(value.tip, 80);
  const styleTags = readStringArray(value.styleTags)
    .map((tag) => limitText(tag, 12))
    .filter(Boolean)
    .slice(0, 5);

  if (!reason) return null;
  return {
    title,
    reason,
    styleTags,
    tip,
    generatedAt: value.generatedAt,
    ...(value.reviewVersion ? { reviewVersion: value.reviewVersion } : {}),
    ...(value.promptVersion ? { promptVersion: value.promptVersion } : {}),
    ...(value.copyPolicyVersion ? { copyPolicyVersion: value.copyPolicyVersion } : {}),
    ...(value.voicePolicyVersion ? { voicePolicyVersion: value.voicePolicyVersion } : {}),
    ...(value.inputDigest ? { inputDigest: value.inputDigest } : {}),
    ...(value.source ? { source: value.source } : {}),
    ...(value.overallComment ? { overallComment: limitText(value.overallComment, 120) } : {}),
    ...(value.advice ? { advice: limitText(value.advice, 80) } : {}),
    ...(value.explanationV2 ? { explanationV2: value.explanationV2 } : {}),
    ...(value.contentPlanVersion ? { contentPlanVersion: limitText(value.contentPlanVersion, 48) } : {}),
    ...(value.sceneIntent ? { sceneIntent: limitText(value.sceneIntent, 48) } : {}),
    ...(value.primaryBenefitCode ? { primaryBenefitCode: limitText(value.primaryBenefitCode, 64) } : {}),
    ...(value.reviewSource ? { reviewSource: limitText(value.reviewSource, 32) } : {}),
    ...(Array.isArray(value.validatorRejectReasons) ? { validatorRejectReasons: readStringArray(value.validatorRejectReasons) } : {}),
    partial: Boolean(value.partial),
    adviceRejectReasons: readStringArray(value.adviceRejectReasons),
  };
}

function isFallbackAiComment(aiComment) {
  return ['rule_fallback', 'cached_fallback'].includes(aiComment?.source)
    || ['rule_fallback', 'cached_fallback'].includes(aiComment?.reviewSource)
    || ['rule_fallback', 'cached_fallback'].includes(aiComment?.explanationV2?.source);
}

function isCurrentCanonicalRuleDefaultAiComment(value, outfit) {
  return outfit?.copyContractVersion === COPY_CONTRACT_VERSION
    && outfit?.reviewSource === 'rule_default'
    && value?.reviewSource === 'rule_default'
    && value?.overallComment === outfit?.copyContract?.detailExplanation
    && value?.advice === '';
}

function normalizeRecommendationAiComment(value, outfit) {
  return isCurrentCanonicalRuleDefaultAiComment(value, outfit) ? value : normalizeAiComment(value);
}

function normalizeOutfitItemRoles(value) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const id = limitText(item.id || item.itemId || item.clothingId, 80);
          const slot = limitText(item.slot || item.category, 32);
          const role = ['core', 'functional', 'optional'].includes(item.role) ? item.role : '';
          const displayName = limitText(item.displayName || item.name, 32);
          if (!id || !slot || !role || !displayName) return null;
          return { id, slot, role, displayName };
        })
        .filter(Boolean)
    : [];
}

function normalizeContentPlan(value) {
  if (!value || typeof value !== 'object') return undefined;
  const items = normalizeOutfitItemRoles(value.items);
  const sceneIntent = limitText(value.sceneIntent, 48);
  const primaryBenefit = limitText(value.primaryBenefit, 64);
  if (!value.version || !sceneIntent || !primaryBenefit || items.length === 0) return undefined;
  return {
    version: limitText(value.version, 48),
    ...(value.personaVersion ? { personaVersion: limitText(value.personaVersion, 48) } : {}),
    sceneIntent,
    items,
    observations: readStringArray(value.observations).slice(0, 8),
    primaryBenefit,
    ...(value.primaryRelationCode ? { primaryRelationCode: limitText(value.primaryRelationCode, 96) } : {}),
    ...(value.source ? { source: limitText(value.source, 48) } : {}),
    ...(value.presentationPlanVersion ? { presentationPlanVersion: limitText(value.presentationPlanVersion, 48) } : {}),
    ...(value.presentationFactSignature ? { presentationFactSignature: limitText(value.presentationFactSignature, 4096) } : {}),
    ...(value.selectedDifferentiator && typeof value.selectedDifferentiator === 'object'
      ? { selectedDifferentiator: value.selectedDifferentiator }
      : {}),
    todayAction: value.todayAction || null,
    todayDimension: value.todayDimension || null,
    todaySubjectItemIds: readStringArray(value.todaySubjectItemIds),
    todayEvidenceFactIds: readStringArray(value.todayEvidenceFactIds),
    todaySentenceClusterId: value.todaySentenceClusterId ?? null,
    detailAction: value.detailAction || null,
    detailDimension: value.detailDimension || null,
    detailSubjectItemIds: readStringArray(value.detailSubjectItemIds),
    detailEvidenceFactIds: readStringArray(value.detailEvidenceFactIds),
    detailSentenceClusterId: value.detailSentenceClusterId ?? null,
    detailDisplay: value.detailDisplay === 'visible' ? 'visible' : 'hidden',
    ...(value.secondaryBenefit ? { secondaryBenefit: limitText(value.secondaryBenefit, 64) } : {}),
    ...(value.suggestion && typeof value.suggestion === 'object' && value.suggestion.text
      ? { suggestion: { text: limitText(value.suggestion.text, 120) } }
      : { suggestion: null }),
    ...(value.defaultCopy && typeof value.defaultCopy === 'object'
      ? {
          defaultCopy: {
            todayReason: limitText(value.defaultCopy.todayReason, 160),
            ...(value.defaultCopy.detailExplanation
              ? { detailExplanation: limitText(value.defaultCopy.detailExplanation, 240) }
              : {}),
            aiExtraDefault: limitText(value.defaultCopy.aiExtraDefault, 240),
            usedInsightCodes: readStringArray(value.defaultCopy.usedInsightCodes).slice(0, 8),
            usedPhrases: readStringArray(value.defaultCopy.usedPhrases).slice(0, 8),
            ...(value.defaultCopy.angle ? { angle: limitText(value.defaultCopy.angle, 32) } : {}),
          },
        }
      : {}),
    ...(value.defaultTodayReason ? { defaultTodayReason: limitText(value.defaultTodayReason, 160) } : {}),
    ...(value.defaultDetailExplanation ? { defaultDetailExplanation: limitText(value.defaultDetailExplanation, 240) } : {}),
    ...(value.xiaodaStyleInsight && typeof value.xiaodaStyleInsight === 'object'
      ? { xiaodaStyleInsight: sanitizePlainObject(value.xiaodaStyleInsight) }
      : {}),
  };
}

function pickOutfitStoryFields(primary, fallback) {
  const contentPlan = normalizeContentPlan(primary?.contentPlan) || normalizeContentPlan(fallback?.contentPlan);
  const detailNarrativeViewModel = normalizeDetailNarrativeViewModel(primary?.detailNarrativeViewModel)
    || normalizeDetailNarrativeViewModel(fallback?.detailNarrativeViewModel)
    || buildDetailNarrativeFromContentPlan(contentPlan);
  const cardViewModel = normalizeCardViewModel(primary?.cardViewModel)
    || normalizeCardViewModel(fallback?.cardViewModel);
  const outfitItemRoles = normalizeOutfitItemRoles(primary?.outfitItemRoles).length
    ? normalizeOutfitItemRoles(primary.outfitItemRoles)
    : normalizeOutfitItemRoles(fallback?.outfitItemRoles);
  return {
    ...(outfitItemRoles.length ? { outfitItemRoles } : {}),
    ...(contentPlan ? { contentPlan } : {}),
    ...(cardViewModel ? { cardViewModel } : {}),
    ...(detailNarrativeViewModel ? { detailNarrativeViewModel } : {}),
    ...(primary?.contentPlanVersion || fallback?.contentPlanVersion ? { contentPlanVersion: primary?.contentPlanVersion || fallback?.contentPlanVersion } : {}),
    ...(primary?.sceneIntent || fallback?.sceneIntent ? { sceneIntent: primary?.sceneIntent || fallback?.sceneIntent } : {}),
    ...(primary?.primaryBenefitCode || primary?.primaryBenefit || fallback?.primaryBenefitCode || fallback?.primaryBenefit
      ? { primaryBenefitCode: primary?.primaryBenefitCode || primary?.primaryBenefit || fallback?.primaryBenefitCode || fallback?.primaryBenefit }
      : {}),
    ...(primary?.secondaryBenefit || fallback?.secondaryBenefit ? { secondaryBenefit: primary?.secondaryBenefit || fallback?.secondaryBenefit } : {}),
    ...(primary?.observationFocus || fallback?.observationFocus ? { observationFocus: primary?.observationFocus || fallback?.observationFocus } : {}),
    ...(primary?.reviewSource || fallback?.reviewSource ? { reviewSource: primary?.reviewSource || fallback?.reviewSource } : {}),
    ...(readStringArray(primary?.validatorRejectReasons).length || readStringArray(fallback?.validatorRejectReasons).length
      ? { validatorRejectReasons: readStringArray(primary?.validatorRejectReasons).length ? readStringArray(primary.validatorRejectReasons) : readStringArray(fallback?.validatorRejectReasons) }
      : {}),
    ...(primary?.cacheReuseReason || fallback?.cacheReuseReason ? { cacheReuseReason: primary?.cacheReuseReason || fallback?.cacheReuseReason } : {}),
  };
}

const COPY_CONTRACT_FIELDS = [
  'copyContract',
  'copyContractVersion',
  'voiceBankVersion',
  'todayClaim',
  'todayClaimId',
  'todayAction',
  'todayDimension',
  'todayEvidenceIds',
  'todayEvidenceFactIds',
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
  'detailEvidenceFactIds',
  'detailRequiredFactIds',
  'detailEvidenceSources',
  'detailSentenceClusterId',
  'detailSubjectItemId',
  'detailSubjectItemIds',
  'detailSlotBindings',
  'detailDisplay',
  'primaryRelationCode',
  'selectedDifferentiator',
  'presentationPlanVersion',
  'riskFlags',
  'copyGateResult',
  'copyRiskFlags',
  'copyDisplay',
  'defaultCopyHidden',
  'copyFinalizationMode',
  'qualification',
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
  'xiaodaStyleInsight',
];

function pickRecommendationCopyContractFields(primary, fallback) {
  const fields = {};
  for (const field of COPY_CONTRACT_FIELDS) {
    const value = primary?.[field] !== undefined ? primary[field] : fallback?.[field];
    if (value !== undefined) fields[field] = value;
  }
  return fields;
}

function normalizeCardViewModel(value) {
  if (!value || typeof value !== 'object') return undefined;
  const previewItems = Array.isArray(value.previewItems)
    ? value.previewItems.slice(0, 3).filter((item) => item && typeof item === 'object')
    : [];
  const hiddenItemCount = Math.max(0, Math.floor(Number(value.hiddenItemCount) || 0));
  if (previewItems.length === 0 && hiddenItemCount === 0) return undefined;
  return {
    previewItems,
    hiddenItemCount,
    layoutVariant: limitText(value.layoutVariant, 32) || (hiddenItemCount > 0 ? 'preview-3-plus' : `preview-${previewItems.length}`),
    totalItemCount: Math.max(previewItems.length + hiddenItemCount, Math.floor(Number(value.totalItemCount) || 0)),
  };
}

function normalizeDetailNarrativeViewModel(value) {
  if (!value || typeof value !== 'object') return undefined;
  const defaultText = limitText(value.defaultText, 240);
  if (!defaultText) return undefined;
  return {
    defaultText,
    source: limitText(value.source, 32) || 'content_plan',
    aiStatus: limitText(value.aiStatus, 32) || 'default',
  };
}

function buildDetailNarrativeFromContentPlan(contentPlan) {
  if (!contentPlan?.defaultDetailExplanation) return undefined;
  return {
    defaultText: contentPlan.defaultDetailExplanation,
    source: 'content_plan',
    aiStatus: 'default',
  };
}

function normalizeAestheticEvaluationForStorage(value) {
  if (!value || typeof value !== 'object') return undefined;
  const score = value.score === null ? null : normalizeFiniteNumber(value.score);
  const coverage = normalizeFiniteNumber(value.coverage);
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .filter((entry) => entry && typeof entry.code === 'string')
        .map((entry) => ({
          code: entry.code,
          polarity: ['positive', 'negative', 'neutral'].includes(entry.polarity) ? entry.polarity : 'neutral',
          strength: Math.max(1, Math.min(3, Math.round(Number(entry.strength) || 1))),
          itemIds: readStringArray(entry.itemIds).sort(),
          ...(entry.data && typeof entry.data === 'object' ? { data: sanitizePlainObject(entry.data) } : {}),
        }))
    : [];
  return {
    version: value.version || 1,
    engineVersion: value.engineVersion || 'aesthetic-compat-v1',
    score,
    coverage: coverage === null ? 0 : coverage,
    dimensions: value.dimensions && typeof value.dimensions === 'object' ? sanitizePlainObject(value.dimensions) : {},
    evidence,
  };
}

function sanitizePlainObject(value) {
  return JSON.parse(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'number' && !Number.isFinite(entry)) return null;
    if (typeof entry === 'function' || typeof entry === 'undefined') return undefined;
    return entry;
  }));
}

async function findAuthoritativeAiCommentAsset(openid, event, payload, outfitKey, scene) {
  const detailSource = normalizeAiCommentDetailSource(event.detailSource || payload?.outfitKind);
  const detailId = normalizeOutfitKey(event.detailId || payload?.id);
  const collectionName = {
    recommendation: 'outfits',
    favorite: 'favorite_outfits',
    history: 'outfit_history',
  }[detailSource];

  if (collectionName && detailId) {
    const exact = await readDocumentOrNull(db.collection(collectionName).doc(detailId));
    if (!exact || exact._openid !== openid) throw new Error('outfit detail asset not found');
    assertAiCommentAssetIdentity(exact, outfitKey, scene);
    return { asset: exact, kind: detailSource };
  }

  const res = await db.collection('outfits')
    .where({ _openid: openid, outfitKey })
    .limit(100)
    .get();
  const candidates = (res.data || [])
    .filter((item) => !scene || normalizeAiCommentScene(item.scene) === scene)
    .sort(compareAiCommentAssets);
  return candidates[0] ? { asset: candidates[0], kind: 'recommendation' } : null;
}

function assertAiCommentAssetIdentity(asset, outfitKey, scene) {
  const assetOutfitKey = getOutfitKey(uniqueStrings(asset.clothingIds || []));
  if (!assetOutfitKey || assetOutfitKey !== outfitKey) throw new Error('outfit detail identity mismatch');
  if (scene && normalizeAiCommentScene(asset.scene) !== scene) throw new Error('outfit detail scene mismatch');
}

function compareAiCommentAssets(left, right) {
  const leftTime = Date.parse(left.updatedAt || left.createdAt || '') || 0;
  const rightTime = Date.parse(right.updatedAt || right.createdAt || '') || 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return String(right._id || '').localeCompare(String(left._id || ''));
}

function normalizeAiCommentDetailSource(value) {
  return ['recommendation', 'favorite', 'history'].includes(value) ? value : '';
}

function assertOwnedClothes(expectedIds, clothes) {
  const expected = uniqueStrings(expectedIds);
  const returned = new Map((clothes || []).map((item) => [item._id, item]));
  if (returned.size !== expected.length) throw new Error('clothing ownership validation failed');
  for (const id of expected) {
    const item = returned.get(id);
    if (!item || item.status === DELETED_STATUS) throw new Error('clothing ownership validation failed');
  }
}

function normalizeAiCommentScene(value) {
  const normalized = limitText(value || '', 32);
  const alias = {
    home: '居家',
    work: '上班',
    date: '约会',
    sport: '运动',
    sports: '运动',
  }[normalized.toLowerCase()];
  const scene = alias || normalized;
  const allowed = ['上班', '开会', '出游', '约会', '逛街', '居家', '运动', '正式', '聚会'];
  if (scene && !allowed.includes(scene)) throw new Error('invalid scene');
  return scene;
}

function normalizeAiCommentReason(value) {
  return limitText(value || '', 160);
}

function normalizeOutfitKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAiReviewId(openid, outfitKey, scene) {
  return sha256(`${openid}|${outfitKey}|${scene}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createAiCommentDebug(action, context, requestId) {
  return createAiReviewDebug({
    requestId,
    action,
    outfitKey: context?.outfitKey,
    scene: context?.scene,
    provider: context?.provider || AI_COMMENT_PROVIDER,
    model: context?.model || AI_COMMENT_MODEL,
  });
}

function isAiCommentProviderConfigured() {
  return AI_COMMENT_PROVIDER === 'aliyun-bailian'
    && Boolean(process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY);
}

function getAiReviewCacheDecision(lease) {
  if (lease?.cacheHit) return 'hit';
  if (lease?.skippedFallback) return 'skip_fallback';
  if (lease?.inProgress) return 'in_progress';
  if (lease?.cooldown) return 'cooldown';
  if (lease?.acquired) return 'generate';
  return 'unknown';
}

function getAiReviewFallbackReason(error) {
  const errorCode = mapAiReviewErrorCode(error);
  if (errorCode === 'AI_REVIEW_PROVIDER_NOT_CONFIGURED') return 'provider_not_configured';
  if (errorCode === 'AI_REVIEW_PROVIDER_UNAVAILABLE') return 'provider_request_failed';
  if (errorCode === 'AI_REVIEW_STORAGE_UNAVAILABLE' || errorCode === 'AI_REVIEW_TRANSACTION_UNAVAILABLE') return 'save_failed';
  if (errorCode === 'AI_REVIEW_INCOMPLETE_INPUT') return 'incomplete_input';
  return 'unknown_error';
}

function getValidatorRejectReason(error) {
  const message = String(error?.message || '');
  if (/invalid_stylist_json/i.test(message)) return 'INVALID_JSON';
  if (/invalid_stylist_explanation/i.test(message)) return 'INVALID_STYLIST_EXPLANATION';
  return 'VALIDATOR_REJECTED';
}

async function readAiReview(reviewId) {
  if (!reviewId) return null;
  try {
    return await readDocumentOrNull(db.collection(AI_REVIEW_COLLECTION).doc(reviewId));
  } catch (error) {
    throw createAiReviewServiceError('AI_REVIEW_STORAGE_UNAVAILABLE', error);
  }
}

async function readDocumentOrNull(ref) {
  try {
    const res = await ref.get();
    return res.data || null;
  } catch (error) {
    if (isDocumentNotFoundError(error)) return null;
    throw error;
  }
}

function isDocumentNotFoundError(error) {
  const message = error && (error.errMsg || error.message || String(error));
  return /document with _id .* does not exist/i.test(String(message || ''));
}

function isReadyAiReview(review, context) {
  return isReusableAiReview(review, context, normalizeAiComment);
}

function isAiReviewStale(review, context) {
  if (!review) return false;
  if (review._openid !== context.openid) return true;
  if (review.outfitKey !== context.outfitKey || review.scene !== context.scene) return true;
  if (review.status !== 'ready') return true;
  if (review.inputHash !== context.inputHash) return true;
  if (review.promptVersion !== context.promptVersion) return true;
  if (review.reviewVersion !== context.reviewVersion) return true;
  if (review.copyPolicyVersion !== context.copyPolicyVersion) return true;
  if (review.voicePolicyVersion !== context.voicePolicyVersion) return true;
  return !normalizeAiComment(review.aiComment);
}

function buildAiReviewResponse(context, review, options = {}) {
  const aiComment = normalizeAiComment(review?.aiComment) || normalizeAiComment(options.fallbackAiComment) || null;
  const ready = context && isReadyAiReview(review, context);
  const fallbackReview = isFallbackAiReview(review) || isFallbackAiComment(aiComment);
  const stale = context ? isAiReviewStale(review, context) : false;
  return {
    success: !fallbackReview && !options.errorCode && Boolean(ready),
    aiComment: !fallbackReview && (ready || options.inProgress)
      ? aiComment
      : !fallbackReview && options.fallbackAiComment
        ? normalizeAiComment(options.fallbackAiComment)
        : null,
    review: review
      ? {
          reviewId: review._id || context?.reviewId,
          outfitKey: review.outfitKey,
          scene: review.scene,
          inputHash: review.inputHash,
          inputDigest: review.inputDigest || review.inputHash,
          schemaVersion: review.schemaVersion,
          reviewVersion: review.reviewVersion,
          promptVersion: review.promptVersion,
          copyPolicyVersion: review.copyPolicyVersion,
          voicePolicyVersion: review.voicePolicyVersion,
          evidenceVersion: review.evidenceVersion,
          source: review.source,
          explanationV2: review.explanationV2,
          reviewSource: review.source || aiComment?.reviewSource || aiComment?.source,
          contentPlanVersion: context?.contentPlanVersion || review.contentPlanVersion || aiComment?.contentPlanVersion,
          sceneIntent: context?.sceneIntent || review.sceneIntent || aiComment?.sceneIntent,
          primaryBenefitCode: context?.primaryBenefitCode || review.primaryBenefitCode || aiComment?.primaryBenefitCode,
          validatorRejectReasons: readStringArray(review.validatorRejectReasons || aiComment?.validatorRejectReasons),
          partial: Boolean(review.partial || aiComment?.partial),
          adviceRejectReasons: readStringArray(review.adviceRejectReasons || aiComment?.adviceRejectReasons),
          cacheReuseReason: options.cacheHit ? 'ready_review_match' : '',
          model: review.model,
          provider: review.provider,
          cacheable: review.cacheable,
          enhanced: review.enhanced,
          aiComment: fallbackReview ? null : aiComment,
          status: review.status,
          generatedAt: review.generatedAt,
          updatedAt: review.updatedAt,
        }
      : undefined,
    reviewId: context?.reviewId || review?._id || '',
    generatedAt: review?.generatedAt || options.fallbackAiComment?.generatedAt,
    cacheHit: Boolean(options.cacheHit),
    saved: Boolean(options.saved),
    stale,
    inProgress: Boolean(options.inProgress),
    superseded: Boolean(options.superseded),
    cooldown: Boolean(options.cooldown),
    retryAfterMs: options.retryAfterMs,
    aiReviewVersion: AI_REVIEW_VERSION,
    partial: Boolean(review?.partial || aiComment?.partial),
    adviceRejectReasons: readStringArray(review?.adviceRejectReasons || aiComment?.adviceRejectReasons),
    retainedPrevious: Boolean(options.retainedPrevious),
    promptVersion: context?.promptVersion || review?.promptVersion || AI_COMMENT_PROMPT_VERSION,
    reviewVersion: context?.reviewVersion || review?.reviewVersion,
    copyPolicyVersion: context?.copyPolicyVersion || review?.copyPolicyVersion,
    voicePolicyVersion: context?.voicePolicyVersion || review?.voicePolicyVersion,
    inputDigest: context?.inputDigest || review?.inputDigest || review?.inputHash,
    source: review?.source || aiComment?.source,
    reviewSource: review?.source || aiComment?.reviewSource || aiComment?.source,
    contentPlanVersion: context?.contentPlanVersion || review?.contentPlanVersion || aiComment?.contentPlanVersion,
    sceneIntent: context?.sceneIntent || review?.sceneIntent || aiComment?.sceneIntent,
    primaryBenefitCode: context?.primaryBenefitCode || review?.primaryBenefitCode || aiComment?.primaryBenefitCode,
    validatorRejectReasons: readStringArray(review?.validatorRejectReasons || aiComment?.validatorRejectReasons),
    cacheReuseReason: options.cacheHit ? 'ready_review_match' : options.inProgress ? 'generation_in_progress' : options.cooldown ? 'force_regenerate_cooldown' : '',
    model: context?.model || review?.model || AI_COMMENT_MODEL,
    cacheable: review?.cacheable,
    enhanced: fallbackReview ? false : review?.enhanced,
    errorCode: options.errorCode,
    aiReviewDebug: toSafeAiReviewDebug(options.aiReviewDebug),
  };
}

async function acquireAiReviewLease(context, { forceRegenerate }) {
  const now = new Date().toISOString();
  const generationToken = crypto.randomBytes(16).toString('hex');

  return runAiReviewTransaction(async (transaction) => {
      const ref = transaction.collection(AI_REVIEW_COLLECTION).doc(context.reviewId);
      const current = await readDocumentOrNull(ref);

      const skippedFallback = buildAiReviewCacheDecision(current, context, normalizeAiComment) === 'skip_fallback';

      if (!forceRegenerate && isReadyAiReview(current, context)) {
        return { cacheHit: true, review: current };
      }

      if (
        current?.status === 'generating'
        && current.promptVersion === context.promptVersion
        && current.copyPolicyVersion === context.copyPolicyVersion
        && current.voicePolicyVersion === context.voicePolicyVersion
        && current.inputDigest === context.inputDigest
        && isActiveGenerationLease(current.generationStartedAt)
      ) {
        return { inProgress: true, review: current };
      }

      const retryAfterMs = forceRegenerate && isReadyAiReview(current, context)
        ? getAiCommentForceCooldownRemaining(current)
        : 0;
      if (retryAfterMs > 0) {
        return { cooldown: true, retryAfterMs, review: current };
      }

      const previousReview = current?.status === 'ready' && !isFallbackAiReview(current)
        ? buildPreviousAiReviewSnapshot(current)
        : current?.previousReview && !isFallbackAiReview(current.previousReview)
          ? current.previousReview
          : null;

      const generatingData = buildAiReviewGeneratingData(context, {
        generationToken,
        now,
        previousReview,
      });

      const generatingDocument = buildAiReviewStoredDocument(
        current,
        generatingData,
        context,
        { createdAt: now },
      );
      await ref.set({ data: generatingDocument });

      return {
        acquired: true,
        skippedFallback,
        generationToken,
        review: {
          ...generatingDocument,
          _id: context.reviewId,
        },
      };
  });
}

function buildAiReviewGeneratingData(context, { generationToken, now, previousReview }) {
  return sanitizePlainObject({
    userId: context.openid,
    outfitKey: context.outfitKey,
    scene: context.scene,
    inputHash: context.inputHash,
    inputDigest: context.inputDigest,
    schemaVersion: 3,
    reviewVersion: context.reviewVersion,
    promptVersion: context.promptVersion,
    copyPolicyVersion: context.copyPolicyVersion,
    voicePolicyVersion: context.voicePolicyVersion,
    evidenceVersion: context.evidenceVersion,
    provider: context.provider,
    model: context.model,
    status: 'generating',
    generationToken,
    generationStartedAt: now,
    updatedAt: now,
    previousReview,
  });
}

async function finishAiReviewSuccess(context, generationToken, aiComment) {
  const now = new Date().toISOString();
  return runAiReviewTransaction(async (transaction) => {
    const ref = transaction.collection(AI_REVIEW_COLLECTION).doc(context.reviewId);
    const current = await readDocumentOrNull(ref);
    if (!isCurrentAiReviewGeneration(current, context, generationToken)) {
      return { saved: false, superseded: true, review: current };
    }

    const explanation = aiComment.explanationV2;
    if (!canPersistAiReviewAsReady(aiComment)) {
      throw createAiReviewServiceError('AI_REVIEW_UNKNOWN');
    }
    const readyData = {
      ...buildStylistReviewDocument({
        context,
        explanation,
        now,
      }),
      cacheable: true,
      enhanced: true,
      generationToken: null,
      generationStartedAt: null,
      previousReview: null,
    };
    const readyDocument = buildAiReviewReadyDocument(current, readyData, context);
    await ref.set({ data: readyDocument });
    return { saved: true, superseded: false, review: { ...readyDocument, _id: context.reviewId } };
  });
}

function buildAiReviewReadyDocument(current, readyData, context) {
  return buildAiReviewStoredDocument(current, readyData, context);
}

function buildAiReviewStoredDocument(current, nextData, context, options = {}) {
  const document = sanitizePlainObject({
    ...current,
    ...nextData,
    _openid: current?._openid || context.openid,
    createdAt: current?.createdAt || options.createdAt,
  });
  delete document._id;
  return document;
}

async function finishAiReviewFailure(context, generationToken) {
  const now = new Date().toISOString();
  return runAiReviewTransaction(async (transaction) => {
    const ref = transaction.collection(AI_REVIEW_COLLECTION).doc(context.reviewId);
    const current = await readDocumentOrNull(ref);
    if (!isCurrentAiReviewGeneration(current, context, generationToken)) {
      return { restored: false, superseded: true, review: current };
    }

    const settlement = resolveAiReviewFailureSettlement(current.previousReview, normalizeAiComment, now);
    const settledData = {
      ...settlement.data,
      generationToken: null,
      generationStartedAt: null,
      previousReview: null,
    };
    const settledDocument = buildAiReviewStoredDocument(current, settledData, context);
    await ref.set({ data: settledDocument });
    return {
      restored: settlement.restored,
      superseded: false,
      review: { ...settledDocument, _id: context.reviewId },
    };
  });
}

function buildPreviousAiReviewSnapshot(review) {
  return {
    aiComment: normalizeAiComment(review.aiComment),
    inputHash: review.inputHash,
    inputDigest: review.inputDigest,
    schemaVersion: review.schemaVersion,
    reviewVersion: review.reviewVersion,
    promptVersion: review.promptVersion,
    copyPolicyVersion: review.copyPolicyVersion,
    evidenceVersion: review.evidenceVersion,
    source: review.source,
    explanationV2: review.explanationV2,
    voicePolicyVersion: review.voicePolicyVersion,
    partial: Boolean(review.partial || review.aiComment?.partial),
    adviceRejectReasons: readStringArray(review.adviceRejectReasons || review.aiComment?.adviceRejectReasons),
    provider: review.provider,
    model: review.model,
    generatedAt: review.generatedAt,
    updatedAt: review.updatedAt,
  };
}

function isCurrentAiReviewGeneration(review, context, generationToken) {
  return Boolean(
    review
      && review.status === 'generating'
      && review.generationToken === generationToken
      && review._openid === context.openid
      && review.outfitKey === context.outfitKey
      && review.scene === context.scene
      && (!review.inputDigest || review.inputDigest === context.inputDigest),
  );
}

function getAiCommentForceCooldownRemaining(review) {
  const generatedAt = Date.parse(review.generatedAt || review.updatedAt || '');
  if (!Number.isFinite(generatedAt)) return 0;
  return Math.max(0, AI_COMMENT_FORCE_COOLDOWN_MS - (Date.now() - generatedAt));
}

function isActiveGenerationLease(generationStartedAt) {
  const startedAt = Date.parse(generationStartedAt || '');
  return Number.isFinite(startedAt) && Date.now() - startedAt < AI_COMMENT_LEASE_TIMEOUT_MS;
}

function assertTransactionSupport() {
  if (typeof db.runTransaction !== 'function') {
    throw createAiReviewServiceError('AI_REVIEW_TRANSACTION_UNAVAILABLE');
  }
}

async function runAiReviewTransaction(callback) {
  assertTransactionSupport();
  try {
    return await db.runTransaction(callback, 3);
  } catch (error) {
    if (isAiReviewServiceError(error)) throw error;
    throw createAiReviewServiceError('AI_REVIEW_STORAGE_UNAVAILABLE', error);
  }
}

function createSafeAiReviewClientError(code) {
  const error = new Error(getSafeAiReviewMessage(code));
  error.aiReviewCode = code;
  return error;
}

function limitText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function shouldListWorn(event) {
  return event.wornOnly === true;
}

async function assertOutfitOwner(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const res = await db.collection('outfits').doc(id).get();
  if (!res.data || res.data._openid !== OPENID) throw new Error('outfit not found');
  return res.data;
}

async function loadClothesByIds(openid, ids, database = db) {
  if (!ids.length) return [];
  const res = await database.collection('clothes').where({ _openid: openid, _id: db.command.in(ids) }).limit(100).get();
  return res.data;
}

async function assertOutfitClothesAvailable(openid, clothingIds, database = db) {
  const expectedIds = uniqueStrings(clothingIds);
  const clothes = await loadClothesByIds(openid, expectedIds, database);
  const availableIds = new Set(
    clothes
      .filter((item) => item && item.status !== DELETED_STATUS)
      .map((item) => item._id),
  );
  if (expectedIds.some((id) => !availableIds.has(id))) {
    throw createBusinessError(
      'OUTFIT_CONTAINS_DELETED_CLOTHES',
      '这套搭配有衣物已移出衣橱，暂时不能继续使用',
    );
  }
}

async function runOutfitReferenceTransaction(callback, timing) {
  if (typeof db.runTransaction !== 'function') {
    throw createBusinessError('OUTFIT_REFERENCE_TRANSACTION_UNAVAILABLE', '操作暂时不可用，请稍后再试');
  }
  const transactionStartedAt = Date.now();
  let callbackCompletedAt = 0;
  try {
    const result = await db.runTransaction(async (transaction) => {
      const callbackStartedAt = Date.now();
      const value = await callback(transaction);
      callbackCompletedAt = Date.now();
      if (timing) timing.transactionCallbackMs += callbackCompletedAt - callbackStartedAt;
      return value;
    }, 3);
    if (timing) {
      timing.transactionMs = Date.now() - transactionStartedAt;
      timing.commitMs += callbackCompletedAt > 0 ? Date.now() - callbackCompletedAt : 0;
    }
    return result;
  } catch (error) {
    if (error && error.businessCode) throw error;
    const wrapped = createBusinessError('OUTFIT_REFERENCE_WRITE_FAILED', '操作暂时失败，请稍后再试');
    wrapped.cause = serializeOutfitReferenceCause(error, {
      stage: error?.outfitReferenceStage || 'transaction_start_or_commit',
    });
    throw wrapped;
  }
}

function serializeOutfitReferenceCause(error, fallback = {}) {
  const source = error && typeof error === 'object' ? error : { message: String(error || '') };
  return {
    errorName: safeOutfitReferenceField(source.errorName ?? source.name, 80),
    errCode: safeOutfitReferenceField(source.errCode ?? source.code, 80),
    errMsg: safeOutfitReferenceField(source.errMsg ?? source.message, 240),
    stage: safeOutfitReferenceField(source.outfitReferenceStage ?? source.stage ?? fallback.stage, 120),
    operation: safeOutfitReferenceField(source.operation ?? fallback.operation, 80),
    collection: safeOutfitReferenceField(source.collection ?? fallback.collection, 120),
    documentId: safeOutfitReferenceField(source.outfitReferenceDocumentId ?? source.documentId ?? fallback.documentId, 160),
    outfitKey: safeOutfitReferenceField(source.outfitReferenceKey ?? source.outfitKey ?? fallback.outfitKey, 240),
    requestId: safeOutfitReferenceField(source.requestId ?? fallback.requestId, 160),
    stack: limitOutfitReferenceStack(source.stack),
  };
}

function safeOutfitReferenceField(value, maxLength) {
  if (typeof value === 'string') return value.slice(0, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function limitOutfitReferenceStack(stack) {
  if (typeof stack !== 'string') return null;
  return stack.split(/\r?\n/).slice(0, 8).join('\n').slice(0, 1500);
}

function getSafeOutfitReferenceCause(cause) {
  if (!cause || typeof cause !== 'object') return null;
  return serializeOutfitReferenceCause(cause);
}

function annotateOutfitReferenceCause(error, details = {}) {
  if (error && typeof error === 'object') {
    if (details.stage) error.outfitReferenceStage = details.stage;
    if (details.operation) error.operation = details.operation;
    if (details.collection) error.collection = details.collection;
    if (details.documentId) error.outfitReferenceDocumentId = details.documentId;
    if (details.outfitKey) error.outfitReferenceKey = details.outfitKey;
  }
  return error;
}

async function saveFavoriteOutfit(id, outfitPayload, aiCommentPayload) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const base = normalizeOutfitPayload(outfitPayload);
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  const outfitKey = getOutfitKey(clothingIds);
  const recordData = buildSnapshotRecordData(base, {
    aiComment: aiCommentPayload || base.aiComment,
    outfitKey,
    now,
    source: base.source === 'history' ? 'history' : 'recommendation',
  });
  const saved = await runOutfitReferenceTransaction(async (transaction) => {
    await assertOutfitClothesAvailable(OPENID, clothingIds, transaction);
    const existing = await findFavoriteByKey(OPENID, outfitKey, transaction);
    if (existing) {
      const data = { ...recordData, updatedAt: now, deletedAt: null };
      await transaction.collection('favorite_outfits').doc(existing._id).update({ data });
      return { ...existing, ...data };
    }

    const addData = {
      _openid: OPENID,
      userId: OPENID,
      ...recordData,
      createdAt: now,
      updatedAt: now,
    };
    const addRes = await transaction.collection('favorite_outfits').add({ data: addData });
    return { ...addData, _id: addRes._id };
  });
  return enrichSingleOutfitState(toSnapshotOutfit(saved, 'favorite'), {
    openid: OPENID,
    targetDate: base.targetDate,
  });
}

async function removeFavoriteOutfit(id, outfitKey) {
  const { OPENID } = cloud.getWXContext();
  if (!id && !outfitKey) throw new Error('favoriteOutfitId is required');
  let favorite = null;

  if (id) {
    try {
      const res = await db.collection('favorite_outfits').doc(id).get();
      if (res.data && res.data._openid === OPENID) favorite = res.data;
    } catch {
      favorite = null;
    }
  }

  if (!favorite && outfitKey) {
    favorite = await findFavoriteByKey(OPENID, outfitKey);
  }

  if (!favorite || favorite.deletedAt) {
    return { success: true, id, outfitKey, alreadyRemoved: true };
  }

  await db.collection('favorite_outfits').doc(favorite._id).remove();
  return { success: true, id: favorite._id, outfitKey: favorite.outfitKey };
}

async function listFavoriteOutfits(event) {
  const { OPENID } = cloud.getWXContext();
  const startedAt = Date.now();
  const page = Math.max(Number(event.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
  const query = db.collection('favorite_outfits')
    .where({ _openid: OPENID });
  const [totalRes, pageRes] = await Promise.all([
    query.count(),
    query
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get(),
  ]);
  const pageList = (pageRes.data || []).filter((item) => !item.deletedAt);
  const outfits = await enrichOutfitsState(pageList.map((item) => toSnapshotOutfit(item, 'favorite')), {
    openid: OPENID,
    targetDate: new Date().toISOString().slice(0, 10),
  });

  console.log('[generateOutfit] listFavoriteOutfits', {
    page,
    pageSize,
    returned: outfits.length,
    total: totalRes.total,
    durationMs: Date.now() - startedAt,
  });

  return {
    list: outfits,
    hasMore: page * pageSize < totalRes.total,
    pagination: {
      total: totalRes.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRes.total / pageSize)),
    },
  };
}

async function addOutfitHistory(event) {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();
  const base = normalizeOutfitPayload(event.outfit);
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  const source = event.source === 'favorite' ? 'favorite' : 'recommendation';
  const sourceFavoriteOutfitId = source === 'favorite'
    ? event.sourceFavoriteOutfitId || event.id || base.id
    : null;
  const targetDate = event.date || base.targetDate || now.slice(0, 10);
  const outfitKey = getOutfitKey(clothingIds);
  const recordData = buildSnapshotRecordData(base, {
    aiComment: event.aiComment || base.aiComment,
    outfitKey,
    now,
    source,
  });
  const saved = await runOutfitReferenceTransaction(async (transaction) => {
    await assertOutfitClothesAvailable(OPENID, clothingIds, transaction);
    const existing = await findTodayHistoryByKey(OPENID, outfitKey, targetDate, transaction);
    if (existing) return existing;

    const addData = {
      _openid: OPENID,
      userId: OPENID,
      ...recordData,
      source,
      sourceFavoriteOutfitId,
      wearDate: targetDate,
      targetDate,
      wornAt: now,
      createdAt: now,
    };
    const addRes = await transaction.collection('outfit_history').add({ data: addData });
    return { ...addData, _id: addRes._id };
  });
  return enrichSingleOutfitState(toSnapshotOutfit(saved, 'history'), {
    openid: OPENID,
    targetDate,
  });
}

async function listOutfitHistory(event) {
  const { OPENID } = cloud.getWXContext();
  const startedAt = Date.now();
  const page = Math.max(Number(event.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize || 10), 1), 50);
  const query = db.collection('outfit_history')
    .where({ _openid: OPENID });
  const [totalRes, pageRes] = await Promise.all([
    query.count(),
    query
      .orderBy('wornAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get(),
  ]);
  const pageList = pageRes.data || [];
  const outfits = await enrichOutfitsState(pageList.map((item) => toSnapshotOutfit(item, 'history')), {
    openid: OPENID,
    targetDate: new Date().toISOString().slice(0, 10),
  });

  console.log('[generateOutfit] listOutfitHistory', {
    page,
    pageSize,
    returned: outfits.length,
    total: totalRes.total,
    durationMs: Date.now() - startedAt,
  });

  return {
    list: outfits,
    page,
    pageSize,
    hasMore: page * pageSize < totalRes.total,
    pagination: {
      total: totalRes.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRes.total / pageSize)),
    },
  };
}

function getHistorySortTime(item) {
  const value = item?.wornAt || item?.createdAt || '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function createRecommendationBatchId(now) {
  return `batch:${now}:${Math.random().toString(36).slice(2, 10)}`;
}

async function enrichOutfitsState(outfits, {
  openid,
  targetDate,
  generatedAt,
  recommendationBatchId,
  copyMode = 'saved_snapshot',
  canonicalCopyEnabled = true,
  assetRecords,
}) {
  const keys = uniqueStrings(outfits.map((outfit) => outfit.outfitKey || getOutfitKey(outfit.clothingIds || [])));
  const [favoriteMap, historyMap, loadedAssetMap] = await Promise.all([
    findFavoritesByKeys(openid, keys),
    findTodayHistoryByKeys(openid, keys, targetDate),
    Array.isArray(assetRecords) ? Promise.resolve(null) : findOutfitsByKeys(openid, keys),
  ]);
  const assetMap = loadedAssetMap || buildOutfitRecordMap(assetRecords);

  return outfits.map((outfit) => {
    const clothingIds = outfit.clothingIds || [];
    const outfitKey = outfit.outfitKey || getOutfitKey(clothingIds);
    const favorite = favoriteMap.get(outfitKey);
    const history = historyMap.get(outfitKey);
    const asset = assetMap.get(outfitKey);
    const { title, userTitle, displayTitle } = resolveEnrichedTitleState(outfit, asset, copyMode);
    const enriched = {
      ...outfit,
      outfitId: outfit.outfitId || asset?._id || (outfit.outfitKind === 'recommendation' ? outfit.id : undefined),
      outfitKey,
      title,
      userTitle,
      displayTitle,
      isFavorite: Boolean(favorite),
      favoriteOutfitId: favorite?._id || undefined,
      favoritedAt: favorite?.createdAt || favorite?.favoritedAt || undefined,
      isWornToday: Boolean(history),
      todayHistoryId: history?._id || undefined,
      historyId: history?._id || outfit.historyId,
      lastWornAt: history?.wornAt || outfit.lastWornAt || outfit.wornAt,
      wornAt: outfit.wornAt || history?.wornAt,
      wornDate: outfit.wornDate || (history?.wornAt ? String(history.wornAt).slice(0, 10) : undefined),
      recommendationBatchId: outfit.recommendationBatchId || recommendationBatchId,
      generatedAt: outfit.generatedAt || generatedAt,
    };
    const canonicalCopy = resolveCanonicalCopyForStorage(outfit, asset, {
      allowCachedFallback: canonicalCopyEnabled,
    });
    const withCanonicalCopy = canonicalCopy
      ? applyCanonicalCopyToOutfit(enriched, canonicalCopy)
      : enriched;
    return normalizeDefaultCopyAtResponseBoundary(withCanonicalCopy, {
      scene: withCanonicalCopy.scene,
      weather: withCanonicalCopy.weatherSnapshot || withCanonicalCopy.weather,
      mode: copyMode,
    });
  });
}

function resolveEnrichedTitleState(outfit, asset, copyMode) {
  const userTitle = readTitle(outfit?.userTitle) || readTitle(asset?.userTitle) || undefined;
  if (copyMode === FINALIZATION_MODES.NEW_RECOMMENDATION) {
    const canonicalTitle = readTitle(outfit?.title);
    return {
      title: canonicalTitle,
      userTitle,
      displayTitle: canonicalTitle,
    };
  }
  const title = readTitle(outfit?.title) || readTitle(asset?.title);
  return {
    title,
    userTitle,
    displayTitle: getDisplayTitle(
      { userTitle, title: title || outfit?.displayTitle },
      `${outfit?.scene || asset?.scene || '今日'}搭配`,
    ),
  };
}

function buildOutfitRecordMap(records) {
  const map = new Map();
  for (const item of Array.isArray(records) ? records : []) {
    if (item?.outfitKey) map.set(item.outfitKey, item);
  }
  return map;
}

async function enrichSingleOutfitState(outfit, { openid, targetDate }) {
  const enriched = await enrichOutfitsState([outfit], {
    openid,
    targetDate: targetDate || new Date().toISOString().slice(0, 10),
    generatedAt: outfit.generatedAt || outfit.createdAt || new Date().toISOString(),
    recommendationBatchId: outfit.recommendationBatchId,
  });
  return enriched[0];
}

async function findFavoritesByKeys(openid, outfitKeys) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await db.collection('favorite_outfits')
    .where({ _openid: openid, outfitKey: db.command.in(keys) })
    .limit(100)
    .get();
  for (const item of res.data || []) {
    if (item.deletedAt || !item.outfitKey) continue;
    const current = map.get(item.outfitKey);
    if (!current || getHistorySortTime(item) > getHistorySortTime(current)) {
      map.set(item.outfitKey, item);
    }
  }
  return map;
}

async function findOutfitsByKeys(openid, outfitKeys) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await db.collection('outfits')
    .where({ _openid: openid, outfitKey: db.command.in(keys) })
    .limit(100)
    .get();
  for (const item of res.data || []) {
    if (!item.outfitKey) continue;
    map.set(item.outfitKey, item);
  }
  return map;
}

async function findTodayHistoryByKeys(openid, outfitKeys, targetDate, database = db) {
  const map = new Map();
  const keys = uniqueStrings(outfitKeys);
  if (!keys.length) return map;
  const res = await database.collection('outfit_history')
    .where({ _openid: openid, outfitKey: db.command.in(keys) })
    .limit(500)
    .get();
  for (const item of res.data || []) {
    if (!item.outfitKey || !isHistoryOnDate(item, targetDate)) continue;
    const current = map.get(item.outfitKey);
    if (!current || getHistorySortTime(item) > getHistorySortTime(current)) {
      map.set(item.outfitKey, item);
    }
  }
  return map;
}

async function findTodayHistoryByKey(openid, outfitKey, targetDate, database = db) {
  const map = await findTodayHistoryByKeys(openid, [outfitKey], targetDate, database);
  return map.get(outfitKey) || null;
}

function isHistoryOnDate(item, targetDate) {
  const candidates = [item.wearDate, item.wornDate, item.targetDate, item.wornAt, item.createdAt].filter(Boolean);
  return candidates.some((value) => String(value).slice(0, 10) === targetDate);
}

async function saveOutfitExposures({ openid, outfits, scene, batchId, shownAt }) {
  const uniqueOutfits = [];
  const seen = new Set();
  for (const outfit of outfits || []) {
    const outfitKey = outfit.outfitKey || getOutfitKey(outfit.clothingIds || []);
    if (!outfitKey || seen.has(outfitKey)) continue;
    seen.add(outfitKey);
    uniqueOutfits.push(outfitKey);
  }

  await Promise.all(uniqueOutfits.map(async (outfitKey) => {
    try {
      await db.collection('outfit_exposures').add({
        data: {
          _openid: openid,
          userId: openid,
          outfitKey,
          scene: scene || '',
          batchId,
          shownAt,
          createdAt: shownAt,
        },
      });
    } catch {
      // Exposure is best-effort telemetry and must not block recommendations.
    }
  }));
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

async function getFavoriteOutfitById(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const res = await db.collection('favorite_outfits').doc(id).get();
  if (!res.data || res.data._openid !== OPENID || res.data.deletedAt) throw new Error('favorite outfit not found');
  return enrichSingleOutfitState(toSnapshotOutfit(res.data, 'favorite'), { openid: OPENID });
}

async function getHistoryById(id) {
  const { OPENID } = cloud.getWXContext();
  if (!id) throw new Error('id is required');
  const res = await db.collection('outfit_history').doc(id).get();
  if (!res.data || res.data._openid !== OPENID) throw new Error('history record not found');
  return enrichSingleOutfitState(toSnapshotOutfit(res.data, 'history'), { openid: OPENID });
}

async function findFavoriteByKey(openid, outfitKey, database = db) {
  const res = await database.collection('favorite_outfits')
    .where({ _openid: openid, outfitKey })
    .limit(1)
    .get();
  return res.data[0] || null;
}

function buildSnapshotRecordData(base, { aiComment, outfitKey, now, source }) {
  const clothingIds = readBaseClothingIds(base);
  const itemsSnapshot = buildDetailedSnapshotItems(clothingIds, base);
  const reason = base.reason || base.reasoning || '';
  const reasoning = base.reasoning || base.reason || '';
  const reviewCandidate = { ...base, aiComment };
  const realAiReviewSource = resolveRealAiReviewSource(reviewCandidate);
  const reviewFields = mapAiReviewAtBoundary(
    reviewCandidate,
    (value) => normalizeRecommendationAiComment(value, reviewCandidate),
  );
  if (
    reviewFields.aiComment
    && !realAiReviewSource
    && !isCurrentCanonicalRuleDefaultAiComment(reviewFields.aiComment, reviewCandidate)
    && !reviewFields.aiComment.generatedAt
  ) {
    reviewFields.aiComment = { ...reviewFields.aiComment, generatedAt: now };
  }
  const aestheticEvaluation = normalizeAestheticEvaluationForStorage(base.aestheticEvaluation);
  const fallbackTitle = `${base.scene || '今日'}搭配`;

  return {
    title: base.title || fallbackTitle,
    userTitle: readTitle(base.userTitle),
    displayTitle: getDisplayTitle(base, fallbackTitle),
    outfitId: base.outfitId || base.id,
    clothingIds,
    outfitKey,
    itemsSnapshot,
    snapshotItems: itemsSnapshot.map((item) => ({
      itemId: item.clothingId,
      name: item.name || item.category || '衣服',
      category: item.category || 'other',
      color: item.color || '',
      imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
      displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
      thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
      isDeleted: Boolean(item.deletedAt),
      ...pickCopyEvidenceSnapshotFields(item),
    })),
    scene: base.scene,
    targetDate: base.targetDate,
    timeOfDay: base.timeOfDay || 'all_day',
    ...((base.weatherSnapshot || base.weather)
      ? {
          weather: base.weatherSnapshot || base.weather,
          weatherSnapshot: base.weatherSnapshot || base.weather,
        }
      : {}),
    weatherMode: base.weatherMode || ((base.weatherSnapshot || base.weather) ? 'live' : 'unavailable'),
    eligibility: base.eligibility,
    eligibilityReason: cloneEligibilityReason(base.eligibilityReason),
    scores: sanitizeScores(base.scores || {}),
    ...(aestheticEvaluation ? { aestheticEvaluation } : {}),
    scoreExplanations: Array.isArray(base.scoreExplanations) ? base.scoreExplanations : [],
    generationType: base.generationType || 'auto',
    source: source || base.source || 'recommendation',
    reason,
    reasoning,
    ...(base.reasonVersion ? { reasonVersion: base.reasonVersion } : {}),
    ...pickRecommendationCopyContractFields(base),
    ...pickOutfitStoryFields(base),
    ...(base.canonicalRecommendationCopyV2
      ? { canonicalRecommendationCopyV2: base.canonicalRecommendationCopyV2 }
      : {}),
    ...reviewFields,
  };
}

function buildDetailedSnapshotItems(clothingIds, base) {
  const snapshots = [
    ...normalizeDetailedSnapshotItems(base?.itemsSnapshot),
    ...normalizeDetailedSnapshotItems(base?.snapshotItems),
    ...normalizeDetailedPayloadItems(base?.items),
  ];
  const snapshotMap = new Map(snapshots.map((item) => [item.clothingId, item]));

  return clothingIds.map((id) => {
    const snapshot = snapshotMap.get(id);
    return {
      clothingId: id,
      itemId: id,
      type: snapshot?.type || snapshot?.category || 'other',
      category: snapshot?.category || 'other',
      color: snapshot?.color || '',
      style: snapshot?.style || '',
      thickness: snapshot?.thickness || '',
      material: snapshot?.material || '',
      imageUrl: snapshot?.imageUrl || snapshot?.displayImageUrl || snapshot?.thumbnailUrl || '',
      displayImageUrl: snapshot?.displayImageUrl || snapshot?.imageUrl || snapshot?.thumbnailUrl || '',
      thumbnailUrl: snapshot?.thumbnailUrl || snapshot?.displayImageUrl || snapshot?.imageUrl || '',
      name: snapshot?.name || snapshot?.category || '衣服',
      deletedAt: snapshot?.deletedAt || null,
      ...pickCopyEvidenceSnapshotFields(snapshot),
    };
  });
}

function normalizeDetailedSnapshotItems(value) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const clothingId = item && (item.clothingId || item.itemId);
          if (!clothingId || typeof clothingId !== 'string') return null;
          return {
            clothingId,
            itemId: clothingId,
            type: item.type || item.subcategory || item.name || item.category || 'other',
            category: item.category || item.type || 'other',
            color: item.color || '',
            style: item.style || readArray(item.styleTags).join(' / '),
            thickness: item.thickness || '',
            material: item.material || '',
            imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
            displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
            thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
            name: item.name || item.subcategory || item.category || '衣服',
            deletedAt: item.deletedAt || (item.isDeleted ? new Date().toISOString() : null),
            ...pickCopyEvidenceSnapshotFields(item),
          };
        })
        .filter(Boolean)
    : [];
}

function normalizeDetailedPayloadItems(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.clothingId === 'string')
        .map((item) => ({
          clothingId: item.clothingId,
          itemId: item.clothingId,
          type: item.subcategory || item.category || 'other',
          category: item.category || 'other',
          color: readColorText(item),
          style: readArray(item.styleTags).join(' / '),
          thickness: item.thickness || '',
          material: item.material || item.materialGuess || '',
          imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
          displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
          thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
          name: item.name || item.subcategory || item.category || '衣服',
          deletedAt: item.deletedAt || (item.isDeleted ? new Date().toISOString() : null),
          ...pickCopyEvidenceSnapshotFields(item),
        }))
    : [];
}

function toSnapshotOutfit(item, kind) {
  const itemsSnapshot = buildDetailedSnapshotItems(item.clothingIds || [], {
    itemsSnapshot: item.itemsSnapshot,
    snapshotItems: item.snapshotItems,
    items: item.items,
  });
  const snapshotItems = itemsSnapshot.map((snapshot) => ({
    itemId: snapshot.clothingId,
    name: snapshot.name || snapshot.category || '衣服',
    category: snapshot.category || 'other',
    color: snapshot.color || '',
    imageUrl: snapshot.imageUrl || snapshot.displayImageUrl || snapshot.thumbnailUrl || '',
    displayImageUrl: snapshot.displayImageUrl || snapshot.imageUrl || snapshot.thumbnailUrl || '',
    thumbnailUrl: snapshot.thumbnailUrl || snapshot.displayImageUrl || snapshot.imageUrl || '',
    isDeleted: Boolean(snapshot.deletedAt),
    ...pickCopyEvidenceSnapshotFields(snapshot),
  }));
  const deletedItemCount = itemsSnapshot.filter((snapshot) => snapshot.deletedAt).length;

  return {
    id: item._id,
    outfitId: item.outfitId || (kind === 'recommendation' ? item._id : undefined),
    userId: item._openid || item.userId,
    title: item.title,
    userTitle: readTitle(item.userTitle) || undefined,
    displayTitle: getDisplayTitle(item, `${item.scene || '今日'}搭配`),
    clothingIds: item.clothingIds || itemsSnapshot.map((snapshot) => snapshot.clothingId),
    outfitKey: item.outfitKey || getOutfitKey(item.clothingIds || []),
    outfitKind: kind,
    itemsSnapshot,
    snapshotItems,
    incomplete: deletedItemCount > 0,
    deletedItemCount,
    items: itemsSnapshot.map((snapshot) => ({
      clothingId: snapshot.clothingId,
      category: snapshot.category || 'other',
      subcategory: snapshot.name || snapshot.type || snapshot.category,
      imageUrl: snapshot.imageUrl || snapshot.displayImageUrl || snapshot.thumbnailUrl || '',
      displayImageUrl: snapshot.displayImageUrl || snapshot.imageUrl || snapshot.thumbnailUrl || '',
      thumbnailUrl: snapshot.thumbnailUrl || snapshot.displayImageUrl || snapshot.imageUrl || '',
      colorPalette: snapshot.color ? [{ name: snapshot.color, hex: '' }] : [],
      isDeleted: Boolean(snapshot.deletedAt),
      ...pickCopyEvidenceSnapshotFields(snapshot),
    })),
    scene: item.scene,
    targetDate: item.targetDate,
    timeOfDay: item.timeOfDay,
    weatherSnapshot: item.weatherSnapshot || item.weather,
    weatherMode: item.weatherMode || ((item.weatherSnapshot || item.weather) ? 'live' : 'unavailable'),
    scores: sanitizeScores(item.scores || {}),
    aestheticEvaluation: normalizeAestheticEvaluationForStorage(item.aestheticEvaluation),
    scoreExplanations: item.scoreExplanations || [],
    generationType: item.generationType || 'auto',
    sourceItemId: item.sourceItemId,
    source: item.source || (kind === 'history' ? 'recommendation' : 'recommendation'),
    sourceFavoriteOutfitId: item.sourceFavoriteOutfitId || undefined,
    favoriteOutfitId: kind === 'favorite' ? item._id : item.favoriteOutfitId || item.sourceFavoriteOutfitId || undefined,
    isFavorite: kind === 'favorite',
    favoritedAt: kind === 'favorite' ? item.createdAt : undefined,
    wornAt: item.wornAt || undefined,
    wornDate: item.wornAt ? String(item.wornAt).slice(0, 10) : undefined,
    isWornToday: kind === 'history' && isHistoryOnDate(item, new Date().toISOString().slice(0, 10)),
    todayHistoryId: kind === 'history' && isHistoryOnDate(item, new Date().toISOString().slice(0, 10)) ? item._id : undefined,
    historyId: kind === 'history' ? item._id : undefined,
    lastWornAt: item.wornAt || undefined,
    recommendationBatchId: item.recommendationBatchId || undefined,
    generatedAt: item.generatedAt || undefined,
    styleTags: readSnapshotStyleTags(itemsSnapshot),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    reason: item.reason || item.reasoning,
    reasoning: item.reasoning || item.reason,
    reasonVersion: item.reasonVersion,
    ...pickRecommendationCopyContractFields(item),
    ...(item.canonicalRecommendationCopyV2
      ? { canonicalRecommendationCopyV2: item.canonicalRecommendationCopyV2 }
      : {}),
    eligibility: item.eligibility,
    eligibilityReason: cloneEligibilityReason(item.eligibilityReason),
    ...pickOutfitStoryFields(item),
    ...mapAiReviewAtBoundary(item, (value) => normalizeRecommendationAiComment(value, item)),
  };
}

async function upsertOutfitByKey({ openid, existing, base, patch, now }) {
  const clothingIds = readBaseClothingIds(base);
  if (!base || clothingIds.length === 0) throw new Error('outfit payload is required');

  return runOutfitReferenceTransaction(async (transaction) => {
    await assertOutfitClothesAvailable(openid, clothingIds, transaction);

    const outfitKey = getOutfitKey(clothingIds);
    const current = existing || (await findOutfitByKey(openid, outfitKey, transaction));
    const data = buildOutfitSaveData(base, {
      outfitKey,
      now,
      patch,
      current,
    });

    if (current) {
      await transaction.collection('outfits').doc(current._id).update({
        data: buildOutfitReferenceUpdatePayload(data),
      });
      return { ...current, ...data };
    }

    const addData = {
      _openid: openid,
      ...data,
      createdAt: now,
    };
    const addRes = await transaction.collection('outfits').add({ data: addData });
    return { ...addData, _id: addRes._id };
  });
}

function buildOutfitSaveData(base, { outfitKey, now, patch, current }) {
  const weather = base.weatherSnapshot || base.weather || current?.weatherSnapshot || current?.weather;
  const reason = base.reason || base.reasoning || current?.reason || current?.reasoning || '';
  const reasoning = base.reasoning || base.reason || current?.reasoning || current?.reason || '';
  const clothingIds = readBaseClothingIds(base);
  const snapshotItems = buildSnapshotItems(clothingIds, base, current);
  const incomplete = snapshotItems.some((item) => item.isDeleted) || Boolean(current?.incomplete);
  const reviewCandidate = {
    aiComment: base.aiComment || current?.aiComment,
    reviewSource: base.reviewSource || current?.reviewSource,
    enhanced: base.enhanced === true || current?.enhanced === true,
    ...pickRecommendationCopyContractFields(base, current),
  };
  const reviewFields = mapAiReviewAtBoundary(
    reviewCandidate,
    (value) => normalizeRecommendationAiComment(value, reviewCandidate),
  );
  const title = base.title || current?.title || `${base.scene || current?.scene || '今日'}搭配`;
  const userTitle = readTitle(current?.userTitle) || readTitle(base.userTitle);
  const aestheticEvaluation = normalizeAestheticEvaluationForStorage(base.aestheticEvaluation || current?.aestheticEvaluation);

  const data = {
    title,
    userTitle,
    displayTitle: getDisplayTitle({ userTitle, title }, `${base.scene || current?.scene || '今日'}搭配`),
    clothingIds,
    outfitKey,
    snapshotItems,
    incomplete,
    deletedItemCount: snapshotItems.filter((item) => item.isDeleted).length,
    scene: base.scene || current?.scene,
    targetDate: base.targetDate || current?.targetDate,
    timeOfDay: base.timeOfDay || current?.timeOfDay || 'all_day',
    ...(weather ? { weather, weatherSnapshot: weather } : {}),
    weatherMode: base.weatherMode || current?.weatherMode || (weather ? 'live' : 'unavailable'),
    eligibility: base.eligibility || current?.eligibility,
    eligibilityReason: cloneEligibilityReason(base.eligibilityReason || current?.eligibilityReason),
    scores: sanitizeScores(base.scores || current?.scores || {}),
    ...(aestheticEvaluation ? { aestheticEvaluation } : {}),
    scoreExplanations: Array.isArray(base.scoreExplanations) ? base.scoreExplanations : current?.scoreExplanations || [],
    generationType: base.generationType || current?.generationType || 'auto',
    source: base.source || current?.source || 'recommend',
    isFavorite: patch.isFavorite ?? Boolean(current?.isFavorite),
    favoritedAt: patch.favoritedAt !== undefined ? patch.favoritedAt : current?.favoritedAt || null,
    wornAt: patch.wornAt !== undefined ? patch.wornAt : current?.wornAt || null,
    wornDate: patch.wornDate !== undefined ? patch.wornDate : current?.wornDate || null,
    isWornToday: patch.isWornToday ?? Boolean(current?.isWornToday),
    recommendationBatchId: base.recommendationBatchId || current?.recommendationBatchId,
    generatedAt: base.generatedAt || current?.generatedAt,
    styleTags: readStringArray(base.styleTags).length
      ? readStringArray(base.styleTags)
      : readStringArray(current?.styleTags),
    reason,
    reasoning,
    reasonVersion: base.reasonVersion || current?.reasonVersion,
    presentationPlan: base.presentationPlan || current?.presentationPlan,
    ...pickRecommendationCopyContractFields(base, current),
    ...pickOutfitStoryFields(base, current),
    ...reviewFields,
    updatedAt: now,
  };
  const canonicalCopy = resolveCanonicalCopyForStorage(base, current);
  if (canonicalCopy) Object.assign(data, applyCanonicalCopyToOutfit(data, canonicalCopy));
  const materializationInput = base.recommendationVoiceMaterializationV2
    || current?.recommendationVoiceMaterializationV2;
  if (materializationInput) data.recommendationVoiceMaterializationV2 = materializationInput;
  data.recommendationContentHash = buildRecommendationContentHash(data);
  return data;
}

function buildOutfitReferenceUpdatePayload(data) {
  const payload = { ...data };
  for (const field of [
    'selectedDifferentiator',
    'presentationPlan',
    'copyContract',
    'canonicalRecommendationCopyV2',
    'recommendationVoiceMaterializationV2',
  ]) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      payload[field] = db.command.set(payload[field]);
    }
  }
  return payload;
}

async function upsertRecommendationOutfitsBatch({
  openid,
  bases,
  now,
  availableClothingIds,
  operationCounts,
}) {
  const inputStartedAt = Date.now();
  const records = Array.isArray(bases) ? bases : [];
  if (operationCounts) {
    Object.defineProperty(operationCounts, 'snapshot', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
      inputPreparationMs: 0,
      serializationMs: 0,
      snapshotBuildMs: 0,
      queryReadMs: 0,
      writeMs: 0,
      writeWallMs: 0,
      transactionMs: 0,
      transactionCallbackMs: 0,
      commitMs: 0,
      responseWaitMs: 0,
      dbRoundTrips: 0,
      writeRoundTrips: 0,
      logicalWrites: 0,
      inputPayloadBytes: 0,
      payloadBytes: 0,
      existingRecordCount: 0,
      newRecordCount: 0,
      maxConcurrency: 0,
      },
    });
  }
  if (records.length === 0) return [];
  const clothingIds = uniqueStrings(records.flatMap((base) => readBaseClothingIds(base)));
  const outfitKeys = records.map((base) => getOutfitKey(readBaseClothingIds(base)));
  const snapshot = operationCounts?.snapshot;
  if (snapshot) {
    snapshot.inputPreparationMs = Date.now() - inputStartedAt;
    const serializationStartedAt = Date.now();
    snapshot.inputPayloadBytes = serializedBytes(records);
    snapshot.serializationMs = Date.now() - serializationStartedAt;
  }

  // Existing recommendation references do not need a transaction: the update
  // payload below is recommendation-owned only and never writes user state.
  // Read once, then use a small concurrency window to avoid the serial
  // transaction write latency on the hot retry path. New/mixed batches keep
  // the transactional path because their add/update decision is not atomic
  // outside a transaction.
  if (Array.isArray(availableClothingIds)) {
    const existingReadStartedAt = Date.now();
    if (operationCounts) operationCounts.reads += 1;
    let existingResponse;
    try {
      existingResponse = await db.collection('outfits')
        .where({ _openid: openid, outfitKey: db.command.in(uniqueStrings(outfitKeys)) })
        .limit(100)
        .get();
    } catch (error) {
      throw annotateOutfitReferenceCause(error, {
        stage: 'outfit_existing_read',
        operation: 'read',
        collection: 'outfits',
      });
    }
    const existingByKey = buildOutfitRecordMap(existingResponse.data);
    if (existingByKey.size === records.length) {
      if (snapshot) {
        snapshot.queryReadMs += Date.now() - existingReadStartedAt;
        snapshot.dbRoundTrips += 1;
        snapshot.existingRecordCount = records.length;
        snapshot.maxConcurrency = Math.min(RECOMMENDATION_REFERENCE_UPDATE_CONCURRENCY, records.length);
      }
      let saved;
      try {
        saved = await updateExistingRecommendationReferences({
          records,
          outfitKeys,
          existingByKey,
          now,
          operationCounts,
        });
      } catch (error) {
        if (error?.businessCode) throw error;
        const wrapped = createBusinessError('OUTFIT_REFERENCE_WRITE_FAILED', '鎿嶄綔鏆傛椂澶辫触锛岃绋嶅悗鍐嶈瘯');
        wrapped.cause = serializeOutfitReferenceCause(error, {
          stage: error?.outfitReferenceStage || 'outfit_recommendation_update',
        });
        throw wrapped;
      }
      if (snapshot) {
        snapshot.transactionMs = Date.now() - existingReadStartedAt;
        snapshot.responseWaitMs = Math.max(0, snapshot.transactionMs - snapshot.queryReadMs - snapshot.writeMs);
      }
      return saved;
    }
  }

  const transactionStartedAt = Date.now();
  const result = await runOutfitReferenceTransaction(async (transaction) => {
    if (Array.isArray(availableClothingIds)) {
      assertAvailableClothingIds(clothingIds, availableClothingIds);
    } else {
      const queryReadStartedAt = Date.now();
      if (operationCounts) operationCounts.reads += 1;
      try {
        await assertOutfitClothesAvailable(openid, clothingIds, transaction);
      } catch (error) {
        throw annotateOutfitReferenceCause(error, {
          stage: 'clothes_validation_read',
          operation: 'read',
          collection: 'clothes',
        });
      }
      if (snapshot) {
        snapshot.queryReadMs += Date.now() - queryReadStartedAt;
        snapshot.dbRoundTrips += 1;
      }
    }

    const existingReadStartedAt = Date.now();
    if (operationCounts) operationCounts.reads += 1;
    let existingResponse;
    try {
      existingResponse = await transaction.collection('outfits')
        .where({ _openid: openid, outfitKey: db.command.in(uniqueStrings(outfitKeys)) })
        .limit(100)
        .get();
    } catch (error) {
      throw annotateOutfitReferenceCause(error, {
        stage: 'outfit_existing_read',
        operation: 'read',
        collection: 'outfits',
      });
    }
    if (snapshot) {
      snapshot.queryReadMs += Date.now() - existingReadStartedAt;
      snapshot.dbRoundTrips += 1;
    }
    const existingByKey = buildOutfitRecordMap(existingResponse.data);
    if (snapshot) {
      snapshot.existingRecordCount = existingByKey.size;
      snapshot.newRecordCount = Math.max(0, records.length - existingByKey.size);
      snapshot.maxConcurrency = 1;
    }

    const saved = [];
    const pendingUpdates = [];
    const pendingAdds = [];
    const snapshotBuildStartedAt = Date.now();
    for (let index = 0; index < records.length; index += 1) {
      const base = records[index];
      const outfitKey = outfitKeys[index];
      const current = existingByKey.get(outfitKey);
      const data = buildOutfitSaveData(base, {
        outfitKey,
        now,
        patch: {},
        current,
      });
      if (operationCounts) operationCounts.writes += 1;
      if (snapshot) snapshot.logicalWrites += 1;
      if (current) {
        pendingUpdates.push({ current, data, outfitKey });
      } else {
        pendingAdds.push({
          outfitKey,
          data: {
            _id: buildRecommendationOutfitDocumentId(openid, outfitKey),
            _openid: openid,
            ...data,
            createdAt: now,
          },
        });
      }
    }
    if (snapshot) snapshot.snapshotBuildMs += Date.now() - snapshotBuildStartedAt;

    for (const pending of pendingUpdates) {
      const writeStartedAt = Date.now();
      try {
        await transaction.collection('outfits').doc(pending.current._id).update({
          data: buildOutfitReferenceUpdatePayload(pending.data),
        });
      } catch (error) {
        throw annotateOutfitReferenceCause(error, {
          stage: 'outfit_update',
          operation: 'update',
          collection: 'outfits',
          documentId: pending.current._id,
          outfitKey: pending.outfitKey,
        });
      }
      const updated = { ...pending.current, ...pending.data };
      existingByKey.set(pending.outfitKey, updated);
      if (snapshot) {
        const writeDurationMs = Date.now() - writeStartedAt;
        snapshot.writeMs += writeDurationMs;
        snapshot.writeWallMs += writeDurationMs;
        snapshot.payloadBytes += serializedBytes(pending.data);
        snapshot.writeRoundTrips += 1;
        snapshot.dbRoundTrips += 1;
      }
    }

    if (pendingAdds.length > 0) {
      const writeStartedAt = Date.now();
      const addData = pendingAdds.map((pending) => pending.data);
      let addRes;
      try {
        addRes = await transaction.collection('outfits').add({ data: addData });
      } catch (error) {
        throw annotateOutfitReferenceCause(error, {
          stage: 'outfit_batch_add',
          operation: 'batch_add',
          collection: 'outfits',
          outfitKey: pendingAdds[0]?.outfitKey,
        });
      }
      const returnedIds = Array.isArray(addRes?._ids)
        ? addRes._ids
        : (addRes?._id ? [addRes._id] : []);
      if (returnedIds.length !== pendingAdds.length) {
        throw annotateOutfitReferenceCause(new Error('batch add did not return one id per outfit'), {
          stage: 'outfit_batch_add_result',
          operation: 'batch_add',
          collection: 'outfits',
          expected: pendingAdds.length,
          actual: returnedIds.length,
        });
      }
      pendingAdds.forEach((pending, index) => {
        const added = { ...pending.data, _id: returnedIds[index] };
        existingByKey.set(pending.outfitKey, added);
        saved.push(added);
        if (snapshot) {
          snapshot.payloadBytes += serializedBytes(addData[index]);
        }
      });
      if (snapshot) {
        const writeDurationMs = Date.now() - writeStartedAt;
        snapshot.writeMs += writeDurationMs;
        snapshot.writeWallMs += writeDurationMs;
        snapshot.writeRoundTrips += 1;
        snapshot.dbRoundTrips += 1;
      }
    }

    pendingUpdates.forEach((pending) => {
      saved.push(existingByKey.get(pending.outfitKey));
    });
    saved.sort((left, right) => outfitKeys.indexOf(left.outfitKey) - outfitKeys.indexOf(right.outfitKey));
    if (snapshot) {
      snapshot.logicalWrites = records.length;
    }
    return saved;
  }, snapshot);
  if (snapshot) {
    snapshot.transactionMs = Math.max(snapshot.transactionMs, Date.now() - transactionStartedAt);
    snapshot.responseWaitMs = Math.max(0, snapshot.transactionMs - snapshot.queryReadMs - snapshot.writeMs);
  }
  return result;
}

const RECOMMENDATION_OWNED_REFERENCE_FIELDS = [
  'title', 'clothingIds', 'outfitKey', 'snapshotItems', 'incomplete', 'deletedItemCount',
  'scene', 'targetDate', 'timeOfDay', 'weather', 'weatherSnapshot', 'weatherMode',
  'eligibility', 'eligibilityReason', 'scores', 'aestheticEvaluation', 'scoreExplanations',
  'generationType', 'source', 'recommendationBatchId', 'generatedAt', 'styleTags', 'reason',
  'reasoning', 'reasonVersion', 'presentationPlan', 'copyContract', 'copyContractVersion',
  'voiceBankVersion', 'selectedDifferentiator', 'contentPlan', 'canonicalRecommendationCopyV2',
  'recommendationVoiceMaterializationV2', 'recommendationContentHash', 'updatedAt',
];
const RECOMMENDATION_REFERENCE_UPDATE_CONCURRENCY = 8;
const RECOMMENDATION_REFERENCE_VOLATILE_FIELDS = new Set([
  'recommendationBatchId', 'generatedAt', 'recommendationContentHash', 'updatedAt',
]);

function buildRecommendationContentHash(data) {
  const stable = {};
  for (const field of RECOMMENDATION_OWNED_REFERENCE_FIELDS) {
    if (RECOMMENDATION_REFERENCE_VOLATILE_FIELDS.has(field)) continue;
    if (Object.prototype.hasOwnProperty.call(data || {}, field)) stable[field] = data[field];
  }
  return sha256(JSON.stringify(stable));
}

function buildRecommendationOwnedReferenceUpdatePayload(data, current) {
  const payload = {};
  const sameContent = typeof data?.recommendationContentHash === 'string'
    && data.recommendationContentHash.length > 0
    && current?.recommendationContentHash === data.recommendationContentHash;
  for (const field of RECOMMENDATION_OWNED_REFERENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data || {}, field)) continue;
    if (sameContent && !RECOMMENDATION_REFERENCE_VOLATILE_FIELDS.has(field)) continue;
    if (current && isDeepStrictEqual(current[field], data[field])) continue;
    payload[field] = data[field];
  }
  return buildOutfitReferenceUpdatePayload(payload);
}

async function updateExistingRecommendationReferences({
  records,
  outfitKeys,
  existingByKey,
  now,
  operationCounts,
}) {
  const snapshotBuildStartedAt = Date.now();
  const pending = records.map((base, index) => {
    const outfitKey = outfitKeys[index];
    const current = existingByKey.get(outfitKey);
    const data = buildOutfitSaveData(base, { outfitKey, now, patch: {}, current });
    return { current, data, outfitKey };
  });
  if (operationCounts?.snapshot) {
    operationCounts.snapshot.snapshotBuildMs += Date.now() - snapshotBuildStartedAt;
  }
  const saved = new Array(pending.length);
  let nextIndex = 0;
  const writeWallStartedAt = Date.now();
  const worker = async () => {
    while (nextIndex < pending.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = pending[index];
      if (operationCounts) operationCounts.writes += 1;
      const writeStartedAt = Date.now();
      const updatePayload = buildRecommendationOwnedReferenceUpdatePayload(item.data, item.current);
      try {
        // Keep each update independent; the production SDK supplies the I/O
        // yield that lets the worker window overlap network round trips.
        await db.collection('outfits').doc(item.current._id).update({
          data: updatePayload,
        });
      } catch (error) {
        throw annotateOutfitReferenceCause(error, {
          stage: 'outfit_recommendation_update',
          operation: 'update',
          collection: 'outfits',
          documentId: item.current._id,
          outfitKey: item.outfitKey,
        });
      }
      if (operationCounts?.snapshot) {
        operationCounts.snapshot.writeMs += Date.now() - writeStartedAt;
        operationCounts.snapshot.writeRoundTrips += 1;
        operationCounts.snapshot.dbRoundTrips += 1;
        operationCounts.snapshot.logicalWrites += 1;
        operationCounts.snapshot.payloadBytes += serializedBytes(updatePayload);
      }
      saved[index] = { ...item.current, ...item.data };
    }
  };
  await Promise.all(Array.from({
    length: Math.min(RECOMMENDATION_REFERENCE_UPDATE_CONCURRENCY, pending.length),
  }, () => worker()));
  if (operationCounts?.snapshot) {
    operationCounts.snapshot.writeWallMs += Date.now() - writeWallStartedAt;
  }
  return saved;
}

function assertAvailableClothingIds(expectedIds, availableIds) {
  const available = new Set(uniqueStrings(availableIds));
  if (expectedIds.some((id) => !available.has(id))) {
    throw createBusinessError(
      'OUTFIT_CONTAINS_DELETED_CLOTHES',
      '杩欏鎼厤鏈夎。鐗╁凡绉诲嚭琛ｆ┍锛屾殏鏃朵笉鑳界户缁娇鐢?',
    );
  }
}

async function findOutfitByKey(openid, outfitKey, database = db) {
  const res = await database.collection('outfits').where({ _openid: openid, outfitKey }).limit(1).get();
  return res.data[0] || null;
}

function readBaseClothingIds(base) {
  return base && Array.isArray(base.clothingIds) ? base.clothingIds : [];
}

function buildRecommendationOutfitDocumentId(openid, outfitKey) {
  return `recommendation-${sha256(`${openid}|${outfitKey}`).slice(0, 24)}`;
}

function buildSnapshotItems(clothingIds, base, current) {
  const snapshots = [
    ...normalizeSnapshotItems(current?.snapshotItems),
    ...normalizeSnapshotItems(base?.snapshotItems),
    ...normalizePayloadItems(base?.items),
  ];
  const snapshotMap = new Map(snapshots.map((item) => [item.itemId, item]));

  return clothingIds.map((id) => {
    const snapshot = snapshotMap.get(id);
    return {
      itemId: id,
      name: snapshot?.name || snapshot?.category || '衣服',
      category: snapshot?.category || 'other',
      color: snapshot?.color || '',
      imageUrl: snapshot?.imageUrl || snapshot?.displayImageUrl || snapshot?.thumbnailUrl || '',
      displayImageUrl: snapshot?.displayImageUrl || snapshot?.imageUrl || snapshot?.thumbnailUrl || '',
      thumbnailUrl: snapshot?.thumbnailUrl || snapshot?.displayImageUrl || snapshot?.imageUrl || '',
      isDeleted: Boolean(snapshot?.isDeleted),
      ...pickCopyEvidenceSnapshotFields(snapshot),
    };
  });
}

function normalizeSnapshotItems(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.itemId === 'string')
        .map((item) => ({
          itemId: item.itemId,
          name: item.name || item.category || '衣服',
          category: item.category || 'other',
          color: item.color || '',
          imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
          displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
          thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
          isDeleted: Boolean(item.isDeleted),
          ...pickCopyEvidenceSnapshotFields(item),
        }))
    : [];
}

function normalizePayloadItems(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && typeof item.clothingId === 'string')
        .map((item) => ({
          itemId: item.clothingId,
          name: item.subcategory || item.category || '衣服',
          category: item.category || 'other',
          color: readColorText(item),
          imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
          displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
          thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
          isDeleted: Boolean(item.isDeleted),
          ...pickCopyEvidenceSnapshotFields(item),
        }))
    : [];
}

function snapshotFromClothing(item, fallback, itemId) {
  const displayImageUrl = getDisplayImage(item) || fallback?.displayImageUrl || fallback?.imageUrl || '';
  const thumbnailUrl = getThumbnailImage(item) || fallback?.thumbnailUrl || displayImageUrl;
  return {
    itemId,
    name: item?.customName || item?.subcategory || item?.subCategory || item?.category || fallback?.name || '衣服',
    category: item?.category || fallback?.category || 'other',
    color: readColorText(item) || fallback?.color || '',
    imageUrl: item?.imageUrl || fallback?.imageUrl || displayImageUrl,
    displayImageUrl,
    thumbnailUrl,
    isDeleted: Boolean(item?.status === DELETED_STATUS || fallback?.isDeleted),
    ...pickCopyEvidenceSnapshotFields(item, fallback),
  };
}

function pickCopyEvidenceSnapshotFields(primary, fallback) {
  const source = primary && typeof primary === 'object' ? primary : {};
  const backup = fallback && typeof fallback === 'object' ? fallback : {};
  const result = {};
  for (const field of [
    'confidence', 'recognitionConfidence', 'aiConfidence', 'factConfidence', 'factSource',
    'fit', 'silhouette', 'shoulderFit', 'shoulderLine', 'sleeveLength', 'sleeve', 'pantsLength',
    'patternType', 'styleComplexity', 'neckline', 'collar', 'closure', 'shoeClosure',
    'shoeType',
    'thickness', 'material', 'materialGuess', 'userEdited', 'fieldSource',
  ]) {
    const value = source[field] !== undefined ? source[field] : backup[field];
    if (value !== undefined && value !== null && value !== '') result[field] = value;
  }
  for (const field of [
    'contractFacts', 'userFacts', 'careLabelFacts', 'productFacts', 'structuredAiFacts',
    'visualFacts', 'styleTags', 'sceneTags',
  ]) {
    const value = Array.isArray(source[field]) ? source[field] : backup[field];
    if (Array.isArray(value) && value.length > 0) result[field] = value.slice();
  }
  for (const field of ['factEvidence', 'factRecords', 'factsWithSource']) {
    const value = Array.isArray(source[field]) ? source[field] : backup[field];
    if (Array.isArray(value) && value.length > 0) result[field] = value.map((entry) => ({ ...entry }));
  }
  for (const field of ['factSources', 'factConfidences', 'aestheticFeatures', 'functionalFeatures']) {
    const value = source[field] && typeof source[field] === 'object' ? source[field] : backup[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) result[field] = { ...value };
  }
  return result;
}

function getOutfitKey(clothingIds) {
  return signature(clothingIds);
}

function normalizeOutfitPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    id: payload.id,
    title: payload.title,
    clothingIds: Array.isArray(payload.clothingIds) ? payload.clothingIds : [],
    itemsSnapshot: Array.isArray(payload.itemsSnapshot) ? payload.itemsSnapshot : [],
    snapshotItems: Array.isArray(payload.snapshotItems) ? payload.snapshotItems : [],
    items: Array.isArray(payload.items) ? payload.items : [],
    scene: payload.scene,
    targetDate: payload.targetDate,
    timeOfDay: payload.timeOfDay,
    weatherSnapshot: payload.weatherSnapshot,
    weather: payload.weather,
    weatherMode: payload.weatherMode,
    eligibility: payload.eligibility,
    eligibilityReason: cloneEligibilityReason(payload.eligibilityReason),
    scores: payload.scores,
    aestheticEvaluation: payload.aestheticEvaluation,
    scoreExplanations: payload.scoreExplanations,
    generationType: payload.generationType,
    source: payload.source || 'recommend',
    presentationPlan: payload.presentationPlan,
    reasoning: payload.reasoning,
    reason: payload.reason,
    outfitKey: payload.outfitKey,
    outfitId: payload.outfitId,
    outfitKind: payload.outfitKind,
    userTitle: payload.userTitle,
    displayTitle: payload.displayTitle,
    favoriteOutfitId: payload.favoriteOutfitId,
    todayHistoryId: payload.todayHistoryId,
    historyId: payload.historyId,
    lastWornAt: payload.lastWornAt,
    recommendationBatchId: payload.recommendationBatchId,
    generatedAt: payload.generatedAt,
    styleTags: readStringArray(payload.styleTags),
    outfitItemRoles: normalizeOutfitItemRoles(payload.outfitItemRoles),
    contentPlan: normalizeContentPlan(payload.contentPlan),
    contentPlanVersion: payload.contentPlanVersion,
    sceneIntent: payload.sceneIntent,
    primaryBenefitCode: payload.primaryBenefitCode,
    primaryBenefit: payload.primaryBenefit,
    secondaryBenefit: payload.secondaryBenefit,
    observationFocus: payload.observationFocus,
    reviewSource: payload.reviewSource,
    validatorRejectReasons: readStringArray(payload.validatorRejectReasons),
    cacheReuseReason: payload.cacheReuseReason,
    ...pickRecommendationCopyContractFields(payload),
    ...mapAiReviewAtBoundary(payload, (value) => normalizeRecommendationAiComment(value, payload)),
  };
}

function isRecommendId(id) {
  return typeof id === 'string' && id.startsWith('recommend:');
}

function toTempOutfit(recommendation, context) {
  const clothingIds = recommendation.items.map((item) => item._id);
  const itemMap = new Map(recommendation.items.map((item) => [item._id, item]));
  const snapshotItems = clothingIds.map((id) => snapshotFromClothing(itemMap.get(id), null, id));
  recordInstrumentationMetric(context.instrumentation, 'buildSnapshotItems');
  const data = {
    _id: `recommend:${recommendation.outfitKey || signature(clothingIds)}`,
    _openid: context.openid,
    title: recommendation.title,
    clothingIds,
    outfitKey: recommendation.outfitKey || getOutfitKey(clothingIds),
    snapshotItems,
    incomplete: false,
    deletedItemCount: 0,
    scene: context.scene,
    targetDate: context.targetDate,
    timeOfDay: context.timeOfDay,
    ...(context.weather ? { weatherSnapshot: context.weather } : {}),
    weatherMode: context.weatherMode,
    scores: recommendation.scores,
    scoreExplanations: recommendation.scoreExplanations,
    outfitItemRoles: normalizeOutfitItemRoles(recommendation.outfitItemRoles),
    compositionVersion: recommendation.compositionVersion,
    structureType: recommendation.structureType,
    sceneIntent: recommendation.sceneIntent,
    primaryBenefit: recommendation.primaryBenefit,
    primaryBenefitCode: recommendation.primaryBenefitCode || recommendation.primaryBenefit,
    secondaryBenefit: recommendation.secondaryBenefit,
    observationFocus: recommendation.observationFocus,
    eligibility: recommendation.eligibility,
    eligibilityReason: cloneEligibilityReason(recommendation.eligibilityReason),
    reviewSource: recommendation.reviewSource || 'rule_default',
    validatorRejectReasons: readStringArray(recommendation.validatorRejectReasons),
    cacheReuseReason: recommendation.cacheReuseReason || '',
    generationType: 'auto',
    source: 'recommend',
    isFavorite: false,
    isWornToday: false,
    favoriteOutfitId: undefined,
    todayHistoryId: undefined,
    historyId: undefined,
    lastWornAt: undefined,
    recommendationBatchId: context.recommendationBatchId,
    generatedAt: context.now,
    styleTags: uniqueStrings(recommendation.items.flatMap((item) => readArray(item.styleTags))),
    reasoning: recommendation.reasoning,
    createdAt: context.now,
    updatedAt: context.now,
  };

  const outfit = attachAestheticEvaluation(toOutfit(data, recommendation.items), recommendation.items);
  return {
    ...outfit,
    snapshotItems: projectSnapshotItemsForCardPreparation(outfit.snapshotItems),
    cardViewModel: buildOutfitCardViewModel(outfit),
  };
}

function resolveCandidateSourceItems(candidate, itemFactsContext, sourceItemById) {
  const refs = Array.isArray(candidate?.itemFactRefs) ? candidate.itemFactRefs : [];
  return refs.map((ref) => {
    const facts = itemFactsContext?.resolveItemFacts?.({ _id: ref.itemId });
    const item = facts?.sourceItem || sourceItemById.get(ref.itemId);
    if (!item) throw new Error(`candidate source item is missing: ${ref.itemId}`);
    return item;
  });
}

function materializeSelectedCandidate(candidate, {
  scene,
  weather,
  tempConfig,
  hasRealWeather,
  itemFactsContext,
  sourceItemById,
  instrumentation,
} = {}) {
  const materialized = materializeCanonicalCandidate(candidate, {
    scene,
    weather,
    itemFactsContext,
    sourceItemById,
    instrumentation,
  });
  attachSemanticOptionalItem(materialized, {
    scene,
    weather,
    hasRealWeather,
    sourceItemById,
  });
  const scores = materialized.scores || {};
  materialized.scoreExplanations = buildScoreExplanations(scores, tempConfig, scene)
    .filter((entry) => hasRealWeather || entry.dimension !== 'weatherAdaptation');
  materialized.reasoning = hasRealWeather
    ? buildFriendlyReasoning(scene, materialized.items, scores, tempConfig)
    : '';
  recordInstrumentationMetric(instrumentation, 'materializeCandidateTitle');
  return materialized;
}

function attachSemanticOptionalItem(materialized, {
  scene,
  weather,
  hasRealWeather,
  sourceItemById,
} = {}) {
  if (!(sourceItemById instanceof Map)) return materialized;
  const selectedIds = new Set(materialized.itemIds || []);
  const sceneKey = normalizeScene(scene);
  const temperature = Number(weather?.temp ?? weather?.temperature);
  const sourceItems = [...sourceItemById.values()].filter((item) => item?._id && !selectedIds.has(item._id));
  const needsLayer = hasRealWeather && Number.isFinite(temperature)
    && (temperature <= 20 || (sceneKey === 'work' && temperature <= 24));
  const outerwear = needsLayer
    ? selectUsefulOptional(sourceItems, 'outerwear', sceneKey, materialized.items)
    : null;
  const accessory = !outerwear && !['home', 'sport'].includes(sceneKey)
    ? selectUsefulOptional(sourceItems, 'accessory', sceneKey, materialized.items)
    : null;
  const selected = outerwear || accessory;
  if (!selected) return materialized;

  const slot = outerwear ? 'outerwear' : 'accessory';
  const role = outerwear ? 'functional' : 'optional';
  const item = { ...selected, outfitSlot: slot, outfitRole: role };
  materialized.items.push(item);
  materialized.itemIds.push(selected._id);
  materialized.itemFactRefs.push({ itemId: selected._id, slot, role });
  materialized.outfitItemRoles.push({
    id: selected._id,
    slot,
    role,
    displayName: selected.customName || selected.subCategory || selected.subcategory || selected.category || '单品',
  });
  if (slot === 'outerwear') {
    materialized.roleItemIds.outerwear = selected._id;
    materialized.itemsByRole.outerwear = item;
  }
  return materialized;
}

function selectUsefulOptional(items, kind, sceneKey, coreItems) {
  const coreColors = new Set(coreItems.flatMap((item) => normalizeColors(item).map((color) => color?.name).filter(Boolean)));
  return (Array.isArray(items) ? items : [])
    .filter((item) => kind === 'outerwear' ? isUsefulOuterwear(item) : isUsefulAccessory(item))
    .filter((item) => evaluateOptionalItemPolicy(sceneKey, [item]).kept.length === 1)
    .filter((item) => kind !== 'accessory' || accessoryAddsValue(item, coreColors, sceneKey))
    .map((item) => ({ item, score: scoreOptionalItem(item, kind, sceneKey, coreColors) }))
    .sort((left, right) => right.score - left.score || String(left.item._id).localeCompare(String(right.item._id)))
    .map((entry) => entry.item)[0] || null;
}

function isUsefulOuterwear(item) {
  const text = [item.category, item.subcategory, item.subCategory, item.customName, ...(readArray(item.styleTags)), ...(readArray(item.sceneTags))]
    .filter(Boolean).join(' ').toLowerCase();
  return item.category === 'outerwear' || /外套|夹克|西装|风衣|开衫|coat|jacket|blazer|cardigan/.test(text);
}

function isUsefulAccessory(item) {
  const text = [item.category, item.subcategory, item.subCategory, item.customName, ...(readArray(item.styleTags)), ...(readArray(item.sceneTags))]
    .filter(Boolean).join(' ').toLowerCase();
  return item.category === 'accessory' || /包|帽|围巾|项链|耳环|腰带|配饰|bag|hat|scarf|necklace|belt/.test(text);
}

function accessoryAddsValue(item, coreColors, sceneKey) {
  const colors = normalizeColors(item).map((color) => color?.name).filter(Boolean);
  if (colors.some((color) => !coreColors.has(color))) return true;
  const text = [item.subcategory, item.subCategory, item.customName, ...(readArray(item.sceneTags))].filter(Boolean).join(' ').toLowerCase();
  return sceneKey === 'date' ? /约会|亮|重点|date|accent/.test(text) : /通勤|简约|work|office/.test(text);
}

function scoreOptionalItem(item, kind, sceneKey, coreColors) {
  const text = [item.subcategory, item.subCategory, item.customName, ...(readArray(item.sceneTags)), ...(readArray(item.styleTags))]
    .filter(Boolean).join(' ').toLowerCase();
  let score = kind === 'outerwear' ? 3 : 1;
  if (sceneKey === 'work' && /通勤|上班|西装|work|office|blazer/.test(text)) score += 3;
  if (sceneKey === 'date' && /约会|优雅|亮|date|accent/.test(text)) score += 3;
  if (normalizeColors(item).some((color) => color?.name && !coreColors.has(color.name))) score += 1;
  return score;
}

function recordInstrumentationMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function recordInstrumentationTiming(instrumentation, name, duration) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const timings = instrumentation.timings && typeof instrumentation.timings === 'object'
    ? instrumentation.timings
    : (instrumentation.timings = {});
  timings[name] = Math.max(0, Number(duration) || 0);
}

function generateRuleRecommendations({
  clothes,
  scene,
  weather,
  weatherMode,
  recommendationProfile,
  excludeClothingIdSets,
  excludedOutfitKeys,
  maxResults,
  debugRecommendationAudit = false,
  timings = createRecommendationDiagnostics().timings,
  diagnostics,
  testInstrumentation,
  disableItemFactsContext = false,
  disableCandidateDerivedFactsForTest = false,
  eagerCandidateMaterializationForTest = false,
}) {
  const normalizedWeather = normalizeRecommendationWeather(weather, weatherMode);
  const hasRealWeather = hasRealRecommendationWeather(normalizedWeather);
  const tempConfig = hasRealWeather
    ? getTemperatureConfig(Number(normalizedWeather.temp ?? normalizedWeather.temperature))
    : getWeatherIndependentTemperatureConfig();
  if (diagnostics) diagnostics.stage = 'composition';
  const compositionStartedAt = Date.now();
  const filtered = clothes
    .filter((item) => item && item._id)
    .filter((item) => !hasRealWeather || matchesSeason(item, tempConfig));
  const sourceItemById = new Map(filtered.map((item) => [item._id, item]));
  const itemFactsStartedAt = Date.now();
  const itemFactsContext = disableItemFactsContext
    ? null
    : buildItemFactsContext({
        items: filtered,
        createCompositionFacts: createCompositionItemFacts,
        instrumentation: testInstrumentation,
      });
  timings.candidateFactPreparationMs = Date.now() - itemFactsStartedAt;
  const candidateConstructionStartedAt = Date.now();
  const compositionCandidates = buildOutfitCandidatesV1({
    clothes: filtered,
    scene,
    weather: normalizedWeather,
    weatherMode: normalizedWeather.mode,
    recommendationProfile,
    excludeClothingIdSets,
    excludedOutfitKeys,
    maxResults: Math.max(Number(maxResults || 8), 1) * 8,
    returnRawCandidates: true,
    itemFactsContext,
    compactCandidates: true,
  });
  timings.candidateConstructionMs = Date.now() - candidateConstructionStartedAt;
  timings.compositionMs = Date.now() - compositionStartedAt;
  if (diagnostics) diagnostics.stage = 'canonicalize';
  const candidateCoreStartedAt = Date.now();
  let candidates = compositionCandidates.map((candidate) => createCandidateCore(candidate, {
    scene,
    weather: normalizedWeather,
    itemFactsContext,
    sourceItemById,
    instrumentation: testInstrumentation,
    useCandidateDerivedFacts: !disableCandidateDerivedFactsForTest,
  }));
  if (eagerCandidateMaterializationForTest) {
    candidates = candidates.map((candidate) => materializeCanonicalCandidate(candidate, {
      scene,
      weather: normalizedWeather,
      itemFactsContext,
      sourceItemById,
      instrumentation: testInstrumentation,
    }));
  }
  candidates.debug = compositionCandidates.debug;
  timings.canonicalizeMs = Date.now() - candidateCoreStartedAt;
  if (diagnostics) diagnostics.stage = 'eligibility';
  const eligibilityStartedAt = Date.now();
  const guardResult = applyWearabilityAndSceneEligibility(candidates, {
    scene,
    weather: normalizedWeather,
    recommendationProfile,
    itemFactsContext,
    sourceItemById,
    instrumentation: testInstrumentation,
  });
  timings.eligibilityMs = Date.now() - eligibilityStartedAt;
  timings.wearabilitySceneEligibilityMs = timings.eligibilityMs;
  const exclusionStartedAt = Date.now();
  const excluded = new Set([
    ...(excludeClothingIdSets || []).filter(Array.isArray).map((ids) => signature(ids)),
    ...readStringArray(excludedOutfitKeys),
  ]);
  const limit = Math.min(Math.max(Number(maxResults || 8), 1), 8);

  if (diagnostics) diagnostics.stage = 'scoring';
  const scoringStartedAt = Date.now();
  const scored = guardResult.accepted;
  for (const candidate of scored) {
      const scoreInput = candidate.derivedFacts || resolveCandidateSourceItems(candidate, itemFactsContext, sourceItemById);
      const scoredCandidate = scoreCandidate(scoreInput, {
        scene,
        sceneFitScore: candidate.sceneEligibility?.sceneFitScore ?? candidate.sceneFitScore,
        tempConfig,
        weather: normalizedWeather,
        recommendationProfile,
        instrumentation: testInstrumentation,
      }, { includePresentation: false });
      const weatherSafeCandidate = hasRealWeather
        ? scoredCandidate
        : removeWeatherInfluence(scoredCandidate);
      hydrateCanonicalScore(candidate, weatherSafeCandidate);
      candidate.primaryBenefitCode = candidate.primaryBenefit;
      candidate.compositionRankingScore = candidate.rankingScore;
      const outfitKey = candidate.derivedFacts?.itemSignature || candidate.selectionSignatures.itemSignature || signature(candidate.itemIds);
      if (!candidate.derivedFacts?.itemSignature && !candidate.selectionSignatures.itemSignature) {
        recordInstrumentationMetric(testInstrumentation, 'scoreCandidateItemSignature');
      }
      candidate.outfitKey = outfitKey;
      candidate.rankingScore = buildRankingScore(candidate);
      candidate.selectionSignatures.itemSignature = outfitKey;
  }
  timings.scoringMs = Date.now() - scoringStartedAt;
  timings.scoringPreparationMs = timings.scoringMs;
  if (diagnostics) diagnostics.stage = 'batchSelection';
  const batchSelectionStartedAt = Date.now();
  const filteringStartedAt = Date.now();
  const available = scored.filter((rec) => !excluded.has(rec.outfitKey));
  const sortedAvailable = sortCandidatesStable(available);
  timings.filteringMs = Date.now() - filteringStartedAt;
  timings.exclusionMs = Date.now() - exclusionStartedAt;
  const dedupeStartedAt = Date.now();
  const selectedCandidateCores = selectCanonicalCandidateBatch(sortedAvailable, limit);

  const reasonSelections = selectBatchEligibilityReasons(selectedCandidateCores.map((candidate) => ({
    outfitKey: candidate.outfitKey,
    reasonCandidates: candidate.eligibilityReasonCandidates,
  })));
  for (let index = 0; index < selectedCandidateCores.length; index += 1) {
    selectedCandidateCores[index].eligibilityReason = cloneEligibilityReason(reasonSelections[index].selectedReason);
  }

  assertEligibilityReasons(selectedCandidateCores, { node: 'afterSelection', scene, weather: normalizedWeather });
  timings.dedupeMs = Date.now() - dedupeStartedAt;
  timings.batchSelectionMs = Date.now() - batchSelectionStartedAt;
  const materializationStartedAt = Date.now();
  const results = selectedCandidateCores.map((candidate) => materializeSelectedCandidate(candidate, {
    scene,
    weather: normalizedWeather,
    tempConfig,
    hasRealWeather,
    itemFactsContext,
    sourceItemById,
    instrumentation: testInstrumentation,
  }));
  timings.materializationMs = Date.now() - materializationStartedAt;
  recordInstrumentationTiming(testInstrumentation, 'materializationMs', timings.materializationMs);

  const exclusionStats = getExclusionStats(scored, excludedOutfitKeys, excludeClothingIdSets);
  results.debug = {
    candidateCount: candidates.length,
    generatedCount: candidates.length,
    guardCandidateCount: guardResult.debug.guardCandidateCount,
    guardAcceptedCount: guardResult.debug.guardAcceptedCount,
    guardRejectedCount: guardResult.debug.guardRejectedCount,
    weatherRejectedCount: guardResult.debug.weatherRejectedCount,
    sceneRejectedCount: guardResult.debug.sceneRejectedCount,
    weatherMode: candidates.debug?.weatherMode || normalizedWeather.mode,
    hasUsableWeather: candidates.debug?.hasUsableWeather ?? hasRealWeather,
    temperatureBandApplied: candidates.debug?.temperatureBandApplied ?? hasRealWeather,
    temperatureFilterSkippedReason: candidates.debug?.temperatureFilterSkippedReason || '',
    candidateCountBeforeTemperatureFilter: candidates.debug?.candidateCountBeforeTemperatureFilter ?? candidates.length,
    candidateCountAfterTemperatureFilter: candidates.debug?.candidateCountAfterTemperatureFilter ?? candidates.length,
    rejectReasonCounts: guardResult.debug.rejectReasonCounts,
    requestedExcludedCount: exclusionStats.requestedExcludedCount,
    actualExcludedCandidateCount: exclusionStats.actualExcludedCandidateCount,
    remainingCandidateCount: available.length,
    timings,
    limitedReason: (guardResult.debug.limitedReason || candidates.debug?.limitedReason || results.length < limit)
      ? classifyLimitedReason(
        guardResult.debug.limitedReason || candidates.debug?.limitedReason || '',
        'DIVERSITY_EXHAUSTED',
      )
      : '',
  };
  if (debugRecommendationAudit) {
    results.debug._auditGuardAcceptedCandidates = scored;
    results.debug._auditGuardRejectedCandidates = guardResult.rejected;
  }
  results.debug._auditAcceptedCandidates = scored;
  results.countContract = buildRecommendationCountContract({
    requestedBatchSize: limit,
    returnedCardCount: results.length,
    remainingUniqueBeforeConsume: available.length,
    executionMode: 'full_compute',
  });
  results.limited = results.countContract.expectedCardCount < results.countContract.requestedBatchSize;
  results.exhausted = results.countContract.poolExhaustedAfterConsume;
  Object.defineProperty(results, 'candidatePoolCandidates', {
    value: scored,
    enumerable: false,
    configurable: false,
  });
  return results;
}

function generateCandidatePoolRecommendations({
  pool,
  clothes,
  scene,
  weather,
  weatherMode,
  excludedOutfitKeys,
  excludeClothingIdSets,
  maxResults,
  timings = createRecommendationDiagnostics().timings,
} = {}) {
  const hasRealWeather = hasRealRecommendationWeather(weather);
  const tempConfig = hasRealWeather
    ? getTemperatureConfig(Number(weather?.temp ?? weather?.temperature))
    : getWeatherIndependentTemperatureConfig();
  const hydrateStartedAt = Date.now();
  const candidateCores = (Array.isArray(pool?.candidates) ? pool.candidates : []).map((entry) => hydrateCandidateCore(entry, {
    reasonDescriptorForCode: (code) => getReasonSelectionDescriptor(code, ELIGIBILITY_REASON_CATALOG),
  }));
  timings.poolHydrateMs = Date.now() - hydrateStartedAt;
  const sourceItemById = new Map((Array.isArray(clothes) ? clothes : [])
    .filter((item) => item?._id)
    .map((item) => [item._id, item]));
  const poolItemIds = [...new Set(candidateCores.flatMap((candidate) => candidate.itemIds))].sort();
  const poolItems = poolItemIds.map((id) => {
    const item = sourceItemById.get(id);
    if (!item) throw new Error(`candidate pool item is missing: ${id}`);
    return item;
  });
  const itemFactsContext = buildItemFactsContext({
    items: poolItems,
    createCompositionFacts: createCompositionItemFacts,
  });
  const exclusionStartedAt = Date.now();
  const excluded = new Set([
    ...(excludeClothingIdSets || []).filter(Array.isArray).map((ids) => signature(ids)),
    ...readStringArray(excludedOutfitKeys),
  ]);
  const limit = Math.min(Math.max(Number(maxResults || 8), 1), 8);
  const available = sortCandidatesStable(candidateCores.filter((candidate) => !excluded.has(candidate.outfitKey)));
  timings.exclusionMs = Date.now() - exclusionStartedAt;
  const batchSelectionStartedAt = Date.now();
  const selectedCandidateCores = selectCanonicalCandidateBatch(available, limit);
  timings.batchSelectionMs = Date.now() - batchSelectionStartedAt;
  const selectedCanonicalCandidates = selectedCandidateCores.map((candidate) => materializeCanonicalCandidate(candidate, {
    scene,
    weather,
    itemFactsContext,
    sourceItemById,
  }));
  for (const candidate of selectedCanonicalCandidates) {
    const allowedCodes = new Set((candidate.eligibilityReasonCandidates || []).map((reason) => reason.code));
    const rehydratedReasons = collectEligibilityReasonCandidates({
      scene,
      weather,
      visibleFacts: candidate.visibleFacts,
      sceneResult: candidate.sceneEligibility,
    }).filter((reason) => allowedCodes.has(reason.code));
    if (rehydratedReasons.length === 0) throw new Error('candidate pool reason rehydration failed');
    candidate.eligibilityReasonCandidates = rehydratedReasons;
  }
  const reasonSelections = selectBatchEligibilityReasons(selectedCanonicalCandidates.map((candidate) => ({
    outfitKey: candidate.outfitKey,
    reasonCandidates: candidate.eligibilityReasonCandidates,
  })));
  for (let index = 0; index < selectedCanonicalCandidates.length; index += 1) {
    selectedCanonicalCandidates[index].eligibilityReason = cloneEligibilityReason(reasonSelections[index].selectedReason);
  }
  assertEligibilityReasons(selectedCanonicalCandidates, { node: 'candidatePoolSelection', scene, weather });
  const materializationStartedAt = Date.now();
  const results = selectedCanonicalCandidates.map((candidate) => materializeSelectedCandidate(candidate, {
    scene,
    weather,
    tempConfig,
    hasRealWeather,
    itemFactsContext,
    sourceItemById,
  }));
  const materializationMs = Date.now() - materializationStartedAt;
  timings.materializationMs = materializationMs;
  const exclusionStats = getExclusionStats(candidateCores, excludedOutfitKeys, excludeClothingIdSets);
  results.debug = {
    candidateCount: candidateCores.length,
    generatedCount: 0,
    guardCandidateCount: candidateCores.length,
    guardAcceptedCount: candidateCores.length,
    guardRejectedCount: 0,
    weatherRejectedCount: 0,
    sceneRejectedCount: 0,
    weatherMode,
    hasUsableWeather: hasRealWeather,
    temperatureBandApplied: hasRealWeather,
    temperatureFilterSkippedReason: hasRealWeather ? '' : weatherMode,
    candidateCountBeforeTemperatureFilter: candidateCores.length,
    candidateCountAfterTemperatureFilter: candidateCores.length,
    rejectReasonCounts: {},
    requestedExcludedCount: exclusionStats.requestedExcludedCount,
    actualExcludedCandidateCount: exclusionStats.actualExcludedCandidateCount,
    remainingCandidateCount: available.length,
    timings,
    materializationMs,
    limitedReason: results.length < limit ? 'DIVERSITY_EXHAUSTED' : '',
  };
  results.debug._auditAcceptedCandidates = candidateCores;
  results.countContract = buildRecommendationCountContract({
    requestedBatchSize: limit,
    returnedCardCount: results.length,
    remainingUniqueBeforeConsume: available.length,
    executionMode: 'candidate_pool_hit',
  });
  results.limited = results.countContract.expectedCardCount < results.countContract.requestedBatchSize;
  results.exhausted = results.countContract.poolExhaustedAfterConsume;
  return results;
}

function assertCandidatePoolExclusions(recommendations, excludedOutfitKeys, excludeClothingIdSets = []) {
  const excluded = new Set([
    ...readStringArray(excludedOutfitKeys),
    ...(excludeClothingIdSets || []).filter(Array.isArray).map((ids) => signature(ids)),
  ]);
  const repeated = (Array.isArray(recommendations) ? recommendations : [])
    .map((candidate) => readString(candidate?.outfitKey))
    .filter((outfitKey) => outfitKey && excluded.has(outfitKey));
  if (repeated.length > 0) {
    const error = new Error('candidate pool returned an excluded outfit key');
    error.businessCode = 'CANDIDATE_POOL_EXCLUSION_VIOLATION';
    throw error;
  }
}

function getExclusionStats(candidates, excludedOutfitKeys = [], excludeClothingIdSets = []) {
  const excluded = new Set([
    ...readStringArray(excludedOutfitKeys),
    ...(excludeClothingIdSets || []).filter(Array.isArray).map((ids) => signature(ids)),
  ]);
  const candidateList = Array.isArray(candidates) ? candidates : [];
  return {
    requestedExcludedCount: excluded.size,
    actualExcludedCandidateCount: candidateList.filter((candidate) => excluded.has(readString(candidate?.outfitKey))).length,
  };
}

function getRequestedExclusionCount(excludedOutfitKeys = [], excludeClothingIdSets = []) {
  return getExclusionStats([], excludedOutfitKeys, excludeClothingIdSets).requestedExcludedCount;
}

function sortCandidatesStable(candidates = []) {
  return (Array.isArray(candidates) ? candidates : []).slice().sort((left, right) => (
    (Number(right.rankingScore) || 0) - (Number(left.rankingScore) || 0)
    || (Number(right.totalScore) || 0) - (Number(left.totalScore) || 0)
    || String(right.outfitKey || right.selectionSignatures?.itemSignature || '')
      .localeCompare(String(left.outfitKey || left.selectionSignatures?.itemSignature || ''))
  ));
}

function getWeatherIndependentTemperatureConfig() {
  return {
    range: 'unavailable',
    seasons: [],
    targetThickness: 2,
    advice: '',
  };
}

function removeWeatherInfluence(candidate) {
  const scores = { ...(candidate.scores || {}) };
  delete scores.weatherAdaptation;
  scores.total = round1(
    Number(scores.colorHarmony || 0) * 0.2
    + Number(scores.styleUnity || 0) * 0.2
    + Number(scores.sceneMatch || 0) * 0.4
    + Number(scores.freshness || 0) * 0.13
    + Number(scores.preference || 0) * 0.07,
  );
  scores.comfort = round1((Number(scores.warmth || 0) + Number(scores.coolness || 0)) / 2);
  return {
    ...candidate,
    scores,
    scoreExplanations: (candidate.scoreExplanations || []).filter((entry) => entry.dimension !== 'weatherAdaptation'),
    reasoning: '',
  };
}

function assertEligibilityReasons(candidates, { node, scene, weather } = {}) {
  const values = Array.isArray(candidates) ? candidates : [];
  const valid = values.every((candidate) => {
    const reason = candidate?.eligibilityReason;
    return Boolean(reason?.code)
      && Array.isArray(reason.subjectItemIds) && reason.subjectItemIds.length > 0
      && Array.isArray(reason.supportingFactIds) && reason.supportingFactIds.length > 0
      && Array.isArray(reason.sourceRuleReasons) && reason.sourceRuleReasons.length > 0
      && Boolean(reason.sourceRule);
  });
  if (!valid) throw new Error(`${node || 'recommendation'} eligibility reason invariant failed`);
  return true;
}

function toEligibilityReasonDiagnostic(candidate) {
  const reason = candidate?.eligibilityReason || {};
  return {
    outfitKey: candidate?.outfitKey || candidate?.id || '',
    selectedOutfitItemIds: readSelectedOutfitItemIds(candidate),
    eligibilityReasonCode: reason.code || '',
    subjectItemIds: Array.isArray(reason.subjectItemIds) ? reason.subjectItemIds.slice() : [],
    supportingFactIds: Array.isArray(reason.supportingFactIds) ? reason.supportingFactIds.slice() : [],
    relationFactIds: Array.isArray(reason.relationFactIds) ? reason.relationFactIds.slice() : [],
    sourceRule: reason.sourceRule || '',
    sourceRuleReasons: Array.isArray(reason.sourceRuleReasons) ? reason.sourceRuleReasons.slice() : [],
  };
}

function readSelectedOutfitItemIds(candidate) {
  if (Array.isArray(candidate?.clothingIds)) return uniqueStrings(candidate.clothingIds);
  if (Array.isArray(candidate?.itemIds)) return uniqueStrings(candidate.itemIds);
  if (!Array.isArray(candidate?.items)) return [];
  return uniqueStrings(candidate.items.map((item) => item?._id || item?.clothingId || item?.itemId));
}

function buildRankingScore(rec) {
  const scores = rec.scores || {};
  const weather = Number(scores.weatherAdaptation || 0);
  const scene = Number(scores.sceneFitScore ?? scores.sceneMatch ?? 0);
  const total = Number(scores.total || 0);
  const weatherPenalty = Number(rec.eligibility?.weather?.penalty || 0);
  const base = weather * 0.38 + scene * 0.32 + total * 0.3 - weatherPenalty;
  const identity = String(rec.outfitKey || rec.selectionSignatures?.itemSignature || signature(rec.itemIds || []));
  const jitter = (stableRankHash(identity) / 0xffffffff - 0.5) * 0.45;
  return base + jitter;
}

function stableRankHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getTemperatureConfig(temp) {
  if (temp < 5) {
    return {
      range: 'freezing',
      seasons: ['winter', '冬'],
      targetThickness: 3,
      advice: '天气寒冷，优先选择保暖外套和长下装',
    };
  }
  if (temp < 15) {
    return {
      range: 'cold',
      seasons: ['winter', 'autumn', '冬', '秋'],
      targetThickness: 2.6,
      advice: '天气偏冷，外套和长裤会更稳妥',
    };
  }
  if (temp < 20) {
    return {
      range: 'cool',
      seasons: ['spring', 'autumn', '春', '秋'],
      targetThickness: 2.1,
      advice: '天气凉爽，薄外套或卫衣更合适',
    };
  }
  if (temp < 26) {
    return {
      range: 'mild',
      seasons: ['spring', 'autumn', '春', '秋'],
      targetThickness: 1.7,
      advice: '温度适中，穿着自由度较高',
    };
  }
  if (temp < 32) {
    return {
      range: 'warm',
      seasons: ['summer', 'spring', '夏', '春'],
      targetThickness: 1.2,
      advice: '天气偏热，轻薄透气会更舒服',
    };
  }
  return {
    range: 'hot',
    seasons: ['summer', '夏'],
    targetThickness: 1,
    advice: '天气炎热，建议选择短袖、短下装和清爽鞋款',
  };
}

function matchesSeason(item, tempConfig) {
  const seasons = readArray(item.seasonTags);
  if (seasons.length === 0) return true;
  return seasons.some((season) => tempConfig.seasons.includes(season));
}

function matchesTemperature(item, tempConfig) {
  const thickness = getThicknessValue(item);
  if ((tempConfig.range === 'hot' || tempConfig.range === 'warm') && thickness >= 2.8) return false;
  if ((tempConfig.range === 'freezing' || tempConfig.range === 'cold') && thickness <= 1.1) return false;
  return true;
}

function groupClothes(clothes) {
  const groups = { top: [], outerwear: [], bottom: [], skirt: [], onepiece: [], shoes: [], accessory: [], other: [] };
  for (const item of clothes) {
    const category = normalizeCategory(item);
    if (category === 'top' && isOuterwear(item)) groups.outerwear.push(item);
    else if (category === 'bottom' && isSkirt(item)) groups.skirt.push(item);
    else if (groups[category]) groups[category].push(item);
    else groups.other.push(item);
  }
  return groups;
}

function generateCandidateCombos(groups) {
  const combos = [];
  if (groups.shoes.length === 0) return combos;

  for (const top of groups.top.slice(0, 6)) {
    for (const bottom of groups.bottom.slice(0, 6)) {
      for (const shoe of groups.shoes.slice(0, 4)) {
        combos.push([top, bottom, shoe]);
      }
    }
  }

  for (const top of groups.top.slice(0, 5)) {
    for (const bottom of groups.bottom.slice(0, 5)) {
      for (const coat of groups.outerwear.slice(0, 4)) {
        for (const shoe of groups.shoes.slice(0, 3)) {
          combos.push([top, bottom, coat, shoe]);
        }
      }
    }
  }

  for (const dress of groups.onepiece.slice(0, 5)) {
    for (const coat of groups.outerwear.slice(0, 4)) {
      for (const shoe of groups.shoes.slice(0, 4)) {
        combos.push([dress, coat, shoe]);
      }
    }
  }

  for (const top of groups.top.slice(0, 6)) {
    for (const skirt of groups.skirt.slice(0, 5)) {
      for (const shoe of groups.shoes.slice(0, 4)) {
        combos.push([top, skirt, shoe]);
      }
    }
  }

  return combos.slice(0, 100);
}

function scoreCandidate(itemsOrDerivedFacts, context, { includePresentation = true } = {}) {
  recordInstrumentationMetric(context.instrumentation, 'scoreCandidate');
  if (isCandidateDerivedFacts(itemsOrDerivedFacts)) {
    return scoreCandidateDerivedFacts(itemsOrDerivedFacts, context);
  }

  const items = Array.isArray(itemsOrDerivedFacts) ? itemsOrDerivedFacts : [];
  recordInstrumentationMetric(context.instrumentation, 'scoreCandidateSourceItemFlatMap');
  recordInstrumentationMetric(context.instrumentation, 'scoreCandidateNormalizeColors');
  const colors = items.flatMap((item) => normalizeColors(item));
  const styles = items.flatMap((item) => readArray(item.styleTags));
  const weatherAdaptation = scoreWeather(items, context.tempConfig);
  const colorHarmony = scoreColorHarmony(colors, context.recommendationProfile.colorPreference);
  const styleUnity = scoreStyleUnity(styles, context.recommendationProfile.styleTags);
  const sceneMatch = normalizeScore(context.sceneFitScore ?? 5);
  const freshness = scoreFreshness(items);
  const preference = scorePreference(items, styles, context.recommendationProfile);
  const warmth = scoreWarmth(items);
  const coolness = scoreCoolness(items);
  const fashion = round1((styleUnity * 0.7) + (avg(items.map((item) => Number(item.fashionScore || 0)).filter(Boolean)) || 7) * 0.3);
  const comfort = round1((weatherAdaptation * 0.7) + (coolness * 0.15) + (warmth * 0.15));
  const total = round1(
    weatherAdaptation * 0.25 +
    colorHarmony * 0.15 +
    styleUnity * 0.15 +
    sceneMatch * 0.3 +
    freshness * 0.1 +
    preference * 0.05,
  );
  const scores = sanitizeScores({
    total,
    weatherAdaptation,
    styleUnity,
    freshness,
    preference,
    fashion,
    comfort,
    warmth,
    coolness,
    sceneMatch,
    sceneFitScore: sceneMatch,
    colorHarmony,
  });

  const result = {
    matchedScene: sceneMatch > 5 ? normalizeScene(context.scene) : '',
    scores,
  };
  if (!includePresentation) return result;
  return {
    ...result,
    title: buildCanonicalTitle(items, context.scene),
    scoreExplanations: buildScoreExplanations(scores, context.tempConfig, context.scene),
    reasoning: buildFriendlyReasoning(context.scene, items, scores, context.tempConfig),
  };
}

function scoreCandidateDerivedFacts(derivedFacts, context) {
  const colors = derivedFacts.normalizedColors;
  const styles = derivedFacts.styles;
  const weatherAdaptation = scoreWeatherFromDerivedFacts(derivedFacts, context.tempConfig);
  const colorHarmony = scoreColorHarmony(colors, context.recommendationProfile.colorPreference);
  const styleUnity = scoreStyleUnity(styles, context.recommendationProfile.styleTags);
  const sceneMatch = normalizeScore(context.sceneFitScore ?? 5);
  const freshness = scoreFreshnessFromDerivedFacts(derivedFacts);
  const preference = scorePreferenceFromDerivedFacts(derivedFacts, context.recommendationProfile);
  const warmth = derivedFacts.warmth;
  const coolness = derivedFacts.coolness;
  const fashion = round1((styleUnity * 0.7) + (avg(derivedFacts.fashionScores.filter(Boolean)) || 7) * 0.3);
  const comfort = round1((weatherAdaptation * 0.7) + (coolness * 0.15) + (warmth * 0.15));
  const total = round1(
    weatherAdaptation * 0.25 +
    colorHarmony * 0.15 +
    styleUnity * 0.15 +
    sceneMatch * 0.3 +
    freshness * 0.1 +
    preference * 0.05,
  );
  const scores = sanitizeScores({
    total,
    weatherAdaptation,
    styleUnity,
    freshness,
    preference,
    fashion,
    comfort,
    warmth,
    coolness,
    sceneMatch,
    sceneFitScore: sceneMatch,
    colorHarmony,
  });

  return {
    matchedScene: sceneMatch > 5 ? normalizeScene(context.scene) : '',
    scores,
  };
}

function isCandidateDerivedFacts(value) {
  return value?.version === 'candidate-derived-facts-v1';
}

function scoreWeather(items, tempConfig) {
  const seasonScore = items.every((item) => readArray(item.seasonTags).length === 0)
    ? 7
    : round1((items.filter((item) => matchesSeason(item, tempConfig)).length / Math.max(items.length, 1)) * 10);
  const thicknessDiff = Math.abs(avg(items.map(getThicknessValue)) - tempConfig.targetThickness);
  const thicknessScore = Math.max(2, round1(10 - thicknessDiff * 2.5));
  const warmthOrCoolness = tempConfig.targetThickness >= 2 ? scoreWarmth(items) : scoreCoolness(items);
  return round1(seasonScore * 0.35 + thicknessScore * 0.35 + warmthOrCoolness * 0.3);
}

function scoreWeatherFromDerivedFacts(derivedFacts, tempConfig) {
  const seasons = derivedFacts.seasons;
  const seasonScore = seasons.every((tags) => tags.length === 0)
    ? 7
    : round1((seasons.filter((tags) => tags.some((season) => tempConfig.seasons.includes(season))).length / Math.max(seasons.length, 1)) * 10);
  const thicknessDiff = Math.abs(avg(derivedFacts.thicknesses) - tempConfig.targetThickness);
  const thicknessScore = Math.max(2, round1(10 - thicknessDiff * 2.5));
  const warmthOrCoolness = tempConfig.targetThickness >= 2 ? derivedFacts.warmth : derivedFacts.coolness;
  return round1(seasonScore * 0.35 + thicknessScore * 0.35 + warmthOrCoolness * 0.3);
}

function scoreColorHarmony(colors, preferredColors) {
  if (colors.length === 0) return 5;
  const families = colors.map((color) => classifyColor(color.hex || color.name || ''));
  const neutralCount = families.filter((family) => family === 'neutral').length;
  const nonNeutral = new Set(families.filter((family) => family !== 'neutral'));
  let score = 6;
  if (neutralCount >= 1 && nonNeutral.size <= 2) score = 9;
  else if (nonNeutral.size === 0) score = 8;
  else if (nonNeutral.size <= 2) score = 7;
  else if (nonNeutral.size >= 4) score = 4;

  const colorText = colors.map((color) => color.name).join(' ');
  if ((preferredColors || []).some((color) => colorText.includes(color))) score += 0.7;
  return Math.min(10, round1(score));
}

function scoreStyleUnity(styles, preferredStyles) {
  if (styles.length === 0) return preferredStyles.length > 0 ? 5 : 7;
  const uniqueCount = new Set(styles).size;
  const unity = uniqueCount === 1 ? 9 : uniqueCount === 2 ? 8 : uniqueCount === 3 ? 6.5 : 5;
  if (!preferredStyles.length) return unity;
  const matchRatio = styles.filter((style) => preferredStyles.includes(style)).length / Math.max(styles.length, 1);
  return round1(unity * 0.65 + (5 + matchRatio * 5) * 0.35);
}

function scoreFreshness(items) {
  const usagePenalty = avg(items.map((item) => Math.min(Number(item.usageCount || 0), 10) * 0.25));
  const recentPenalty = items.filter((item) => item.lastWornAt && isWithinDays(item.lastWornAt, 7)).length * 1.2;
  return Math.max(3, round1(9 - usagePenalty - recentPenalty));
}

function scoreFreshnessFromDerivedFacts(derivedFacts) {
  const usagePenalty = avg(derivedFacts.freshnessUsagePenalties);
  const recentPenalty = derivedFacts.lastWornAtValues
    .filter((value) => value && isWithinDays(value, 7)).length * 1.2;
  return Math.max(3, round1(9 - usagePenalty - recentPenalty));
}

function scorePreference(items, styles, profile) {
  const text = items
    .flatMap((item) => [
      item.category,
      item.subcategory,
      item.subCategory,
      item.material,
      item.customName,
      ...(item.colors || []),
      ...readArray(item.styleTags),
      ...readArray(item.sceneTags),
      ...normalizeColors(item).map((color) => color.name),
    ])
    .filter(Boolean)
    .join(' ');
  const styleMatches = styles.filter((style) => profile.styleTags.includes(style)).length;
  const colorMatches = profile.colorPreference.filter((color) => text.includes(color)).length;
  const avoidMatches = profile.avoidTags.filter((tag) => text.includes(tag)).length;
  return Math.max(1, Math.min(10, round1(6 + styleMatches * 1.2 + colorMatches * 0.8 - avoidMatches * 1.5)));
}

function scorePreferenceFromDerivedFacts(derivedFacts, profile) {
  const text = derivedFacts.preferenceText;
  const styleMatches = derivedFacts.styles.filter((style) => profile.styleTags.includes(style)).length;
  const colorMatches = profile.colorPreference.filter((color) => text.includes(color)).length;
  const avoidMatches = profile.avoidTags.filter((tag) => text.includes(tag)).length;
  return Math.max(1, Math.min(10, round1(6 + styleMatches * 1.2 + colorMatches * 0.8 - avoidMatches * 1.5)));
}

function scoreWarmth(items) {
  return Math.max(1, Math.min(10, round1(avg(items.map((item) => Number(item.warmthScore || 0) || inferWarmth(item))))));
}

function scoreCoolness(items) {
  return Math.max(1, Math.min(10, round1(avg(items.map((item) => Number(item.coolnessScore || 0) || inferCoolness(item))))));
}

function inferWarmth(item) {
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  let score = 5;
  if (['羽绒', '羊毛', '针织', '皮革', 'down_jacket', 'jacket', 'sweater', 'boots'].some((hint) => text.includes(hint))) score += 2.5;
  if (['短袖', '薄', 'tshirt', 'shorts', 'sandals'].some((hint) => text.includes(hint))) score -= 2;
  return score;
}

function inferCoolness(item) {
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  let score = 5;
  if (['棉', '麻', '丝绸', '短袖', '薄', 'tshirt', 'shirt', 'shorts', 'skirt', 'sandals'].some((hint) => text.includes(hint))) score += 2;
  if (['羽绒', '羊毛', '厚', 'down_jacket', 'jacket', 'sweater', 'boots'].some((hint) => text.includes(hint))) score -= 2;
  return score;
}

function getThicknessValue(item) {
  const warmthScore = Number(item.warmthScore || 0);
  if (warmthScore > 0) return Math.min(3, Math.max(1, warmthScore / 3.3));
  const text = `${item.thickness || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.material || ''}`;
  if (['厚', '羽绒', '羊毛', 'down_jacket', 'sweater', 'coat'].some((hint) => text.includes(hint))) return 3;
  if (['薄', '短袖', '背心', 'tshirt', 'vest', 'shorts', 'sandals'].some((hint) => text.includes(hint))) return 1;
  return 2;
}

function buildTitle(items, scene) {
  const label = scene || '今日';
  const hasDress = items.some((item) => normalizeCategory(item) === 'onepiece');
  const hasTop = items.some((item) => normalizeCategory(item) === 'top');
  const hasBottom = items.some((item) => normalizeCategory(item) === 'bottom');
  const hasShoe = items.some((item) => normalizeCategory(item) === 'shoes');
  const isSport = label === '运动' || label === 'sport';
  const isHome = label === '居家' || label === 'home';
  const isWork = label === '上班' || label === 'work';
  const isDate = label === '约会' || label === 'date';
  const visibleFact = buildTitleVisibleFact(items);

  if (visibleFact) {
    if (isSport && hasTop && hasBottom && hasShoe) return `轻运动${visibleFact}组合`;
    if (isHome && hasDress) return hasShoe ? `居家${visibleFact}临时出门组合` : `居家${visibleFact}舒适组合`;
    if (isHome && hasTop && hasBottom) return hasShoe ? `居家${visibleFact}临时出门组合` : `居家${visibleFact}舒适组合`;
    if (isWork && hasDress) return `通勤${visibleFact}连衣裙组合`;
    if (isWork && hasTop && hasBottom) return `通勤${visibleFact}长裤组合`;
    if (isDate && hasDress) return `约会${visibleFact}连衣裙组合`;
    if (isDate && hasTop && hasBottom) return `约会${visibleFact}关系组合`;
  }

  if (isSport && hasTop && hasBottom && hasShoe) return '轻运动上衣下装组合';
  if (isHome && hasDress) return hasShoe ? '居家连衣裙外出备选' : '居家舒适连衣裙';
  if (isHome && hasTop && hasBottom) return hasShoe ? '居家兼临时出门组合' : '居家舒适上衣下装';
  if (isWork && hasDress) return '通勤连衣裙鞋型组合';
  if (isWork && hasTop && hasBottom) return '通勤上衣长裤组合';
  if (isDate && hasDress) return '约会连衣裙视觉焦点';
  if (isDate && hasTop && hasBottom) return '约会上衣下装呼应';
  if (hasDress) return `${label}连衣裙结构搭配`;
  if (hasTop && hasBottom) return `${label}上衣下装组合`;
  return `${label}完整搭配`;
}

function buildTitleVisibleFact(items) {
  const source = Array.isArray(items) ? items : [];
  const patterned = source.find((item) => /stripe|plaid|floral|print|条纹|格纹|碎花|印花/.test([
    item.patternType, item.subcategory, item.subCategory, item.customName,
  ].filter(Boolean).join(' ').toLowerCase()));
  if (patterned) return '图案焦点';
  const top = source.find((item) => normalizeCategory(item) === 'top');
  const dress = source.find((item) => normalizeCategory(item) === 'onepiece');
  const primary = top || dress;
  const text = primary ? [primary.subcategory, primary.subCategory, primary.customName, primary.category]
    .filter(Boolean).join(' ').toLowerCase() : '';
  if (/衬衫|shirt/.test(text)) return '衬衫';
  if (/针织|毛衣|knit|sweater/.test(text)) return '针织';
  if (/t恤|t-shirt|tee/.test(text)) return 'T恤';
  if (/背心|vest/.test(text)) return '背心';
  if (dress) return '连衣裙';
  const color = normalizeColors(primary || {}).map((entry) => entry?.name).find(Boolean);
  return color ? `${String(color).slice(0, 8)}配色` : '';
}

function buildScoreExplanations(scores, tempConfig, scene) {
  return [
    { dimension: 'total', score: scores.total, text: `综合评分 ${scores.total}，按天气、配色、风格、场景、新鲜感和偏好加权。` },
    { dimension: 'weatherAdaptation', score: scores.weatherAdaptation, text: `${tempConfig.advice}，天气适配 ${scores.weatherAdaptation} 分。` },
    { dimension: 'colorHarmony', score: scores.colorHarmony, text: scores.colorHarmony >= 8 ? '配色协调耐看。' : '配色可用，建议控制颜色数量。' },
    { dimension: 'styleUnity', score: scores.styleUnity, text: scores.styleUnity >= 8 ? '整体风格统一。' : '风格有混搭感。' },
    { dimension: 'sceneMatch', score: scores.sceneMatch, text: `适配${scene || '当前'}场景。` },
    { dimension: 'freshness', score: scores.freshness, text: '结合使用次数和最近穿着记录计算。' },
    { dimension: 'preference', score: scores.preference, text: '结合风格、颜色偏好和避雷标签计算。' },
  ];
}

function buildTemplateReasoning(scene, items, scores, tempConfig) {
  const names = items
    .map((item) => item.customName || item.subCategory || item.subcategory || item.category)
    .slice(0, 3)
    .join('、');
  const colorText = scores.colorHarmony >= 8 ? '配色干净' : '配色有层次';
  const temperatureText = scores.weatherAdaptation >= 8 ? '今天穿着也舒服' : tempConfig.advice;
  return `${names}，适合${scene || '日常'}；${colorText}，${temperatureText}。`;
}

function buildFriendlyReasoning(scene, items, scores, tempConfig) {
  if (!items.length) return buildTemplateReasoning(scene, items, scores, tempConfig);
  const style = getMainStyle(items);
  const sceneText = scene || '日常';
  const itemNames = items
    .map((item) => item.customName || item.subCategory || item.subcategory || item.category)
    .filter(Boolean)
    .slice(0, 2)
    .join('、');
  const opening =
    scores.sceneMatch >= 8
      ? `这套很贴合${sceneText}节奏，${style}感会显得自然又利落。`
      : `这套更偏轻松耐看的${style}感，用在${sceneText}也不突兀。`;
  const weatherText =
    scores.weatherAdaptation >= 8
      ? '厚薄和透气度都比较稳，今天穿起来会舒服一些。'
      : `${tempConfig.advice}，这套可以作为备选灵感。`;
  const colorText =
    scores.colorHarmony >= 8
      ? '配色干净，单品放在一起不会抢戏。'
      : '颜色有一点层次感，搭配时保持配饰简单会更清爽。';
  const itemText = itemNames ? `${itemNames}把整体气质撑起来，` : '';
  const variants = [
    `${itemText}${opening}${weatherText}`,
    `${opening}${colorText}`,
    `${itemText}${colorText}${weatherText}`,
  ];
  const index = Math.abs(
    signature(items.map((item) => item._id))
      .split('')
      .reduce((sum, char) => sum + char.charCodeAt(0), 0),
  ) % variants.length;
  return variants[index];
}

function normalizeWeather(weather) {
  if (!weather || typeof weather !== 'object') return null;
  const normalized = normalizeRecommendationWeather(weather, weather.mode || weather.weatherMode);
  return hasRealRecommendationWeather(normalized) ? toWeatherSnapshot(normalized) : null;
}

function normalizeCategory(item) {
  const category = item.category;
  if (resolveCategoryValues('top').includes(category)) return 'top';
  if (resolveCategoryValues('bottom').includes(category)) return 'bottom';
  if (resolveCategoryValues('onepiece').includes(category)) return 'onepiece';
  if (resolveCategoryValues('shoes').includes(category)) return 'shoes';
  if (resolveCategoryValues('accessory').includes(category)) return 'accessory';
  return 'other';
}

function isOuterwear(item) {
  const text = `${item.category || ''} ${item.subcategory || ''} ${item.subCategory || ''} ${item.customName || ''}`;
  return ['jacket', 'down_jacket', 'blazer', 'coat', 'trench', 'cardigan', '外套', '夹克', '西装', '羽绒服'].some((hint) => text.includes(hint));
}

function isSkirt(item) {
  const text = `${item.subcategory || ''} ${item.subCategory || ''} ${item.customName || ''}`;
  return text.includes('skirt') || text.includes('裙');
}

function getMainStyle(items) {
  const styles = items.flatMap((item) => readArray(item.styleTags));
  return styles.find(Boolean) || '日常';
}

function normalizeColors(item) {
  if (Array.isArray(item.colorPalette) && item.colorPalette.length > 0) return item.colorPalette;
  return readArray(item.colors).map((name) => ({ name, hex: '' }));
}

function readColorText(item) {
  if (!item) return '';
  const colors = normalizeColors(item).map((color) => color.name).filter(Boolean);
  return colors.join(' / ');
}

function classifyColor(value) {
  if (!value) return 'neutral';
  const colorName = String(value).trim().toLowerCase();
  if (/灰蓝|蓝灰|雾霾蓝|浅绿|灰绿|墨绿|steelblue|slateblue|olive|green|blue/.test(colorName)) return 'vivid';
  if (/黑|白|纯灰|中灰|深灰|浅灰|米白|米色|卡其|棕|咖|藏青|black|white|gray|grey|beige|khaki|brown|navy/.test(colorName)) return 'neutral';
  if (!value.startsWith('#') || value.length < 7) return 'vivid';

  const r = parseInt(value.slice(1, 3), 16) / 255;
  const g = parseInt(value.slice(3, 5), 16) / 255;
  const b = parseInt(value.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  if (s < 0.15 || l < 0.15 || l > 0.85) return 'neutral';

  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  if (h < 60 || h >= 300) return 'warm';
  if (h >= 180 && h < 300) return 'cool';
  return 'vivid';
}

function readArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function readSnapshotStyleTags(items) {
  return uniqueStrings((items || []).flatMap((item) => String(item.style || '').split(/[,/，、\s]+/)));
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveInitialCacheMissReason({ isRefreshRequest, requestedCandidatePoolId }) {
  if (isRefreshRequest) {
    return requestedCandidatePoolId ? '' : 'refresh_without_pool_id';
  }
  return 'initial_request';
}

function mapCandidatePoolLoadReason(reason) {
  const value = readString(reason);
  if (value === 'not_found') return 'candidate_pool_missing';
  if (value === 'expired' || value === 'ttl_invalid') return 'candidate_pool_expired';
  if (value === 'user_mismatch' || value === 'identity_changed') return 'candidate_pool_identity_mismatch';
  return value || 'pool_corrupt';
}

function sameIdSet(a, b) {
  return signature(a) === signature(b);
}

function signature(ids) {
  return ids.slice().sort().join('_');
}

function overlapRatio(a, b) {
  const set = new Set(a);
  return b.filter((id) => set.has(id)).length / Math.max(b.length, 1);
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function sanitizeScores(scores) {
  return {
    total: normalizeScore(scores.total),
    weatherAdaptation: normalizeScore(scores.weatherAdaptation),
    styleUnity: normalizeScore(scores.styleUnity),
    freshness: normalizeScore(scores.freshness),
    preference: normalizeScore(scores.preference),
    fashion: normalizeScore(scores.fashion),
    comfort: normalizeScore(scores.comfort),
    warmth: normalizeScore(scores.warmth),
    coolness: normalizeScore(scores.coolness),
    sceneMatch: normalizeScore(scores.sceneMatch),
    sceneFitScore: normalizeScore(scores.sceneFitScore ?? scores.sceneMatch),
    colorHarmony: normalizeScore(scores.colorHarmony),
  };
}

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, round1(score)));
}

function normalizeFiniteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function isWithinDays(dateText, days) {
  const time = new Date(dateText).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

function pickOutfitItems(clothes, excludeSets, recommendationProfile) {
  const byCategory = (category) => clothes.filter((item) => resolveCategoryValues(category).includes(item.category));
  const combos = [
    [first(byCategory('top')), first(byCategory('bottom')), first(byCategory('shoes'))],
    [first(byCategory('onepiece')), first(byCategory('shoes')), first(byCategory('accessory'))],
    [first(byCategory('top')), first(byCategory('bottom')), first(byCategory('accessory'))],
  ]
    .map((items) => items.filter(Boolean))
    .filter((items) => items.length >= 2);

  const available = combos
    .map((items) => ({ items, score: scorePreferenceMatch(items, recommendationProfile) }))
    .sort((a, b) => b.score - a.score)
    .find(({ items }) => {
      const ids = items.map((item) => item._id).sort().join(',');
      return !excludeSets.some((set) => Array.isArray(set) && set.slice().sort().join(',') === ids);
    });

  return available ? available.items : [];
}

function first(items) {
  return items[0] || null;
}

function normalizeRecommendationProfile(styleProfile) {
  const profile = styleProfile || {};
  const recommendationProfile = profile.recommendationProfile || {};
  return {
    genderPreference: readEnum(recommendationProfile.genderPreference, ['male_style', 'female_style', 'neutral_style', 'all', 'unknown'], 'unknown'),
    styleTags: Array.isArray(recommendationProfile.styleTags)
      ? recommendationProfile.styleTags
      : Array.isArray(profile.preferredStyles)
        ? profile.preferredStyles
        : [],
    fitPreference: readEnum(recommendationProfile.fitPreference, ['loose', 'regular', 'slim', 'oversize', 'unknown'], 'unknown'),
    colorPreference: Array.isArray(recommendationProfile.colorPreference) ? recommendationProfile.colorPreference : [],
    avoidTags: Array.isArray(recommendationProfile.avoidTags) ? recommendationProfile.avoidTags : [],
    temperatureSensitivity: readEnum(recommendationProfile.temperatureSensitivity, ['cold_sensitive', 'normal', 'heat_sensitive'], 'normal'),
  };
}

function scorePreferenceMatch(items, profile) {
  const text = items
    .flatMap((item) => [
      item.category,
      item.subcategory,
      item.material,
      item.customName,
      ...(item.styleTags || []),
      ...(item.sceneTags || []),
      ...(item.colorPalette || []).map((color) => color.name),
    ])
    .filter(Boolean)
    .join(' ');

  let score = 0;
  score += countMatches(text, profile.styleTags) * 2;
  score += countMatches(text, profile.colorPreference) * 1.2;
  score -= countMatches(text, profile.avoidTags) * 1.5;
  score += scoreFitPreference(text, profile.fitPreference);
  // Recommendation direction only. This is not the user's gender identity
  // and must never exclude clothing; it only nudges ranking.
  score += scoreGenderPreference(text, profile.genderPreference);
  return score;
}

function scoreGenderPreference(text, preference) {
  if (preference === 'unknown' || preference === 'all') return 0;
  const maleHints = ['工装', '街头', '运动', '美式复古', '中性', '简约'];
  const femaleHints = ['甜美', '甜酷', '优雅', '法式', '韩系', '日系'];
  const neutralHints = ['中性', '极简', 'Clean Fit', '简约', '休闲'];
  const hints =
    preference === 'male_style'
      ? maleHints
      : preference === 'female_style'
        ? femaleHints
        : neutralHints;
  return hints.some((hint) => text.includes(hint)) ? 0.8 : 0;
}

function scoreFitPreference(text, preference) {
  if (preference === 'unknown') return 0;
  const hints = {
    loose: ['宽松', '休闲'],
    regular: ['合身', '简约', '通勤'],
    slim: ['修身', '优雅'],
    oversize: ['Oversize', '宽松', '街头'],
  };
  return (hints[preference] || []).some((hint) => text.includes(hint)) ? 0.6 : 0;
}

function countMatches(text, tags) {
  return (tags || []).filter((tag) => text.includes(tag)).length;
}

function readEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function toOutfit(item, clothes) {
  const today = new Date().toISOString().slice(0, 10);
  const clothingIds = item.clothingIds || [];
  const clothesMap = new Map((clothes || []).map((clothing) => [clothing._id, clothing]));
  const snapshotMap = new Map(normalizeSnapshotItems(item.snapshotItems).map((snapshot) => [snapshot.itemId, snapshot]));
  const snapshotItems = clothingIds.map((id) => snapshotFromClothing(clothesMap.get(id), snapshotMap.get(id), id));
  const deletedItemCount = snapshotItems.filter((snapshot) => snapshot.isDeleted || !clothesMap.has(snapshot.itemId)).length;
  const incomplete = Boolean(item.incomplete) || deletedItemCount > 0;

  return {
    id: item._id,
    outfitId: item.outfitId || item._id,
    userId: item._openid,
    title: item.title,
    userTitle: readTitle(item.userTitle) || undefined,
    displayTitle: getDisplayTitle(item, `${item.scene || '今日'}搭配`),
    clothingIds,
    outfitKey: item.outfitKey || getOutfitKey(clothingIds),
    snapshotItems,
    incomplete,
    deletedItemCount,
    items: snapshotItems.map((snapshot) => {
      const clothing = clothesMap.get(snapshot.itemId);
      const displayImageUrl = getDisplayImage(clothing) || snapshot.displayImageUrl || snapshot.imageUrl || '';
      const thumbnailUrl = getThumbnailImage(clothing) || snapshot.thumbnailUrl || displayImageUrl;
      return {
        clothingId: snapshot.itemId,
        category: clothing?.category || snapshot.category || 'other',
        subcategory: clothing?.subcategory || snapshot.name,
        imageUrl: clothing?.imageUrl || snapshot.imageUrl || displayImageUrl || thumbnailUrl,
        displayImageUrl,
        thumbnailUrl,
        colorPalette: clothing?.colorPalette || [],
        isDeleted: Boolean(snapshot.isDeleted || !clothing),
        ...pickCopyEvidenceSnapshotFields(clothing, snapshot),
      };
    }),
    scene: item.scene,
    targetDate: item.targetDate,
    timeOfDay: item.timeOfDay,
    weatherSnapshot: item.weatherSnapshot || item.weather,
    weatherMode: item.weatherMode || ((item.weatherSnapshot || item.weather) ? 'live' : 'unavailable'),
    eligibility: item.eligibility,
    eligibilityReason: cloneEligibilityReason(item.eligibilityReason),
    scores: sanitizeScores(item.scores || {}),
    aestheticEvaluation: normalizeAestheticEvaluationForStorage(item.aestheticEvaluation),
    scoreExplanations: item.scoreExplanations || [],
    generationType: item.generationType || 'auto',
    sourceItemId: item.sourceItemId,
    source: item.source || 'recommend',
    presentationPlan: item.presentationPlan,
    isFavorite: Boolean(item.isFavorite),
    favoriteOutfitId: item.favoriteOutfitId || undefined,
    favoritedAt: item.favoritedAt || undefined,
    wornAt: item.wornAt || undefined,
    wornDate: item.wornDate || undefined,
    isWornToday: Boolean(item.isWornToday) || item.wornDate === today,
    todayHistoryId: item.todayHistoryId || undefined,
    historyId: item.historyId || undefined,
    lastWornAt: item.lastWornAt || item.wornAt || undefined,
    recommendationBatchId: item.recommendationBatchId || undefined,
    generatedAt: item.generatedAt || undefined,
    styleTags: readStringArray(item.styleTags).length ? readStringArray(item.styleTags) : [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reason: item.reason || item.reasoning,
    reasoning: item.reasoning || item.reason,
    reasonVersion: item.reasonVersion,
    ...pickRecommendationCopyContractFields(item),
    ...pickOutfitStoryFields(item),
    ...mapAiReviewAtBoundary(item, (value) => normalizeRecommendationAiComment(value, item)),
  };
}

function normalizeUserTitleInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateUserTitle(value) {
  if (!value) return;
  if (Array.from(value).length > 20) {
    throw new Error('穿搭名称最多 20 个字');
  }
}

function readTitle(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDisplayTitle(outfit, fallback) {
  return readTitle(outfit?.displayTitle) || readTitle(outfit?.userTitle) || readTitle(outfit?.title) || fallback;
}

function resolveCategoryValues(category) {
  const map = {
    top: ['top', '上衣', '外套'],
    bottom: ['bottom', '裤子', '裙子'],
    onepiece: ['onepiece', '连衣裙'],
    shoes: ['shoes', '鞋子'],
    accessory: ['accessory', '包', '帽子', '配饰'],
    other: ['other', '其他'],
  };
  return map[category] || [category];
}

function getDisplayImage(item) {
  if (!item) return '';
  return item.displayImageUrl
    || item.cleanImageUrl
    || item.aiSegmentImageUrl
    || item.cropImageUrl
    || item.croppedImageUrl
    || item.imageUrl
    || item.originalImageUrl
    || '';
}

function getThumbnailImage(item) {
  if (!item) return '';
  return item.thumbnailUrl || item.thumbImageUrl || getDisplayImage(item);
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  const errorCode = error && (error.businessCode || error.aiReviewCode);
  const data = errorCode ? { errorCode } : null;
  if (errorCode === 'OUTFIT_REFERENCE_WRITE_FAILED' && data) {
    data.debug = {
      outfitReferenceWriteFailure: getSafeOutfitReferenceCause(error.cause),
    };
  }
  return {
    code: 1,
    data,
    message: error && error.message ? error.message : 'unknown error',
  };
}

function createBusinessError(code, message) {
  const error = new Error(message);
  error.businessCode = code;
  return error;
}

if (process.env.NODE_ENV === 'test') {
  exports.__test = {
    PRESENTATION_FACT_MODEL_BUILD,
    buildRecommendationResponseData,
    buildSceneEvidenceAcceptanceDiagnostics,
    projectRecommendationResponseOutfits,
    buildOutfitSaveData,
    buildOutfitReferenceUpdatePayload,
    buildSnapshotRecordData,
    buildAiReviewGeneratingData,
    buildAiReviewReadyDocument,
    buildAiReviewStoredDocument,
    alignAiCommentSourceWithRequestedPresentation,
    canonicalizeAiCommentSource,
    createRecommendationSceneContract,
    createRecommendationDiagnostics,
    recordServerPhase,
    finalizeRecommendationResponse,
    measureRecommendationResponseBreakdown,
    stripResponseDiagnosticsForBusinessResponse,
    finalizeFullComputeAfterPoolPersist,
    attachPresentationEvidenceDebug,
    buildPresentationEvidence,
    generateCandidatePoolRecommendations,
    upsertRecommendationOutfitsBatch,
    measureRecommendationResponse,
    measureRecommendationResponseFields,
    materializeRecommendationCanonicalCopyV2,
    normalizeOutfitPayload,
    persistCanonicalCopyMaterialization,
    generateRuleRecommendations,
    buildRankingScore,
    scoreCandidate,
    assertEligibilityReasons,
    toEligibilityReasonDiagnostic,
    toTempOutfit,
    toOutfit,
    toSnapshotOutfit,
    runOutfitReferenceTransaction,
    serializeOutfitReferenceCause,
    getSafeOutfitReferenceCause,
    fail,
    ok,
    isQaAuditEnabled: isRecommendationQaAuditEnabled,
    validateCandidatePoolAvailability,
    resolveInitialCacheMissReason,
    mapCandidatePoolLoadReason,
    resolveEnrichedTitleState,
    isCanonicalCopyRuntimeV2Acceptance,
  };
}
