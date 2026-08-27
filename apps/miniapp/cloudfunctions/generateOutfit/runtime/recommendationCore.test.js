'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runRecommendationCore } = require('./recommendationCore');

test('core exposes the stable result contract without changing outfit order', async () => {
  const outfits = [{ outfitKey: 'a' }, { outfitKey: 'b' }];
  const result = await runRecommendationCore({ scene: 'work' }, { computeRecommendation: async () => ({ identity: { userIdentityHash: 'u' }, executionState: { executionMode: 'full_compute' }, outfits, narrativePlans: [{ planId: 'p' }], evidence: { scene: 'work' }, metadata: { batchId: 'batch-1' } }) });
  assert.deepEqual(result.outfits, outfits);
  assert.deepEqual(result.narrativePlans, [{ planId: 'p' }]);
  assert.equal(result.metadata.batchId, 'batch-1');
  assert.equal(result.executionState.executionMode, 'full_compute');
});

test('core rejects a non-object result', async () => {
  await assert.rejects(runRecommendationCore({}, { computeRecommendation: async () => null }), { message: 'RECOMMENDATION_CORE_RESULT_INVALID' });
});

test('core rejects results missing any formal output field', async () => {
  const valid = {
    identity: {},
    executionState: {},
    outfits: [],
    narrativePlans: [],
    evidence: {},
    metadata: {},
  };
  for (const field of Object.keys(valid)) {
    const incomplete = { ...valid };
    delete incomplete[field];
    await assert.rejects(
      runRecommendationCore({}, { computeRecommendation: async () => incomplete }),
      { message: 'RECOMMENDATION_CORE_RESULT_INVALID' },
    );
  }
});
