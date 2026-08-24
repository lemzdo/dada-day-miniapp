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
  assert.equal(calls[0].model, 'qwen3.7-max'); assert.equal(calls[0].stream, true); assert.equal(calls[0].enable_thinking, false); assert.deepEqual(calls[0].stream_options, { include_usage: true });
  assert.match(calls[0].messages[0].content, /逐项独立按 id 对应/); assert.equal(PROMPT_VARIANT, 'compressed-v2');
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
  const body = (async function* stream() {
    const firstJson = '{"copies":[{"id":"1","text":"这套简单日常，衣物1搭配很自然。"}';
    yield `data: ${JSON.stringify({ choices: [{ delta: { content: firstJson } }] })}\n`;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closing = JSON.stringify({ choices: [{ delta: { content: String.fromCharCode(125, 93, 125) } }] });
    yield `data: ${closing}\n`;
  }());
  const seen = []; const result = await renderRecommendationVoiceRendererProductionV2({ preparedEntries: input, fetchImpl: async () => ({ status: 200, body }), onValidated: async (copy) => { seen.push(copy.id); sawBeforeEnd = true; } });
  assert.deepEqual(seen, ['1']); assert.equal(sawBeforeEnd, true); assert.equal(result.status, 'failed_open'); assert.equal(result.failureCode, 'VOICE_RENDERER_STREAM_INCOMPLETE');
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
  const request = buildProductionRequest(entries(1)); assert.equal(request.model, 'qwen3.7-max'); assert.equal(request.top_p, 0.8); assert.equal(request.max_tokens, 1200); assert.equal(request.stream_options.include_usage, true);
  assert.equal(PRODUCTION_PROMPT_VERSION, 'voice-contract-v2.0-compressed-v2-production-1');
  assert.notEqual(PRODUCTION_MODEL_ROUTE_VERSION, VOICE_RENDERER_MODEL_ROUTE_VERSION);
});
