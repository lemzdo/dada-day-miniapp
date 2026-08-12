'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt, BRIEF_SCHEMA_VERSION } = require('./core');
const { buildDevelopmentCalls, parseProviderContent, runDevelopment, usageFrom } = require('./run-development');

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-dev-'));
  const fixtures = Array.from({ length: 20 }, (_, index) => ({ id: `dev-${index + 1}`, modelBrief: { id: `dev-${index + 1}`, briefSchemaVersion: BRIEF_SCHEMA_VERSION, delivery: 'omit', scene: 'home', garments: [], primaryStylingPoint: null, inferenceBoundary: {} } }));
  fs.writeFileSync(path.join(dir, '01-prompt.md'), `${buildPrompt()}\n`);
  fs.writeFileSync(path.join(dir, '03-development.json'), JSON.stringify({ count: 20, fixtures }));
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ changeHypothesis: 'test', changedLayer: 'Prompt', expectedChangedLayer: 'Prompt', before: 'a', after: 'b' }));
  return dir;
}

test('development helpers parse provider content and usage', () => {
  const result = { data: { providerResponse: { choices: [{ message: { content: '{"items":[]}' } }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11, prompt_tokens_details: { cached_tokens: 2 } } } } };
  assert.equal(parseProviderContent(result), '{"items":[]}');
  assert.deepEqual(usageFrom(result), { inputTokens: 8, outputTokens: 3, cachedInputTokens: 2, totalTokens: 11 });
});

test('development runner uses 8/8/4 plus calls and writes attempt', async () => {
  const dir = fixtureDir();
  process.env.XIAODA_VOICE_BENCHMARK_TOKEN = 'dev-token';
  const calls = [];
  const mini = { evaluate: async (_fn, payload) => { calls.push(payload); const items = payload.briefs.map((brief) => ({ id: brief.id, reason: '简单日常搭配。' })); return { result: { data: { requestedModel: 'qwen3.7-plus', returnedModel: 'qwen3.7-plus', httpStatus: 200, wallLatencyMs: 3, providerResponse: { choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } } } }; } };
  const result = await runDevelopment({ artifactDir: dir, metadataPath: path.join(dir, 'metadata.json'), deps: { mini } });
  assert.deepEqual(calls.map((call) => call.briefs.length), [8, 8, 4]);
  assert.equal(calls[0].token, 'dev-token');
  assert.equal(calls[0].promptVersion, require('./core').PROMPT_VERSION);
  assert.equal(calls[0].briefSchemaVersion, require('./core').BRIEF_SCHEMA_VERSION);
  assert.ok(calls.every((call) => call.briefs.every((brief) => /^dev-/.test(brief.id))));
  assert.equal(result.parsedItems.length, 20);
  assert.equal(result.editorialReviewRequired, true);
  assert.equal(fs.existsSync(path.join(dir, '06-development-attempt-1.json')), true);
});

test('development runner rejects missing metadata and holdout ids', async () => {
  const dir = fixtureDir();
  await assert.rejects(runDevelopment({ artifactDir: dir, metadataPath: path.join(dir, 'missing.json'), deps: { mini: {} } }), /ENOENT/);
  fs.writeFileSync(path.join(dir, '03-development.json'), JSON.stringify({ count: 20, fixtures: [{ id: 'holdout-1' }] }));
  await assert.rejects(runDevelopment({ artifactDir: dir, metadataPath: path.join(dir, 'metadata.json'), deps: { mini: {} } }), /DEVELOPMENT_COUNT_INVALID/);
});

test('development calls are fixed at 8/8/4', () => {
  assert.deepEqual(buildDevelopmentCalls(Array.from({ length: 20 }, (_, i) => i)).map((batch) => batch.length), [8, 8, 4]);
  assert.throws(() => buildDevelopmentCalls(Array.from({ length: 21 }, (_, i) => i)), /./);
});

test('existing attempt increments from 1 to 2', async () => {
  const dir = fixtureDir();
  fs.writeFileSync(path.join(dir, '06-development-attempt-1.json'), '{}');
  process.env.XIAODA_VOICE_BENCHMARK_TOKEN = 'dev-token';
  const mini = { evaluate: async (_fn, payload) => ({ result: { data: { requestedModel: 'qwen3.7-plus', returnedModel: 'qwen3.7-plus', providerResponse: { choices: [{ message: { content: JSON.stringify({ items: payload.briefs.map((brief) => ({ id: brief.id, reason: 'ok' })) }) } }], usage: {} } } } }) };
  const result = await runDevelopment({ artifactDir: dir, metadataPath: path.join(dir, 'metadata.json'), deps: { mini } });
  assert.equal(result.attempt, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '06-development-attempt-2.json'))).status, 'COMPLETED');
});

test('attempt four is rejected before any evaluate call', async () => {
  const dir = fixtureDir();
  for (const attempt of [1, 2, 3, 4]) fs.writeFileSync(path.join(dir, `06-development-attempt-${attempt}.json`), '{}');
  let evaluateCount = 0;
  const mini = { evaluate: async () => { evaluateCount += 1; } };
  await assert.rejects(runDevelopment({ artifactDir: dir, metadataPath: path.join(dir, 'metadata.json'), deps: { mini } }), /DEVELOPMENT_ATTEMPT_LIMIT/);
  assert.equal(evaluateCount, 0);
});

test('second call failure preserves first call in FAILED artifact', async () => {
  const dir = fixtureDir();
  process.env.XIAODA_VOICE_BENCHMARK_TOKEN = 'dev-token';
  let count = 0;
  const mini = { evaluate: async (_fn, payload) => { count += 1; if (count === 2) throw new Error('second failed'); return { result: { data: { requestedModel: 'qwen3.7-plus', returnedModel: 'qwen3.7-plus', providerResponse: { choices: [{ message: { content: JSON.stringify({ items: payload.briefs.map((brief) => ({ id: brief.id, reason: 'ok' })) }) } }], usage: {} } } } }; } };
  await assert.rejects(runDevelopment({ artifactDir: dir, metadataPath: path.join(dir, 'metadata.json'), deps: { mini } }), /second failed/);
  const artifact = JSON.parse(fs.readFileSync(path.join(dir, '06-development-attempt-1.json')));
  assert.equal(artifact.status, 'FAILED');
  assert.equal(artifact.calls.length, 1);
  assert.equal(artifact.calls[0].label, 'development-1');
});
