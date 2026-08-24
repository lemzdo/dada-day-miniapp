'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildCompressedV2SystemPrompt, buildRendererInput } = require('../../scripts/voice-renderer-v2-lab/core');
const { buildGoldPlans } = require('../../scripts/voice-renderer-v2-lab/gold-plans');
const lab = require('./index');
const renderer = require('./renderer');

const input = buildRendererInput(buildGoldPlans()[0]);
const baseEvent = { caseId: 'primary-pattern-focus', model: 'flash', promptVariant: 'current', input, execute: false };

function mockFetch(body, status = 200) {
  return async (_url, options) => ({ status, ok: status >= 200 && status < 300, async text() { return JSON.stringify(body(options)); } });
}

test('isolated function supports required allowlists and has no production references', () => {
  assert.deepEqual(lab.__test.MODELS, { max: 'qwen3.7-max', flash: 'qwen3.7-flash' });
  assert.deepEqual(lab.__test.PROMPT_VARIANTS, ['current', 'compressed', 'compressed-v2']);
  const source = `${fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')}\n${fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8')}`;
  assert.doesNotMatch(source, /recommendationMutationCoordinator|P3|prefetch/i);
  assert.doesNotMatch(source, /console\.(log|error|warn)\s*\(/i);
});

test('missing credential fails before fetch and does not leak secret', async () => {
  const bailian = process.env.BAILIAN_API_KEY;
  const dashscope = process.env.DASHSCOPE_API_KEY;
  delete process.env.BAILIAN_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  let called = false;
  try {
    const result = await lab.main({ ...baseEvent, execute: true });
    assert.equal(result.errorCode, 'LAB_CREDENTIAL_MISSING');
    assert.equal(JSON.stringify(result).includes('sk-'), false);
    await assert.rejects(() => lab.__test.executeProvider({ ...baseEvent, execute: true }, '', async () => { called = true; }), /LAB_CREDENTIAL_MISSING/);
    assert.equal(called, false);
  } finally {
    if (bailian === undefined) delete process.env.BAILIAN_API_KEY; else process.env.BAILIAN_API_KEY = bailian;
    if (dashscope === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = dashscope;
  }
});

test('request is non-thinking and structured for current and compressed variants', () => {
  const current = renderer.buildRequest(baseEvent);
  const compressed = renderer.buildRequest({ ...baseEvent, promptVariant: 'compressed' });
  const compressedV2 = renderer.buildRequest({ ...baseEvent, promptVariant: 'compressed-v2' });
  assert.equal(current.enable_thinking, false);
  assert.equal(compressed.enable_thinking, false);
  assert.deepEqual(compressed.response_format, { type: 'json_object' });
  assert.equal(current.model, 'qwen3.7-flash');
  assert.equal(JSON.parse(compressed.messages[1].content)[0].id, '1');
  assert.equal(compressedV2.messages[0].content, buildCompressedV2SystemPrompt());
  assert.deepEqual(compressedV2.response_format, { type: 'json_object' });
  const streaming = renderer.buildRequest({ ...baseEvent, batch: true, inputs: [input], stream: true, sequencing: true, model: 'max', promptVariant: 'compressed-v2' });
  assert.deepEqual(streaming.stream_options, { include_usage: true });
  assert.equal(streaming.stream, true);
});

test('mock provider returns minimal timing/token/contract/validator fields', async () => {
  const previous = process.env.BAILIAN_API_KEY;
  process.env.BAILIAN_API_KEY = 'test-only-marker';
  try {
    const result = await lab.__test.executeProvider({ ...baseEvent, execute: true }, 'test-only-marker', mockFetch((options) => ({
      model: JSON.parse(options.body).model,
      choices: [{ message: { content: JSON.stringify([{ planId: input.planId, insightId: input.primary.insightId, text: '条纹上衣突出图案重点，纯色长裤保持简单。' }]) } }],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    })));
    assert.equal(result.status, 'completed');
    assert.equal(result.nonThinking, true);
    assert.equal(result.parserPass, true);
    assert.equal(result.contractPass, true);
    assert.equal(result.validatorPass, true);
    assert.equal(result.promptTokens, 20);
    assert.equal(result.completionTokens, 8);
    assert.equal(result.retryCount, 0);
    assert.equal(result.canonicalCopy, '条纹上衣突出图案重点，纯色长裤保持简单。');
    assert.deepEqual(result.validatorFailures, []);
    assert.equal(JSON.stringify(result).includes('test-only-marker'), false);
  } finally {
    if (previous === undefined) delete process.env.BAILIAN_API_KEY; else process.env.BAILIAN_API_KEY = previous;
  }
});

test('compressed mock output is parsed and factual/persona failures are surfaced', async () => {
  const result = await lab.__test.executeProvider({ ...baseEvent, promptVariant: 'compressed', execute: true }, 'test-only-marker', mockFetch((options) => ({
    model: JSON.parse(options.body).model,
    choices: [{ message: { content: JSON.stringify({ copies: [{ id: '1', text: '条纹上衣显瘦又透气。' }] }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  })));
  assert.equal(result.contractPass, true);
  assert.equal(result.validatorPass, false);
  assert.equal(result.factualViolation, true);
  assert.equal(result.personaNaturalness, true);
  assert.ok(result.validatorFailures.includes('MEANING_NOT_PRESERVED'));
});

test('validator rejects secondary meaning even when the JSON contract passes', () => {
  const competing = buildRendererInput(buildGoldPlans().find((plan) => plan.caseId === 'competing-pattern-and-silhouette'));
  const result = renderer.parseAndValidate(JSON.stringify([{ planId: competing.planId, insightId: competing.primary.insightId, text: '条纹修身上衣是图案重点，一紧一松也很平衡。' }]), 'current', competing, 'competing-pattern-and-silhouette');
  assert.equal(result.contractPass, true);
  assert.equal(result.validatorPass, false);
  assert.ok(result.validatorFailures.includes('NEW_REASON_OR_SECONDARY'));
});

test('case, model, prompt, input and execute flags are validated', () => {
  assert.doesNotThrow(() => lab.__test.assertEvent({ ...baseEvent, tcbContext: { platform: 'cloudbase' }, userInfo: { openId: 'platform-injected' } }));
  assert.throws(() => lab.__test.assertEvent({ ...baseEvent, caseId: 'unknown' }), /CASE_ID_NOT_ALLOWED/);
  assert.throws(() => lab.__test.assertEvent({ ...baseEvent, model: 'plus' }), /MODEL_NOT_ALLOWED/);
  assert.throws(() => lab.__test.assertEvent({ ...baseEvent, promptVariant: 'other' }), /PROMPT_VARIANT_NOT_ALLOWED/);
  assert.throws(() => lab.__test.assertEvent({ ...baseEvent, input: null }), /INPUT_OBJECT/);
  assert.throws(() => lab.__test.assertEvent({ ...baseEvent, execute: 'yes' }), /EXECUTE_FLAG/);
});

test('batch route accepts at most eight unique Gold cases and fixes Max compressed', () => {
  const cases = buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) }));
  assert.doesNotThrow(() => lab.__test.assertEvent({ batch: true, model: 'max', promptVariant: 'compressed', cases, execute: false }));
  assert.doesNotThrow(() => lab.__test.assertEvent({ batch: true, model: 'max', promptVariant: 'compressed-v2', cases, execute: false }));
  assert.throws(() => lab.__test.assertEvent({ batch: true, model: 'flash', promptVariant: 'compressed', cases, execute: false }), /BATCH_ROUTE_FIXED/);
  assert.throws(() => lab.__test.assertEvent({ batch: true, model: 'max', promptVariant: 'current', cases, execute: false }), /BATCH_ROUTE_FIXED/);
  assert.throws(() => lab.__test.assertEvent({ batch: true, model: 'max', promptVariant: 'compressed', cases: cases.slice(0, 7).concat(cases[0]), execute: false }), /BATCH_CASE_ID/);
});

test('batch compressed request carries eight inputs in one structured request', () => {
  const cases = buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) }));
  const request = renderer.buildRequest({ model: 'max', promptVariant: 'compressed', inputs: cases.map((entry) => entry.input) });
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.equal(request.enable_thinking, false);
  assert.equal(JSON.parse(request.messages[1].content).length, 8);
  assert.equal(JSON.parse(request.messages[1].content)[7].id, '8');
});

test('batch parser validates every returned copy and exposes canonical copies', () => {
  const cases = buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) }));
  const outputs = { copies: cases.map((entry, index) => ({ id: String(index + 1), text: entry.input.garments[0] + (entry.input.expressionMode === 'baseline' ? '简单日常。' : '保持简单。') })) };
  const result = renderer.parseAndValidateBatch(JSON.stringify(outputs), 'compressed', cases);
  assert.equal(result.length, 8);
  assert.equal(result[0].result.canonicalCopy.includes(cases[0].input.garments[0]), true);
});

test('mock batch provider performs one request and returns aggregate canonical copies', async () => {
  const cases = buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) }));
  const texts = [
    '条纹上衣是这套搭配唯一明确的图案重点，纯色长裤保持简单。',
    '修身上衣与阔腿裤形成一紧一松的轮廓对比。',
    '蓝色上衣和藏青长裤处在接近的蓝色系，颜色保持统一。',
    '衬衫、西装长裤和商务鞋组成清楚完整的上班搭配。',
    '基础上衣和基础长裤，简单日常就好。',
    '图案上衣和印花长裤，简单日常就好。',
    '白色T恤和灰色长裤，简单日常就好。',
    '条纹修身上衣是这套搭配的图案重点，纯色阔腿裤保持简单。',
  ];
  const result = await lab.__test.executeProvider({ batch: true, model: 'max', promptVariant: 'compressed', cases, execute: true }, 'test-only-marker', mockFetch((options) => ({
    model: JSON.parse(options.body).model,
    choices: [{ message: { content: JSON.stringify({ copies: texts.map((text, index) => ({ id: String(index + 1), text })) }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 80 },
  })));
  assert.equal(result.status, 'completed');
  assert.equal(result.batch, true);
  assert.equal(result.outputCount, 8);
  assert.equal(result.contractPass, true);
  assert.equal(result.validatorPass, true);
  assert.equal(result.canonicalCopies.length, 8);
});

test('streaming lab consumes SSE deltas and validates first output independently', async () => {
  const cases = buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) }));
  const texts = ['条纹上衣是这套搭配唯一明确的图案重点，纯色长裤保持简单。', '修身上衣与阔腿裤形成一紧一松的轮廓对比。', '蓝色上衣和藏青长裤处在接近的蓝色系，颜色保持统一。', '衬衫、西装长裤和商务鞋组成清楚完整的上班搭配。', '基础上衣和基础长裤，简单日常就好。', '图案上衣和印花长裤，简单日常就好。', '白色T恤和灰色长裤，简单日常就好。', '条纹修身上衣是这套搭配的图案重点，纯色阔腿裤保持简单。'];
  const raw = JSON.stringify({ copies: texts.map((text, index) => ({ id: String(index + 1), text })) });
  const frames = [];
  for (let i = 0; i < raw.length; i += 23) frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: raw.slice(i, i + 23) } }] })}\n\n`);
  frames.push('data: [DONE]\n\n');
  const body = { status: 200, ok: true, body: { async *[Symbol.asyncIterator]() { for (const frame of frames) yield Buffer.from(frame); } } };
  const result = await lab.__test.executeProvider({ batch: true, model: 'max', promptVariant: 'compressed-v2', stream: true, sequencing: true, cases, execute: true }, 'test-only-marker', async () => body);
  assert.equal(result.streamSupported, true);
  assert.equal(result.streamFormat.startsWith('SSE:'), true);
  assert.equal(result.FIRST_ITEM_VALIDATED_MS !== null, true);
  assert.equal(result.SECOND_ITEM_VALIDATED_MS !== null, true);
  assert.equal(result.FIRST_ITEM_PARSEABLE_MS <= result.FIRST_ITEM_VALIDATED_MS, true);
  assert.equal(result.ALL_8_STREAM_COMPLETE_MS <= result.ALL_8_VALIDATED_MS, true);
  assert.equal(result.parserPassCount, '8/8');
  assert.equal(result.contractPassCount, '8/8');
  assert.equal(result.validatorPassCount, '8/8');
  assert.equal(result.factualFailures, 0);
  assert.equal(result.personaFailures, 0);
  assert.equal(result.outputCount, 8);
  assert.equal(result.validatorPass, true);
  assert.equal(result.factualViolation, false);
  assert.equal(result.metaLanguageFailures, 0);
});

test('streaming lab supports isolated Plan #1 priority request', async () => {
  const one = { caseId: 'primary-pattern-focus', input };
  const raw = JSON.stringify({ copies: [{ id: '1', text: '条纹上衣突出图案重点，纯色长裤保持简单。' }] });
  const body = { status: 200, ok: true, body: { async *[Symbol.asyncIterator]() { yield Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: raw } }] })}\n\n`); yield Buffer.from('data: [DONE]\n\n'); } } };
  const result = await lab.__test.executeProvider({ ...one, model: 'max', promptVariant: 'compressed-v2', stream: true, execute: true }, 'test-only-marker', async () => body);
  assert.equal(result.caseId, one.caseId);
  assert.equal(result.parserPassCount, '1/1');
  assert.equal(result.validatorPass, true);
});
