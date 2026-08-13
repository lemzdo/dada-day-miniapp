'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildRendererInput, INPUT_VERSION, PROMPT_VERSION } = require('./core');
const { buildGoldPlans } = require('./gold-plans');
const { renderHelper, stageCloudBenchmark } = require('./stage-cloud-benchmark');

const SOURCE = path.resolve(__dirname, '../../cloudfunctions/generateOutfit');

function withStage(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-renderer-cloud-'));
  try {
    const target = path.join(root, 'generateOutfit');
    const token = 'test-token-that-is-at-least-thirty-two-characters';
    const audit = stageCloudBenchmark({ sourceDirectory: SOURCE, targetDirectory: target, token });
    return callback({ target, token, audit });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('stages an independent token-gated action without modifying production source', () => withStage(({ target, audit }) => {
  assert.equal(audit.productionSourceUnmodified, true);
  assert.equal(fs.existsSync(path.join(target, 'benchmarkVoiceRendererV2.js')), true);
  assert.equal(fs.existsSync(path.join(target, 'recommendationStylingShadowV2.test.js')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(SOURCE, 'index.js'), 'utf8'), /voiceRendererV2Benchmark/);
  const staged = fs.readFileSync(path.join(target, 'index.js'), 'utf8');
  assert.match(staged, /action === 'voiceRendererV2Benchmark'/);
  assert.match(staged, /event\.voiceRendererRealPlanBenchmark === true/);
  assert.match(staged, /authorizeRecommendationVoiceRendererBenchmark\(event, \{ compare: true, review: true \}\)/);
  assert.match(staged, /delete event\.benchmarkToken/);
  assert.ok(staged.indexOf("action === 'voiceRendererV2Benchmark'") < staged.indexOf("action === 'transport_probe'"));
}));

test('cloud helper rejects unauthorized, extra, and forbidden inputs before provider access', () => withStage(({ target, token }) => {
  const helper = require(path.join(target, 'benchmarkVoiceRendererV2.js'));
  const input = buildRendererInput(buildGoldPlans()[0]);
  const request = { action: helper.ACTION, benchmarkToken: token, modelAlias: 'max', promptVersion: PROMPT_VERSION, inputVersion: INPUT_VERSION, inputs: [input] };
  assert.throws(() => helper.assertRequest({ ...request, benchmarkToken: undefined }), /BENCHMARK_NOT_AUTHORIZED/);
  assert.doesNotThrow(() => helper.assertRequest({
    ...request,
    tcbContext: { platform: 'cloudbase' },
    userInfo: { openId: 'platform-injected' },
  }));
  assert.throws(() => helper.assertRequest({ ...request, systemPrompt: 'override' }), /EVENT_KEY_NOT_ALLOWED:systemPrompt/);
  assert.throws(() => helper.assertRequest({ ...request, inputs: [{ ...input, reason: 'legacy' }] }), /INPUT_KEY_NOT_ALLOWED:reason/);
  assert.throws(() => helper.assertRequest({ ...request, inputs: [{ ...input, wardrobe: [] }] }), /INPUT_KEY_NOT_ALLOWED:wardrobe/);
  assert.doesNotThrow(() => helper.assertRequest(request));
  assert.doesNotThrow(() => helper.assertRequest({ ...request, modelAlias: 'plus' }));
}));

test('rendered helper contains fixed server prompt and no plaintext benchmark token', () => {
  const token = 'test-token-that-is-at-least-thirty-two-characters';
  const helper = renderHelper(token);
  assert.doesNotMatch(helper, new RegExp(token));
  assert.doesNotMatch(helper, /__VOICE_RENDERER_V2_/);
  assert.match(helper, /qwen3\.7-max/);
  assert.match(helper, /qwen3\.7-plus/);
});
