'use strict';

const DEFAULT_AI_WINDOW_MS = 6000;
const { normalizeInput, runRecommendationCore } = require('./recommendationCore');

function asPromise(value) {
  return Promise.resolve(value);
}

function safeCall(fn, value) {
  if (typeof fn !== 'function') return Promise.resolve();
  try {
    return asPromise(fn(value)).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function getPlans(result) {
  return Array.isArray(result?.narrativePlans) ? result.narrativePlans : [];
}

function getEntries(result) {
  return Array.isArray(result?.rendererEntries)
    ? result.rendererEntries
    : Array.isArray(result?.entries) ? result.entries : [];
}

async function runRecommendationOrchestrator(input = {}, context = {}, lifecycleHooks = {}) {
  const normalized = normalizeInput(input);
  void safeCall(lifecycleHooks.onInputNormalized, { input: normalized });
  const startedAt = Date.now();
  let core;
  let prepared;
  let response;
  try {
    core = await runRecommendationCore(normalized, context);
    void safeCall(lifecycleHooks.onCoreResultAvailable, { result: core, input: normalized });
    prepared = typeof context.prepareRecommendationWork === 'function'
      ? await context.prepareRecommendationWork(core, normalized)
      : { tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [] };
    const rawNarrativePayload = prepared.narrativePayload || {
      plans: getPlans(prepared),
      entries: getEntries(prepared),
      batchId: prepared.batchId || core.metadata.batchId,
    };
    const narrativePayload = {
      ...rawNarrativePayload,
      plans: Array.isArray(rawNarrativePayload.plans) ? rawNarrativePayload.plans : [],
      entries: Array.isArray(rawNarrativePayload.entries) ? rawNarrativePayload.entries : [],
    };
    if (narrativePayload.plans.length > 0 || narrativePayload.entries.length > 0) {
      void safeCall(lifecycleHooks.onNarrativePlansReady, narrativePayload);
    }
    void safeCall(lifecycleHooks.onPostC2TasksScheduled, {
      tasks: Array.isArray(prepared.tasks) ? prepared.tasks : [],
      batchId: prepared.batchId || core.metadata.batchId,
    });
    if (typeof context.persistAndAssembleRecommendation !== 'function') {
      throw new Error('RECOMMENDATION_RESPONSE_ASSEMBLER_REQUIRED');
    }
    response = await context.persistAndAssembleRecommendation(core, prepared, normalized);
  } catch (error) {
    await safeCall(lifecycleHooks.onRuntimeFailure, { error, input: normalized });
    throw error;
  }
  const batchId = response?.batch?.batchId || prepared.batchId || core.metadata.batchId;
  const countContract = response?.batch?.countContract || core.executionState.countContract;
  await safeCall(lifecycleHooks.onRecommendationReady, {
    batchId,
    response,
    countContract,
    identity: core.identity,
    elapsedMs: Date.now() - startedAt,
  });
  const plans = core.narrativePlans;
  const entries = getEntries(prepared);
  const renderer = context.renderer || context.render;
  let aiPromise = Promise.resolve({ status: 'noop', copyCount: 0 });
  if (entries.length > 0 && typeof renderer === 'function') {
    aiPromise = (async () => {
      let copies = 0;
      try {
        const summary = await renderer({
          entries,
          plans,
          batchId,
          userIdentity: context.userIdentity,
          onCopy: async (copy) => {
            copies += 1;
            await safeCall(lifecycleHooks.onCanonicalCopy, { batchId, copy });
          },
        });
        return { ...(summary || {}), status: summary?.status || 'completed', copyCount: copies };
      } catch (error) {
        await safeCall(lifecycleHooks.onAiFailure, { error, batchId });
        return { status: 'failed_open', copyCount: copies, error };
      }
    })();
  }
  const aiWindowMs = Math.max(0, Number(context.aiWindowMs ?? DEFAULT_AI_WINDOW_MS));
  let timer;
  const aiDone = Promise.race([
    aiPromise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'window_expired' }), aiWindowMs);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
  return {
    ...core,
    response,
    batchId,
    countContract,
    rendererEntries: entries,
    aiDone,
    aiPromise,
    startedAt,
  };
}

module.exports = { DEFAULT_AI_WINDOW_MS, runRecommendationOrchestrator };
