/* global require, __dirname, process, Response, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { buildFixture, createMemoryDatabase } = require('./fixture');
const { buildCacheIdentity, prepareRecommendationCopyJob } = require('../../cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2');
const { parseEvents, safeFailure } = require('./runner');
const { runSmoke } = require('./runner');
const { failureFetch, readGarments, successFetch } = require('./transport-fixtures');

test('fixture is scoped to one synthetic user and memory writes are observable', async () => {
  const fixture = buildFixture();
  const database = createMemoryDatabase({ clothes: fixture.clothes, users: fixture.users });
  assert.equal(fixture.openid, 'first-card-smoke-user');
  assert.equal(fixture.clothes.every((item) => item._openid === fixture.openid), true);
  assert.equal(fixture.users.every((user) => user._openid === fixture.openid), true);

  await database.collection('recommendation_canonical_copy_cache_v2').doc('cache-1').set({ data: {
    _openid: fixture.openid,
    cacheId: 'cache-1',
    text: 'synthetic copy',
  } });
  const snapshot = database.snapshot();
  assert.equal(snapshot.clothes.length, 3);
  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.recommendation_canonical_copy_cache_v2.length, 1);
  assert.equal(snapshot.outfits, undefined);
  assert.equal(snapshot.outfit_history, undefined);
});

test('SSE parser reads only framed events and preserves event payloads', () => {
  const result = parseEvents({ chunks: [
    'event: recommendation.ready\ndata: {"batchId":"b1"}\n\n',
    'event: complete\ndata: {"reason":"completed"}\n\n',
  ] });
  assert.deepEqual(result, [
    { event: 'recommendation.ready', data: { batchId: 'b1' } },
    { event: 'complete', data: { reason: 'completed' } },
  ]);
});

test('controlled provider fixtures use production request garments and standard Response streams', async () => {
  const init = { body: JSON.stringify({ messages: [{ role: 'user', content: JSON.stringify([{ id: '1', g: ['短袖T恤', '长裤'] }]) }] }) };
  assert.deepEqual(readGarments(init), ['短袖T恤', '长裤']);
  const success = await successFetch('https://provider.invalid', init);
  assert.equal(success instanceof Response, true);
  assert.equal(success.status, 200);
  assert.match(await success.text(), /短袖T恤/);
  const unauthorized = await failureFetch(401, 'unauthorized')('https://provider.invalid', init);
  assert.equal(unauthorized.status, 401);
  assert.match(await unauthorized.text(), /unauthorized/);
});

test('failure projection is safe and does not expose raw provider data', () => {
  const projected = safeFailure({
    schemaVersion: 'first-card-runtime-observability/v1',
    failureId: 'failure-test',
    auditId: 'audit-test',
    attemptId: 'attempt-test',
    batchId: 'batch-test',
    code: 'PROVIDER_HTTP_ERROR',
    stage: 'request',
    retryability: 'retryable',
    providerIssue: 'yes',
    businessRejected: 'no',
    deadline: { causedFailure: 'no', source: null },
    provider: { name: 'dashscope', model: 'qwen-test', httpStatus: 429, requestId: null, errorCode: 'rate_limit' },
    evidence: { exceptionType: 'Error', networkCode: null, validatorCodes: [] },
    Authorization: 'Bearer secret',
    prompt: 'private prompt',
  });
  assert.equal(projected.code, 'PROVIDER_HTTP_ERROR');
  assert.equal(projected.stage, 'request');
  assert.equal(projected.provider.httpStatus, 429);
  assert.equal(projected.failureId, 'failure-test');
  assert.doesNotMatch(JSON.stringify(projected), /secret|private prompt|Authorization/);
});

test('canonical cache reads are isolated by owner even with the same render fingerprint', async () => {
  const fixture = buildFixture();
  const rendererVersion = 'renderer-v2';
  const renderInputFingerprint = 'same-render-fingerprint';
  const otherOwner = fixture.sentinel._openid;
  const otherCacheId = buildCacheIdentity({ openid: otherOwner, rendererVersion, renderInputFingerprint });
  const database = createMemoryDatabase({
    clothes: fixture.clothes,
    users: fixture.users,
    recommendation_canonical_copy_cache_v2: [{
      _id: otherCacheId,
      _openid: otherOwner,
      cacheId: otherCacheId,
      rendererVersion,
      renderInputFingerprint,
      planId: 'plan-other-owner',
      source: 'ai_cache',
      text: 'other owner copy',
    }],
  }, { owner: fixture.openid });
  const entry = [{
    position: 0,
    outfitKey: 'outfit-current-owner',
    renderInputFingerprint,
    preparedEntry: { plan: { planId: 'plan-current-owner', planHash: 'hash-current-owner' } },
  }];
  const result = await prepareRecommendationCopyJob({
    database,
    openid: fixture.openid,
    batchId: 'batch-owner-isolation',
    rendererVersion,
    entries: entry,
    executionMode: 'interactive',
  });
  assert.deepEqual(result.initialCopies, []);
  assert.equal(result.missEntries.length, 1);
  assert.equal(database.snapshot().recommendation_canonical_copy_cache_v2[0]._openid, otherOwner);
  assert.equal(database.snapshot().recommendation_canonical_copy_cache_v2[0].text, 'other owner copy');
});

test('controlled transport exercises production runtime miss, persistence, then cache hit', async () => {
  const result = await runSmoke({ providerMode: 'controlled', fetch: successFetch });
  assert.equal(result.providerMode, 'controlled');
  assert.equal(result.status, 'PASS');
  assert.equal(result.first.events.includes('recommendation.ready'), true);
  assert.equal(result.second.events.includes('recommendation.ready'), true);
  assert.equal(result.providerCalls, 1, 'the second request must reuse the persisted canonical copy');
  assert.equal(result.assertions.firstMiss, true);
  assert.equal(result.assertions.secondHit, true);
  assert.equal(result.assertions.canonicalPersisted, true);
  assert.equal(result.isolation.protectedDataUnchanged, true);
});

test('controlled provider HTTP failures are correlated and fail closed', async (context) => {
  for (const status of [401, 429]) {
    const result = await runSmoke({ providerMode: 'controlled', fetch: failureFetch(status) });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.first.handlerSettled, true);
    assert.equal(result.second, null);
    assert.equal(result.providerCalls, 1);
    assert.equal(result.first.failure?.provider?.httpStatus, status);
    assert.ok(result.first.failure?.failureId);
    assert.ok(result.first.failure?.attemptId);
    assert.equal(result.isolation.protectedDataUnchanged, true);
    assert.doesNotMatch(JSON.stringify(result), /Bearer|prompt|rawResponse|qa-controlled-credential/);
  }
  context.signal.throwIfAborted();
});

test('missing controlled credentials never claims a provider call', async () => {
  const result = await runSmoke({ providerMode: 'controlled', fetch: successFetch, credentials: 'missing' });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.second, null);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.first.failure?.code, 'CREDENTIALS_UNAVAILABLE');
  assert.equal(result.first.failure?.provider?.httpStatus, null);
  assert.equal(result.isolation.protectedDataUnchanged, true);
});

test('fixture protects business data and clones reads', async () => {
  const fixture = buildFixture();
  const database = createMemoryDatabase({
    clothes: fixture.clothes,
    users: fixture.users,
    outfit_history: [{ _id: 'history-1', _openid: fixture.openid, note: 'keep' }],
  }, { owner: fixture.openid });
  const before = database.snapshot();
  const clothes = await database.collection('clothes').where({ _openid: fixture.openid }).get();
  clothes.data[0].category = 'mutated-copy';
  assert.equal(database.snapshot().clothes[0].category, before.clothes[0].category);
  await assert.rejects(() => database.collection('clothes').doc('smoke-top').update({ data: { category: 'changed' } }), /FIXTURE_WRITE_FORBIDDEN:clothes/);
  await assert.rejects(() => database.collection('users').doc('smoke-user').update({ data: { styleProfile: { changed: true } } }), /FIXTURE_WRITE_FORBIDDEN:users/);
  await assert.rejects(() => database.collection('recommendation_canonical_copy_cache_v2').doc('foreign-cache').set({ data: {
    _openid: fixture.sentinel._openid, cacheId: 'foreign-cache', source: 'ai_cache', text: 'foreign',
  } }), /FIXTURE_OWNER_MISMATCH:recommendation_canonical_copy_cache_v2/);
  assert.deepEqual(database.snapshot().clothes, before.clothes);
  assert.deepEqual(database.snapshot().users, before.users);
  assert.deepEqual(database.snapshot().outfit_history, before.outfit_history);
});

test('CLI refuses an implicit offline or live mode', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'runner.js')], {
    cwd: path.resolve(__dirname, '../../../..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /--live/);
});

test('live mode refuses a controlled transport override', async () => {
  await assert.rejects(
    () => runSmoke({ providerMode: 'live', fetch: successFetch }),
    /QA_LIVE_TRANSPORT_OVERRIDE_FORBIDDEN/,
  );
});

test('delayed provider response still persists the tail before the warm hit', { timeout: 10000 }, async () => {
  const delayedSuccess = async (url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 2400));
    return successFetch(url, init);
  };
  const result = await runSmoke({ providerMode: 'controlled', fetch: delayedSuccess });
  assert.equal(result.status, 'PASS');
  assert.equal(result.first.handlerSettled, true);
  assert.equal(result.assertions.canonicalPersisted, true);
  assert.equal(result.second?.handlerSettled, true);
  assert.equal(result.assertions.secondHit, true);
  assert.equal(result.assertions.secondNoProvider, true);
});
