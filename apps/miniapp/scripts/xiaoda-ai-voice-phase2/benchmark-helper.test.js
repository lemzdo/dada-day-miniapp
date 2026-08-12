'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { assertRequest, MODEL_ALLOWLIST, BRIEF_SCHEMA_VERSION } = require('./benchmark-helper-template');
test('plus only, versions, and brief schema gates', () => {
  assert.deepEqual(MODEL_ALLOWLIST, { plus: 'qwen3.7-plus' });
  assert.throws(() => assertRequest({ modelAlias: 'max' }), /AUTHORIZED|MODEL/);
  assert.throws(() => assertRequest({ benchmarkToken: '', modelAlias: 'plus', promptVersion: 'xiaoda-today-voice-v2-dev1', briefSchemaVersion: BRIEF_SCHEMA_VERSION, briefs: [{ id: 'x', briefSchemaVersion: 'wrong' }], systemPrompt: 'x'.repeat(100) }), /AUTHORIZED|BRIEF_SCHEMA/);
});
test('Node 16 fetch compatibility and telemetry source contract', () => {
  const source = fs.readFileSync(require.resolve('./benchmark-helper-template'), 'utf8');
  assert.match(source, /require\('node-fetch'\)/);
  assert.doesNotMatch(source, /globalThis\.fetch/);
  assert.doesNotMatch(source, /AbortSignal\.timeout/);
  assert.match(source, /enable_thinking: false/);
  assert.match(source, /providerError/);
  assert.match(source, /providerEndpointHost/);
  assert.match(source, /batchSize/);
});
