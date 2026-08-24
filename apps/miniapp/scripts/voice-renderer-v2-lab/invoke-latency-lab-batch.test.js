'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invokeBatch } = require('./invoke-latency-lab-batch');

test('batch runner sends all eight Gold cases in one Max compressed lab invocation', async () => {
  let captured;
  const result = await invokeBatch({
    call: async (event) => {
      captured = event;
      return { status: 'completed', outputCount: event.cases.length };
    },
  });
  assert.equal(captured.batch, true);
  assert.equal(captured.model, 'max');
  assert.equal(captured.promptVariant, 'compressed');
  assert.equal(captured.cases.length, 8);
  assert.equal(new Set(captured.cases.map((entry) => entry.caseId)).size, 8);
  assert.equal(result.outputCount, 8);
});
