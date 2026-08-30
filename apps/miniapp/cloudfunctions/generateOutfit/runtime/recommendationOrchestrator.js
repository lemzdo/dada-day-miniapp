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
  const origin = context?.handlerOrigin;
  const deadlineAt = context?.deadlineAt;
  const now = monotonicNow();
  const elapsed = typeof origin === 'bigint' ? Number(now - origin) / 1e6 : null;
  const remaining = typeof deadlineAt === 'bigint'
    ? Math.max(0, Number(deadlineAt - now) / 1e6)
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
  const backgroundAccepted = audit.stages.some((entry) => entry.stage === 'BACKGROUND_DISPATCHED'
    && ['dispatched', 'joined'].includes(entry.status));
  const summary = {
    auditId: diagnostics.auditId || null,
    firstCardAiStarted: has('FIRST_CARD_AI_ADMITTED'),
    providerCalled: has('PROVIDER_START'),
    validated: has('VALIDATOR_COMPLETE') && audit.stages.some((entry) => entry.stage === 'VALIDATOR_COMPLETE' && entry.status === 'accepted'),
    persisted: has('CANONICAL_PERSISTED'),
    backgroundDispatched: backgroundAccepted,
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
  const handlerOrigin = typeof context.handlerOrigin === 'bigint' ? context.handlerOrigin : monotonicNow();
  context.handlerOrigin = handlerOrigin;
  const deadlineAt = handlerOrigin + globalThis.BigInt(SERVER_RESPONSE_DEADLINE_MS) * 1000000n;
  context.deadlineAt = deadlineAt;
  auditStage(context, 'HANDLER_ENTRY', 'entered');
  setDiagnostic(context, 'requestStart', 0);
  setDiagnostic(context, 'AI_LATE_DISCARDED', false);
  let earlyInteractive = null;
  let earlyCardPromise = null;
  let winningInteractive = null;
  const orchestrationContext = {
    ...context,
    onFirstCardReady: (payload) => {
      if (earlyInteractive || typeof context.prepareFirstCardInteractive !== 'function') return;
      try {
        earlyInteractive = context.prepareFirstCardInteractive(payload);
        const start = (value) => {
          winningInteractive = value;
          return runFirstCard(value, context, handlerOrigin, deadlineAt);
        };
        // Production preparation is synchronous, so runFirstCard reaches the
        // canonical read immediately while Core continues plans 1..N. Keep
        // Promise support for injected adapters without duplicating the path.
        earlyCardPromise = earlyInteractive && typeof earlyInteractive.then === 'function'
          ? asPromise(earlyInteractive).then(start)
          : start(earlyInteractive);
      } catch { earlyInteractive = null; earlyCardPromise = null; }
      return earlyInteractive;
    },
  };
  orchestrationContext.deadlineAt = deadlineAt;
  let core;
  let prepared;
  try {
    core = await runRecommendationCore(normalized, orchestrationContext);
    auditStage(context, 'CORE_READY');
    setDiagnostic(context, 'coreResultReady', elapsedMs(handlerOrigin));
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
      return finishLegacy({ core, prepared, response, context, lifecycleHooks, startedAt, handlerOrigin });
    }
    const requiredPromise = asPromise(
      context.persistAndAssembleRecommendation(core, prepared, normalized),
    );
    const cardPromise = earlyCardPromise
      || runFirstCard(interactive, context, handlerOrigin, deadlineAt);
    const activeInteractive = prepared.firstCardInteractive || interactive;
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
        setDiagnostic(context, 'deadlineReached', elapsedMs(handlerOrigin));
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
        let persisted = first.copy;
        if (first.status !== 'CACHE_HIT') {
          // Canonical persistence is part of the interactive AI budget.  A
          // late write must never turn a safe first response into a late AI
          // response; the durable worker can settle it afterwards.
          const persistRemainingMs = Math.max(0, Number(deadlineAt - monotonicNow()) / 1e6);
          if (persistRemainingMs <= 0) {
            outcome = { status: 'TIMEOUT', reason: 'POST_VALIDATION' };
          } else {
            let persistTimer;
            const persistDeadline = new Promise((resolve) => {
              persistTimer = setTimeout(() => resolve({ timedOut: true }), persistRemainingMs);
            });
            const persistResult = await Promise.race([
              asPromise((winningInteractive || interactive).persistCanonicalCopy(first.copy)).then((value) => ({ value })),
              persistDeadline,
            ]);
            if (persistTimer) clearTimeout(persistTimer);
            if (persistResult?.timedOut) {
              outcome = { status: 'TIMEOUT', reason: 'POST_VALIDATION' };
            } else {
              persisted = persistResult.value || first.copy;
              auditStage(context, 'CANONICAL_PERSISTED');
              setDiagnostic(context, 'firstCardCanonicalPersisted', elapsedMs(handlerOrigin));
            }
          }
        }
        if (outcome.status !== 'TIMEOUT' && typeof (winningInteractive || interactive).applyCanonicalToResponse === 'function') {
          finalResponse = await (winningInteractive || interactive).applyCanonicalToResponse(
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
    const backgroundDispatch = safeCall(activeInteractive.scheduleBackgroundMaterialization, outcome);
    if (typeof activeInteractive.scheduleBackgroundMaterialization !== 'function') {
      auditStage(context, 'BACKGROUND_DISPATCHED', 'not_reached');
    } else {
      // Dispatch is deliberately fire-and-forget for recommendation.ready,
      // but audit only records it after the durable dispatcher accepts it.
      void backgroundDispatch.then((result) => {
        if (result?.accepted === true) auditStage(context, 'BACKGROUND_DISPATCHED', 'dispatched');
        else if (result?.joined === true || ['joined', 'dispatched', 'running', 'completed'].includes(result?.status)) {
          auditStage(context, 'BACKGROUND_DISPATCHED', 'joined', { dispatchStatus: result?.status || 'joined' });
        }
        else auditStage(context, 'BACKGROUND_DISPATCHED', 'failed', { dispatchStatus: result?.status || 'rejected' });
      });
    }
    // Let an already-resolved dispatch acceptance settle for diagnostics;
    // never await a pending dispatcher here.
    await Promise.resolve();
    await Promise.resolve();
    if (outcome.status === 'TIMEOUT' && context?.diagnostics?.firstCardAudit) {
      context.diagnostics.firstCardAudit.deadlineReason = outcome.reason || deadlineReasonAt(
        context.diagnostics.firstCardAudit,
      );
    }
    auditSummary(context);
    const result = buildResult({
      core,
      prepared,
      response: finalResponse,
      context,
      lifecycleHooks,
      startedAt,
      handlerOrigin,
      outcome,
    });
    void cardPromise.then((late) => {
      if (first.status !== 'TIMEOUT') return;
      setDiagnostic(context, 'AI_LATE_DISCARDED', true);
      setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'TIMEOUT');
      void safeCall(activeInteractive.scheduleBackgroundMaterialization, late);
    });
    return result;
  } catch (error) {
    await safeCall(lifecycleHooks.onRuntimeFailure, { error, input: normalized });
    throw error;
  }
}

async function runFirstCard(interactive, context, origin, deadlineAt) {
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
  // Admission (including the canonical lookup) may itself be asynchronous.
  // Never start a provider once the absolute handler deadline has elapsed.
  if (Number(deadlineAt - monotonicNow()) <= 0) {
    auditStage(context, 'FIRST_CARD_AI_ADMITTED', 'not_admitted');
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'TIMEOUT');
    return { status: 'TIMEOUT', reason: 'PRE_AI_EXHAUSTION' };
  }
  const aiStartedAt = monotonicNow();
  auditStage(context, 'FIRST_CARD_AI_ADMITTED', 'admitted');
  setDiagnostic(context, 'firstCardAiStart', elapsedMs(origin));
  try {
    const providerRemainingMs = Math.max(0, Number(deadlineAt - monotonicNow()) / 1e6);
    const result = await context.renderFirstCardCanonical({
      entry: admission.entry,
      rendererConfig: {
        ...(admission.rendererConfig || {}),
        timeoutMs: Math.floor(providerRemainingMs),
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
  handlerOrigin,
  outcome,
}) {
  const batchId = response?.batch?.batchId || prepared.batchId || core.metadata.batchId;
  const countContract = response?.batch?.countContract || core.executionState.countContract;
  setDiagnostic(context, 'recommendationReady', elapsedMs(handlerOrigin));
  void safeCall(lifecycleHooks.onRecommendationReady, {
    batchId,
    response,
    countContract,
    identity: core.identity,
    elapsedMs: Date.now() - startedAt,
  });
  setDiagnostic(context, 'REQUEST_TO_RESPONSE_READY_MS', elapsedMs(handlerOrigin));
  setDiagnostic(context, 'responseReady', elapsedMs(handlerOrigin));
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
    handlerOrigin,
  };
}

async function finishLegacy({
  core,
  prepared,
  response,
  context,
  lifecycleHooks,
  startedAt,
  handlerOrigin,
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
    handlerOrigin,
  };
}

module.exports = { DEFAULT_AI_WINDOW_MS, SERVER_RESPONSE_DEADLINE_MS, runRecommendationOrchestrator };
