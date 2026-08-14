const {
  VOICE_RENDERER_CONTRACT_VERSION,
  VOICE_RENDERER_MODEL,
  VOICE_RENDERER_MODEL_ROUTE_VERSION,
} = require('./voiceRendererV2Contract');
const {
  buildRecommendationVoiceMaterializationEntry,
  readCachedRecommendationVoiceCopies,
} = require('./recommendationVoiceRendererShadowV2');
const {
  RECOMMENDATION_SAFE_RENDERER_VERSION,
  renderRecommendationSafeCopyV2Safely,
} = require('./recommendationSafeRendererV2');

const RECOMMENDATION_CANONICAL_COPY_RUNTIME_VERSION = 'recommendation-canonical-copy-runtime-v2.0';
const authorizedRuntimeEvents = new WeakSet();
const CANONICAL_COPY_SOURCES = new Set(['safe', 'ai_cache', 'legacy_emergency']);
const CANONICAL_COPY_AI_STATES = new Set(['not_requested', 'materializing', 'ready', 'failed']);

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

function attachRecommendationCanonicalCopiesV2(outfits = [], batch = null, plans = []) {
  const visible = Array.isArray(outfits) ? outfits : [];
  if (!batch || !Array.isArray(batch.copies)) return visible;
  const byComposition = new Map(batch.copies.map((copy) => [copy.compositionKey, copy]));
  const plansByComposition = new Map((Array.isArray(plans) ? plans : []).map((plan) => [
    compositionKey(plan?.identity?.outfitComposition?.itemIds),
    plan,
  ]));
  const total = visible.length;
  return visible.map((outfit, index) => {
    const outfitCompositionKey = compositionKey(readOutfitItemIds(outfit));
    const copy = byComposition.get(outfitCompositionKey);
    const plan = plansByComposition.get(outfitCompositionKey);
    const legacyText = readText(outfit?.copyContract?.todayReason || outfit?.reason);
    const text = readText(copy?.text) || legacyText;
    const source = readText(copy?.text) ? copy.source : 'legacy_emergency';
    return {
      ...outfit,
      reason: text,
      ...(outfit?.copyContract
        ? { copyContract: { ...outfit.copyContract, todayReason: text } }
        : {}),
      ...(plan ? {
        recommendationVoiceMaterializationV2: buildRecommendationVoiceMaterializationEntry(plan, outfit),
      } : {}),
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

function assertRecommendationCanonicalCopiesV2(outfits = []) {
  const visible = Array.isArray(outfits) ? outfits : [];
  visible.forEach((outfit, index) => {
    const canonical = normalizeCanonicalCopy(outfit?.canonicalRecommendationCopyV2);
    if (!canonical
      || canonical.version !== RECOMMENDATION_CANONICAL_COPY_RUNTIME_VERSION
      || canonical.batchIndex !== index
      || canonical.batchTotal !== visible.length
      || !CANONICAL_COPY_SOURCES.has(canonical.source)
      || !CANONICAL_COPY_AI_STATES.has(canonical.aiState)
      || readText(outfit?.reason) !== canonical.text
      || (outfit?.copyContract && readText(outfit.copyContract.todayReason) !== canonical.text)) {
      throw new Error('canonical recommendation copy v2 invariant failed');
    }
  });
  return true;
}

function resolveCanonicalCopyForStorage(base = {}, current = {}, { allowCachedFallback = true } = {}) {
  const next = normalizeCanonicalCopy(base?.canonicalRecommendationCopyV2);
  const cached = normalizeCanonicalCopy(current?.canonicalRecommendationCopyV2);
  if (cached?.source === 'ai_cache'
    && cached.aiState === 'ready'
    && cached.renderInputFingerprint
    && cached.renderInputFingerprint === next?.renderInputFingerprint) {
    return cached;
  }
  return next || (allowCachedFallback ? cached : null) || null;
}

function applyCanonicalCopyToOutfit(outfit = {}, copy = null) {
  const canonical = normalizeCanonicalCopy(copy);
  if (!canonical) return outfit;
  return {
    ...outfit,
    reason: canonical.text,
    reasoning: canonical.text,
    ...(outfit?.copyContract
      ? { copyContract: { ...outfit.copyContract, todayReason: canonical.text } }
      : {}),
    canonicalRecommendationCopyV2: canonical,
  };
}

function buildMaterializedCanonicalCopy(existing, cachedCopy) {
  const canonical = normalizeCanonicalCopy(existing);
  const text = readText(cachedCopy?.text);
  const fingerprint = readText(cachedCopy?.renderInputFingerprint);
  if (!canonical || !text || !fingerprint || fingerprint !== canonical.renderInputFingerprint) return null;
  const materialized = {
    ...canonical,
    source: 'ai_cache',
    text,
    aiState: 'ready',
  };
  delete materialized.aiFailureCode;
  return materialized;
}

function buildFailedCanonicalCopy(existing, failureCode) {
  const canonical = normalizeCanonicalCopy(existing);
  if (!canonical || canonical.aiState === 'ready') return canonical;
  return {
    ...canonical,
    aiState: 'failed',
    aiFailureCode: readText(failureCode || 'VOICE_RENDERER_FAILED').slice(0, 80),
  };
}

function normalizeCanonicalCopy(value) {
  if (!value || typeof value !== 'object' || !readText(value.text)) return null;
  return { ...value, text: readText(value.text) };
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
  applyCanonicalCopyToOutfit,
  assertRecommendationCanonicalCopiesV2,
  attachRecommendationCanonicalCopiesV2,
  authorizeRecommendationCanonicalCopyRuntimeV2,
  buildFailedCanonicalCopy,
  buildMaterializedCanonicalCopy,
  buildRecommendationCanonicalCopyBatchV2,
  isRecommendationCanonicalCopyRuntimeV2Enabled,
  resolveCanonicalCopyForStorage,
};
