'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runRecommendationRuntime } = require('./recommendationRuntime');

function createCore({ outfits = [{ outfitKey: 'a' }], narrativePlans = [{ id: 1 }], batchId = 'b1' } = {}) {
  return { identity: {}, executionState: {}, outfits, narrativePlans, evidence: {}, metadata: { batchId } };
}

function createRuntimeContext(core, rendererEntries = [], extra = {}) {
  return {
    computeRecommendation: async () => core,
    prepareRecommendationWork: async () => ({ batchId: core.metadata.batchId, tasks: [], narrativePlans: core.narrativePlans, rendererEntries }),
    persistAndAssembleRecommendation: async () => ({ batch: { batchId: core.metadata.batchId, countContract: core.executionState.countContract || {} }, cards: core.outfits }),
    ...extra,
  };
}

test('ready is emitted without awaiting incremental AI copies', async () => {
  const events = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const runtime = await runRecommendationRuntime({ maxResults: 3 }, createRuntimeContext(createCore(), [{ id: 1 }], {
    userIdentity: { openid: 'u1' },
    renderer: async ({ onCopy }) => { await blocked; await onCopy({ id: 1, text: 'safe' }); return { status: 'completed' }; },
  }), {
    onNarrativePlansReady: () => events.push('C2'),
    onRecommendationReady: () => events.push('ready'),
    onCanonicalCopy: () => events.push('copy'),
  });
  assert.deepEqual(events, ['C2', 'ready']);
  release();
  await runtime.aiDone;
  assert.deepEqual(events, ['C2', 'ready', 'copy']);
});

test('empty/exhausted recommendations never invoke renderer', async () => {
  let invoked = false;
  const core = createCore({ outfits: [], narrativePlans: [], batchId: 'empty' });
  core.executionState.countContract = { exhausted: true };
  const result = await runRecommendationRuntime({ maxResults: 0 }, createRuntimeContext(core, [], {
    renderer: async () => { invoked = true; },
  }));
  await result.aiDone;
  assert.equal(invoked, false);
});

test('renderer and validator failures are fail-open', async () => {
  const result = await runRecommendationRuntime({}, createRuntimeContext(createCore({ batchId: 'b2' }), [{ id: 1 }], {
    renderer: async () => { throw new Error('QWEN_DOWN'); },
  }));
  assert.equal((await result.aiDone).status, 'failed_open');
});
