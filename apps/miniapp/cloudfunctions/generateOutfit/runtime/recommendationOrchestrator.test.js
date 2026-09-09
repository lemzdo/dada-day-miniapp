'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runRecommendationOrchestrator } = require('./recommendationOrchestrator');
const { renderFirstCardCanonical } = require('../services/recommendationFirstCardRenderer');
const { createXiaodaAI, createFailureEnvelope } = require('@d1d/ai-core');

test('orchestrator resolves snapshot and cache before invoking the pure core boundary', async () => {
  const events = [];
  const snapshot = { scene: 'work', marker: 'snapshot' };
  const cacheResolution = { attempted: true, hit: false, reason: 'not_found' };
  const core = {
    identity: {}, executionState: {}, outfits: [], narrativePlans: [], evidence: {}, metadata: { batchId: 'boundary' },
  };
  const result = await runRecommendationOrchestrator({ scene: ' work ' }, {
    loadInputSnapshot: async (input) => {
      events.push('snapshot');
      assert.equal(input.scene, 'work');
      return snapshot;
    },
    resolveRecommendationCache: async (input) => {
      events.push('cache');
      assert.equal(input, snapshot);
      return cacheResolution;
    },
    computeRecommendation: async (input) => {
      events.push('core');
      assert.equal(input.marker, 'snapshot');
      assert.equal(input.cacheResolution, cacheResolution);
      return core;
    },
    persistAndAssembleRecommendation: async () => ({ batch: { batchId: 'boundary', countContract: {} } }),
  });
  assert.deepEqual(events, ['snapshot', 'cache', 'core']);
  assert.equal(result.batchId, 'boundary');
});

test('orchestrator announces core before ready and does not await renderer', async () => {
  const events = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const core = { identity: {}, executionState: {}, outfits: [{ outfitKey: 'a' }], narrativePlans: [{ id: 1 }], evidence: {}, metadata: { batchId: 'b' } };
  const runtime = await runRecommendationOrchestrator({ scene: ' work ' }, {
    computeRecommendation: async () => core,
    prepareRecommendationWork: async () => { events.push('prepare'); return { batchId: 'b', tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [{ id: 1 }] }; },
    persistAndAssembleRecommendation: async () => { events.push('persist'); return { batch: { batchId: 'b', countContract: {} } }; },
    renderer: async () => blocked,
  }, {
    onCoreResultAvailable: () => events.push('core'),
    onNarrativePlansReady: () => events.push('narrative'),
    onPostC2TasksScheduled: () => events.push('background'),
    onRecommendationReady: () => events.push('ready'),
  });
  assert.deepEqual(events, ['core', 'prepare', 'narrative', 'background', 'persist', 'ready']);
  release();
  await runtime.aiDone;
});

test('lifecycle hook errors are fail-open', async () => {
  const result = await runRecommendationOrchestrator({}, {
    computeRecommendation: async () => ({ identity: {}, executionState: {}, outfits: [], narrativePlans: [], evidence: {}, metadata: { batchId: 'b' } }),
    persistAndAssembleRecommendation: async () => ({ batch: { batchId: 'b', countContract: {} } }),
  }, { onCoreResultAvailable: () => { throw new Error('ignored'); }, onRecommendationReady: () => { throw new Error('ignored'); } });
  assert.equal(result.batchId, 'b');
});

test('background settlement never blocks required persistence or ready', async () => {
  const events = [];
  let releaseBackground;
  const background = new Promise((resolve) => { releaseBackground = resolve; });
  const core = { identity: {}, executionState: {}, outfits: [], narrativePlans: [], evidence: {}, metadata: { batchId: 'b' } };
  const runtime = await runRecommendationOrchestrator({}, {
    computeRecommendation: async () => core,
    prepareRecommendationWork: async () => ({ batchId: 'b', tasks: [background], narrativePlans: [], rendererEntries: [] }),
    persistAndAssembleRecommendation: async () => { events.push('persist'); return { batch: { batchId: 'b', countContract: {} } }; },
  }, {
    onPostC2TasksScheduled: () => { events.push('background'); return background; },
    onRecommendationReady: () => events.push('ready'),
  });
  assert.equal(runtime.batchId, 'b');
  assert.deepEqual(events, ['background', 'persist', 'ready']);
  releaseBackground();
});

function interactiveCore() {
  return {
    identity: {},
    executionState: {},
    outfits: [{ outfitKey: 'look-1' }],
    narrativePlans: [{ planId: 'plan-1' }],
    evidence: {},
    metadata: { batchId: 'batch-interactive' },
  };
}

function interactiveContext(overrides = {}) {
  const core = interactiveCore();
  const safeResponse = {
    batch: { batchId: core.metadata.batchId, countContract: {} },
    light: { cards: [{ outfitKey: 'look-1', todayReason: 'safe', copySource: 'safe' }] },
  };
  return {
    computeRecommendation: async () => core,
    prepareRecommendationWork: async () => ({
      batchId: core.metadata.batchId,
      tasks: [],
      narrativePlans: core.narrativePlans,
      rendererEntries: [{ preparedEntry: { plan: { planId: 'plan-1' } } }],
      firstCardInteractive: {
        entry: { preparedEntry: { plan: { planId: 'plan-1' } } },
        persistCanonicalCopy: async (copy) => ({
          outfitKey: 'look-1', cardIndex: 0, text: copy.text, source: 'ai_cache',
        }),
        applyCanonicalToResponse: (response, copy) => ({
          ...response,
          light: { cards: [{ ...response.light.cards[0], todayReason: copy.text, copySource: 'ai_cache' }] },
        }),
        completeCopyJob: async () => ({ status: 'completed' }),
        markCopyJobRetryable: async () => ({ status: 'interactive' }),
        ...overrides.firstCardInteractive,
      },
    }),
    persistAndAssembleRecommendation: async () => safeResponse,
    renderFirstCardCanonical: async () => ({
      status: 'success',
      copy: { planId: 'plan-1', text: 'AI canonical' },
    }),
    ...overrides.context,
  };
}

test('one-shot first-card ready starts lookup/provider before Core releases', async () => {
  let releaseCore;
  const coreGate = new Promise((resolve) => { releaseCore = resolve; });
  let lookupStarted = false;
  let providerStarted = false;
  const core = interactiveCore();
  const early = {
    entry: { preparedEntry: { plan: { planId: 'plan-1' } } },
    resolveAdmission: async () => { lookupStarted = true; return { entry: early.entry }; },
    persistCanonicalCopy: async (copy) => ({ outfitKey: 'look-1', cardIndex: 0, text: copy.text }),
    applyCanonicalToResponse: (response, copy) => ({ ...response, light: { cards: [{ ...response.light.cards[0], todayReason: copy.text }] } }),
    scheduleBackgroundMaterialization: async () => ({ accepted: true }),
  };
  const context = {
    prepareFirstCardInteractive: () => early,
    computeRecommendation: async (_input, runtimeContext) => {
      runtimeContext.onFirstCardReady({ entry: early.entry });
      await coreGate;
      return core;
    },
    prepareRecommendationWork: async () => ({ batchId: 'batch-interactive', tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [early.entry], firstCardInteractive: early }),
    persistAndAssembleRecommendation: async () => ({ batch: { batchId: 'batch-interactive', countContract: {} }, light: { cards: [{ outfitKey: 'look-1', todayReason: 'safe' }] } }),
    renderFirstCardCanonical: async () => { providerStarted = true; return { status: 'success', copy: { planId: 'plan-1', text: 'early AI' } }; },
  };
  const running = runRecommendationOrchestrator({}, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lookupStarted, true);
  assert.equal(providerStarted, true);
  releaseCore();
  await running;
});

test('performance milestones use provider start and full execution end, while HIT remains AI-free', async () => {
  const timings = [];
  const diagnostics = { auditId: 'milestones', stageLogger() {} };
  const context = interactiveContext({ context: {
    diagnostics, onTelemetry: (value) => timings.push(value),
    renderFirstCardCanonical: async ({ rendererConfig }) => {
      assert.equal(diagnostics.AI_START, undefined, 'admission is not a provider call');
      rendererConfig.onAuditStage('PROVIDER_START', 'started');
      rendererConfig.onAuditStage('PROVIDER_COMPLETE', 'completed');
      assert.equal(diagnostics.AI_COMPLETE, undefined, 'a streaming Response is not completed AI');
      rendererConfig.onAuditStage('EXECUTION_COMPLETE', 'succeeded');
      return { status: 'success', copy: { planId: 'plan-1', text: 'AI canonical' } };
    },
  } });
  const result = await runRecommendationOrchestrator({}, context);
  await result.tailDone;
  assert.deepEqual(timings.filter(({ key }) => ['AI_START', 'AI_COMPLETE', 'CANONICAL_READY'].includes(key))
    .map(({ key }) => key), ['AI_START', 'AI_COMPLETE', 'CANONICAL_READY']);
  assert.equal(result.response.light.cards[0].todayReason, 'AI canonical');
  const hitTimings = [];
  await runRecommendationOrchestrator({}, interactiveContext({
    firstCardInteractive: { cachedCopy: { text: 'cached' } },
    context: { diagnostics: { auditId: 'hit-milestones', stageLogger() {} },
      onTelemetry: ({ key }) => hitTimings.push(key),
      renderFirstCardCanonical: () => { throw new Error('HIT must not render'); } },
  }));
  assert.ok(hitTimings.includes('CANONICAL_READY'));
  assert.ok(!hitTimings.includes('AI_START') && !hitTimings.includes('AI_COMPLETE'));
});

test('early provider does not await unrelated candidate persistence', async () => {
  let releaseCandidate;
  const candidateGate = new Promise((resolve) => { releaseCandidate = resolve; });
  let providerStarted = false;
  const core = interactiveCore();
  const early = {
    entry: { preparedEntry: { plan: { planId: 'plan-1' } } },
    resolveAdmission: async () => ({ entry: early.entry }),
    persistCanonicalCopy: async (copy) => ({ outfitKey: 'look-1', cardIndex: 0, text: copy.text }),
    applyCanonicalToResponse: (response, copy) => ({ ...response, light: { cards: [{ ...response.light.cards[0], todayReason: copy.text }] } }),
    scheduleBackgroundMaterialization: async () => ({ accepted: true }),
  };
  const context = {
    prepareFirstCardInteractive: () => early,
    computeRecommendation: async (_input, runtimeContext) => { runtimeContext.onFirstCardReady({ entry: early.entry }); return core; },
    prepareRecommendationWork: async () => ({ batchId: 'batch-interactive', tasks: [candidateGate], narrativePlans: core.narrativePlans, rendererEntries: [early.entry], firstCardInteractive: early }),
    persistAndAssembleRecommendation: async () => ({ batch: { batchId: 'batch-interactive', countContract: {} }, light: { cards: [{ outfitKey: 'look-1', todayReason: 'safe' }] } }),
    renderFirstCardCanonical: async () => { providerStarted = true; return { status: 'success', copy: { planId: 'plan-1', text: 'early AI' } }; },
  };
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(providerStarted, true);
  assert.equal(result.firstCardAi.status, 'SUCCESS');
  releaseCandidate();
});

test('unrelated candidate persistence failure does not affect interactive AI', async () => {
  const core = interactiveCore();
  const early = {
    entry: { preparedEntry: { plan: { planId: 'plan-1' } } },
    resolveAdmission: async () => ({ entry: early.entry }),
    persistCanonicalCopy: async (copy) => ({ outfitKey: 'look-1', cardIndex: 0, text: copy.text }),
    applyCanonicalToResponse: (response, copy) => ({ ...response, light: { cards: [{ ...response.light.cards[0], todayReason: copy.text }] } }),
    scheduleBackgroundMaterialization: async () => ({ accepted: true }),
  };
  const candidateFailure = Promise.reject(new Error('candidate persistence failed'));
  const result = await runRecommendationOrchestrator({}, {
    prepareFirstCardInteractive: () => early,
    computeRecommendation: async (_input, runtimeContext) => {
      runtimeContext.onFirstCardReady({ entry: early.entry });
      return core;
    },
    prepareRecommendationWork: async () => ({
      batchId: 'batch-interactive',
      tasks: [candidateFailure],
      narrativePlans: core.narrativePlans,
      rendererEntries: [early.entry],
      firstCardInteractive: early,
    }),
    persistAndAssembleRecommendation: async () => ({
      batch: { batchId: 'batch-interactive', countContract: {} },
      light: { cards: [{ outfitKey: 'look-1', todayReason: 'safe' }] },
    }),
    renderFirstCardCanonical: async () => ({
      status: 'success', copy: { planId: 'plan-1', text: 'AI despite persistence failure' },
    }),
  }, {
    onPostC2TasksScheduled: ({ tasks }) => Promise.allSettled(tasks),
  });
  assert.equal(result.firstCardAi.status, 'SUCCESS');
  assert.equal(result.response.light.cards[0].todayReason, 'AI despite persistence failure');
});

test('AI success persists canonical before the authoritative first response', async () => {
  const events = [];
  const context = interactiveContext({
    firstCardInteractive: {
      persistCanonicalCopy: async (copy) => {
        events.push('canonical-persisted');
        return { outfitKey: 'look-1', cardIndex: 0, text: copy.text, source: 'ai_cache' };
      },
      applyCanonicalToResponse: (response, copy) => {
        events.push('response-assembled');
        return { ...response, light: { cards: [{ ...response.light.cards[0], todayReason: copy.text, copySource: 'ai_cache' }] } };
      },
      completeCopyJob: async () => { events.push('job-completed'); },
    },
  });
  const result = await runRecommendationOrchestrator({}, context, {
    onRecommendationReady: () => events.push('ready'),
  });
  assert.equal(result.response.light.cards[0].todayReason, 'AI canonical');
  assert.equal(result.firstCardAi.status, 'SUCCESS');
  assert.deepEqual(events, ['canonical-persisted', 'job-completed', 'response-assembled', 'ready']);
});

test('interactive audit records correlated first-card stages and a complete summary', async () => {
  const audit = [];
  const context = interactiveContext({
    firstCardInteractive: {
      resolveAdmission: async () => ({}),
    },
    context: {
      diagnostics: {
        auditId: 'audit-test',
        monotonicOriginAt: process.hrtime.bigint(),
        stageLogger: (_label, entry) => audit.push(entry),
      },
      renderFirstCardCanonical: async ({ rendererConfig }) => {
        rendererConfig.onAuditStage('PROVIDER_START', 'started');
        rendererConfig.onAuditStage('PROVIDER_COMPLETE', 'completed');
        rendererConfig.onAuditStage('VALIDATOR_COMPLETE', 'accepted');
        return { status: 'success', copy: { planId: 'plan-1', text: 'AI canonical' } };
      },
    },
  });
  await runRecommendationOrchestrator({}, context);
  const stages = new Set(audit.map((entry) => entry.stage));
  for (const stage of ['HANDLER_ENTRY', 'CORE_READY', 'NARRATIVE_PLAN_READY', 'CACHE_LOOKUP_DONE', 'BACKGROUND_DISPATCHED',
    'FIRST_CARD_AI_ADMITTED', 'PROVIDER_START', 'PROVIDER_COMPLETE', 'VALIDATOR_COMPLETE',
    'CANONICAL_WRITE_START', 'CANONICAL_WRITE_DONE', 'CANONICAL_PERSISTED']) assert.ok(stages.has(stage), stage);
  const summary = context.diagnostics.firstCardAudit.summary;
  assert.equal(summary.auditId, 'audit-test');
  assert.equal(summary.firstCardAiStarted, true);
  assert.equal(summary.providerCalled, true);
  assert.equal(summary.validated, true);
  assert.equal(summary.persisted, true);
  assert.equal(summary.backgroundDispatched, false);
  assert.equal(summary.deadlineReason, null);
  assert.equal(summary.stageStatus.DEADLINE_REACHED, 'not_occurred');
  const stageEntries = audit.filter((entry) => typeof entry.stage === 'string');
  assert.ok(stageEntries.every((entry) => entry.auditId === 'audit-test'));
  assert.ok(stageEntries.every((entry) => typeof entry.elapsedFromHandlerMs === 'number'));
  assert.ok(stageEntries.every((entry) => typeof entry.remainingDeadlineMs === 'number'));
  assert.ok(stageEntries.every((entry) => typeof entry.status === 'string'));
});

test('T+1000ms audit reports about 1000ms elapsed and 1300ms remaining', async () => {
  const handlerOrigin = process.hrtime.bigint() - 1000n * 1000000n;
  const diagnostics = {
    auditId: 'audit-clock',
    monotonicOriginAt: process.hrtime.bigint() - 3559n * 1000000n,
    stageLogger: () => {},
  };
  await runRecommendationOrchestrator({}, interactiveContext({
    context: { diagnostics, handlerOrigin },
  }));
  const handlerEntry = diagnostics.firstCardAudit.stages.find((entry) => entry.stage === 'HANDLER_ENTRY');
  assert.ok(handlerEntry.elapsedFromHandlerMs >= 995 && handlerEntry.elapsedFromHandlerMs < 1100);
  assert.ok(handlerEntry.remainingDeadlineMs > 1200 && handlerEntry.remainingDeadlineMs <= 1305);
  assert.ok(Math.abs(
    handlerEntry.elapsedFromHandlerMs + handlerEntry.remainingDeadlineMs - 2300,
  ) < 0.01);
});

test('T+2299ms audit reports about 1ms remaining', async () => {
  const handlerOrigin = process.hrtime.bigint() - 2299n * 1000000n;
  const diagnostics = { auditId: 'audit-one-ms', stageLogger: () => {} };
  await runRecommendationOrchestrator({}, interactiveContext({
    context: { diagnostics, handlerOrigin },
  }));
  const handlerEntry = diagnostics.firstCardAudit.stages.find((entry) => entry.stage === 'HANDLER_ENTRY');
  assert.ok(handlerEntry.elapsedFromHandlerMs >= 2299);
  assert.ok(handlerEntry.remainingDeadlineMs >= 0 && handlerEntry.remainingDeadlineMs <= 1.1);
});

test('failed background dispatch is not reported as dispatched', async () => {
  const diagnostics = {
    auditId: 'audit-background-failed',
    monotonicOriginAt: process.hrtime.bigint(),
    stageLogger: () => {},
  };
  const context = interactiveContext({
    firstCardInteractive: {
      scheduleBackgroundMaterialization: async () => ({ accepted: false, status: 'dispatch_failed' }),
    },
    context: { diagnostics },
  });
  await runRecommendationOrchestrator({}, context);
  assert.equal(diagnostics.firstCardAudit.summary.backgroundDispatched, false);
});

test('normal first-card miss never invokes an injected SCF dispatcher', async () => {
  const diagnostics = {
    auditId: 'audit-background-joined',
    monotonicOriginAt: process.hrtime.bigint(),
    stageLogger: () => {},
  };
  let dispatchCalls = 0;
  const context = interactiveContext({
    firstCardInteractive: {
      scheduleBackgroundMaterialization: async () => { dispatchCalls += 1; return { accepted: true }; },
    },
    context: { diagnostics },
  });
  await runRecommendationOrchestrator({}, context);
  assert.equal(dispatchCalls, 0);
  assert.equal(diagnostics.firstCardAudit.summary.backgroundDispatched, false);
});

test('card0 canonical cache hit skips the provider and marks AI stages not occurred', async () => {
  let providerCalls = 0;
  let persistenceCalls = 0;
  const diagnostics = {
    auditId: 'audit-cache-hit',
    monotonicOriginAt: process.hrtime.bigint(),
    stageLogger: () => {},
  };
  const context = interactiveContext({
    firstCardInteractive: {
      resolveAdmission: async () => ({
        cachedCopy: { outfitKey: 'look-1', cardIndex: 0, text: 'cached canonical', source: 'ai_cache' },
      }),
      persistCanonicalCopy: async () => { persistenceCalls += 1; },
    },
    context: { diagnostics, renderFirstCardCanonical: async () => { providerCalls += 1; } },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'CACHE_HIT');
  assert.equal(result.response.light.cards[0].todayReason, 'cached canonical');
  assert.equal(providerCalls, 0);
  assert.equal(persistenceCalls, 0);
  assert.equal(diagnostics.firstCardAudit.summary.firstCardAiStarted, false);
  assert.equal(diagnostics.firstCardAudit.summary.providerCalled, false);
  assert.equal(diagnostics.firstCardAudit.summary.stageStatus.CACHE_LOOKUP_DONE, 'occurred');
  assert.equal(diagnostics.firstCardAudit.summary.stageStatus.FIRST_CARD_AI_ADMITTED, 'not_occurred');
  assert.equal(diagnostics.firstCardAudit.summary.stageStatus.PROVIDER_START, 'not_occurred');
});

for (const failureType of ['PROVIDER_FAIL', 'VALIDATOR_FAIL']) {
  test(`${failureType} preserves safe recommendation and leaves the job retryable`, async () => {
    const outcomes = [];
    const context = interactiveContext({
      firstCardInteractive: {
        markCopyJobRetryable: async (outcome) => { outcomes.push(outcome); },
      },
      context: {
        renderFirstCardCanonical: async () => ({ status: 'failure', failureType }),
      },
    });
    const result = await runRecommendationOrchestrator({}, context);
    assert.equal(result.firstCardAi.status, 'FAIL');
    assert.equal(result.firstCardAi.reason, failureType);
    assert.equal(result.response.light.cards[0].todayReason, 'safe');
    await result.tailDone;
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].reason, failureType);
  });
}

test('absolute deadline returns safe copy then persists the same late provider result once', async () => {
  let release;
  let providerCalls = 0;
  let persistenceCalls = 0;
  const monotonicOriginAt = process.hrtime.bigint() - 2250n * 1000000n;
  const diagnostics = { auditId: 'audit-provider', monotonicOriginAt, stageLogger: () => {} };
  const context = interactiveContext({
    firstCardInteractive: {
      persistCanonicalCopy: async () => { persistenceCalls += 1; },
    },
    context: {
      diagnostics,
      handlerOrigin: monotonicOriginAt,
      renderFirstCardCanonical: async ({ rendererConfig }) => {
        providerCalls += 1;
        assert.ok(rendererConfig.timeoutMs >= 6000);
        rendererConfig.onAuditStage('PROVIDER_START', 'started');
        return new Promise((resolve) => { release = resolve; });
      },
    },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'TIMEOUT');
  assert.equal(result.response.light.cards[0].todayReason, 'safe');
  assert.equal(persistenceCalls, 0);
  release({ status: 'success', copy: { planId: 'plan-1', text: 'late canonical' } });
  await result.tailDone;
  assert.equal(providerCalls, 1);
  assert.equal(persistenceCalls, 1);
  assert.equal(diagnostics.AI_LATE_DISCARDED, false);
  assert.equal(diagnostics.FIRST_CARD_AI_RESULT, 'SUCCESS_TAIL');
  assert.equal(diagnostics.firstCardAudit.summary.deadlineReason, 'PROVIDER_IN_FLIGHT');
  assert.equal(diagnostics.firstCardAudit.summary.providerCalled, true);
});

test('canonical persistence failure keeps safe copy and marks the job retryable', async () => {
  const outcomes = [];
  const context = interactiveContext({
    firstCardInteractive: {
      persistCanonicalCopy: async () => { throw new Error('CANONICAL_WRITE_FAILED'); },
      markCopyJobRetryable: async (outcome) => { outcomes.push(outcome); },
    },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'FAIL');
  assert.equal(result.firstCardAi.reason, 'PERSIST_FAIL');
  assert.equal(result.response.light.cards[0].todayReason, 'safe');
  await result.tailDone;
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].reason, 'PERSIST_FAIL');
});

test('deadline summary freezes pre-AI exhaustion at the absolute handler deadline', async () => {
  let providerCalls = 0;
  let persistenceCalls = 0;
  const handlerOrigin = process.hrtime.bigint() - 2301n * 1000000n;
  const diagnostics = {
    auditId: 'audit-pre-ai',
    monotonicOriginAt: process.hrtime.bigint() - 4860n * 1000000n,
    stageLogger: () => {},
  };
  const context = interactiveContext({
    firstCardInteractive: {
      materializeFirstCard: async () => {
        providerCalls += 1;
        return { status: 'SUCCESS', copy: { planId: 'plan-1', text: 'tail materialized' } };
      },
      persistCanonicalCopy: async (copy) => {
        persistenceCalls += 1;
        return { outfitKey: 'look-1', cardIndex: 0, text: copy.text };
      },
    },
    context: {
      diagnostics,
      handlerOrigin,
      renderFirstCardCanonical: async () => {
        providerCalls += 1;
        return { status: 'failure', failureType: 'PROVIDER_FAIL' };
      },
    },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'TIMEOUT');
  assert.equal(diagnostics.firstCardAudit.summary.deadlineReason, 'PRE_AI_EXHAUSTION');
  assert.equal(diagnostics.firstCardAudit.summary.remainingAtAiStartMs, 0);
  await result.tailDone;
  assert.equal(providerCalls, 1);
  assert.equal(persistenceCalls, 1);
});

test('deadline summary distinguishes provider completion from validator completion', async () => {
  let release;
  const handlerOrigin = process.hrtime.bigint() - 2250n * 1000000n;
  const diagnostics = {
    auditId: 'audit-validator',
    monotonicOriginAt: process.hrtime.bigint() - 4800n * 1000000n,
    stageLogger: () => {},
  };
  const context = interactiveContext({
    context: {
      diagnostics,
      handlerOrigin,
      renderFirstCardCanonical: async ({ rendererConfig }) => {
        rendererConfig.onAuditStage('PROVIDER_START', 'started');
        rendererConfig.onAuditStage('PROVIDER_COMPLETE', 'completed');
        return new Promise((resolve) => { release = resolve; });
      },
    },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'TIMEOUT');
  assert.equal(diagnostics.firstCardAudit.summary.deadlineReason, 'VALIDATOR_IN_FLIGHT');
  assert.equal(diagnostics.firstCardAudit.summary.providerDurationMs >= 0, true);
  assert.equal(diagnostics.firstCardAudit.summary.validated, false);
  release({ status: 'failure', failureType: 'VALIDATOR_FAIL' });
  await new Promise((resolve) => setImmediate(resolve));
});

test('failureId is stable within an attempt and distinct across attempts', async () => {
  const failure = createFailureEnvelope(new Error('rate limited'), { failureId: 'attempt-1-failure' }, {
    stage: 'http_response', code: 'PROVIDER_HTTP_ERROR',
    retryability: 'retryable', providerIssue: 'yes', businessRejected: 'no', deadline: { causedFailure: 'no', source: null },
    provider: { httpStatus: 429 },
  });
  const context = interactiveContext({
    context: {
      diagnostics: { stageLogger: () => { throw new Error('logger must be fail-open'); } },
      renderFirstCardCanonical: async () => ({ status: 'failure', failureType: 'PROVIDER_FAIL', failure }),
    },
  });
  const first = await runRecommendationOrchestrator({}, context);
  assert.equal(first.firstCardAi.failure.failureId, failure.failureId);
  await first.tailDone;
  assert.equal(first.firstCardAi.failure.failureId, failure.failureId);

  const secondFailure = { ...failure, failureId: 'attempt-2-failure' };
  const second = await runRecommendationOrchestrator({}, interactiveContext({
    context: {
      renderFirstCardCanonical: async () => ({ status: 'failure', failureType: 'PROVIDER_FAIL', failure: secondFailure }),
    },
  }));
  assert.notEqual(first.firstCardAi.failure.failureId, second.firstCardAi.failure.failureId);
});

test('real Core to Renderer to Orchestrator preserves HTTP 429 failure evidence', async () => {
  const logs = [];
  const requests = [];
  const ai = createXiaodaAI({ authLookup: 'secret', fetch: async (url, options) => {
    requests.push({ url, options });
    return {
    ok: false, status: 429,
    headers: { get: () => 'request-429' },
    text: async () => JSON.stringify({ error: { code: 'Throttling.RateQuota' } }),
    };
  } });
  const context = interactiveContext({
    firstCardInteractive: { entry: { preparedEntry: { plan: { planId: 'plan-1' }, input: { planId: 'plan-1', expressionMode: 'baseline', garments: ['白衬衫'], primary: null } } } },
    context: {
      diagnostics: { auditId: 'audit-chain', stageLogger: (name, value) => logs.push({ name, value }) },
      renderFirstCardCanonical: ({ entry, rendererConfig }) => renderFirstCardCanonical({ entry, rendererConfig: { ...rendererConfig, xiaodaAI: ai } }),
    },
  });
  const result = await runRecommendationOrchestrator({}, context);
  await result.tailDone;
  const failure = result.firstCardAi.failure;
  assert.equal(failure.code, 'PROVIDER_HTTP_ERROR');
  assert.equal(failure.provider.httpStatus, 429);
  assert.equal(failure.provider.requestId, 'request-429');
  assert.equal(failure.provider.errorCode, 'Throttling.RateQuota');
  assert.ok(failure.failureId);
  assert.equal(failure.auditId, 'audit-chain');
  assert.equal(failure.stage, 'http_response');
  assert.equal(failure.retryability, 'retryable');
  assert.equal(failure.providerIssue, 'yes');
  assert.equal(failure.businessRejected, 'no');
  assert.equal(failure.deadline.causedFailure, 'no');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'POST');
  const correlated = logs.filter((log) => log.value.failure);
  assert.ok(correlated.some((log) => log.value.stage === 'PROVIDER_COMPLETE'));
  assert.ok(correlated.some((log) => log.value.stage === 'STREAM_COMPLETE'));
  assert.ok(correlated.some((log) => log.value.stage === 'EXECUTION_COMPLETE'));
  assert.ok(correlated.some((log) => log.name === '[RecommendationAuditSummary]'));
  assert.ok(correlated.every((log) => log.value.failure.failureId === failure.failureId));
  assert.ok(correlated.every((log) => log.value.failure.attemptId === failure.attemptId));
});

for (const expireTail of [false, true]) test(`response deadline then actual provider failure (tail wait expired=${expireTail})`, async () => {
  const logs = [];
  const retryInputs = [];
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const ai = createXiaodaAI({ authLookup: 'test-key', fetch: async () => {
    calls += 1;
    await gate;
    return { ok: false, status: 503, headers: { get: () => 'late-request' }, text: async () => JSON.stringify({ error: { code: 'ServiceUnavailable' } }) };
  } });
  const diagnostics = { auditId: 'tail-audit', stageLogger: (name, value) => logs.push({ name, value }) };
  const context = interactiveContext({
    firstCardInteractive: {
      entry: { preparedEntry: { plan: { planId: 'plan-1' }, input: { expressionMode: 'baseline', garments: ['白衬衫'], primary: null } } },
      markCopyJobRetryable: async (input) => retryInputs.push(input),
    },
    context: {
      diagnostics, handlerOrigin: process.hrtime.bigint() - 2200n * 1000000n,
      firstCardTailTimeoutMs: expireTail ? 10 : 1000,
      renderFirstCardCanonical: ({ entry, rendererConfig }) => renderFirstCardCanonical({ entry, rendererConfig: { ...rendererConfig, xiaodaAI: ai } }),
    },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'TIMEOUT');
  assert.equal(result.response.light.cards[0].todayReason, 'safe');
  const responseSnapshot = diagnostics.firstCardAudit.responseSummary;
  assert.equal(responseSnapshot.responseDeadlineReached, true);
  assert.equal(responseSnapshot.executionOutcome, 'running');
  assert.equal(responseSnapshot.failure, null);
  if (expireTail) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await result.tailDone).status, 'TAIL_TIMEOUT');
    assert.equal(diagnostics.firstCardAudit.summary.tailWaitExpired, true);
    assert.equal(diagnostics.firstCardAudit.summary.failure, null);
  }
  release();
  if (expireTail) await new Promise((resolve) => setImmediate(resolve));
  else assert.equal((await result.tailDone).status, 'FAIL');
  const final = diagnostics.firstCardAudit.summary;
  assert.equal(final.executionOutcome, 'failed');
  assert.equal(final.failure.provider.httpStatus, 503);
  assert.equal(final.failure.deadline.causedFailure, 'no');
  assert.equal(final.responseDeadlineReached, true);
  assert.equal(final.tailWaitExpired, expireTail);
  assert.equal(responseSnapshot.failure, null, 'response-time snapshot must not mutate');
  assert.equal(responseSnapshot.executionOutcome, 'running');
  assert.equal(calls, 1);
  const ids = new Set(logs.filter((log) => log.value.failure).map((log) => log.value.failure.failureId));
  assert.deepEqual([...ids], [final.failure.failureId]);
  assert.ok(retryInputs.every((input) => !input.failure && !input.result?.failure));
});

test('pre-admission exhaustion allocates identity only when tail materializes', async () => {
  let materialized;
  const diagnostics = { auditId: 'pre-admission-audit', stageLogger: () => {} };
  const context = interactiveContext({
    firstCardInteractive: {
      materializeFirstCard: async (options) => {
        materialized = options;
        const failure = createFailureEnvelope(new Error('rejected'), options.failureContext, {
          stage: 'validation', code: 'VALIDATION_REJECTED', providerIssue: 'no', businessRejected: 'yes', deadline: { causedFailure: 'no', source: null },
        });
        options.onAuditStage('EXECUTION_COMPLETE', 'failed', { failure });
        return { status: 'FAIL', reason: 'VALIDATOR_FAIL', failure };
      },
    },
    context: { diagnostics, handlerOrigin: process.hrtime.bigint() - 2301n * 1000000n },
  });
  const result = await runRecommendationOrchestrator({}, context);
  await result.tailDone;
  assert.equal(diagnostics.firstCardAudit.responseSummary.executionOutcome, 'not_started');
  assert.equal(diagnostics.firstCardAudit.responseSummary.failure, null);
  assert.equal(typeof materialized.attemptId, 'string');
  assert.equal(materialized.attemptId, materialized.failureContext.attemptId);
  assert.equal(diagnostics.firstCardAudit.summary.failure.attemptId, materialized.attemptId);
  assert.equal(diagnostics.firstCardAudit.summary.failure.auditId, 'pre-admission-audit');
  assert.equal(diagnostics.firstCardAudit.summary.failure.deadline.causedFailure, 'no');
});

test('Phase1A early admission owns one promise and does not duplicate provider work', async () => {
  const events = [];
  const core = interactiveCore();
  const entry = { preparedEntry: { plan: { planId: 'plan-1', fingerprint: 'fp-1', outfitKey: 'look-1' } } };
  let prepareCalls = 0;
  let providerCalls = 0;
  let releaseAdmission;
  const admission = new Promise((resolve) => { releaseAdmission = resolve; });
  const interactive = {
    entry,
    resolveAdmission: async () => { events.push('lookup'); return { entry }; },
    persistCanonicalCopy: async (copy) => ({ ...copy, outfitKey: 'look-1', cardIndex: 0 }),
    applyCanonicalToResponse: (response, copy) => ({ ...response, light: { cards: [{ outfitKey: 'look-1', todayReason: copy.text }] } }),
  };
  const running = runRecommendationOrchestrator({}, {
    prepareFirstCardInteractive: () => {
      prepareCalls += 1;
      return admission;
    },
    computeRecommendation: async (_input, runtimeContext) => {
      events.push('card0');
      runtimeContext.onFirstCardReady({ entry, recommendation: core.outfits[0], plan: entry.preparedEntry.plan });
      events.push('card1-N');
      return core;
    },
    prepareRecommendationWork: async () => ({ batchId: core.metadata.batchId, tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [entry], firstCardInteractive: interactive }),
    persistAndAssembleRecommendation: async () => ({ batch: { batchId: core.metadata.batchId, countContract: {} }, light: { cards: [{ outfitKey: 'look-1', todayReason: 'safe' }] } }),
    renderFirstCardCanonical: async () => { providerCalls += 1; events.push('provider'); return { status: 'success', copy: { planId: 'plan-1', fingerprint: 'fp-1', outfitKey: 'look-1', text: 'early' } }; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prepareCalls, 1);
  assert.equal(providerCalls, 0, 'provider waits for the single admission promise');
  releaseAdmission({ ...interactive });
  const result = await running;
  await result.tailDone;
  assert.equal(providerCalls, 1);
  assert.deepEqual(events.slice(0, 3), ['card0', 'card1-N', 'lookup']);
  assert.equal(result.firstCardAi.status, 'SUCCESS');
});

test('Phase1A keeps the prepared adapter as the canonical persistence owner', async () => {
  const core = interactiveCore();
  const entry = { preparedEntry: { plan: { planId: 'plan-1' } } };
  let persisted = 0;
  const preparedInteractive = {
    entry,
    resolveAdmission: async () => ({ entry }),
    persistCanonicalCopy: async (copy) => { persisted += 1; return { ...copy, outfitKey: 'look-1', cardIndex: 0 }; },
    completeCopyJob: async () => {},
    applyCanonicalToResponse: (response, copy) => ({ ...response, light: { cards: [{ outfitKey: 'look-1', todayReason: copy.text }] } }),
  };
  const result = await runRecommendationOrchestrator({}, {
    prepareFirstCardInteractive: () => ({ entry }),
    computeRecommendation: async (_input, runtimeContext) => { runtimeContext.onFirstCardReady({ entry }); return core; },
    prepareRecommendationWork: async () => ({ batchId: core.metadata.batchId, tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [entry], firstCardInteractive: preparedInteractive }),
    persistAndAssembleRecommendation: async () => ({ batch: { batchId: core.metadata.batchId, countContract: {} }, light: { cards: [{ outfitKey: 'look-1', todayReason: 'safe' }] } }),
    renderFirstCardCanonical: async () => ({ status: 'success', copy: { planId: 'plan-1', text: 'early' } }),
  });
  assert.equal(result.firstCardAi.status, 'SUCCESS');
  assert.equal(persisted, 1);
  assert.equal(result.response.light.cards[0].todayReason, 'early');
});

test('Phase1A async setup rejection is absorbed and leaves no unhandled rejection', async () => {
  const core = interactiveCore();
  const errors = [];
  const onUnhandled = (error) => errors.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const result = await runRecommendationOrchestrator({}, {
      prepareFirstCardInteractive: async () => { throw new Error('setup failed'); },
      computeRecommendation: async (_input, runtimeContext) => {
        runtimeContext.onFirstCardReady({ entry: { preparedEntry: { plan: { planId: 'plan-1' } } } });
        return core;
      },
      prepareRecommendationWork: async () => ({ batchId: core.metadata.batchId, tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [], firstCardInteractive: { entry: {} } }),
      persistAndAssembleRecommendation: async () => ({ batch: { batchId: core.metadata.batchId, countContract: {} } }),
    });
    assert.equal(result.batchId, core.metadata.batchId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('Phase1A provider failure is tail-owned and does not leak a rejection', async () => {
  const core = interactiveCore();
  const interactive = {
    entry: { preparedEntry: { plan: { planId: 'plan-1' } } },
    resolveAdmission: async () => ({ entry: interactive.entry }),
    persistCanonicalCopy: async () => { throw new Error('must not persist failure'); },
    markCopyJobRetryable: async () => {},
  };
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const result = await runRecommendationOrchestrator({}, {
      prepareFirstCardInteractive: () => interactive,
      computeRecommendation: async (_input, runtimeContext) => { runtimeContext.onFirstCardReady({ entry: interactive.entry }); return core; },
      prepareRecommendationWork: async () => ({ batchId: core.metadata.batchId, tasks: [], narrativePlans: core.narrativePlans, rendererEntries: [interactive.entry], firstCardInteractive: interactive }),
      persistAndAssembleRecommendation: async () => ({ batch: { batchId: core.metadata.batchId, countContract: {} }, light: { cards: [{ outfitKey: 'look-1', todayReason: 'safe' }] } }),
      renderFirstCardCanonical: async () => { throw new Error('provider failed'); },
    });
    assert.equal(result.firstCardAi.status, 'FAIL');
    await result.tailDone;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

function deferredCardWork() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('Phase1A latches duplicate and reentrant callbacks before synchronous preparation', async () => {
  for (const throws of [false, true]) {
    let callback;
    let preparationCalls = 0;
    let providerCalls = 0;
    const context = interactiveContext();
    context.prepareFirstCardInteractive = () => {
      preparationCalls += 1;
      callback({ entry: { unexpected: true } });
      if (throws) throw new Error('setup failed');
      return { entry: { planId: 'original' } };
    };
    context.computeRecommendation = async (_input, runtimeContext) => {
      callback = runtimeContext.onFirstCardReady;
      callback({});
      callback({ entry: { unexpected: true } });
      return interactiveCore();
    };
    context.renderFirstCardCanonical = async ({ entry }) => {
      providerCalls += 1;
      assert.equal(entry.planId, 'original');
      return { status: 'success', copy: { text: 'one provider' } };
    };
    const result = await runRecommendationOrchestrator({}, context);
    await result.tailDone;
    assert.equal(preparationCalls, 1);
    assert.equal(providerCalls, throws ? 0 : 1);
    assert.equal(result.firstCardAi.status, throws ? 'FAIL' : 'SUCCESS');
  }
});

test('Phase1A early success waits for complete batch commit before canonical persistence and ready', async () => {
  const batch = deferredCardWork();
  const events = [];
  const context = interactiveContext({ firstCardInteractive: {
    persistCanonicalCopy: async (copy) => { events.push('canonical'); return copy; },
  } });
  context.prepareFirstCardInteractive = () => ({ entry: {} });
  context.computeRecommendation = async (_input, runtimeContext) => {
    runtimeContext.onFirstCardReady({});
    return interactiveCore();
  };
  context.renderFirstCardCanonical = async () => {
    events.push('provider');
    return { status: 'success', copy: { text: 'ready' } };
  };
  context.persistAndAssembleRecommendation = async () => {
    events.push('batch-start');
    await batch.promise;
    events.push('batch-commit');
    return { batch: { batchId: 'batch-interactive' }, light: { cards: [{ outfitKey: 'look-1' }] } };
  };
  const running = runRecommendationOrchestrator({}, context, {
    onRecommendationReady: () => events.push('ready'),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['provider', 'batch-start']);
  batch.resolve();
  const result = await running;
  await result.tailDone;
  assert.deepEqual(events, ['provider', 'batch-start', 'batch-commit', 'canonical', 'ready']);
});

for (const failedStage of ['core', 'prepare', 'assembler']) {
  for (const providerFails of [false, true]) {
    test(`Phase1A ${failedStage} failure drains admitted provider ${providerFails ? 'rejection' : 'success'} before propagating`, async () => {
      const provider = deferredCardWork();
      const error = new Error(`${failedStage} failed`);
      let providerCalls = 0;
      let persisted = 0;
      let retryCount = 0;
      let completed = false;
      const context = interactiveContext({ firstCardInteractive: {
        persistCanonicalCopy: async () => { persisted += 1; },
        markCopyJobRetryable: async () => { retryCount += 1; },
      } });
      context.prepareFirstCardInteractive = () => ({ entry: {} });
      context.computeRecommendation = async (_input, runtimeContext) => {
        runtimeContext.onFirstCardReady({});
        if (failedStage === 'core') throw error;
        return interactiveCore();
      };
      if (failedStage === 'prepare') context.prepareRecommendationWork = async () => { throw error; };
      if (failedStage === 'assembler') context.persistAndAssembleRecommendation = async () => { throw error; };
      context.renderFirstCardCanonical = () => { providerCalls += 1; return provider.promise; };
      const caught = runRecommendationOrchestrator({}, context).then(
        () => { completed = true; return null; },
        (cause) => { completed = true; return cause; },
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(providerCalls, 1);
      assert.equal(completed, false, 'failure cleanup must own the in-flight provider');
      if (providerFails) provider.reject(new Error('provider failed after batch'));
      else provider.resolve({ status: 'success', copy: { text: 'unused' } });
      assert.equal(await caught, error);
      assert.equal(persisted, 0, 'failed batch cannot move canonical persistence into cleanup');
      assert.equal(retryCount, failedStage === 'assembler' ? 1 : 0);
    });
  }
}

test('Phase1A partial preparation exposes cleanup through returned tailDone', async () => {
  const provider = deferredCardWork();
  const context = interactiveContext();
  context.prepareFirstCardInteractive = () => ({ entry: {} });
  context.computeRecommendation = async (_input, runtimeContext) => {
    runtimeContext.onFirstCardReady({});
    return interactiveCore();
  };
  context.prepareRecommendationWork = async () => ({ tasks: [], narrativePlans: [], rendererEntries: [] });
  context.renderFirstCardCanonical = () => provider.promise;
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(typeof result.tailDone?.then, 'function');
  let tailComplete = false;
  const tail = result.tailDone.then((value) => { tailComplete = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tailComplete, false);
  provider.reject(new Error('late provider failure'));
  assert.equal((await tail).status, 'FAIL');
  await result.aiDone;
});

test('Phase1A core failure settles the admission-owned durable job when preparation has not completed', async () => {
  const provider = deferredCardWork();
  let retryCount = 0;
  const admission = {
    entry: {},
    markCopyJobRetryable: async () => { retryCount += 1; },
  };
  const context = interactiveContext();
  context.prepareFirstCardInteractive = () => admission;
  context.computeRecommendation = async (_input, runtimeContext) => {
    runtimeContext.onFirstCardReady({});
    throw new Error('core failed before preparation');
  };
  context.renderFirstCardCanonical = () => provider.promise;
  const caught = runRecommendationOrchestrator({}, context);
  await new Promise((resolve) => setImmediate(resolve));
  provider.resolve({ status: 'success', copy: { text: 'unused' } });
  await assert.rejects(caught, /core failed before preparation/);
  assert.equal(retryCount, 1);
});

test('Phase1A starts admission cleanup before an unresolved provider settles', async () => {
  const provider = deferredCardWork();
  let retryCount = 0;
  let cleanupStarted = false;
  const admission = {
    entry: {},
    markCopyJobRetryable: async () => { cleanupStarted = true; retryCount += 1; },
  };
  const context = interactiveContext();
  context.prepareFirstCardInteractive = () => admission;
  context.computeRecommendation = async (_input, runtimeContext) => {
    runtimeContext.onFirstCardReady({});
    throw new Error('core failed while provider is running');
  };
  context.renderFirstCardCanonical = () => provider.promise;
  const caught = runRecommendationOrchestrator({}, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cleanupStarted, true);
  assert.equal(retryCount, 1);
  provider.resolve({ status: 'success', copy: { text: 'unused' } });
  await assert.rejects(caught, /core failed while provider is running/);
  assert.equal(retryCount, 1);
});

test('Phase1A failure cleanup is bounded and still observes rejection after tail expires', async () => {
  const provider = deferredCardWork();
  const context = interactiveContext();
  context.firstCardTailTimeoutMs = 5;
  context.prepareFirstCardInteractive = () => ({ entry: {} });
  context.computeRecommendation = async (_input, runtimeContext) => {
    runtimeContext.onFirstCardReady({});
    throw new Error('core failed');
  };
  context.renderFirstCardCanonical = () => provider.promise;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(runRecommendationOrchestrator({}, context), /core failed/);
    provider.reject(new Error('rejected after tail window'));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    clearTimeout(keepAlive);
  }
});

test('Phase1A abandoned async preparation never starts a provider after Core fails', async () => {
  const admission = deferredCardWork();
  const context = interactiveContext();
  let calls = 0;
  context.prepareFirstCardInteractive = () => admission.promise;
  context.computeRecommendation = async (_input, runtimeContext) => {
    runtimeContext.onFirstCardReady({});
    throw new Error('core failed');
  };
  context.renderFirstCardCanonical = async () => { calls += 1; return { status: 'success' }; };
  const caught = assert.rejects(runRecommendationOrchestrator({}, context), /core failed/);
  await new Promise((resolve) => setImmediate(resolve));
  admission.resolve({ entry: {} });
  await caught;
  assert.equal(calls, 0);
});

test('Phase1A late callbacks cannot duplicate the prepared-path provider', async () => {
  const provider = deferredCardWork();
  const context = interactiveContext();
  let callback;
  let calls = 0;
  let earlyPreparations = 0;
  context.prepareFirstCardInteractive = () => { earlyPreparations += 1; return { entry: {} }; };
  context.computeRecommendation = async (_input, runtimeContext) => {
    callback = runtimeContext.onFirstCardReady;
    return interactiveCore();
  };
  context.renderFirstCardCanonical = () => { calls += 1; return provider.promise; };
  const running = runRecommendationOrchestrator({}, context);
  await new Promise((resolve) => setImmediate(resolve));
  callback({});
  assert.equal(earlyPreparations, 0);
  assert.equal(calls, 1);
  provider.resolve({ status: 'success', copy: { text: 'single provider' } });
  const result = await running;
  await result.tailDone;
});
