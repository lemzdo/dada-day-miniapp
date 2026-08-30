'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runRecommendationOrchestrator } = require('./recommendationOrchestrator');

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
        scheduleBackgroundMaterialization: async () => ({ accepted: true }),
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
      scheduleBackgroundMaterialization: async (outcome) => { events.push(`background-${outcome.status}`); },
    },
  });
  const result = await runRecommendationOrchestrator({}, context, {
    onRecommendationReady: () => events.push('ready'),
  });
  assert.equal(result.response.light.cards[0].todayReason, 'AI canonical');
  assert.equal(result.firstCardAi.status, 'SUCCESS');
  assert.deepEqual(events, ['canonical-persisted', 'response-assembled', 'background-SUCCESS', 'ready']);
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
    'CANONICAL_PERSISTED']) assert.ok(stages.has(stage), stage);
  const summary = context.diagnostics.firstCardAudit.summary;
  assert.equal(summary.auditId, 'audit-test');
  assert.equal(summary.firstCardAiStarted, true);
  assert.equal(summary.providerCalled, true);
  assert.equal(summary.validated, true);
  assert.equal(summary.persisted, true);
  assert.equal(summary.backgroundDispatched, true);
  assert.equal(summary.deadlineReason, null);
  assert.equal(summary.stageStatus.DEADLINE_REACHED, 'not_occurred');
  const stageEntries = audit.filter((entry) => typeof entry.stage === 'string');
  assert.ok(stageEntries.every((entry) => entry.auditId === 'audit-test'));
  assert.ok(stageEntries.every((entry) => typeof entry.elapsedFromHandlerMs === 'number'));
  assert.ok(stageEntries.every((entry) => typeof entry.remainingDeadlineMs === 'number'));
  assert.ok(stageEntries.every((entry) => typeof entry.status === 'string'));
});

test('deadline, elapsed, and remaining share the explicit handler clock', async () => {
  const requestOrigin = process.hrtime.bigint() - 25n * 1000000n;
  const diagnostics = {
    auditId: 'audit-clock',
    monotonicOriginAt: process.hrtime.bigint() - 900n * 1000000n,
    stageLogger: () => {},
  };
  await runRecommendationOrchestrator({}, interactiveContext({
    context: { diagnostics, requestMonotonicOriginAt: requestOrigin },
  }));
  assert.equal(diagnostics.monotonicOriginAt, requestOrigin);
  const coreReady = diagnostics.firstCardAudit.stages.find((entry) => entry.stage === 'CORE_READY');
  assert.ok(coreReady.elapsedFromHandlerMs >= 25);
  assert.ok(Math.abs(
    coreReady.elapsedFromHandlerMs + coreReady.remainingDeadlineMs - 2300,
  ) < 0.01);
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

test('joined durable background dispatch is reported as dispatched', async () => {
  const diagnostics = {
    auditId: 'audit-background-joined',
    monotonicOriginAt: process.hrtime.bigint(),
    stageLogger: () => {},
  };
  const context = interactiveContext({
    firstCardInteractive: {
      scheduleBackgroundMaterialization: async () => ({ accepted: false, joined: true, status: 'joined' }),
    },
    context: { diagnostics },
  });
  await runRecommendationOrchestrator({}, context);
  assert.equal(diagnostics.firstCardAudit.summary.backgroundDispatched, true);
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
  test(`${failureType} preserves safe recommendation and starts background materialization`, async () => {
    const outcomes = [];
    const context = interactiveContext({
      firstCardInteractive: {
        scheduleBackgroundMaterialization: async (outcome) => { outcomes.push(outcome); },
      },
      context: {
        renderFirstCardCanonical: async () => ({ status: 'failure', failureType }),
      },
    });
    const result = await runRecommendationOrchestrator({}, context);
    assert.equal(result.firstCardAi.status, 'FAIL');
    assert.equal(result.firstCardAi.reason, failureType);
    assert.equal(result.response.light.cards[0].todayReason, 'safe');
    assert.equal(outcomes.length, 1);
  });
}

test('absolute deadline returns safe copy and discards a late validated result', async () => {
  let release;
  let persistenceCalls = 0;
  const monotonicOriginAt = process.hrtime.bigint() - 2250n * 1000000n;
  const diagnostics = { auditId: 'audit-provider', monotonicOriginAt, stageLogger: () => {} };
  const context = interactiveContext({
    firstCardInteractive: {
      persistCanonicalCopy: async () => { persistenceCalls += 1; },
    },
    context: {
      diagnostics,
      requestMonotonicOriginAt: monotonicOriginAt,
      renderFirstCardCanonical: async ({ rendererConfig }) => {
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
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persistenceCalls, 0);
  assert.equal(diagnostics.AI_LATE_DISCARDED, true);
  assert.equal(diagnostics.FIRST_CARD_AI_RESULT, 'TIMEOUT');
  assert.equal(diagnostics.firstCardAudit.summary.deadlineReason, 'PROVIDER_IN_FLIGHT');
  assert.equal(diagnostics.firstCardAudit.summary.providerCalled, true);
});

test('deadline summary freezes pre-AI exhaustion at the absolute handler deadline', async () => {
  let providerCalls = 0;
  const diagnostics = {
    auditId: 'audit-pre-ai',
    monotonicOriginAt: process.hrtime.bigint() - 2310n * 1000000n,
    stageLogger: () => {},
  };
  const context = interactiveContext({
    context: {
      diagnostics,
      requestMonotonicOriginAt: diagnostics.monotonicOriginAt,
      renderFirstCardCanonical: async () => {
        providerCalls += 1;
        return { status: 'failure', failureType: 'PROVIDER_FAIL' };
      },
    },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'TIMEOUT');
  assert.equal(diagnostics.firstCardAudit.summary.deadlineReason, 'PRE_AI_EXHAUSTION');
  assert.ok(diagnostics.firstCardAudit.summary.elapsedBeforeAiStartMs >= 2300);
  assert.equal(diagnostics.firstCardAudit.summary.remainingAtAiStartMs, 0);
  assert.equal(providerCalls, 0);
});

test('deadline summary distinguishes provider completion from validator completion', async () => {
  let release;
  const diagnostics = {
    auditId: 'audit-validator',
    monotonicOriginAt: process.hrtime.bigint() - 2250n * 1000000n,
    stageLogger: () => {},
  };
  const context = interactiveContext({
    context: {
      diagnostics,
      requestMonotonicOriginAt: diagnostics.monotonicOriginAt,
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
