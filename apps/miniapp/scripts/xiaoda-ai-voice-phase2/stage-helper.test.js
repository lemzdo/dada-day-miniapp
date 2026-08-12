'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stage } = require('./stage-helper');

function fixture(root, index, name = 'source') {
  const source = path.join(root, name);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.js'), index);
  fs.mkdirSync(path.join(source, 'node_modules'));
  fs.writeFileSync(path.join(source, 'node_modules', 'ignored.js'), 'ignored');
  return source;
}

const productionIndex = "const { isDeepStrictEqual } = require('node:util');\nexports.main = async (event = {}) => {\n  const action = event.action || 'generate';\n  const handlerStartedAt = Date.now();\n  return ok(await generate(event));\n};\n";

test('stage injects reachable phase2 action only into independent copy', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-stage-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = fixture(root, productionIndex);
  const target = path.join(root, 'generateOutfit');
  const result = stage({ sourceDirectory: source, targetDirectory: target, token: 'x'.repeat(40) });
  const staged = fs.readFileSync(path.join(target, 'index.js'), 'utf8');
  assert.match(staged, /require\('\.\/benchmarkXiaodaVoicePhase2'\)/);
  assert.match(staged, /action === 'xiaodaVoicePhase2Benchmark'/);
  assert.match(staged, /handlerStartedAt = Date\.now\(\);[\s\S]*xiaodaVoicePhase2Benchmark/);
  assert.equal(fs.readFileSync(path.join(source, 'index.js'), 'utf8'), productionIndex);
  assert.equal(fs.existsSync(path.join(target, 'node_modules')), false);
  assert.equal(result.productionSourceUnmodified, true);
  assert.doesNotMatch(fs.readFileSync(path.join(target, 'benchmarkXiaodaVoicePhase2.js'), 'utf8'), /__PHASE2_TOKEN_SHA256__/);
  assert.doesNotMatch(fs.readFileSync(path.join(target, 'benchmarkXiaodaVoicePhase2.js'), 'utf8'), /x{32}/);
});

test('stage rejects unsafe directories and already injected production', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-stage-errors-'));
  const source = fixture(root, productionIndex);
  assert.throws(() => stage({ sourceDirectory: source, targetDirectory: path.join(source, 'generateOutfit'), token: 'x'.repeat(40) }), /independent/);
  assert.throws(() => stage({ sourceDirectory: source, targetDirectory: path.join(root, 'wrong-name'), token: 'x'.repeat(40) }), /basename/);
  const injected = fixture(root, `${productionIndex}\n// benchmarkXiaodaVoicePhase2`, 'injected');
  assert.throws(() => stage({ sourceDirectory: injected, targetDirectory: path.join(root, 'generateOutfit'), token: 'x'.repeat(40) }), /already contains/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('production cloudfunction index contains no phase2 action', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'cloudfunctions', 'generateOutfit', 'index.js'), 'utf8');
  assert.doesNotMatch(source, /xiaodaVoicePhase2Benchmark|benchmarkXiaodaVoicePhase2/);
});
