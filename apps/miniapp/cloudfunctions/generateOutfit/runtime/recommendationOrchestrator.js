'use strict';

const DEFAULT_AI_WINDOW_MS = 6000;
const SERVER_RESPONSE_DEADLINE_MS = 2300;
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

function monotonicNow() {
  return process.hrtime.bigint();
}

function setDiagnostic(context, key, value) {
  const normalized = typeof value === 'bigint' ? Number(value) : value;
  if (context?.diagnostics && typeof context.diagnostics === 'object') {
    context.diagnostics[key] = normalized;
  }
  void safeCall(context?.onTelemetry, { key, value: normalized });
}

// Narrow, request-correlated audit for the interactive first-card path.  This
// deliberately has no effect on scheduling or values used by the runtime.
function auditStage(context, stage, status = 'completed', extra = {}) {
  const diagnostics = context?.diagnostics;
  if (!diagnostics) return;
  const origin = diagnostics.monotonicOriginAt;
  const elapsed = typeof origin === 'bigint' ? elapsedMs(origin) : null;
  const remaining = typeof origin === 'bigint'
    ? Math.max(0, SERVER_RESPONSE_DEADLINE_MS - elapsed)
    : null;
  const entry = {
    auditId: diagnostics.auditId || null,
    stage,
    elapsedFromHandlerMs: elapsed === null ? null : Math.round(elapsed * 1000) / 1000,
    remainingDeadlineMs: remaining === null ? null : Math.round(remaining * 1000) / 1000,
    status,
    ...extra,
  };
  diagnostics.firstCardAudit = diagnostics.firstCardAudit || { stages: [], summary: null };
  diagnostics.firstCardAudit.stages.push(entry);
  try { (diagnostics.stageLogger || console.log)('[RecommendationAudit]', entry); } catch { /* fail-open */ }
}

function deadlineReasonAt(audit) {
  const occurredBeforeDeadline = (stage) => audit.stages.some((entry) => entry.stage === stage
    && !['skipped', 'not_occurred', 'not_reached', 'not_admitted'].includes(entry.status)
    && Number(entry.elapsedFromHandlerMs) < SERVER_RESPONSE_DEADLINE_MS);
  if (!occurredBeforeDeadline('FIRST_CARD_AI_ADMITTED')) return 'PRE_AI_EXHAUSTION';
  if (!occurredBeforeDeadline('PROVIDER_START')) return 'PRE_PROVIDER';
  if (!occurredBeforeDeadline('PROVIDER_COMPLETE')) return 'PROVIDER_IN_FLIGHT';
  if (!occurredBeforeDeadline('VALIDATOR_COMPLETE')) return 'VALIDATOR_IN_FLIGHT';
  if (!occurredBeforeDeadline('CANONICAL_PERSISTED')) return 'POST_VALIDATION';
  return 'ORCHESTRATOR_TIMEOUT';
}

function auditSummary(context, extra = {}) {
  const diagnostics = context?.diagnostics;
  if (!diagnostics) return null;
  const audit = diagnostics.firstCardAudit || { stages: [] };
  const has = (stage) => audit.stages.some((entry) => entry.stage === stage
    && !['skipped', 'not_occurred', 'not_reached', 'not_admitted'].includes(entry.status));
  const ai = audit.stages.find((entry) => entry.stage === 'FIRST_CARD_AI_ADMITTED');
  const providerStart = audit.stages.find((entry) => entry.stage === 'PROVIDER_START');
  const providerComplete = audit.stages.find((entry) => entry.stage === 'PROVIDER_COMPLETE');
  const summary = {
    auditId: diagnostics.auditId || null,
    firstCardAiStarted: has('FIRST_CARD_AI_ADMITTED'),
    providerCalled: has('PROVIDER_START'),
    validated: has('VALIDATOR_COMPLETE') && audit.stages.some((entry) => entry.stage === 'VALIDATOR_COMPLETE' && entry.status === 'accepted'),
    persisted: has('CANONICAL_PERSISTED'),
    backgroundDispatched: has('BACKGROUND_DISPATCHED'),
    elapsedBeforeAiStartMs: ai?.elapsedFromHandlerMs ?? null,
    providerDurationMs: providerStart && providerComplete ? Math.max(0, providerComplete.elapsedFromHandlerMs - providerStart.elapsedFromHandlerMs) : null,
    remainingAtAiStartMs: ai?.remainingDeadlineMs ?? null,
    deadlineReason: extra.deadlineReason || audit.deadlineReason || null,
    stageStatus: Object.fromEntries([
      'HANDLER_ENTRY', 'CORE_READY', 'NARRATIVE_PLAN_READY', 'CACHE_LOOKUP_DONE',
      'FIRST_CARD_AI_ADMITTED', 'PROVIDER_START', 'PROVIDER_COMPLETE',
      'VALIDATOR_COMPLETE', 'CANONICAL_PERSISTED', 'BACKGROUND_DISPATCHED',
      'DEADLINE_REACHED',
    ].map((stage) => [stage, has(stage) ? 'occurred' : 'not_occurred'])),
  };
  diagnostics.firstCardAudit.summary = summary;
  try { (diagnostics.stageLogger || console.log)('[RecommendationAuditSummary]', summary); } catch { /* fail-open */ }
  return summary;
}

function elapsedMs(origin) {
  return Number(monotonicNow() - origin) / 1e6;
}

async function runRecommendationOrchestrator(input = {}, context = {}, lifecycleHooks = {}) {
  const normalized = normalizeInput(input);
  void safeCall(lifecycleHooks.onInputNormalized, { input: normalized });
  const startedAt = Date.now();
  const suppliedOrigin = context.requestMonotonicOriginAt ?? context.diagnostics?.monotonicOriginAt;
  const requestOrigin = typeof suppliedOrigin === 'bigint' ? suppliedOrigin : monotonicNow();
  auditStage(context, 'HANDLER_ENTRY', 'entered', {
    elapsedFromHandlerMs: 0,
    remainingDeadlineMs: SERVER_RESPONSE_DEADLINE_MS,
  });
  setDiagnostic(context, 'requestStart', 0);
  setDiagnostic(context, 'AI_LATE_DISCARDED', false);
  const deadlineAt = requestOrigin + globalThis.BigInt(SERVER_RESPONSE_DEADLINE_MS) * 1000000n;
  let core;
  let prepared;
  try {
    core = await runRecommendationCore(normalized, context);
    auditStage(context, 'CORE_READY');
    setDiagnostic(context, 'coreResultReady', elapsedMs(requestOrigin));
    void safeCall(lifecycleHooks.onCoreResultAvailable, { result: core, input: normalized });
    prepared = typeof context.prepareRecommendationWork === 'function'
      ? await context.prepareRecommendationWork(core, normalized)
      : { tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [] };
    const raw = prepared.narrativePayload || {
      plans: getPlans(prepared),
      entries: getEntries(prepared),
      batchId: prepared.batchId || core.metadata.batchId,
    };
    const narrativePayload = {
      ...raw,
      plans: Array.isArray(raw.plans) ? raw.plans : [],
      entries: Array.isArray(raw.entries) ? raw.entries : [],
    };
    if (narrativePayload.plans.length || narrativePayload.entries.length) {
      auditStage(context, 'NARRATIVE_PLAN_READY');
      void safeCall(lifecycleHooks.onNarrativePlansReady, narrativePayload);
    }
    void safeCall(lifecycleHooks.onPostC2TasksScheduled, {
      tasks: Array.isArray(prepared.tasks) ? prepared.tasks : [],
      batchId: prepared.batchId || core.metadata.batchId,
    });
    if (typeof context.persistAndAssembleRecommendation !== 'function') {
      throw new Error('RECOMMENDATION_RESPONSE_ASSEMBLER_REQUIRED');
    }
    const interactive = prepared.firstCardInteractive;
    if (!interactive) {
      const response = await context.persistAndAssembleRecommendation(core, prepared, normalized);
      return finishLegacy({ core, prepared, response, context, lifecycleHooks, startedAt, requestOrigin });
    }
    const requiredPromise = asPromise(
      context.persistAndAssembleRecommendation(core, prepared, normalized),
    );
    const cardPromise = runFirstCard(interactive, context, requestOrigin);
    const remainingMs = Math.max(0, Number(deadlineAt - monotonicNow()) / 1e6);
    let timer;
    const deadlinePromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        auditStage(context, 'DEADLINE_REACHED', 'timeout');
        if (context?.diagnostics?.firstCardAudit) {
          context.diagnostics.firstCardAudit.deadlineReason = deadlineReasonAt(
            context.diagnostics.firstCardAudit,
          );
        }
        setDiagnostic(context, 'deadlineReached', elapsedMs(requestOrigin));
        setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'TIMEOUT');
        resolve({ status: 'TIMEOUT' });
      }, remainingMs);
    });
    const first = await Promise.race([cardPromise, deadlinePromise]);
    if (timer) clearTimeout(timer);
    const response = await requiredPromise;
    let finalResponse = response;
    let outcome = first;
    if (first.status === 'SUCCESS' || first.status === 'CACHE_HIT') {
      try {
        const persisted = first.status === 'CACHE_HIT'
          ? first.copy
          : await asPromise(interactive.persistCanonicalCopy(first.copy));
        if (first.status !== 'CACHE_HIT') {
          auditStage(context, 'CANONICAL_PERSISTED');
          setDiagnostic(context, 'firstCardCanonicalPersisted', elapsedMs(requestOrigin));
        }
        if (typeof interactive.applyCanonicalToResponse === 'function') {
          finalResponse = await interactive.applyCanonicalToResponse(
            response,
            persisted || first.copy,
          );
        }
      } catch (error) {
        outcome = { status: 'FAIL', reason: 'PERSIST_FAIL', error };
      }
    }
    // The existing worker is also responsible for card1..N after success;
    // it recognizes a persisted card0 and skips regenerating that card.
    void safeCall(interactive.scheduleBackgroundMaterialization, outcome);
    auditStage(
      context,
      'BACKGROUND_DISPATCHED',
      typeof interactive.scheduleBackgroundMaterialization === 'function' ? 'dispatched' : 'not_reached',
    );
    auditSummary(context);
    const result = buildResult({
      core,
      prepared,
      response: finalResponse,
      context,
      lifecycleHooks,
      startedAt,
      requestOrigin,
      outcome,
    });
    void cardPromise.then((late) => {
      if (first.status !== 'TIMEOUT') return;
      setDiagnostic(context, 'AI_LATE_DISCARDED', true);
      setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'TIMEOUT');
      void safeCall(interactive.scheduleBackgroundMaterialization, late);
    });
    return result;
  } catch (error) {
    await safeCall(lifecycleHooks.onRuntimeFailure, { error, input: normalized });
    throw error;
  }
}

async function runFirstCard(interactive, context, origin) {
  let admission = interactive;
  if (typeof interactive.resolveAdmission === 'function') {
    try {
      admission = { ...interactive, ...(await interactive.resolveAdmission()) };
      auditStage(context, 'CACHE_LOOKUP_DONE', admission.cachedCopy ? 'hit' : 'miss');
    } catch (error) {
      auditStage(context, 'CACHE_LOOKUP_DONE', 'failed');
      setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
      return { status: 'FAIL', reason: 'PROVIDER_FAIL', error };
    }
  }
  if (admission.cachedCopy) {
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'CACHE_HIT');
    return { status: 'CACHE_HIT', copy: admission.cachedCopy };
  }
  if (typeof context.renderFirstCardCanonical !== 'function' || !admission.entry) {
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
    return { status: 'FAIL', reason: 'NO_INTERACTIVE_RENDERER' };
  }
  const aiStartedAt = monotonicNow();
  auditStage(context, 'FIRST_CARD_AI_ADMITTED', 'admitted');
  setDiagnostic(context, 'firstCardAiStart', elapsedMs(origin));
  try {
    const result = await context.renderFirstCardCanonical({
      entry: admission.entry,
      rendererConfig: {
        ...(admission.rendererConfig || {}),
        onAuditStage: (stage, status) => auditStage(context, stage, status),
      },
    });
    const aiMs = Number(monotonicNow() - aiStartedAt) / 1e6;
    setDiagnostic(context, 'FIRST_CARD_AI_MS', aiMs);
    const status = String(result?.status || '').toUpperCase();
    if (status !== 'SUCCESS') {
      const failureType = String(result?.failureType || '').toUpperCase();
      const reason = failureType === 'VALIDATOR_FAIL' || status === 'VALIDATOR_FAIL'
        ? 'VALIDATOR_FAIL'
        : 'PROVIDER_FAIL';
      setDiagnostic(context, 'FIRST_CARD_AI_RESULT', reason);
      return { status: 'FAIL', reason, result };
    }
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'SUCCESS');
    setDiagnostic(context, 'firstCardAiValidated', elapsedMs(origin));
    return {
      status: 'SUCCESS',
      copy: result.copy || result.canonicalCopy,
      metadata: result.metadata,
      aiMs,
    };
  } catch (error) {
    setDiagnostic(context, 'FIRST_CARD_AI_MS', Number(monotonicNow() - aiStartedAt) / 1e6);
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
    return { status: 'FAIL', reason: 'PROVIDER_FAIL', error };
  }
}

function buildResult({
  core,
  prepared,
  response,
  context,
  lifecycleHooks,
  startedAt,
  requestOrigin,
  outcome,
}) {
  const batchId = response?.batch?.batchId || prepared.batchId || core.metadata.batchId;
  const countContract = response?.batch?.countContract || core.executionState.countContract;
  setDiagnostic(context, 'recommendationReady', elapsedMs(requestOrigin));
  void safeCall(lifecycleHooks.onRecommendationReady, {
    batchId,
    response,
    countContract,
    identity: core.identity,
    elapsedMs: Date.now() - startedAt,
  });
  setDiagnostic(context, 'REQUEST_TO_RESPONSE_READY_MS', elapsedMs(requestOrigin));
  setDiagnostic(context, 'responseReady', elapsedMs(requestOrigin));
  return {
    ...core,
    response,
    batchId,
    countContract,
    rendererEntries: getEntries(prepared),
    firstCardAi: outcome,
    aiDone: Promise.resolve(outcome),
    aiPromise: Promise.resolve(outcome),
    startedAt,
    requestMonotonicOriginAt: requestOrigin,
  };
}

async function finishLegacy({
  core,
  prepared,
  response,
  context,
  lifecycleHooks,
  startedAt,
  requestOrigin,
}) {
  const entries = getEntries(prepared);
  const batchId = response?.batch?.batchId || prepared.batchId || core.metadata.batchId;
  const countContract = response?.batch?.countContract || core.executionState.countContract;
  await safeCall(lifecycleHooks.onRecommendationReady, {
    batchId,
    response,
    countContract,
    identity: core.identity,
    elapsedMs: Date.now() - startedAt,
  });
  let aiPromise = Promise.resolve({ status: 'noop', copyCount: 0 });
  const renderer = context.renderer || context.render;
  if (entries.length && typeof renderer === 'function') {
    aiPromise = Promise.resolve().then(() => renderer({
      entries,
      plans: core.narrativePlans,
      batchId,
      userIdentity: context.userIdentity,
      onCopy: async (copy) => safeCall(lifecycleHooks.onCanonicalCopy, { batchId, copy }),
    })).catch((error) => ({ status: 'failed_open', error }));
  }
  const aiWindowMs = Math.max(0, Number(context.aiWindowMs ?? DEFAULT_AI_WINDOW_MS));
  let timer;
  const aiDone = Promise.race([
    aiPromise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'window_expired' }), aiWindowMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  return {
    ...core,
    response,
    batchId,
    countContract,
    rendererEntries: entries,
    aiDone,
    aiPromise,
    startedAt,
    requestMonotonicOriginAt: requestOrigin,
  };
}

module.exports = { DEFAULT_AI_WINDOW_MS, SERVER_RESPONSE_DEADLINE_MS, runRecommendationOrchestrator };
