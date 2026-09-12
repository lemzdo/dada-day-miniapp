'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const { renderFirstCardCanonical } = require('./recommendationFirstCardRenderer');
const { buildProductionRequest } = require('./recommendationVoiceRendererProductionV2');

const entry = {
  preparedEntry: {
    plan: { planId: 'plan-1' },
    input: { planId: 'plan-1', expressionMode: 'baseline', garments: ['白衬衫'], primary: null },
  },
};

function response(text) {
  const payload = JSON.stringify({ copies: [{ id: '1', text }] });
  return { status: 200, body: (async function* stream() {
    yield `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }], usage: { total_tokens: 7 } })}\n`;
    yield 'data: [DONE]\n';
  }()) };
}

test('returns validated canonical copy and provider metadata for card0 success', async () => {
  const result = await renderFirstCardCanonical({ entry, rendererConfig: { fetchImpl: async () => response('简单日常，白衬衫穿起来很自然。') } });
  assert.equal(result.status, 'success');
  assert.equal(result.validatedCopy.text, '简单日常，白衬衫穿起来很自然。');
  assert.equal(result.metadata.providerCalls, 1);
  assert.equal(result.usage.total_tokens, 7);
  assert.ok(result.timing.durationMs >= 0);
});

test('classifies provider failure without throwing', async () => {
  const result = await renderFirstCardCanonical({ entry, rendererConfig: { fetchImpl: async () => ({ status: 503, body: [] }) } });
  assert.equal(result.status, 'failure');
  assert.equal(result.failureType, 'PROVIDER_FAIL');
  assert.match(result.failureCode, /VOICE_RENDERER_PROVIDER_HTTP/);
});

test('classifies production validator rejection', async () => {
  const result = await renderFirstCardCanonical({ entry, rendererConfig: { fetchImpl: async () => response('不合规文案') } });
  assert.equal(result.status, 'failure');
  assert.equal(result.failureType, 'VALIDATOR_FAIL');
  assert.equal(result.metadata.invalidCount, 1);
});

test('is side-effect-free and does not invoke caller callbacks', async () => {
  let callbackCalls = 0;
  const config = {
    onValidated: async () => { callbackCalls += 1; },
    onInvalid: async () => { callbackCalls += 1; },
    fetchImpl: async () => response('简单日常，白衬衫穿起来很自然。'),
  };
  const result = await renderFirstCardCanonical({ entry, rendererConfig: config });
  assert.equal(result.status, 'success');
  assert.equal(callbackCalls, 0);
});

test('uses the shared AI core recommendation_reason entry point', async () => {
  const calls = [];
  const auditStages = [];
  let cancelled = 0;
  const result = await renderFirstCardCanonical({
    entry,
    rendererConfig: {
      onAuditStage: (stage, status) => auditStages.push({ stage, status }),
      xiaodaAI: {
        execute: async (...args) => {
          calls.push(args);
          const payload = JSON.stringify({ copies: [{ id: '1', text: '简单日常，白衬衫穿起来很自然。' }] });
          return {
            status: 200,
            body: (async function* stream() { yield `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n`; }()),
            __cancelDeadline: () => { cancelled += 1; },
            usage: { total_tokens: 9 },
          };
        },
      },
    },
  });
  assert.equal(result.status, 'success');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'recommendation_reason');
  assert.deepEqual(calls[0][1], entry.preparedEntry.input);
  assert.equal(calls[0][2].model, 'qwen3.7-max');
  assert.equal(calls[0][2].promptVariant, 'compressed-v2');
  assert.equal(calls[0][2].rawResponse, true);
  assert.deepEqual(calls[0][2].request, buildProductionRequest([entry.preparedEntry]));
  assert.ok(calls[0][2].signal instanceof AbortSignal);
  assert.equal(cancelled, 1);
  assert.deepEqual(auditStages, [
      { stage: 'PROVIDER_START', status: 'started' },
      { stage: 'RESPONSE_HEADERS', status: 'received' },
      { stage: 'PROVIDER_HEADERS', status: 'received' },
      { stage: 'FIRST_COMPLETE_CANDIDATE', status: 'extracted' },
      { stage: 'FIRST_VALIDATED', status: 'accepted' },
      { stage: 'PROVIDER_COMPLETE', status: 'completed' },
      { stage: 'STREAM_COMPLETE', status: 'completed' },
      { stage: 'VALIDATOR_COMPLETE', status: 'accepted' },
      { stage: 'EXECUTION_COMPLETE', status: 'succeeded' },
  ]);
});

test('provider rejection records the exact provider boundary without validator completion', async () => {
  const auditStages = [];
  const result = await renderFirstCardCanonical({
    entry,
    rendererConfig: {
      onAuditStage: (stage, status) => auditStages.push({ stage, status }),
      xiaodaAI: { execute: async () => { throw Object.assign(new Error('provider unavailable'), { code: 'ECONNRESET' }); } },
    },
  });
  assert.equal(result.status, 'failure');
  assert.equal(result.failureType, 'PROVIDER_FAIL');
  assert.deepEqual(auditStages, [
    { stage: 'PROVIDER_START', status: 'started' },
    { stage: 'PROVIDER_COMPLETE', status: 'failed' },
    { stage: 'STREAM_COMPLETE', status: 'failed' },
    { stage: 'EXECUTION_COMPLETE', status: 'failed' },
  ]);
});

function failureOf(result) {
  assert.ok(result?.failure, 'expected failure envelope');
  assert.equal(result.failure.schemaVersion, 'first-card-runtime-observability/v1');
  return result.failure;
}

for (const [label, invoke, expected] of [
  ['network error', async () => { throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }); }, { stage: 'request', code: 'NETWORK_ERROR', retryability: 'retryable', providerIssue: 'unknown', businessRejected: 'no', deadline: 'no' }],
  ['abort with unknown source', async () => { const error = new Error('provider timeout'); error.name = 'AbortError'; throw error; }, { stage: 'request', code: 'REQUEST_ABORTED', retryability: 'unknown', providerIssue: 'unknown', businessRejected: 'no', deadline: 'unknown' }],
]) {
  test(`runtime observability preserves renderer ${label} classification`, async () => {
    const result = await renderFirstCardCanonical({ entry, rendererConfig: { xiaodaAI: { execute: invoke } } });
    const failure = failureOf(result);
    assert.equal(typeof failure.failureId, 'string');
    assert.equal(failure.stage, expected.stage);
    assert.equal(failure.code, expected.code);
    assert.equal(failure.retryability, expected.retryability);
    assert.equal(failure.providerIssue, expected.providerIssue);
    assert.equal(failure.businessRejected, expected.businessRejected);
    assert.equal(failure.deadline.causedFailure, expected.deadline);
  });
}

test('missing AI Core remains fail-open and produces a safe, correlated diagnostic', async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const logged = [];
  try {
    Module._load = function (request, ...args) {
      if (request === '@d1d/ai-core' || request === '../vendor/ai-core') throw new Error('private loader details');
      return Reflect.apply(originalLoad, this, [request, ...args]);
    };
    const result = await renderFirstCardCanonical({ entry, rendererConfig: {
      failureContext: { auditId: 'missing-core-audit', attemptId: 'missing-core-attempt' },
      onAuditStage: (stage, status, extra) => logged.push({ stage, status, ...extra }),
    } });
    assert.equal(result.status, 'failure');
    assert.equal(result.failureType, 'PROVIDER_FAIL');
    assert.equal(result.failure.code, 'AI_CORE_UNAVAILABLE');
    assert.equal(result.failure.stage, 'ai_core');
    assert.equal(result.failure.auditId, 'missing-core-audit');
    assert.equal(result.failure.attemptId, 'missing-core-attempt');
    assert.equal(result.failure.providerIssue, 'no');
    assert.equal(result.failure.provider.httpStatus, null);
    assert.doesNotMatch(JSON.stringify(logged), /private loader details/);
  } finally { Module._load = originalLoad; }
});

test('renderer timeout has timer evidence and asynchronous logging failure stays fail-open', async () => {
  const result = await renderFirstCardCanonical({ entry, rendererConfig: {
    timeoutMs: 5,
    onAuditStage: async () => { throw new Error('logger unavailable'); },
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }),
  } });
  assert.equal(result.status, 'failure');
  assert.equal(result.failure.stage, 'request');
  assert.equal(result.failure.code, 'PROVIDER_TIMEOUT');
  assert.equal(result.failure.retryability, 'retryable');
  assert.equal(result.failure.providerIssue, 'unknown');
  assert.equal(result.failure.businessRejected, 'no');
  assert.deepEqual(result.failure.deadline, { causedFailure: 'yes', source: 'renderer_timeout' });
  await new Promise((resolve) => setImmediate(resolve));
});

test('native Response headers survive the Core stream adapter', async () => {
  const { createXiaodaAI } = require('@d1d/ai-core');
  const ai = createXiaodaAI({ authLookup: 'test-key', fetch: async () => new Response('data: {bad-json}\n', { headers: { 'x-request-id': 'native-response-request' } }) });
  const result = await renderFirstCardCanonical({ entry, rendererConfig: { xiaodaAI: ai } });
  assert.equal(result.failure.code, 'OUTPUT_PARSE_FAILED');
  assert.equal(result.failure.provider.httpStatus, 200);
  assert.equal(result.failure.provider.requestId, 'native-response-request');
});
