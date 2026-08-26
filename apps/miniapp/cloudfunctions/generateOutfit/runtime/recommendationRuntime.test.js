'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runRecommendationRuntime } = require('./recommendationRuntime');

test('ready is emitted without awaiting incremental AI copies', async () => {
  const events = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const runtime = await runRecommendationRuntime({ maxResults: 3 }, {
    userIdentity: { openid: 'u1' },
    recommendationCore: async () => ({ batchId: 'b1', narrativePlans: [{ id: 1 }], rendererEntries: [{ id: 1 }], response: { cards: [1] } }),
    renderer: async ({ onCopy }) => { await blocked; await onCopy({ id: 1, text: 'safe' }); return { status: 'completed' }; },
  }, {
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
  const result = await runRecommendationRuntime({ maxResults: 0 }, {
    recommendationCore: async () => ({ batchId: 'empty', response: { cards: [], countContract: { exhausted: true } } }),
    renderer: async () => { invoked = true; },
  });
  await result.aiDone;
  assert.equal(invoked, false);
});

test('renderer and validator failures are fail-open', async () => {
  const result = await runRecommendationRuntime({}, {
    recommendationCore: async () => ({ batchId: 'b2', rendererEntries: [{ id: 1 }], response: {} }),
    renderer: async () => { throw new Error('QWEN_DOWN'); },
  });
  assert.equal((await result.aiDone).status, 'failed_open');
});
