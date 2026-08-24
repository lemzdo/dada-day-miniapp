'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildRendererInput } = require('../../scripts/voice-renderer-v2-lab/core');
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
  assert.deepEqual(lab.__test.PROMPT_VARIANTS, ['current', 'compressed']);
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
  assert.equal(current.enable_thinking, false);
  assert.equal(compressed.enable_thinking, false);
  assert.deepEqual(compressed.response_format, { type: 'json_object' });
  assert.equal(current.model, 'qwen3.7-flash');
  assert.equal(JSON.parse(compressed.messages[1].content)[0].id, '1');
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
