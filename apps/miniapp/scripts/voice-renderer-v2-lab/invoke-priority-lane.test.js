'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { invokePriorityLane, runThree, summarize } = require('./invoke-priority-lane');

test('priority lane starts Plan #1 stream and stable rest batch in the same tick', async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const resultPromise = invokePriorityLane({ call: async (event) => {
    started.push({ event, at: started.length });
    if (started.length === 2) release();
    await gate;
    return event.stream
      ? { status: 'completed', FIRST_ITEM_VALIDATED_MS: 321, parserPass: true, contractPass: true, validatorPass: true, factualFailures: 0, personaFailures: 0, metaLanguageFailures: 0 }
      : { status: 'completed', e2eLatencyMs: 654, parserPass: true, contractPass: true, validatorPass: true, factualFailures: 0, personaFailures: 0, metaLanguageFailures: 0 };
  } });
  const result = await resultPromise;
  assert.equal(started.length, 2);
  assert.equal(started[0].at, 0);
  assert.equal(started[1].at, 1);
  assert.equal(started[0].event.stream, true);
  assert.equal(started[0].event.caseId, 'primary-pattern-focus');
  assert.equal(started[1].event.batch, true);
  assert.equal(started[1].event.stream, undefined);
  assert.equal(started[1].event.cases.length, 7);
  assert.equal(result.providerCalls, 2);
  assert.equal(result.priorityFirstValidatedMs, 321);
  assert.equal(result.rest7CompleteMs, 654);
});

test('priority lane summarizes three injected runs', async () => {
  let callCount = 0;
  const result = await runThree({ call: async (event) => {
    callCount += 1;
    return event.stream
      ? { FIRST_ITEM_VALIDATED_MS: 100 + Math.ceil(callCount / 2), parserPass: true, contractPass: true, validatorPass: true, factualFailures: 0, personaFailures: 0, metaLanguageFailures: 0 }
      : { e2eLatencyMs: 200 + Math.ceil(callCount / 2), parserPass: true, contractPass: true, validatorPass: true, factualFailures: 0, personaFailures: 0, metaLanguageFailures: 0 };
  } });
  assert.equal(callCount, 6);
  assert.deepEqual(result.firstValidated, { values: [101, 102, 103], median: 102, range: [101, 103] });
  assert.deepEqual(result.rest7, { values: [201, 202, 203], median: 202, range: [201, 203] });
  assert.deepEqual(summarize([3, 1, 2]), { values: [3, 1, 2], median: 2, range: [1, 3] });
});
