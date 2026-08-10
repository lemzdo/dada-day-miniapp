'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_ROOT, analyzePackage, assertPackageIntegrity } = require('./check-generate-outfit-package');

const DEPLOY_SCRIPT = path.join(__dirname, 'deploy-generate-outfit.ps1');

test('current generateOutfit package includes recursive runtime dependencies and required directories', () => {
  const report = assertPackageIntegrity(DEFAULT_ROOT);
  assert.equal(report.passed, true);
  assert.equal(report.requiredDirectories.index, true);
  assert.equal(report.requiredDirectories.services, true);
  assert.equal(report.requiredDirectories.shared, true);
  assert.ok(report.runtimeDependencyCount > 20);
  assert.equal(report.missingRuntimeFiles.length, 0);
});

test('integrity check fails before deployment when a recursive runtime file is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-outfit-integrity-'));
  fs.mkdirSync(path.join(root, 'services'));
  fs.mkdirSync(path.join(root, 'shared'));
  fs.writeFileSync(path.join(root, 'index.js'), "require('./services/required');\n");
  assert.throws(() => analyzePackage(root), /Missing local runtime dependency/);
});

test('deployment wrapper uses an explicit single-function source path', () => {
  const source = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');
  assert.match(source, /cloud functions deploy/);
  assert.match(source, /--paths \$stageRoot/);
  assert.match(source, /node_modules/);
  assert.match(source, /Copy-Item/);
  assert.match(source, /deploymentMarker/);
  assert.doesNotMatch(source, /--names\s+generateOutfit/);
});
