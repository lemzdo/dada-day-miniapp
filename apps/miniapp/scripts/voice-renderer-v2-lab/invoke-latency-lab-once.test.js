'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invokeOnce } = require('./invoke-latency-lab-once');

test('one-shot runner performs exactly one isolated cloud invocation', async () => {
  let calls = 0;
  const registry = {};
  const mini = {
    async evaluate(fn, payload) {
      if (typeof payload === 'object') {
        calls += 1;
        registry[payload.requestId] = { status: 'resolved', result: { status: 'completed', caseId: payload.event.caseId } };
        return undefined;
      }
      if (registry[payload]) return registry[payload];
      delete registry[payload];
      return undefined;
    },
  };
  const result = await invokeOnce({ model: 'flash', promptVariant: 'current', caseId: 'primary-pattern-focus', deps: { mini } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'completed');
});
