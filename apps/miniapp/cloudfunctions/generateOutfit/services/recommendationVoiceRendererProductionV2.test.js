const assert = require('assert/strict');
const test = require('node:test');
const {
  PROMPT_VARIANT,
  PRODUCTION_MODEL_ROUTE_VERSION,
  PRODUCTION_PROMPT_VERSION,
  buildProductionRequest,
  renderRecommendationVoiceRendererProductionV2,
} = require('./recommendationVoiceRendererProductionV2');
const { VOICE_RENDERER_MODEL_ROUTE_VERSION } = require('./voiceRendererV2Contract');

function entries(count) {
  return Array.from({ length: count }, (_, index) => ({
    plan: { planId: `plan-${index + 1}` },
    input: { planId: `plan-${index + 1}`, expressionMode: 'baseline', garments: [`衣物${index + 1}`], primary: null },
  }));
}
function responseFor(items, split = false) {
  const json = JSON.stringify({ copies: items.map((item, index) => ({ id: String(index + 1), text: `这套简单日常，${item.input.garments[0]}搭配很自然。` })) });
  const pieces = split ? [json.slice(0, Math.floor(json.length / 2)), json.slice(Math.floor(json.length / 2))] : [json];
  return { status: 200, body: (async function* stream() { for (const piece of pieces) yield `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n`; yield 'data: [DONE]\n'; })() };
}
function provider(items, calls, options = {}) {
  return async (_url, request) => { calls.push(JSON.parse(request.body)); return options.response || responseFor(items, options.split); };
}

test('8-plan uses one qwen compressed-v2 streaming request', async () => {
  const input = entries(8); const calls = []; const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: input, fetchImpl: provider(input, calls) });
  assert.equal(result.status, 'completed'); assert.equal(result.validatedCount, 8); assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'qwen-flash'); assert.equal(calls[0].stream, true); assert.equal(calls[0].enable_thinking, false); assert.deepEqual(calls[0].stream_options, { include_usage: true });
  assert.match(calls[0].messages[0].content, /逐项独立按 id 对应/); assert.equal(PROMPT_VARIANT, 'compressed-v2');
});

test('fixed model race can override only the model while retaining the production prompt and validator', async () => {
  const input = entries(1); const calls = [];
  const result = await renderRecommendationVoiceRendererProductionV2({
    preparedEntries: input,
    model: 'qwen3.7-max',
    modelRouteVersion: 'voice-renderer-model-route-v2-flash-race',
    fetchImpl: provider(input, calls),
  });
  assert.equal(result.status, 'completed');
  assert.equal(calls[0].model, 'qwen3.7-max');
  assert.match(calls[0].messages[0].content, /只返回 JSON 对象/);
  assert.equal(result.validatedCount, 1);
});

for (const count of [1, 3, 7]) test(`partial ${count}-plan input remains one call`, async () => {
  const input = entries(count); const calls = []; const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: input, fetchImpl: provider(input, calls) });
  assert.equal(result.validatedCount, count); assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0].messages[1].content).length, count);
});

test('zero entries is a no-op', async () => {
  let calls = 0; const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: [], fetchImpl: async () => { calls += 1; } });
  assert.equal(result.providerCalls, 0); assert.equal(calls, 0);
});

test('item 1 is delivered before stream completion', async () => {
  const input = entries(2); let sawBeforeEnd = false;
  const auditStages = [];
  const body = (async function* stream() {
    const firstJson = '{"copies":[{"id":"1","text":"这套简单日常，衣物1搭配很自然。"}';
    yield `data: ${JSON.stringify({ choices: [{ delta: { content: firstJson } }] })}\n`;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closing = JSON.stringify({ choices: [{ delta: { content: String.fromCharCode(125, 93, 125) } }] });
    yield `data: ${closing}\n`;
  }());
  const seen = []; const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: input, fetchImpl: async () => ({ status: 200, body }), onAuditStage: (stage) => auditStages.push(stage), onValidated: async (copy) => { seen.push(copy.id); sawBeforeEnd = true; } });
  assert.deepEqual(seen, ['1']); assert.equal(sawBeforeEnd, true); assert.equal(result.status, 'failed_open'); assert.equal(result.failureCode, 'VOICE_RENDERER_STREAM_INCOMPLETE');
  assert.ok(auditStages.indexOf('FIRST_COMPLETE_CANDIDATE') < auditStages.indexOf('FIRST_VALIDATED'));
  assert.ok(auditStages.indexOf('FIRST_VALIDATED') < auditStages.indexOf('PROVIDER_COMPLETE'));
});

test('AI Core Uint8Array stream decodes complete provider output and terminal metadata', async () => {
  const input = entries(1);
  const payload = JSON.stringify({ copies: [{ id: '1', text: '这套简单日常，衣物1搭配很自然。' }] });
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload }, finish_reason: null }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 7 } })}\n`,
    'data: [DONE]\n',
  ];
  const encoded = new TextEncoder().encode(frames.join(''));
  const multibyteStart = encoded.findIndex((byte) => byte > 0x7f);
  const chunks = [
    encoded.slice(0, multibyteStart + 1),
    encoded.slice(multibyteStart + 1, encoded.length - 5),
    encoded.slice(encoded.length - 5),
  ];
  const body = (async function* stream() {
    for (const chunk of chunks) yield chunk;
  }());
  const result = await renderRecommendationVoiceRendererProductionV2({
    preparedEntries: input,
    fetchImpl: async () => ({ status: 200, body }),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.providerCalls, 1);
  assert.equal(result.validatedCount, 1);
  assert.equal(result.usage.total_tokens, 7);
  assert.equal(result.stream.chunkCount, 3);
  assert.ok(result.stream.firstChunkBytes > 0);
  assert.ok(result.stream.lastChunkBytes > 0);
  assert.equal(result.stream.rawLength, encoded.byteLength);
  assert.equal(result.stream.finishReason, 'stop');
  assert.equal(result.stream.doneReceived, true);
  assert.equal(result.stream.parseErrorCount, 0);
  assert.equal(result.stream.errorEventCount, 0);
});

test('provider SSE error event is surfaced with stream diagnostics', async () => {
  const input = entries(1);
  const body = (async function* stream() {
    yield new TextEncoder().encode(`data: ${JSON.stringify({ error: { code: 'provider_stream_error' } })}\n`);
  }());
  const result = await renderRecommendationVoiceRendererProductionV2({
    preparedEntries: input,
    fetchImpl: async () => ({ status: 200, body }),
  });
  assert.equal(result.status, 'failed_open');
  assert.equal(result.failureCode, 'VOICE_RENDERER_PROVIDER_STREAM_ERROR:provider_stream_error');
  assert.equal(result.stream.errorEventCount, 1);
  assert.equal(result.failure.code, 'PROVIDER_STREAM_ERROR');
  assert.equal(result.failure.stage, 'stream_read');
  assert.equal(result.failure.retryability, 'unknown');
  assert.equal(result.failure.providerIssue, 'unknown');
  assert.equal(result.failure.businessRejected, 'no');
  assert.equal(result.failure.deadline.causedFailure, 'no');
  assert.equal(result.failure.provider.errorCode, 'provider_stream_error');
});

test('final SSE frame without newline is flushed through parser and validator', async () => {
  const input = entries(1);
  const payload = JSON.stringify({ copies: [{ id: '1', text: '这套简单日常，衣物1搭配很自然。' }] });
  const body = (async function* stream() {
    yield new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: payload }, finish_reason: 'stop' }] })}`);
  }());
  const result = await renderRecommendationVoiceRendererProductionV2({
    preparedEntries: input,
    fetchImpl: async () => ({ status: 200, body }),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.validatedCount, 1);
  assert.equal(result.stream.finishReason, 'stop');
});

test('invalid item is skipped while later items continue', async () => {
  const input = entries(3); const calls = []; const bad = { copies: [{ id: '1', text: '不合规文案' }, { id: '2', text: '这套简单日常，衣物2搭配很自然。' }, { id: '3', text: '这套简单日常，衣物3搭配很自然。' }] };
  const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: input, fetchImpl: provider(input, calls, { response: { status: 200, body: (async function* stream() { yield `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(bad) } }] })}\n`; }()) } }) });
  assert.equal(result.invalidCount, 1); assert.equal(result.validatedCount, 2);
});

test('an item with extra contract fields is invalid and is not emitted', async () => {
  const input = entries(1); const emitted = [];
  const body = (async function* stream() {
    const payload = { copies: [{ id: '1', text: '这套简单日常，衣物1搭配很自然。', extra: true }] };
    yield `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(payload) } }] })}\n`;
  }());
  const result = await renderRecommendationVoiceRendererProductionV2({
    preparedEntries: input,
    fetchImpl: async () => ({ status: 200, body }),
    onValidated: async (copy) => emitted.push(copy),
  });
  assert.equal(result.validatedCount, 0);
  assert.equal(result.invalidCount, 1);
  assert.deepEqual(emitted, []);
});

test('cache-hit filtering accepts misses and isolates compressed-v2 request', async () => {
  const input = entries(3); const calls = []; const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: input, misses: input.slice(1), fetchImpl: provider(input.slice(1), calls) });
  assert.equal(result.planCount, 2); assert.equal(JSON.parse(calls[0].messages[1].content).length, 2); assert.equal(calls[0].response_format.type, 'json_object');
  assert.doesNotMatch(calls[0].messages[0].content, /只返回 JSON 数组/);
});

test('request builder keeps contract version and exact generation route', () => {
  const request = buildProductionRequest(entries(1)); assert.equal(request.model, 'qwen-flash'); assert.equal(request.top_p, 0.8); assert.equal(request.max_tokens, 1200); assert.equal(request.stream_options.include_usage, true);
  assert.equal(PRODUCTION_PROMPT_VERSION, 'voice-contract-v2.0-compressed-v2-production-4');
  assert.notEqual(PRODUCTION_MODEL_ROUTE_VERSION, VOICE_RENDERER_MODEL_ROUTE_VERSION);
});

function failureOf(result) {
  assert.ok(result?.failure, 'expected failure envelope');
  assert.equal(result.failure.schemaVersion, 'first-card-runtime-observability/v1');
  return result.failure;
}

test('parse failure is distinct from business validation rejection', async () => {
  const malformed = {
    status: 200,
    body: (async function* stream() { yield 'data: {not-json}\n'; yield 'data: [DONE]\n'; }()),
  };
  const parsed = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: entries(1), fetchImpl: async () => malformed });
  const parseFailure = failureOf(parsed);
  assert.equal(parseFailure.stage, 'output_parse');
  assert.equal(parseFailure.code, 'OUTPUT_PARSE_FAILED');
  assert.equal(parseFailure.businessRejected, 'no');
  assert.equal(parseFailure.providerIssue, 'unknown');
  assert.equal(parseFailure.retryability, 'unknown');
  assert.equal(parseFailure.deadline.causedFailure, 'no');

  const rejected = await renderRecommendationVoiceRendererProductionV2({
    preparedEntries: entries(1),
    fetchImpl: async () => ({ status: 200, body: (async function* stream() {
      yield `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ copies: [{ id: '1', text: '不合规文案' }] }) } }] })}\n`;
      yield 'data: [DONE]\n';
    }()) }),
  });
  const validationFailure = failureOf(rejected);
  assert.equal(validationFailure.stage, 'validation');
  assert.equal(validationFailure.code, 'VALIDATION_REJECTED');
  assert.equal(validationFailure.retryability, 'unknown');
  assert.equal(validationFailure.providerIssue, 'no');
  assert.equal(validationFailure.businessRejected, 'yes');
  assert.equal(validationFailure.deadline.causedFailure, 'no');
  assert.ok(validationFailure.evidence.validatorCodes.length > 0);
});

test('tolerated malformed SSE does not change a subsequently successful business result', async () => {
  const input = entries(1);
  const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: input, fetchImpl: async () => ({
    status: 200, body: (async function* () {
      yield 'data: {bad-json}\n';
      for await (const chunk of responseFor(input).body) yield chunk;
    })(),
  }) });
  assert.equal(result.status, 'completed');
  assert.equal(result.validatedCount, 1);
  assert.equal(result.stream.parseErrorCount, 1);
  assert.equal(result.failure, undefined);
});
