const assert = require('node:assert/strict');
const test = require('node:test');
const lab = require('../../../scripts/voice-renderer-v2-lab/core');
const production = require('./voiceRendererV2Contract');

test('B.1 uses the exact B.0 prompt, versions, model, and generation parameters', () => {
  assert.equal(production.buildVoiceRendererV2SystemPrompt(), lab.buildSystemPrompt());
  assert.equal(production.VOICE_RENDERER_CONTRACT_VERSION, lab.PROMPT_VERSION);
  assert.equal(production.VOICE_RENDERER_INPUT_VERSION, lab.INPUT_VERSION);
  assert.equal(production.VOICE_RENDERER_PERSONA_VERSION, lab.PERSONA_VERSION);
  assert.equal(production.VOICE_RENDERER_MODEL, lab.MODEL_ALLOWLIST.max);
  assert.deepEqual(production.VOICE_RENDERER_GENERATION_PARAMETERS, lab.GENERATION_PARAMETERS);
});
