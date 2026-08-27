'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const { renderFirstCardCanonical } = require('./recommendationFirstCardRenderer');

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
