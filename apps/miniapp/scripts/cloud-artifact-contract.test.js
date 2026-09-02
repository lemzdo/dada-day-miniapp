'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ALL_FUNCTIONS, PRODUCTION_FUNCTIONS, assertDestination, checkCloudArtifact, hash, stageCloudFunction, verifyInstalledDependencies, writeJson } = require('./cloud-artifact-contract');
const { auditDependencies, parseDependencies } = require('./cloud-dependency-audit');
const { auditAll } = require('./cloud-deploy-audit');
const { assertRemoteInventory, deployFunction, parseArgs, parseTcbJson, waitForRemoteActive } = require('./cloud-deploy');

function temporary(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-contract-v2-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('every source function has a manifest, builds and boots in isolation', (context) => {
  const report = auditAll(temporary(context));
  assert.equal(PRODUCTION_FUNCTIONS.length, 26);
  assert.equal(report.functions.length, ALL_FUNCTIONS.length);
  assert.equal(report.passed, true, JSON.stringify(report.functions.filter((item) => !item.gate?.passed)));
  assert.ok(report.functions.every((item) => item.gate.boot.handlersInvoked === false));
  assert.ok(report.functions.every((item) => item.artifact.files.every((file) => !/(?:\.turbo|node_modules|\.env|\.log$)/.test(file.path))));
  assert.equal(report.shared.length, 1);
});

test('AST audit ignores comments and reports every missing or dynamic dependency', (context) => {
  const root = temporary(context);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'index.js'), [
    '// require("./fake-comment")',
    'require("./missing-one");',
    'import("./missing-two");',
    'require(process.env.UNDECLARED_PLUGIN);',
    'require("unknown-external");',
  ].join('\n'));
  assert.equal(parseDependencies(path.join(root, 'index.js')).dependencies.length, 4);
  const report = auditDependencies('login', root);
  assert.equal(report.missingFiles.length, 4);
  assert.equal(report.dynamicDependencies[0].declared, false);
});

test('known confirm/upload missing files fail; deleting several yields a complete audit', (context) => {
  const root = path.join(temporary(context), 'confirmClothesDrafts');
  stageCloudFunction('confirmClothesDrafts', root);
  fs.unlinkSync(path.join(root, 'services/wardrobeCapacity.js'));
  fs.unlinkSync(path.join(root, 'shared/sceneEligibilityFacts.js'));
  const audit = auditDependencies('confirmClothesDrafts', root, { allFiles: true });
  assert.ok(audit.missingFiles.some((item) => item.request === './services/wardrobeCapacity'));
  assert.ok(audit.missingFiles.some((item) => item.request === './shared/sceneEligibilityFacts'));
  assert.throws(() => checkCloudArtifact('confirmClothesDrafts', root), /manifest integrity failed/);
});

test('lazy dynamic vendor target is required even when runtime catches its load error', (context) => {
  const root = path.join(temporary(context), 'backfillClothesThumbnails');
  stageCloudFunction('backfillClothesThumbnails', root);
  fs.unlinkSync(path.join(root, 'vendor/garment-assets/src/index.js'));
  const audit = auditDependencies('backfillClothesThumbnails', root, { allFiles: true });
  assert.ok(audit.missingFiles.some((item) => item.request === '../vendor/garment-assets'));
  assert.throws(() => checkCloudArtifact('backfillClothesThumbnails', root), /manifest integrity failed/);
});

test('full nested canonical drift fails even with a self-consistent rehashed manifest', (context) => {
  const root = path.join(temporary(context), 'recommendationStream');
  const manifest = stageCloudFunction('recommendationStream', root);
  const file = 'generateOutfit/services/aestheticCompatibility.js';
  fs.appendFileSync(path.join(root, file), '\n// stale nested runtime\n');
  const record = manifest.files.find((item) => item.path === file);
  record.bytes = fs.statSync(path.join(root, file)).size;
  record.sha256 = hash(path.join(root, file));
  writeJson(path.join(root, 'artifact-manifest.json'), manifest);
  assert.throws(() => checkCloudArtifact('recommendationStream', root), /CANONICAL_ARTIFACT_DRIFT/);
});

test('unexpected artifact files and workspace escape attempts fail closed', (context) => {
  const root = path.join(temporary(context), 'login');
  stageCloudFunction('login', root);
  fs.writeFileSync(path.join(root, 'extra.js'), 'module.exports = 1;');
  assert.throws(() => checkCloudArtifact('login', root), /unexpectedFiles/);
  assert.throws(() => assertDestination(path.resolve(__dirname, '../cloudfunctions/login')), /SOURCE_DIRECTORY_DEPLOY_FORBIDDEN/);
  assert.throws(() => assertDestination(root), /NOT_EMPTY/);
});

test('upload success without the expected remote manifest is never deployment success', (context) => {
  const root = temporary(context);
  const runner = (_cli, args, cwd) => {
    if (args[1] === 'code' && args[2] === 'download') {
      fs.cpSync(path.join(root, 'staged/login'), args[4], { recursive: true });
      fs.appendFileSync(path.join(args[4], 'index.js'), '\n// remote corruption\n');
    }
    assert.ok(cwd);
    if (args[1] === 'list') return { stdout: JSON.stringify({ data: [{ name: 'login', status: 'Deployment completed' }] }, null, 2) };
  };
  assert.throws(() => deployFunction('login', { workRoot: root, runner, tcbCli: 'mock' }), /manifest integrity failed/);
});

test('all selects production; unknown remote functions cannot silently escape coverage', () => {
  assert.deepEqual(parseArgs(['all']).functions, PRODUCTION_FUNCTIONS);
  assert.deepEqual(parseArgs(['all-functions']).functions, ALL_FUNCTIONS);
  const rows = ALL_FUNCTIONS.map((name) => ({ name }));
  assert.doesNotThrow(() => assertRemoteInventory(rows));
  assert.throws(() => assertRemoteInventory([...rows, { name: 'newProductionFunction' }]), /REMOTE_INVENTORY_MISMATCH/);
  assert.throws(() => assertRemoteInventory(rows.filter((item) => item.name !== 'login')), /REMOTE_INVENTORY_MISMATCH/);
});

test('remote inventory parser accepts CLI progress before JSON without losing rows', () => {
  assert.deepEqual(parseTcbJson('- Loading data...\n{\n  "data": [{"name":"login"}]\n}\n').data, [{ name: 'login' }]);
  assert.throws(() => parseTcbJson('login timed out'), /TCB_JSON_RESPONSE_MISSING/);
});

test('remote verify rejects missing installed external dependencies', (context) => {
  const root = temporary(context);
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};');
  assert.throws(() => verifyInstalledDependencies(root, [{ importer: 'index.js', request: 'missing-runtime-sdk', version: '1.0.0' }]), /REMOTE_INSTALLED_DEPENDENCIES_FAILED/);
});

test('code update waits for Active before downloading and rejects terminal failures', () => {
  const states = ['Updating', 'Deployment completed'];
  const runner = () => ({ stdout: JSON.stringify({ data: [{ name: 'login', status: states.shift() }] }, null, 2) });
  assert.doesNotThrow(() => waitForRemoteActive('mock', 'login', 'env', '.', { runner, delayMs: 0, attempts: 2 }));
  assert.equal(states.length, 0);
  const failed = () => ({ stdout: JSON.stringify({ data: [{ name: 'login', status: 'Update failed' }] }, null, 2) });
  assert.throws(() => waitForRemoteActive('mock', 'login', 'env', '.', { runner: failed, delayMs: 0 }), /REMOTE_UPDATE_FAILED/);
});
