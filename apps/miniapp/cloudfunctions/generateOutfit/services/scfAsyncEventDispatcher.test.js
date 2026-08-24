'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { dispatchScfEvent, parseContextEnvironment } = require('./scfAsyncEventDispatcher');

test('SCF async dispatcher sends Event invocation and waits only for accepted request id', async () => {
  let request;
  const result = await dispatchScfEvent({
    event: { action: 'materializeRecommendationCopyJobV2', jobId: 'job-1' },
    context: {
      function_name: 'generateOutfit',
      namespace: 'cloud-env',
      tencentcloud_region: 'ap-shanghai',
      environment: JSON.stringify({
        TENCENTCLOUD_SECRETID: 'secret-id',
        TENCENTCLOUD_SECRETKEY: 'secret-key',
        TENCENTCLOUD_SESSIONTOKEN: 'session-token',
      }),
    },
    now: new Date('2026-08-24T12:00:00.000Z'),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ Response: { RequestId: 'request-1' } }) };
    },
  });
  assert.deepEqual(result, { accepted: true, requestId: 'request-1' });
  assert.equal(request.url, 'https://scf.tencentcloudapi.com');
  assert.equal(JSON.parse(request.options.body).InvocationType, 'Event');
  assert.equal(JSON.parse(JSON.parse(request.options.body).ClientContext).jobId, 'job-1');
  assert.match(request.options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=secret-id\//);
  assert.equal(request.options.headers['X-TC-Token'], 'session-token');
});

test('SCF async dispatcher fails closed before dispatch without runtime credentials', async () => {
  await assert.rejects(
    dispatchScfEvent({ event: {}, context: { function_name: 'generateOutfit', tencentcloud_region: 'ap-shanghai' } }),
    /SCF_ASYNC_CREDENTIALS_MISSING/,
  );
});

test('context environ parser keeps values after the first separator', () => {
  assert.deepEqual(parseContextEnvironment({ environ: 'A=1;TOKEN=a=b=c' }), { A: '1', TOKEN: 'a=b=c' });
});
