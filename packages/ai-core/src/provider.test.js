'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createXiaodaAI, normalizeProviderError } = require('./index');

function failureOf(error) {
  assert.ok(error?.failure, 'expected failure envelope');
  assert.equal(error.failure.schemaVersion, 'first-card-runtime-observability/v1');
  return error.failure;
}

function assertContract(error, expected) {
  const failure = failureOf(error);
  assert.equal(typeof failure.failureId, 'string');
  assert.equal(failure.stage, expected.stage);
  assert.equal(failure.code, expected.code);
  assert.equal(failure.retryability, expected.retryability);
  assert.equal(failure.providerIssue, expected.providerIssue);
  assert.equal(failure.businessRejected, expected.businessRejected);
  assert.equal(failure.deadline.causedFailure, expected.deadline);
}

function httpResponse(status, body = {}) {
  return {
    ok: false,
    status,
    headers: { get: (name) => name === 'x-request-id' ? `req-${status}` : null },
    text: async () => JSON.stringify(body),
  };
}

function aiWith(fetchImpl) {
  return createXiaodaAI({ authLookup: 'test-secret', fetch: fetchImpl });
}

for (const [status, expected] of [
  [401, { stage: 'http_response', code: 'PROVIDER_HTTP_ERROR', retryability: 'not_retryable', providerIssue: 'no', businessRejected: 'no', deadline: 'no' }],
  [429, { stage: 'http_response', code: 'PROVIDER_HTTP_ERROR', retryability: 'retryable', providerIssue: 'yes', businessRejected: 'no', deadline: 'no' }],
  [503, { stage: 'http_response', code: 'PROVIDER_HTTP_ERROR', retryability: 'retryable', providerIssue: 'yes', businessRejected: 'no', deadline: 'no' }],
]) {
  test(`runtime observability preserves HTTP ${status} evidence`, async () => {
    const body = status === 429 ? { error: { code: 'Throttling.RateQuota' } } : { error: { code: `E${status}` } };
    const ai = aiWith(async () => httpResponse(status, body));
    await assert.rejects(
      ai.execute('recommendation_reason', { text: 'x' }, { rawResponse: true }),
      (error) => {
        const failure = failureOf(error);
        assertContract(error, expected);
        assert.equal(failure.provider.httpStatus, status);
        assert.equal(failure.provider.requestId, `req-${status}`);
        assert.equal(failure.provider.errorCode, status === 429 ? 'Throttling.RateQuota' : `E${status}`);
        return true;
      },
    );
  });
}

test('HTTP 429 without a temporary-limit code remains unknown', async () => {
  const ai = aiWith(async () => httpResponse(429, { error: { code: 'E429' } }));
  await assert.rejects(ai.execute('recommendation_reason', { text: 'x' }, { rawResponse: true }), (error) => {
    const failure = failureOf(error);
    assert.equal(failure.code, 'PROVIDER_HTTP_ERROR');
    assert.equal(failure.retryability, 'unknown');
    assert.equal(failure.providerIssue, 'unknown');
    assert.equal(failure.provider.errorCode, 'E429');
    return true;
  });
});

test('network error retains unknown provider attribution', async () => {
  const ai = aiWith(async () => { throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }); });
  await assert.rejects(ai.execute('recommendation_reason', { text: 'x' }, { rawResponse: true }), (error) => {
    assertContract(error, { stage: 'request', code: 'NETWORK_ERROR', retryability: 'retryable', providerIssue: 'unknown', businessRejected: 'no', deadline: 'no' });
    return true;
  });
});

test('source-unknown AbortError is REQUEST_ABORTED without deadline attribution', async () => {
  const ai = aiWith(async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; });
  await assert.rejects(ai.execute('recommendation_reason', { text: 'x' }, { rawResponse: true }), (error) => {
    assertContract(error, { stage: 'request', code: 'REQUEST_ABORTED', retryability: 'unknown', providerIssue: 'unknown', businessRejected: 'no', deadline: 'unknown' });
    return true;
  });
});

test('Core deadline abort is attributed to provider timeout', async () => {
  const ai = aiWith((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('deadline exceeded'), { name: 'AbortError' })), { once: true });
  }));
  await assert.rejects(ai.execute('recommendation_reason', { text: 'x' }, { rawResponse: true, timeoutMs: 1.5 }), (error) => {
    const failure = failureOf(error);
    assert.equal(failure.code, 'PROVIDER_TIMEOUT');
    assert.equal(failure.deadline.causedFailure, 'yes');
    assert.equal(failure.deadline.source, 'provider_timeout');
    return true;
  });
});

test('second normalization preserves the original envelope and safe evidence', () => {
  const error = new Error('secret bearer token should not leak');
  const first = normalizeProviderError(error, { status: 503, headers: { get: () => 'req-original' } }, JSON.stringify({ error: { code: 'UPSTREAM_BUSY' } }), { model: 'model-x' });
  const second = normalizeProviderError(first, { status: 503 }, JSON.stringify({ error: { code: 'OTHER' } }), { model: 'model-y' });
  assert.equal(second, first);
  assert.equal(second.failure.provider.httpStatus, 503);
  assert.equal(second.failure.provider.requestId, 'req-original');
  assert.equal(second.failure.provider.errorCode, 'UPSTREAM_BUSY');
  assert.equal(second.failure.provider.model, 'model-x');
  assert.equal(Object.prototype.hasOwnProperty.call(second.failure, 'message'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(second.failure, 'stack'), false);
});

test('transport details remain unchanged and HTTP body is consumed once', async () => {
  const request = { model: 'qwen3.7-max', messages: [{ role: 'user', content: 'unchanged' }], stream: true, temperature: 0.3 };
  let calls = 0;
  let reads = 0;
  const ai = aiWith(async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://example.invalid/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' });
    assert.equal(init.body, JSON.stringify(request));
    assert.ok(init.signal instanceof AbortSignal);
    return { ok: false, status: 401, headers: new Headers({ 'x-request-id': 'header-request' }), text: async () => {
      reads += 1;
      return JSON.stringify({ request_id: 'body-request', error: { code: 'InvalidApiKey', message: 'private provider details' } });
    } };
  });
  await assert.rejects(ai.execute('recommendation_reason', {}, { endpoint: 'https://example.invalid/v1', rawResponse: true, request }), (error) => {
    assert.equal(error.code, 'PROVIDER_HTTP_401');
    assert.equal(error.status, 401);
    assert.equal(error.failure.provider.requestId, 'body-request');
    assert.doesNotMatch(JSON.stringify(error.failure), /private provider details|test-secret|unchanged/);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(reads, 1);
});

test('unknown failures stay unknown and a nested network cause survives legacy normalization', async () => {
  const unknown = normalizeProviderError(new Error('private timeout-looking text'));
  assert.equal(unknown.code, 'PROVIDER_TIMEOUT', 'legacy message mapping is unchanged');
  assert.equal(unknown.failure.code, 'UNKNOWN_FAILURE');
  assert.equal(unknown.failure.deadline.causedFailure, 'unknown');
  const network = normalizeProviderError(new TypeError('fetch failed', { cause: Object.assign(new Error('socket'), { code: 'ECONNRESET' }) }));
  assert.equal(network.code, 'PROVIDER_ERROR', 'preserve the legacy public code');
  assert.equal(network.failure.code, 'NETWORK_ERROR');
  assert.equal(network.failure.evidence.networkCode, 'ECONNRESET');
});

test('parse and stream exceptions keep their original identity and response evidence', async () => {
  const { executeDashScope, streamDashScope } = require('./provider');
  const cases = [
    { run: executeDashScope, error: new SyntaxError('private bad JSON'), stage: 'output_parse', code: 'OUTPUT_PARSE_FAILED' },
    { run: streamDashScope, error: Object.assign(new Error('private socket message'), { code: 'ECONNRESET' }), stage: 'stream_read', code: 'NETWORK_ERROR' },
  ];
  for (const item of cases) {
    const originalCode = item.error.code;
    const response = { ok: true, status: 200, headers: new Headers({ 'x-request-id': 'stream-request' }), json: async () => { throw item.error; }, body: { getReader: () => ({ read: async () => { throw item.error; } }) } };
    await assert.rejects(item.run({ model: 'test-model' }, { apiKey: 'test-key', fetch: async () => response }), (error) => {
      assert.equal(error, item.error);
      assert.equal(error.code, originalCode);
      assert.equal(error.failure.stage, item.stage);
      assert.equal(error.failure.code, item.code);
      assert.equal(error.failure.provider.httpStatus, 200);
      assert.equal(error.failure.provider.requestId, 'stream-request');
      assert.equal(error.failure.businessRejected, 'no');
      assert.equal(error.failure.deadline.causedFailure, 'no');
      return true;
    });
  }
});

test('failure helpers preserve frozen errors, identities and whitelist external evidence', () => {
  const { createFailureEnvelope, attachFailure, getFailure, sanitizeFailure } = require('./index');
  const error = Object.freeze(new Error('do not log this'));
  const first = createFailureEnvelope(error, { auditId: 'audit-1', attemptId: 'attempt-1' }, { stage: 'request', code: 'UNKNOWN_FAILURE' });
  assert.equal(attachFailure(error), error);
  assert.equal(getFailure(error).failureId, first.failureId);
  assert.equal(createFailureEnvelope(error).failureId, first.failureId);
  const clean = sanitizeFailure({ ...first, message: 'SECRET', prompt: 'SECRET', provider: { requestId: 'r'.repeat(300), errorCode: 'bad\nSECRET', httpStatus: 503 }, evidence: { exceptionType: 'SECRET', networkCode: 'SECRET', validatorCodes: ['VALIDATOR_FAIL', 'bad\nSECRET'] } });
  assert.equal(clean.failureId, first.failureId);
  assert.equal(clean.provider.requestId.length, 128);
  assert.equal(clean.provider.errorCode, null);
  assert.equal(clean.evidence.exceptionType, null);
  assert.equal(clean.evidence.networkCode, null);
  assert.deepEqual(clean.evidence.validatorCodes, ['VALIDATOR_FAIL']);
  assert.doesNotMatch(JSON.stringify(clean), /SECRET|prompt|message/);
  const thrown = Object.freeze({ code: 'opaque' });
  assert.equal(attachFailure(thrown), thrown);
  assert.ok(getFailure(thrown));
});

test('already structured provider exceptions keep status, request ID and original code', () => {
  const original = Object.assign(new Error('auth failed'), { status: 401, requestId: 'request-from-error', code: 'InvalidApiKey' });
  const error = normalizeProviderError(original);
  assert.equal(error, original);
  assert.equal(error.code, 'PROVIDER_HTTP_401');
  assert.equal(error.failure.provider.httpStatus, 401);
  assert.equal(error.failure.provider.requestId, 'request-from-error');
  assert.equal(error.failure.provider.errorCode, 'InvalidApiKey');
});
