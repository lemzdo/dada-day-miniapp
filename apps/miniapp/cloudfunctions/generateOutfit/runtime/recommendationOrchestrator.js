'use strict';

const DEFAULT_AI_WINDOW_MS = 6000;
const SERVER_RESPONSE_DEADLINE_MS = 2300;
const SERVER_TAIL_TIMEOUT_MS = 6000;
const { normalizeInput, runRecommendationCore } = require('./recommendationCore');
const { createFailureEnvelope, getFailure, sanitizeFailure } = require('../services/firstCardObservability');

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

function newAttemptId() {
  try { return globalThis.crypto?.randomUUID?.() || `attempt-${Date.now()}-${Math.random().toString(16).slice(2)}`; } catch { return `attempt-${Date.now()}`; }
}

function failureFor(context, error, overrides = {}) {
  try {
    return createFailureEnvelope(error, {
      auditId: context?.diagnostics?.auditId || null,
      batchId: context?.diagnostics?.batchId || null,
      attemptId: context?.attemptId || null,
      handlerStartedAt: context?.failureHandlerStartedAt,
    }, overrides);
  } catch { return null; }
}

function logAudit(context, label, value) {
  try {
    const result = (context?.diagnostics?.stageLogger || console.log)(label, value);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch { /* Logging cannot fail a recommendation. */ }
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
  const safeFailure = sanitizeFailure(extra?.failure, { auditId: diagnostics.auditId, attemptId: context.attemptId, batchId: diagnostics.batchId });
  const entry = {
    auditId: diagnostics.auditId || null,
    stage,
    elapsedFromHandlerMs: elapsed === null ? null : Math.round(elapsed * 1000) / 1000,
    remainingDeadlineMs: remaining === null ? null : Math.round(remaining * 1000) / 1000,
    status,
    ...(safeFailure ? { failure: safeFailure } : {}),
    ...(typeof extra?.attemptId === 'string' && /^[\w.-]+$/.test(extra.attemptId) ? { attemptId: extra.attemptId.slice(0, 128) } : {}),
  };
  diagnostics.firstCardAudit = diagnostics.firstCardAudit || { stages: [], summary: null, executionOutcome: 'not_started' };
  if (safeFailure) {
    diagnostics.firstCardAudit.failure = safeFailure;
    diagnostics.firstCardAudit.executionOutcome = 'failed';
  } else if (stage === 'FIRST_CARD_AI_ADMITTED' && status === 'admitted') {
    diagnostics.firstCardAudit.executionOutcome = 'running';
  } else if (stage === 'EXECUTION_COMPLETE' && status === 'succeeded') {
    diagnostics.firstCardAudit.executionOutcome = 'succeeded';
  }
  diagnostics.firstCardAudit.stages.push(entry);
  // Align the public performance timeline with the provider lifecycle. The
  // admission latch is earlier than provider invocation and must not be
  // reported as AI_START.
  if (stage === 'PROVIDER_START' && diagnostics.AI_START === undefined) {
    setDiagnostic(context, 'AI_START', entry.elapsedFromHandlerMs);
  } else if (stage === 'EXECUTION_COMPLETE'
    && diagnostics.AI_COMPLETE === undefined) {
    setDiagnostic(context, 'AI_COMPLETE', entry.elapsedFromHandlerMs);
  }
  logAudit(context, '[RecommendationAudit]', entry);
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
    persisted: audit.stages.some((entry) => entry.stage === 'CANONICAL_PERSISTED' && ['completed', 'tail'].includes(entry.status)),
    backgroundDispatched: backgroundAccepted,
    elapsedBeforeAiStartMs: ai?.elapsedFromHandlerMs ?? null,
    providerDurationMs: providerStart && providerComplete ? Math.max(0, providerComplete.elapsedFromHandlerMs - providerStart.elapsedFromHandlerMs) : null,
    remainingAtAiStartMs: ai?.remainingDeadlineMs ?? null,
    deadlineReason: extra.deadlineReason || audit.deadlineReason || null,
    responseDeadlineReached: diagnostics.deadlineReached != null || audit.deadlineReason != null,
    tailWaitExpired: audit.tailWaitExpired === true,
    executionOutcome: audit.executionOutcome || 'not_started',
    failure: sanitizeFailure(audit.failure),
    snapshot: extra.snapshot || 'response',
    stageStatus: Object.fromEntries([
      'HANDLER_ENTRY', 'CORE_READY', 'NARRATIVE_PLAN_READY', 'CACHE_LOOKUP_DONE',
      'FIRST_CARD_AI_ADMITTED', 'PROVIDER_START', 'PROVIDER_COMPLETE',
      'VALIDATOR_COMPLETE', 'CANONICAL_PERSISTED', 'BACKGROUND_DISPATCHED',
      'DEADLINE_REACHED',
    ].map((stage) => [stage, has(stage) ? 'occurred' : 'not_occurred'])),
  };
  diagnostics.firstCardAudit.summary = summary;
  if (summary.snapshot === 'response' && !audit.responseSummary) diagnostics.firstCardAudit.responseSummary = summary;
  logAudit(context, '[RecommendationAuditSummary]', summary);
  return summary;
}

function elapsedMs(origin) {
  return Number(monotonicNow() - origin) / 1e6;
}

function recordExecution(context, status, failure) {
  const audit = context.diagnostics?.firstCardAudit;
  const alreadyRecorded = audit?.stages.some((entry) => entry.stage === 'EXECUTION_COMPLETE'
    && entry.attemptId === context.attemptId && entry.status === status);
  if (!alreadyRecorded) auditStage(context, 'EXECUTION_COMPLETE', status, { attemptId: context.attemptId, failure });
  if (audit?.responseSummary) auditSummary(context, { snapshot: 'execution' });
}

async function runRecommendationOrchestrator(input = {}, context = {}, lifecycleHooks = {}) {
  const normalized = normalizeInput(input);
  void safeCall(lifecycleHooks.onInputNormalized, { input: normalized });
  const startedAt = Date.now();
  const handlerOrigin = typeof context.handlerOrigin === 'bigint' ? context.handlerOrigin : monotonicNow();
  context.handlerOrigin = handlerOrigin;
  context.failureHandlerStartedAt = Date.now() - elapsedMs(handlerOrigin);
  const deadlineAt = handlerOrigin + globalThis.BigInt(SERVER_RESPONSE_DEADLINE_MS) * 1000000n;
  context.deadlineAt = deadlineAt;
  auditStage(context, 'HANDLER_ENTRY', 'entered');
  setDiagnostic(context, 'requestStart', 0);
  setDiagnostic(context, 'AI_LATE_DISCARDED', false);
  // The owner is created at admission time and is the single handle shared by
  // the response race and the server tail.  Keeping the promise in one owner
  // prevents a late callback (or the normal prepared path) from starting card0
  // a second time.
  let earlyCardOwner = null;
  let coreFinished = false;
  const orchestrationContext = {
    ...context,
    onFirstCardReady: (payload) => {
      if (earlyCardOwner) return earlyCardOwner.interactive || earlyCardOwner.promise;
      if (coreFinished) return;
      if (typeof context.prepareFirstCardInteractive !== 'function') return;
      // Latch before invoking the adapter: production preparation may invoke
      // user supplied/re-entrant code, and the callback must remain one-shot
      // even when preparation throws synchronously.
      earlyCardOwner = { interactive: null, promise: null };
      let preparedInteractive;
      try {
        preparedInteractive = context.prepareFirstCardInteractive(payload);
        const owner = earlyCardOwner;
        const start = (value) => owner.abandoned
          ? Promise.resolve({ status: 'FAIL', reason: 'RECOMMENDATION_FAILED' })
          : runFirstCard(value, context, handlerOrigin, deadlineAt);
        // Production preparation is synchronous, so runFirstCard reaches the
        // canonical read immediately while Core continues plans 1..N. Keep
        // Promise support for injected adapters without duplicating the path.
        if (preparedInteractive && typeof preparedInteractive.then === 'function') {
          earlyCardOwner.promise = asPromise(preparedInteractive)
            .then((value) => {
              owner.interactive = value;
              return start(value);
            })
            .catch((error) => {
              const failure = failureFor(context, error, { stage: 'admission', code: 'ADMISSION_FAILED' });
              setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
              return { status: 'FAIL', reason: 'PROVIDER_FAIL', error, failure };
            });
        } else {
          earlyCardOwner.interactive = preparedInteractive;
          earlyCardOwner.promise = asPromise(start(preparedInteractive)).catch((error) => {
            const failure = failureFor(context, error, { stage: 'runtime', code: 'RUNTIME_FAILED' });
            setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
            return { status: 'FAIL', reason: 'PROVIDER_FAIL', error, failure };
          });
        }
        // The owner promise always has a rejection handler before control
        // returns to Core, so an adapter failure cannot become unhandled.
        return owner.interactive || owner.promise;
      } catch (error) {
        const failure = failureFor(context, error, { stage: 'admission', code: 'ADMISSION_FAILED' });
        setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
        earlyCardOwner.promise = Promise.resolve({ status: 'FAIL', reason: 'PROVIDER_FAIL', error, failure });
        return earlyCardOwner.promise;
      }
    },
  };
  orchestrationContext.deadlineAt = deadlineAt;
  let core;
  let prepared;
  try {
    core = await runRecommendationCore(normalized, orchestrationContext);
    coreFinished = true;
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
      // Core may have admitted card0 before preparation determined that the
      // normal interactive path is unavailable. Drain the owned promise for a
      // bounded tail window so its rejection is observed and its owner is
      // released without changing the response contract.
      const response = await context.persistAndAssembleRecommendation(core, prepared, normalized);
      const result = await finishLegacy({ core, prepared, response, context, lifecycleHooks, startedAt, handlerOrigin });
      if (earlyCardOwner) result.tailDone = drainEarlyCardOwner(earlyCardOwner, context);
      return result;
    }
    const requiredPromise = asPromise(
      context.persistAndAssembleRecommendation(core, prepared, normalized),
    );
    // Observe assembler failures immediately; the response path still awaits
    // this same promise and preserves its existing failure semantics.
    void requiredPromise.catch(() => undefined);
    const cardPromise = earlyCardOwner?.promise
      || asPromise(runFirstCard(interactive, context, handlerOrigin, deadlineAt)).catch((error) => ({
        status: 'FAIL', reason: 'PROVIDER_FAIL', error,
        failure: failureFor(context, error, { stage: 'runtime', code: 'RUNTIME_FAILED' }),
      }));
    // The early adapter only admits/renders card0. Canonical persistence and
    // retry hooks are completed by the prepared adapter in the normal path.
    const activeInteractive = prepared.firstCardInteractive || interactive;
    const remainingMs = Math.max(0, Number(deadlineAt - monotonicNow()) / 1e6);
    let timer;
    const deadlinePromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        auditStage(context, 'DEADLINE_REACHED', 'timeout', { attemptId: context.attemptId });
        if (context?.diagnostics?.firstCardAudit) {
          context.diagnostics.firstCardAudit.deadlineReason = deadlineReasonAt(
            context.diagnostics.firstCardAudit,
          );
        }
        setDiagnostic(context, 'deadlineReached', elapsedMs(handlerOrigin));
        if (context?.diagnostics?.firstCardAudit) context.diagnostics.firstCardAudit.responseDeadlineReached = true;
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
          // Tail takeover may outlive the response race. Mark this promise as
          // observed immediately, including when the response deadline wins.
          void firstCardPersistPromise.catch(() => undefined);
          const persistRemainingMs = Math.max(0, Number(deadlineAt - monotonicNow()) / 1e6);
          if (persistRemainingMs <= 0) {
            outcome = { status: 'TIMEOUT', reason: 'POST_VALIDATION' };
          } else {
            let persistTimer;
            const persistDeadline = new Promise((resolve) => {
              persistTimer = setTimeout(() => resolve({ timedOut: true }), persistRemainingMs);
            });
            let persistResult;
            try {
              persistResult = await Promise.race([
                firstCardPersistPromise.then((value) => ({ value })),
                persistDeadline,
              ]);
            } finally {
              if (persistTimer) clearTimeout(persistTimer);
            }
            if (persistResult?.timedOut) {
              outcome = { status: 'TIMEOUT', reason: 'POST_VALIDATION' };
            } else {
              persisted = persistResult.value || first.copy;
              auditStage(context, 'CANONICAL_PERSISTED');
              setDiagnostic(context, 'firstCardCanonicalPersisted', elapsedMs(handlerOrigin));
              setDiagnostic(context, 'CANONICAL_READY', elapsedMs(handlerOrigin));
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
        const failure = failureFor(context, error, { stage: 'persistence', code: 'PERSISTENCE_FAILED' });
        auditStage(context, 'CANONICAL_PERSISTED', 'failed', { attemptId: context.attemptId, failure });
        outcome = { status: 'FAIL', reason: 'PERSIST_FAIL', error, failure };
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
    // Tail settlement owns cleanup. The derived promise also remains
    // fail-open if an injected retry adapter violates its contract.
    result.tailDone = Promise.resolve(tailDone).then(
      (value) => { if (earlyCardOwner) earlyCardOwner.promise = null; return value; },
      (error) => {
        if (earlyCardOwner) earlyCardOwner.promise = null;
        return { status: 'FAIL', reason: 'TAIL_FAIL', error };
      },
    );
    return result;
  } catch (error) {
    coreFinished = true;
    // Core/prepare failures can happen after card0 was admitted. There is no
    // response to carry tailDone in this branch. Keep this invocation alive
    // until bounded cleanup settles, then propagate the original failure.
    if (earlyCardOwner?.promise) {
      // Core/prepare can fail before the prepared work adapter exists.  The
      // admission adapter is still the owner of the reserved durable job and
      // must receive the retryable settlement in that case.
      await drainEarlyCardOwner(
        earlyCardOwner,
        context,
        prepared?.firstCardInteractive || earlyCardOwner.interactive,
        error,
      );
    }
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
  // Envelopes are diagnostic only; retain the pre-contract durable-job input.
  const legacyOutcome = { ...outcome };
  delete legacyOutcome.failure;
  if (legacyOutcome.result && typeof legacyOutcome.result === 'object') {
    legacyOutcome.result = { ...legacyOutcome.result };
    delete legacyOutcome.result.failure;
  }
  try { await interactive.markCopyJobRetryable(legacyOutcome); } catch { /* recovery state is fail-open */ }
}

function drainEarlyCardOwner(owner, context, interactive, error) {
  if (owner?.tailDone) return owner.tailDone;
  if (!owner?.promise) return Promise.resolve({ status: 'NO_EARLY_CARD' });
  owner.abandoned = true;
  const timeoutMs = Math.max(1, Number(context.firstCardTailTimeoutMs) || SERVER_TAIL_TIMEOUT_MS);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' }), timeoutMs);
    timer.unref?.();
  });
  // Promise.race observes both branches; the explicit catch keeps the owner
  // fail-open even if an injected adapter returns a malformed thenable.
  let retryableSettlement = Promise.resolve();
  if (interactive && !owner.retryableMarked) {
    owner.retryableMarked = true;
    retryableSettlement = Promise.resolve(
      markFirstCardRetryable(interactive, { status: 'FAIL', reason: 'RECOMMENDATION_FAILED', error }),
    ).catch(() => undefined);
  }
  const work = Promise.resolve(owner.promise).catch((cause) => ({
    status: 'FAIL', reason: 'EARLY_CARD_FAIL', error: cause,
  })).then(async (result) => {
    // The retryable settlement starts immediately above, while this branch
    // only drains the already-admitted provider promise. Cleanup never writes
    // canonical data; cached copies already have a durable owner.
    await retryableSettlement;
    return result;
  });
  owner.tailDone = Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
    owner.promise = null;
  }).catch(() => {
    owner.promise = null;
    return { status: 'FAIL', reason: 'EARLY_CARD_FAIL' };
  });
  return owner.tailDone;
}

async function settleFirstCardTail({ cardPromise, persistPromise, interactive, context }) {
  const tailTimeoutMs = Math.max(1, Number(context.firstCardTailTimeoutMs) || SERVER_TAIL_TIMEOUT_MS);
  let tailOpen = true;
  let tailFailureStage = 'runtime';
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      tailOpen = false;
      if (context?.diagnostics) context.diagnostics.firstCardAudit = { ...(context.diagnostics.firstCardAudit || {}), tailWaitExpired: true };
      resolve({ status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' });
    }, tailTimeoutMs);
    timer.unref?.();
  });
  const work = (async () => {
    let late = await cardPromise;
    if (!tailOpen) {
      if (late?.failure || late?.result?.failure) auditStage(context, 'TAIL_COMPLETE', 'failed', { failure: late.failure || late.result.failure });
      auditSummary(context, { snapshot: 'execution' });
      return { status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' };
    }
    // A provider that was already admitted must never be started a second
    // time. Materialization is only valid for the explicit pre-admission case.
    if (late?.status === 'TIMEOUT'
      && late.reason === 'PRE_AI_EXHAUSTION'
      && typeof interactive.materializeFirstCard === 'function') {
      const attemptId = newAttemptId();
      context.attemptId = attemptId;
      auditStage(context, 'FIRST_CARD_AI_ADMITTED', 'admitted', { attemptId });
      late = await interactive.materializeFirstCard({
        timeoutMs: tailTimeoutMs,
        attemptId,
        failureContext: {
          attemptId,
          auditId: context.diagnostics?.auditId || null,
          batchId: context.diagnostics?.batchId || null,
          handlerStartedAt: context.failureHandlerStartedAt,
        },
        onAuditStage: (stage, status, extra) => auditStage(context, stage, status, { attemptId, failure: extra?.failure }),
      });
    }
    if (late?.status === 'FAIL' && !late.failure) late = { ...late, failure: failureFor(context, late.error || late, { stage: 'runtime', code: 'RUNTIME_FAILED' }) };
    if (late?.status === 'SUCCESS' && context.diagnostics?.firstCardAudit) context.diagnostics.firstCardAudit.executionOutcome = 'succeeded';
    if (!tailOpen) {
      if (late?.failure || late?.result?.failure) auditStage(context, 'TAIL_COMPLETE', 'failed', { failure: late.failure || late.result.failure });
      auditSummary(context, { snapshot: 'execution' });
      return { status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' };
    }
    if (late?.status === 'SUCCESS') {
      tailFailureStage = 'persistence';
      const persisted = await (persistPromise || persistAndCompleteFirstCard(interactive, late.copy));
      if (!tailOpen) return { status: 'TAIL_TIMEOUT', reason: 'TAIL_TIMEOUT' };
      auditStage(context, 'CANONICAL_PERSISTED', 'tail');
      setDiagnostic(context, 'firstCardCanonicalPersisted', elapsedMs(context.handlerOrigin));
      setDiagnostic(context, 'CANONICAL_READY', elapsedMs(context.handlerOrigin));
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
    const terminalFailure = late?.failure || late?.result?.failure || null;
    if (terminalFailure) auditStage(context, 'TAIL_COMPLETE', 'failed', { failure: terminalFailure });
    else auditStage(context, 'TAIL_COMPLETE', late?.status === 'SUCCESS_TAIL' ? 'succeeded' : late?.status === 'TAIL_TIMEOUT' ? 'wait_expired' : 'completed');
    auditSummary(context, { snapshot: 'tail' });
    // This flag now means an AI result was intentionally thrown away. A late
    // result is retained by the server tail, so it must remain false.
    setDiagnostic(context, 'AI_LATE_DISCARDED', false);
    return late;
  } catch (error) {
    // Keep the durable job retryable; the tail is fail-open for the response.
    setDiagnostic(context, 'AI_LATE_DISCARDED', false);
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'TAIL_FAIL');
    await markFirstCardRetryable(interactive, { status: 'FAIL', reason: 'PERSIST_FAIL', error });
    const failure = failureFor(context, error, { stage: tailFailureStage, code: tailFailureStage === 'persistence' ? 'PERSISTENCE_FAILED' : 'RUNTIME_FAILED' });
    logAudit(context, '[RecommendationFirstCardTailFailOpen]', { failure });
    if (tailFailureStage === 'persistence') auditStage(context, 'CANONICAL_PERSISTED', 'failed', { attemptId: context.attemptId, failure });
    auditStage(context, 'TAIL_COMPLETE', 'failed', { failure });
    auditSummary(context, { snapshot: 'tail' });
    return { status: 'FAIL', reason: 'PERSIST_FAIL', error, failure };
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
      const failure = failureFor(context, error, { stage: 'admission', code: 'ADMISSION_FAILED' });
      auditStage(context, 'CACHE_LOOKUP_DONE', 'failed', { attemptId: context.attemptId, failure });
      setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
      return { status: 'FAIL', reason: 'PROVIDER_FAIL', error, failure };
    }
  }
  if (admission.cachedCopy) {
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'CACHE_HIT');
    setDiagnostic(context, 'CANONICAL_READY', elapsedMs(origin));
    return { status: 'CACHE_HIT', copy: admission.cachedCopy };
  }
  if (typeof context.renderFirstCardCanonical !== 'function' || !admission.entry) {
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'PROVIDER_FAIL');
    const failure = failureFor(context, new Error('NO_INTERACTIVE_RENDERER'), { stage: 'admission', code: 'ADMISSION_FAILED', providerIssue: 'no', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
    recordExecution(context, 'failed', failure);
    return { status: 'FAIL', reason: 'NO_INTERACTIVE_RENDERER', failure };
  }
  // Admission (including the canonical lookup) may itself be asynchronous.
  // Never start a provider once the absolute handler deadline has elapsed.
  if (Number(deadlineAt - monotonicNow()) <= 0) {
    auditStage(context, 'FIRST_CARD_AI_ADMITTED', 'not_admitted');
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'TIMEOUT');
    return { status: 'TIMEOUT', reason: 'PRE_AI_EXHAUSTION' };
  }
  const aiStartedAt = monotonicNow();
  const attemptId = newAttemptId();
  context.attemptId = attemptId;
  auditStage(context, 'FIRST_CARD_AI_ADMITTED', 'admitted', { attemptId });
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
        attemptId: context.attemptId,
        failureContext: {
          ...(admission.rendererConfig?.failureContext || {}),
          attemptId: context.attemptId,
          auditId: context.diagnostics?.auditId || null,
          batchId: context.diagnostics?.batchId || null,
          handlerStartedAt: context.failureHandlerStartedAt,
        },
        onAuditStage: (stage, status, extra) => auditStage(context, stage, status, { failure: extra?.failure, attemptId }),
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
      const failure = sanitizeFailure(result?.failure) || failureFor(context, result, {
        stage: reason === 'VALIDATOR_FAIL' ? 'validation' : 'runtime',
        code: reason === 'VALIDATOR_FAIL' ? 'VALIDATION_REJECTED' : 'UNKNOWN_FAILURE',
      });
      recordExecution(context, 'failed', failure);
      return { status: 'FAIL', reason, result, ...(failure ? { failure } : {}) };
    }
    setDiagnostic(context, 'FIRST_CARD_AI_RESULT', 'SUCCESS');
    if (context?.diagnostics?.firstCardAudit) context.diagnostics.firstCardAudit.executionOutcome = 'succeeded';
    recordExecution(context, 'succeeded');
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
    if (context?.diagnostics?.firstCardAudit) context.diagnostics.firstCardAudit.executionOutcome = 'failed';
    const failure = getFailure(error) || failureFor(context, error, { stage: 'runtime', code: 'RUNTIME_FAILED' });
    recordExecution(context, 'failed', failure);
    return { status: 'FAIL', reason: 'PROVIDER_FAIL', error, ...(failure ? { failure } : {}) };
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
