'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ALL_FUNCTIONS, CONTRACT_VERSION, assertInventory, catalog, checkCloudArtifact, cloudfunctionsRoot, hash, stageCloudFunction, writeJson } = require('./cloud-artifact-contract');
const { auditDependencies, filesIn, parseDependencies, relative } = require('./cloud-dependency-audit');

function auditAll(workRoot) {
  const inventory = assertInventory();
  const functions = [];
  for (const name of ALL_FUNCTIONS) {
    const source = auditDependencies(name, path.join(cloudfunctionsRoot, name), { source: true });
    const item = { name, production: catalog.functions[name].production, source };
    try {
      item.artifact = stageCloudFunction(name, path.join(workRoot, 'staged', name));
      item.gate = checkCloudArtifact(name, path.join(workRoot, 'staged', name));
    } catch (error) { item.error = error.message; }
    functions.push(item);
    console.log(`ARTIFACT_AUDIT=${name} ${item.gate?.passed ? 'PASS' : 'FAIL'}`);
  }
  const shared = inventory.sharedDirectories.map((name) => ({ name, kind: 'shared-library-not-function', dynamicDependencies: filesIn(path.join(cloudfunctionsRoot, name)).filter((file) => file.endsWith('.js') && !file.endsWith('.test.js')).flatMap((file) => parseDependencies(file).dependencies.filter((item) => item.dynamic).map((item) => ({ importer: relative(cloudfunctionsRoot, file), ...item }))) }));
  return { version: CONTRACT_VERSION, generatedAt: new Date().toISOString(), inventory, functions, shared, passed: functions.every((item) => item.gate?.passed) };
}

function compareRemoteFiles(manifest, root) {
  const missingFiles = [], changedFiles = [], markerOnlyFiles = [];
  for (const file of manifest.files) {
    const remote = path.join(root, file.path);
    if (!fs.existsSync(remote)) missingFiles.push(file.path);
    else if (hash(remote) !== file.sha256) changedFiles.push(file.path);
  }
  return { missingFiles, changedFiles, markerOnlyFiles, manifestPresent: fs.existsSync(path.join(root, 'artifact-manifest.json')) };
}

function auditRemoteSnapshot(item, root, stagedRoot) {
  const diff = compareRemoteFiles(item.artifact, root);
  diff.markerOnlyFiles = diff.changedFiles.filter((file) => file.endsWith('.js')
    && fs.readFileSync(path.join(root, file), 'utf8').replace(/^\/\/ canonical-deploy-[^\r\n]+\r?\n/, '') === fs.readFileSync(path.join(stagedRoot, file), 'utf8'));
  diff.contentDriftFiles = diff.changedFiles.filter((file) => !diff.markerOnlyFiles.includes(file));
  return { ...diff, dependencyAudit: auditDependencies(item.name, root, { allFiles: true }) };
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg, i) => !['--remote', '--output', '--remote-from'].includes(arg) && !['--output', '--remote-from'].includes(args[i - 1]));
  if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(',')}`);
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output requires a directory');
  const workRoot = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-cloud-audit-'));
  fs.mkdirSync(workRoot, { recursive: true });
  console.log(`AUDIT_EVIDENCE=${workRoot}`);
  const report = auditAll(workRoot);
  writeJson(path.join(workRoot, 'audit.json'), report);
  const snapshotIndex = args.indexOf('--remote-from');
  if (snapshotIndex >= 0) {
    if (!args[snapshotIndex + 1]) throw new Error('--remote-from requires a directory');
    const snapshotRoot = path.resolve(args[snapshotIndex + 1]);
    report.remoteSnapshotRoot = snapshotRoot;
    for (const item of report.functions) {
      try { item.remoteBefore = auditRemoteSnapshot(item, path.join(snapshotRoot, item.name), path.join(workRoot, 'staged', item.name)); }
      catch (error) { item.remoteBefore = { error: error.message }; report.passed = false; }
    }
    writeJson(path.join(workRoot, 'audit.json'), report);
  }
  if (args.includes('--remote')) {
    const { assertRemoteInventory, listRemoteFunctions, resolveTcbCli, runTcb } = require('./cloud-deploy');
    const environmentId = process.env.CLOUDBASE_ENV_ID || 'cloud1-d8gl3k1vkdf0b7f05';
    const tcbCli = resolveTcbCli();
    report.environmentId = environmentId;
    report.remoteInventory = listRemoteFunctions(tcbCli, environmentId, workRoot);
    assertRemoteInventory(report.remoteInventory);
    for (const item of report.functions) {
      const destination = path.join(workRoot, 'before', item.name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      try {
        runTcb(tcbCli, ['fn', 'code', 'download', item.name, destination, '--env-id', environmentId], workRoot);
        const root = fs.existsSync(path.join(destination, 'index.js')) ? destination : path.join(destination, item.name);
        item.remoteBefore = auditRemoteSnapshot(item, root, path.join(workRoot, 'staged', item.name));
        console.log(`REMOTE_BASELINE=${item.name} missing=${item.remoteBefore.missingFiles.length} changed=${item.remoteBefore.changedFiles.length}`);
      } catch (error) { item.remoteBefore = { error: error.message }; report.passed = false; }
      writeJson(path.join(workRoot, 'audit.json'), report);
    }
  }
  console.log(`DRY_RUN_ARTIFACT_AUDIT=${report.passed ? 'PASS' : 'FAIL'}`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}

module.exports = { auditAll, compareRemoteFiles };
