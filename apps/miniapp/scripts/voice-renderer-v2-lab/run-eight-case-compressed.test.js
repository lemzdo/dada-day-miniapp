'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runEightCaseCompressed } = require('./run-eight-case-compressed');

test('eight-case runner invokes every existing Gold case sequentially as Max compressed', async () => {
  const seen = [];
  let tick = 1000;
  const result = await runEightCaseCompressed({
    deps: { mini: {} },
    now: () => { tick += 100; return tick; },
    invoke: async (request) => {
      seen.push(request);
      return { status: 'completed', caseId: request.caseId, providerLatencyMs: 10, retryCount: 0 };
    },
  });
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen.map((request) => request.caseId)).size, 8);
  assert.equal(seen.every((request) => request.model === 'max' && request.promptVariant === 'compressed'), true);
  assert.equal(result.sumProviderLatencyMs, 80);
  assert.equal(result.retries, 0);
  assert.equal(result.totalWallClockMs, 100);
});
