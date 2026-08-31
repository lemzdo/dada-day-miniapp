'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const { __test, main } = require('./index');
const { dispatchScfEvent } = require('./services/scfAsyncEventDispatcher');

test('SCF Payload/ClientContext wrappers normalize to the Copy Job worker action', () => {
  const payload = {
    action: 'materializeRecommendationCopyJobV2',
    jobId: 'job-1',
    cacheIds: ['cache-1'],
    auditId: 'audit-1',
  };
  assert.deepEqual(__test.normalizeGenerateOutfitEvent({ Payload: JSON.stringify(payload) }), payload);
  assert.deepEqual(__test.normalizeGenerateOutfitEvent({ ClientContext: JSON.stringify(payload) }), payload);
});

test('dispatcher ClientContext is the worker event received by generateOutfit', async () => {
  let requestBody;
  await dispatchScfEvent({
    event: { action: 'materializeRecommendationCopyJobV2', jobId: 'job-contract', cacheIds: ['cache-1'], auditId: 'audit-1' },
    context: { tencentcloud_region: 'ap-shanghai', environment: JSON.stringify({ TENCENTCLOUD_SECRETID: 'id', TENCENTCLOUD_SECRETKEY: 'key', TENCENTCLOUD_SESSIONTOKEN: 'token' }) },
    fetchImpl: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, status: 200, text: async () => JSON.stringify({ Response: { RequestId: 'request-contract' } }) }; },
  });
  const received = JSON.parse(requestBody.ClientContext);
  assert.deepEqual(__test.normalizeGenerateOutfitEvent(received), received);
  assert.equal(received.action, 'materializeRecommendationCopyJobV2');
  assert.deepEqual({ jobId: received.jobId, cacheIds: received.cacheIds, auditId: received.auditId }, { jobId: 'job-contract', cacheIds: ['cache-1'], auditId: 'audit-1' });
  // Keep the captured event shape while making the worker's first contract
  // guard deterministic in a unit test without a live database.
  const routed = await main({ ...received, jobId: '' });
  assert.equal(routed.code, 1);
  assert.equal(routed.data.errorCode, 'COPY_JOB_ID_REQUIRED');
});

test('unknown or malformed Event actions fail closed before recommendation runtime', async () => {
  for (const event of [{ action: 'not-a-real-action' }, { action: '' }, { action: null }, { action: 42 }, []]) {
    const unknown = await main(event);
    assert.equal(unknown.code, 1);
    assert.equal(unknown.data.errorCode, 'GENERATE_OUTFIT_ACTION_UNKNOWN');
  }
  const malformed = await main({ Payload: '{not-json' });
  assert.equal(malformed.code, 1);
  assert.equal(malformed.data.errorCode, 'GENERATE_OUTFIT_ACTION_UNKNOWN');
  const raw = await main('{not-json');
  assert.equal(raw.code, 1);
  assert.equal(raw.data.errorCode, 'GENERATE_OUTFIT_ACTION_UNKNOWN');
  const malformedWrapper = await main({ ClientContext: '{}' });
  assert.equal(malformedWrapper.code, 1);
  assert.equal(malformedWrapper.data.errorCode, 'GENERATE_OUTFIT_ACTION_UNKNOWN');
  assert.deepEqual(__test.normalizeGenerateOutfitEvent({}), {});
});
