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
