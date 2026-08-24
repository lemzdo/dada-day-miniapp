'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { summarize, runThree } = require('./invoke-streaming-batch');

test('stream benchmark summarizes three runs without changing request semantics', async () => {
  assert.deepEqual(summarize([1200, 900, 1100]), { values: [1200, 900, 1100], median: 1100, range: [900, 1200] });
  let calls = 0;
  const result = await runThree({ call: async (event) => { calls += 1; assert.equal(event.stream, true); assert.equal(event.sequencing, true); return { FIRST_ITEM_VALIDATED_MS: calls * 100, ALL_8_VALIDATED_MS: calls * 200 }; } });
  assert.equal(calls, 3);
  assert.equal(result.firstValidated.median, 200);
  assert.deepEqual(result.fullBatch.range, [200, 600]);
});
