'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertPromptFreeze, extractProviderContent, usageFrom } = require('./run-benchmark');
const { buildPrompt, sha256 } = require('./core');

test('provider response parser observes content and token usage without inference', () => {
  const call = { providerResponse: { choices: [{ message: { content: '{"items":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } } };
  assert.equal(extractProviderContent(call), '{"items":[]}');
  assert.deepEqual(usageFrom(call), { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 'NOT_OBSERVED' });
});

test('holdout requires immutable prompt and schema hashes', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoda-freeze-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prompt = buildPrompt();
  const schema = { version: 'xiaoda-styling-brief-v1' };
  fs.writeFileSync(path.join(directory, '02-brief-schema.json'), JSON.stringify(schema));
  fs.writeFileSync(path.join(directory, 'prompt-freeze.json'), JSON.stringify({
    promptVersion: 'xiaoda-today-voice-v1',
    promptSha256: sha256(prompt),
    briefSchemaVersion: 'xiaoda-styling-brief-v1',
    briefSchemaSha256: sha256(schema),
    generationParameters: { enable_thinking: false, temperature: 0.3, top_p: 0.8, max_tokens: 900, stream: false },
  }));
  assert.doesNotThrow(() => assertPromptFreeze(directory, prompt));
  assert.throws(() => assertPromptFreeze(directory, `${prompt} changed`), /changed/);
});
