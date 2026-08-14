const {
  VOICE_RENDERER_CONTRACT_VERSION,
  VOICE_RENDERER_MODEL,
  VOICE_RENDERER_MODEL_ROUTE_VERSION,
} = require('./voiceRendererV2Contract');
const {
  readCachedRecommendationVoiceCopies,
} = require('./recommendationVoiceRendererShadowV2');
const {
  RECOMMENDATION_SAFE_RENDERER_VERSION,
  renderRecommendationSafeCopyV2Safely,
} = require('./recommendationSafeRendererV2');

const RECOMMENDATION_CANONICAL_COPY_RUNTIME_VERSION = 'recommendation-canonical-copy-runtime-v2.0';
const authorizedRuntimeEvents = new WeakSet();

function authorizeRecommendationCanonicalCopyRuntimeV2(event) {
  if (!event || typeof event !== 'object') throw new Error('CANONICAL_COPY_RUNTIME_EVENT');
  authorizedRuntimeEvents.add(event);
}

function isRecommendationCanonicalCopyRuntimeV2Enabled(event = {}, env = process.env) {
  return env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED === 'true'
    || authorizedRuntimeEvents.has(event);
}

function buildRecommendationCanonicalCopyBatchV2({
  plans = [],
  recommendations = [],
  aiMaterializationRequested = false,
  model = VOICE_RENDERER_MODEL,
  modelRouteVersion = VOICE_RENDERER_MODEL_ROUTE_VERSION,
} = {}) {
  const startedAt = Date.now();
  const entries = matchPlansToRecommendations(plans, recommendations);
  const cachedByPlanId = new Map(readCachedRecommendationVoiceCopies({
    plans: entries.map((entry) => entry.plan),
    recommendations: entries.map((entry) => entry.recommendation),
    model,
    modelRouteVersion,
  }).map((entry) => [entry.planId, entry]));
  const copies = entries.map(({ plan, recommendation }) => {
    const cached = cachedByPlanId.get(plan.planId);
    const safeResult = renderRecommendationSafeCopyV2Safely(plan, recommendation);
    const aiCopy = cached?.copy || null;
    return {
      planId: plan.planId,
      planHash: plan.planHash,
      compositionKey: compositionKey(plan.identity?.outfitComposition?.itemIds),
      renderInputFingerprint: cached?.renderInputFingerprint || '',
      text: aiCopy?.text || safeResult.copy?.text || '',
      source: aiCopy ? 'ai_cache' : safeResult.copy ? 'safe' : 'legacy_emergency',
      aiState: aiCopy ? 'ready' : aiMaterializationRequested ? 'materializing' : 'not_requested',
      safeRendererVersion: RECOMMENDATION_SAFE_RENDERER_VERSION,
      contractVersion: VOICE_RENDERER_CONTRACT_VERSION,
      model,
      modelRouteVersion,
      safeFailureCode: safeResult.status === 'ready' ? '' : safeResult.errorCode,
    };
  });
  return {
    version: RECOMMENDATION_CANONICAL_COPY_RUNTIME_VERSION,
    status: copies.length === recommendations.length ? 'ready' : 'partially_failed_open',
    expectedCopyCount: recommendations.length,
    resolvedCopyCount: copies.length,
    aiCacheHitCount: copies.filter((copy) => copy.source === 'ai_cache').length,
    safeCopyCount: copies.filter((copy) => copy.source === 'safe').length,
    legacyEmergencyCount: recommendations.length - copies.filter((copy) => copy.source !== 'legacy_emergency').length,
    safeLatencyMs: Date.now() - startedAt,
    copies,
  };
}

function attachRecommendationCanonicalCopiesV2(outfits = [], batch = null) {
  const visible = Array.isArray(outfits) ? outfits : [];
  if (!batch || !Array.isArray(batch.copies)) return visible;
  const byComposition = new Map(batch.copies.map((copy) => [copy.compositionKey, copy]));
  const total = visible.length;
  return visible.map((outfit, index) => {
    const copy = byComposition.get(compositionKey(readOutfitItemIds(outfit)));
    const legacyText = readText(outfit?.copyContract?.todayReason || outfit?.reason);
    const text = readText(copy?.text) || legacyText;
    const source = readText(copy?.text) ? copy.source : 'legacy_emergency';
    return {
      ...outfit,
      reason: text,
      ...(outfit?.copyContract
        ? { copyContract: { ...outfit.copyContract, todayReason: text } }
        : {}),
      canonicalRecommendationCopyV2: {
        version: RECOMMENDATION_CANONICAL_COPY_RUNTIME_VERSION,
        batchIndex: index,
        batchTotal: total,
        planHash: copy?.planHash || '',
        renderInputFingerprint: copy?.renderInputFingerprint || '',
        source,
        text,
        aiState: copy?.aiState || 'not_requested',
        contractVersion: copy?.contractVersion || VOICE_RENDERER_CONTRACT_VERSION,
        model: copy?.model || VOICE_RENDERER_MODEL,
        modelRouteVersion: copy?.modelRouteVersion || VOICE_RENDERER_MODEL_ROUTE_VERSION,
        safeRendererVersion: copy?.safeRendererVersion || RECOMMENDATION_SAFE_RENDERER_VERSION,
        ...(copy?.safeFailureCode ? { safeFailureCode: copy.safeFailureCode } : {}),
      },
    };
  });
}

function matchPlansToRecommendations(plans, recommendations) {
  const available = Array.isArray(recommendations) ? recommendations : [];
  return (Array.isArray(plans) ? plans : []).flatMap((plan) => {
    const key = compositionKey(plan?.identity?.outfitComposition?.itemIds);
    const recommendation = available.find((entry) => compositionKey(readOutfitItemIds(entry)) === key);
    return recommendation ? [{ plan, recommendation }] : [];
  });
}

function readOutfitItemIds(outfit) {
  if (Array.isArray(outfit?.clothingIds)) return outfit.clothingIds;
  return (Array.isArray(outfit?.items) ? outfit.items : [])
    .map((item) => item?.clothingId || item?._id || item?.id || item?.itemId);
}

function compositionKey(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))]
    .sort()
    .join('|');
}

function readText(value) { return typeof value === 'string' ? value.trim() : ''; }

module.exports = {
  RECOMMENDATION_CANONICAL_COPY_RUNTIME_VERSION,
  attachRecommendationCanonicalCopiesV2,
  authorizeRecommendationCanonicalCopyRuntimeV2,
  buildRecommendationCanonicalCopyBatchV2,
  isRecommendationCanonicalCopyRuntimeV2Enabled,
};
