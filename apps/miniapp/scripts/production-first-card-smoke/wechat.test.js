'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestInput, requestFirstCard } = require('./wechat');

test('requestInput fixes home/disabled smoke contract and excludes identity or force fields', () => {
  const input = requestInput('2026-09-02', 'smoke-batch');
  assert.equal(input.scene, '居家');
  assert.equal(input.weatherMode, 'disabled');
  assert.equal(input.date, '2026-09-02');
  assert.equal(input.v2BatchId, 'smoke-batch');
  assert.equal(input.requestKind, 'initial');
  for (const key of ['openid', '_openid', 'forceMiss', 'force miss', 'identityHash', 'userIdentity']) assert.equal(Object.hasOwn(input, key), false, key);
});

function sse(data, event) { return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; }
function mockMini(chunks, openid = 'smoke-user') {
  return {
    evaluate: async (fn, args) => {
      const previous = global.wx;
      global.wx = { getStorageSync: () => openid, cloud: { callHTTPFunction: (options) => {
        for (const chunk of chunks) options.onChunkedReceived({ data: chunk });
        options.onHeadersReceived?.({ statusCode: 200 });
        options.success?.({ statusCode: 200 });
        return { abort() {} };
      } } };
      try { return await fn(args); } finally { global.wx = previous; }
    },
  };
}
const ready = { identity: { userIdentityVerified: true }, batchId: 'smoke-batch', response: { light: { cards: [{ outfitKey: 'look-1' }] } } };
const complete = { batchId: 'smoke-batch', reason: 'completed' };

test('requestFirstCard parses split SSE bytes and requires ready plus complete', async () => {
  const body = sse(ready, 'recommendation.ready') + sse(complete, 'complete');
  const bytes = new TextEncoder().encode(body);
  const result = await requestFirstCard(mockMini([bytes.slice(0, 17), bytes.slice(17)]), { openid: 'smoke-user', envId: 'env' }, { v2BatchId: 'smoke-batch' });
  assert.equal(result.batchId, 'smoke-batch');
  assert.deepEqual(result.events, ['recommendation.ready', 'complete']);
});

test('requestFirstCard rejects missing complete or batch mismatch', async () => {
  const missing = sse(ready, 'recommendation.ready');
  await assert.rejects(() => requestFirstCard(mockMini([missing]), { openid: 'smoke-user', envId: 'env' }, { v2BatchId: 'smoke-batch' }), /WECHAT_SMOKE_SSE_INCOMPLETE/);
  const wrong = sse({ ...complete, batchId: 'other' }, 'complete');
  await assert.rejects(() => requestFirstCard(mockMini([sse(ready, 'recommendation.ready') + wrong]), { openid: 'smoke-user', envId: 'env' }, { v2BatchId: 'smoke-batch' }), /WECHAT_SMOKE_BATCH_MISMATCH/);
});
