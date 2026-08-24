'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const lab = require('./index');

const event = {
  caseId: 'primary-pattern-focus',
  model: 'flash',
  promptVariant: 'compressed',
  input: { inputVersion: 'voice-renderer-input-v2.0', planId: 'plan-test' },
  execute: false,
};

test('function is isolated and has only max/flash and current/compressed allowlists', () => {
  assert.equal(lab.__test.ACTION, 'voiceRendererLatencyLab');
  assert.deepEqual(lab.__test.MODELS, { max: 'qwen3.7-max', flash: 'qwen3.7-flash' });
  assert.deepEqual(lab.__test.PROMPT_VARIANTS, ['current', 'compressed']);
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.doesNotMatch(source, /generateOutfit|Today|recommendationMutationCoordinator|P3|prefetch/i);
  assert.doesNotMatch(source, /fetch\s*\(|node-fetch|https?:\/\//i);
});

test('missing credential returns LAB_CREDENTIAL_MISSING without egress', async () => {
  const bailian = process.env.BAILIAN_API_KEY;
  const dashscope = process.env.DASHSCOPE_API_KEY;
  delete process.env.BAILIAN_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  try {
    assert.deepEqual(await lab.main(event), {
      benchmarkOnly: true,
      action: 'voiceRendererLatencyLab',
      status: 'failed',
      errorCode: 'LAB_CREDENTIAL_MISSING',
    });
  } finally {
    if (bailian === undefined) delete process.env.BAILIAN_API_KEY; else process.env.BAILIAN_API_KEY = bailian;
    if (dashscope === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = dashscope;
  }
});

test('real calls are disabled even when a test-only credential marker exists', async () => {
  const previous = process.env.BAILIAN_API_KEY;
  process.env.BAILIAN_API_KEY = 'test-only-marker';
  try {
    const ready = await lab.main(event);
    assert.equal(ready.status, 'credential_present_contract_only');
    assert.equal(ready.callsExecuted, 0);
    assert.equal(ready.providerCall, 'disabled_by_safety_gate');
    assert.equal(ready.nonThinking, true);
    assert.equal(ready.structuredOutput, 'json_object');
    assert.equal(ready.credentialVariable, 'BAILIAN_API_KEY');
    assert.deepEqual(await lab.main({ ...event, execute: true }), {
      benchmarkOnly: true,
      action: 'voiceRendererLatencyLab',
      status: 'failed',
      errorCode: 'REAL_CALLS_DISABLED',
    });
  } finally {
    if (previous === undefined) delete process.env.BAILIAN_API_KEY; else process.env.BAILIAN_API_KEY = previous;
  }
});

test('invalid event values are rejected', async () => {
  assert.throws(() => lab.__test.assertEvent({ ...event, model: 'plus' }), /MODEL_NOT_ALLOWED/);
  assert.throws(() => lab.__test.assertEvent({ ...event, promptVariant: 'other' }), /PROMPT_VARIANT_NOT_ALLOWED/);
  assert.throws(() => lab.__test.assertEvent({ ...event, caseId: 'unknown' }), /CASE_ID_NOT_ALLOWED/);
  assert.throws(() => lab.__test.assertEvent({ ...event, execute: true }), /REAL_CALLS_DISABLED/);
});
