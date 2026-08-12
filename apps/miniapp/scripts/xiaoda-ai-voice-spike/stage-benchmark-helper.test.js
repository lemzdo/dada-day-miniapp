'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { stageBenchmarkHelper } = require('./stage-benchmark-helper');

test('helper is injected only into an independent staging copy', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoda-voice-stage-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(source);
  const original = "const { isDeepStrictEqual } = require('node:util');\nexports.main = async (event = {}) => {\n  const action = event.action || 'generate';\n  const handlerStartedAt = Date.now();\n};\n";
  fs.writeFileSync(path.join(source, 'index.js'), original);
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"fixture"}');
  const result = stageBenchmarkHelper({ sourceDirectory: source, targetDirectory: target, benchmarkToken: 'a'.repeat(40) });
  assert.equal(fs.readFileSync(path.join(source, 'index.js'), 'utf8'), original);
  assert.match(fs.readFileSync(path.join(target, 'index.js'), 'utf8'), /xiaodaVoiceBenchmark/);
  const helper = fs.readFileSync(path.join(target, 'benchmarkXiaodaVoice.js'), 'utf8');
  assert.doesNotMatch(helper, /__BENCHMARK_TOKEN_SHA256__/);
  assert.doesNotMatch(helper, /a{32}/);
  assert.equal(result.productionSourceUnmodified, true);
});

test('staging rejects unsafe target placement and short tokens', () => {
  assert.throws(() => stageBenchmarkHelper({ sourceDirectory: __dirname, targetDirectory: path.join(__dirname, 'nested'), benchmarkToken: 'a'.repeat(40) }), /independent/);
  assert.throws(() => stageBenchmarkHelper({ sourceDirectory: __dirname, targetDirectory: path.join(os.tmpdir(), 'target'), benchmarkToken: 'short' }), /32/);
});

test('production cloudfunction source contains no benchmark action', () => {
  const productionIndex = fs.readFileSync(path.resolve(__dirname, '..', '..', 'cloudfunctions', 'generateOutfit', 'index.js'), 'utf8');
  assert.doesNotMatch(productionIndex, /xiaodaVoiceBenchmark|benchmarkXiaodaVoice/);
});

test('helper template is token protected and model allowlisted', () => {
  const source = fs.readFileSync(path.join(__dirname, 'benchmark-helper-template.js'), 'utf8');
  assert.match(source, /BENCHMARK_TOKEN_SHA256/);
  assert.match(source, /plus: 'qwen3\.7-plus'/);
  assert.match(source, /max: 'qwen3\.7-max'/);
  assert.doesNotMatch(source, /event\.model\b/);
  assert.match(source, /briefs\.length > 8/);
});
