'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildGoldPlans } = require('./gold-plans');
const { FAILURE_CASE_IDS, invokeCompressedV2Batch } = require('./invoke-compressed-v2-batch');

test('compressed-v2 failure batch sends Weak, Sparse, and Baseline in one Max request', async () => {
  let captured;
  await invokeCompressedV2Batch({ call: async (event) => { captured = event; return { status: 'completed' }; } });
  assert.equal(captured.batch, true);
  assert.equal(captured.model, 'max');
  assert.equal(captured.promptVariant, 'compressed-v2');
  assert.deepEqual(captured.cases.map((entry) => entry.caseId), FAILURE_CASE_IDS);
  assert.equal(captured.cases.every((entry) => entry.input.primary === null), true);
});

test('compressed-v2 full batch sends the original eight Gold cases in one request', async () => {
  let captured;
  const caseIds = buildGoldPlans().map((plan) => plan.caseId);
  await invokeCompressedV2Batch({ caseIds, call: async (event) => { captured = event; return { status: 'completed' }; } });
  assert.deepEqual(captured.cases.map((entry) => entry.caseId), caseIds);
  assert.equal(captured.cases.length, 8);
});
