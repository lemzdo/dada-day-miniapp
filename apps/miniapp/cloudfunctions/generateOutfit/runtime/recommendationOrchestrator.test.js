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

test('card0 canonical cache hit skips the provider and still fills first response', async () => {
  let providerCalls = 0;
  let persistenceCalls = 0;
  const context = interactiveContext({
    firstCardInteractive: {
      resolveAdmission: async () => ({
        cachedCopy: { outfitKey: 'look-1', cardIndex: 0, text: 'cached canonical', source: 'ai_cache' },
      }),
      persistCanonicalCopy: async () => { persistenceCalls += 1; },
    },
    context: { renderFirstCardCanonical: async () => { providerCalls += 1; } },
  });
  const result = await runRecommendationOrchestrator({}, context);
  assert.equal(result.firstCardAi.status, 'CACHE_HIT');
  assert.equal(result.response.light.cards[0].todayReason, 'cached canonical');
  assert.equal(providerCalls, 0);
  assert.equal(persistenceCalls, 0);
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
  const diagnostics = {};
  const context = interactiveContext({
    firstCardInteractive: {
      persistCanonicalCopy: async () => { persistenceCalls += 1; },
    },
    context: {
      diagnostics,
      requestMonotonicOriginAt: process.hrtime.bigint() - 2295n * 1000000n,
      renderFirstCardCanonical: async () => new Promise((resolve) => { release = resolve; }),
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
});
