'use strict';

const DEFAULT_AI_WINDOW_MS = 6000;
const SERVER_RESPONSE_DEADLINE_MS = 2300;
const SERVER_TAIL_TIMEOUT_MS = 6000;
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
  const orchestrationContext = {
    ...context,
    onFirstCardReady: (payload) => {
      if (earlyInteractive || typeof context.prepareFirstCardInteractive !== 'function') return;
      try {
        earlyInteractive = context.prepareFirstCardInteractive(payload);
        const start = (value) => runFirstCard(value, context, handlerOrigin, deadlineAt);
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
    let firstCardPersistPromise = null;
    if (first.status === 'SUCCESS' || first.status === 'CACHE_HIT') {
      try {
        let persisted = first.copy;
        if (first.status !== 'CACHE_HIT') {
          // Persistence and job completion share one promise across the UI
          // race and server tail. Never issue a second canonical write.
          firstCardPersistPromise = persistAndCompleteFirstCard(activeInteractive, first.copy);
          const persistRemainingMs = Math.max(0, Number(deadlineAt - monotonicNow()) / 1e6);
          if (persistRemainingMs <= 0) {
            outcome = { status: 'TIMEOUT', reason: 'POST_VALIDATION' };
          } else {
            let persistTimer;
            const persistDeadline = new Promise((resolve) => {
              persistTimer = setTimeout(() => resolve({ timedOut: true }), persistRemainingMs);
            });
            const persistResult = await Promise.race([
              firstCardPersistPromise.then((value) => ({ value })),
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
        if (outcome.status !== 'TIMEOUT' && typeof activeInteractive.applyCanonicalToResponse === 'function') {
          finalResponse = await activeInteractive.applyCanonicalToResponse(
            response,
            persisted || first.copy,
          );
        }
      } catch (error) {
        outcome = { status: 'FAIL', reason: 'PERSIST_FAIL', error };
      }
    }
    // A first-card timeout is a response barrier, not an AI cancellation point.
    // Keep the already-admitted provider promise alive and settle it server-side
    // after returning the safe response.  This deliberately does not dispatch
    // an SCF event (or write another SSE frame).
    // Interactive first-card misses are completed in this invocation. Never
    // dispatch the recovery worker from the normal request path.
    auditStage(context, 'BACKGROUND_DISPATCHED', 'not_reached');
    if (outcome.status === 'TIMEOUT' && context?.diagnostics?.firstCardAudit) {
      context.diagnostics.firstCardAudit.deadlineReason = outcome.reason || deadlineReasonAt(
        context.diagnostics.firstCardAudit,
      );
    }
    auditSummary(context);
    let tailDone = Promise.resolve(outcome);
    if (outcome.status === 'TIMEOUT') {
      tailDone = settleFirstCardTail({
        cardPromise,
        persistPromise: firstCardPersistPromise,
        interactive: activeInteractive,
        context,
      });
    } else if (outcome.status === 'FAIL') {
      tailDone = markFirstCardRetryable(activeInteractive, outcome).then(() => outcome);
    }
    const result = buildResult({
      core,
      prepared,
      response: finalResponse,
      context,
      lifecycleHooks,
      startedAt,
      handlerOrigin,
      outcome,
      tailDone,
    });
    return result;
  } catch (error) {
    await safeCall(lifecycleHooks.onRuntimeFailure, { error, input: normalized });
    throw error;
  }
}

async function persistAndCompleteFirstCard(interactive, copy) {
  if (typeof interactive.persistCanonicalCopy !== 'function') {
    throw new Error('CANONICAL_PERSISTENCE_REQUIRED');
  }
  const persisted = await interactive.persistCanonicalCopy(copy);
  if (typeof interactive.completeCopyJob === 'function') {
    await interactive.completeCopyJob({ copy: persisted || copy });
  }
  return persisted || copy;
}

async function markFirstCardRetryable(interactive, outcome) {
  if (typeof interactive.markCopyJobRetryable !== 'function') return;
  try { await interactive.markCopyJobRetryable(outcome); } catch { /* recovery state is fail-open */ }
}

async function settleFirstCardTail({ cardPromise, persistPromise, interactive, context }) {
  const tailTimeoutMs = Math.max(1, Number(context.firstCardTailTimeoutMs) || SERVER_TAIL_TIMEOUT_MS);
  let tailOpen = true;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      tailOpen = false;
      resolve({ status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' });
    }, tailTimeoutMs);
    timer.unref?.();
  });
  const work = (async () => {
    let late = await cardPromise;
    if (!tailOpen) return { status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' };
    // A provider that was already admitted must never be started a second
    // time. Materialization is only valid for the explicit pre-admission case.
    if (late?.status === 'TIMEOUT'
      && late.reason === 'PRE_AI_EXHAUSTION'
      && typeof interactive.materializeFirstCard === 'function') {
      late = await interactive.materializeFirstCard({
        timeoutMs: tailTimeoutMs,
        onAuditStage: (stage, status) => auditStage(context, stage, status),
      });
    }
    if (!tailOpen) return { status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' };
    if (late?.status === 'SUCCESS') {
      const persisted = await (persistPromise || persistAndCompleteFirstCard(interactive, late.copy));
      if (!tailOpen) return { status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' };
      auditStage(context, 'CANONICAL_PERSISTED', 'tail');
      setDiagnostic(context, 'firstCardCanonicalPersisted', elapsedMs(context.handlerOrigin));
      setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'SUCCESS_TAIL');
      return { ...late, copy: persisted || late.copy, status: 'SUCCESS_TAIL' };
    }
    return late;
  })();
  try {
    const late = await Promise.race([work, timeout]);
    if (late?.status !== 'SUCCESS_TAIL') {
      await markFirstCardRetryable(interactive, late || { status: 'FAIL', reason: 'TAIL_FAIL' });
      setDiagnostic(context, 'FIRST_CARD_AI_RESULT', late?.reason || 'TAIL_FAIL');
    }
    // This flag now means an AI result was intentionally thrown away. A late
    // result is retained by the server tail, so it must remain false.
    setDiagnostic(context, 'AI_LATE_DISCARDED', false);
    return late;
  } catch (error) {
    // Keep the durable job retryable; the tail is fail-open for the response.
    setDiagnostic(context, 'AI_LATE_DISCARDED', false);
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'TAIL_FAIL');
    await markFirstCardRetryable(interactive, { status: 'FAIL', reason: 'PERSIST_FAIL', error });
    try { (context?.diagnostics?.stageLogger || console.warn)('[RecommendationFirstCardTailFailOpen]', error); } catch { /* fail-open */ }
    return { status: 'FAIL', reason: 'PERSIST_FAIL', error };
  } finally {
    if (timer) clearTimeout(timer);
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
    // The UI deadline only gates the race. Once admitted, the provider
    // promise must remain alive for the server tail; use the existing bounded
    // provider timeout rather than aborting it at 2300ms.
    const providerTimeoutMs = Math.max(
      providerRemainingMs,
      Number(context.firstCardProviderTimeoutMs) || SERVER_TAIL_TIMEOUT_MS,
    );
    const result = await context.renderFirstCardCanonical({
      entry: admission.entry,
      rendererConfig: {
        ...(admission.rendererConfig || {}),
        timeoutMs: Math.floor(providerTimeoutMs),
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
  tailDone,
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
    tailDone,
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

module.exports = { DEFAULT_AI_WINDOW_MS, SERVER_RESPONSE_DEADLINE_MS, SERVER_TAIL_TIMEOUT_MS, runRecommendationOrchestrator };
