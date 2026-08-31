'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_ROOT, analyzePackage, assertPackageIntegrity } = require('./check-generate-outfit-package');

const DEPLOY_SCRIPT = path.join(__dirname, 'deploy-generate-outfit.ps1');
const RECOMMENDATION_DEPLOY_SCRIPT = path.join(__dirname, 'deploy-recommendation-functions.ps1');

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

test('integrity check rejects runtime files excluded from the deployable source set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-outfit-deploy-filter-'));
  fs.mkdirSync(path.join(root, 'services'));
  fs.mkdirSync(path.join(root, 'shared'));
  fs.writeFileSync(path.join(root, 'index.js'), "require('./services/runtime.test');\n");
  fs.writeFileSync(path.join(root, 'services', 'runtime.test.js'), 'module.exports = {};\n');
  const report = analyzePackage(root);
  assert.equal(report.passed, false);
  assert.deepEqual(report.missingRuntimeFiles, ['services/runtime.test.js']);
});

test('legacy deployment wrappers delegate only to the canonical repository command', () => {
  const legacySource = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');
  const source = fs.readFileSync(RECOMMENDATION_DEPLOY_SCRIPT, 'utf8');
  assert.match(legacySource, /pnpm cloud:deploy generateOutfit/);
  assert.match(legacySource, /generateOutfit/);
  assert.match(source, /pnpm cloud:deploy \$functionName/);
  assert.match(source, /Functions = @\('recommendationStream'\)/);
  assert.doesNotMatch(`${legacySource}\n${source}`, /cloud functions (?:deploy|inc-deploy)/);
  assert.doesNotMatch(`${legacySource}\n${source}`, /tcb fn deploy/);
});
