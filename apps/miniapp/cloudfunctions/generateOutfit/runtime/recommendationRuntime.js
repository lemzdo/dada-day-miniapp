'use strict';

/**
 * Transport-neutral recommendation orchestration.
 *
 * The recommendation core is deliberately injected.  This keeps wx-server-sdk,
 * HTTP and SSE out of the recommendation contract and lets callFunction/Event
 * and HTTP use exactly the same ordering and fail-open rules.
 */
const DEFAULT_AI_WINDOW_MS = 6000;

function normalizeInput(input = {}) {
  return {
    ...input,
    ...(typeof input.scene === 'string' ? { scene: input.scene.trim() } : {}),
    maxResults: Math.max(0, Math.min(8, Number(input.maxResults) || 8)),
  };
}

function asPromise(value) { return Promise.resolve(value); }

function safeCall(fn, value) {
  if (typeof fn !== 'function') return Promise.resolve();
  try { return asPromise(fn(value)).catch(() => undefined); } catch { return Promise.resolve(); }
}

function getPlans(result) {
  return Array.isArray(result?.narrativePlans) ? result.narrativePlans
    : Array.isArray(result?.plans) ? result.plans : [];
}

function getEntries(result) {
  return Array.isArray(result?.rendererEntries) ? result.rendererEntries
    : Array.isArray(result?.entries) ? result.entries : [];
}

/**
 * Run the recommendation core.  `context.recommendationCore` is the existing
 * generateOutfit core adapter in production; tests can provide a deterministic
 * core without loading wx-server-sdk.
 */
async function runRecommendationRuntime(input = {}, context = {}, lifecycleHooks = {}) {
  const normalized = normalizeInput(input);
  const core = context.recommendationCore || context.core;
  if (typeof core !== 'function') throw new Error('RECOMMENDATION_CORE_REQUIRED');
  const startedAt = Date.now();
  let result;
  try {
    result = await core(normalized, context);
  } catch (error) {
    await safeCall(lifecycleHooks.onRuntimeFailure, { error, input: normalized });
    throw error;
  }

  const plans = getPlans(result);
  const entries = getEntries(result);
  // C2 is notification-only: neither the renderer nor its hooks can delay the
  // recommendation response.  Hooks are fail-open by design.
  if (plans.length > 0 || entries.length > 0) {
    void safeCall(lifecycleHooks.onNarrativePlansReady, {
      plans, entries, batchId: result?.batchId, response: result?.response,
    });
  }
  await safeCall(lifecycleHooks.onRecommendationReady, {
    batchId: result?.batchId,
    response: result?.response ?? result,
    countContract: result?.countContract ?? result?.response?.batch?.countContract,
    identity: context.userIdentity,
    elapsedMs: Date.now() - startedAt,
  });

  const aiWindowMs = Math.max(0, Number(context.aiWindowMs ?? DEFAULT_AI_WINDOW_MS));
  const renderer = context.renderer || context.render;
  let aiPromise = Promise.resolve({ status: 'noop', copyCount: 0 });
  if (entries.length > 0 && typeof renderer === 'function') {
    aiPromise = (async () => {
      let copies = 0;
      try {
        const summary = await renderer({
          entries,
          plans,
          batchId: result?.batchId,
          userIdentity: context.userIdentity,
          onCopy: async (copy) => {
            copies += 1;
            await safeCall(lifecycleHooks.onCanonicalCopy, {
              batchId: result?.batchId, copy,
            });
          },
        });
        return { ...(summary || {}), status: summary?.status || 'completed', copyCount: copies };
      } catch (error) {
        await safeCall(lifecycleHooks.onAiFailure, { error, batchId: result?.batchId });
        return { status: 'failed_open', copyCount: copies, error };
      }
    })();
  }
  // The returned recommendation is intentionally ready before this promise.
  // Consumers that need a bounded interactive connection may await `aiDone`.
  let timer;
  const aiDone = Promise.race([
    aiPromise,
    new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'window_expired' }), aiWindowMs); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
  return {
    ...result,
    response: result?.response ?? result,
    batchId: result?.batchId,
    aiDone,
    aiPromise,
    startedAt,
  };
}

module.exports = { DEFAULT_AI_WINDOW_MS, normalizeInput, runRecommendationRuntime };
