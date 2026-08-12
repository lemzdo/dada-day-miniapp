'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareHelperDeployment } = require('./prepare-helper-deployment');

const INDEX = "const { isDeepStrictEqual } = require('node:util');\nexports.main = async (event = {}) => {\n  const action = event.action || 'generate';\n  const handlerStartedAt = Date.now();\n};\n";

test('creates protected token and safe phase2 staging audit', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-prepare-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.js'), INDEX);
  const artifact = path.join(root, 'artifact');
  const result = prepareHelperDeployment({ sourceDirectory: source, artifactDirectory: artifact });
  const token = fs.readFileSync(result.tokenFile, 'utf8');
  const auditPath = path.join(artifact, 'phase2-helper-staging.json');
  const audit = fs.readFileSync(auditPath, 'utf8');
  assert.equal(token.length >= 40, true);
  assert.equal(result.tokenLength, token.length);
  assert.match(result.target, /\.phase2-helper-stage[\\/]generateOutfit$/);
  assert.equal(result.targetFunction, 'generateOutfit');
  assert.equal(result.environment, 'cloud1-d8gl3k1vkdf0b7f05');
  assert.equal(result.productionUnmodified, true);
  assert.match(audit, /tokenHash/);
  assert.doesNotMatch(audit, new RegExp(token));
  if (process.platform !== 'win32') assert.equal((fs.statSync(result.tokenFile).mode & 0o777).toString(8), '600');
});

test('fails closed when staging or token already exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-prepare-errors-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'index.js'), INDEX);
  const artifact = path.join(root, 'artifact');
  fs.mkdirSync(path.join(artifact, '.phase2-helper-stage'), { recursive: true });
  assert.throws(() => prepareHelperDeployment({ sourceDirectory: source, artifactDirectory: artifact }), /already exists/);
  fs.rmSync(path.join(artifact, '.phase2-helper-stage'), { recursive: true, force: true });
  fs.writeFileSync(path.join(artifact, '.phase2-benchmark-token'), 'occupied');
  assert.throws(() => prepareHelperDeployment({ sourceDirectory: source, artifactDirectory: artifact }), /already exists/);
  fs.rmSync(root, { recursive: true, force: true });
});
