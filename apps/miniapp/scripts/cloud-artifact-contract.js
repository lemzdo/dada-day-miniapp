'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const catalog = require('./cloud-function-manifests.json');
const legacy = require('./stage-recommendation-artifacts');
const { checkArtifactContract: checkLegacyContract, findLinks, verifyManifestIntegrity } = require('./check-recommendation-artifacts');
const { auditDependencies, declarationsFor, filesIn, inside, relative } = require('./cloud-dependency-audit');

const CONTRACT_VERSION = catalog.version;
const repoRoot = path.resolve(__dirname, '../../..');
const cloudfunctionsRoot = path.join(repoRoot, 'apps/miniapp/cloudfunctions');
const ALL_FUNCTIONS = Object.freeze(Object.keys(catalog.functions));
const PRODUCTION_FUNCTIONS = Object.freeze(ALL_FUNCTIONS.filter((name) => catalog.functions[name].production));

function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function assertInventory() {
  const directories = fs.readdirSync(cloudfunctionsRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name);
  const unknown = directories.filter((name) => !ALL_FUNCTIONS.includes(name) && !catalog.sharedDirectories.includes(name));
  const absent = ALL_FUNCTIONS.filter((name) => !directories.includes(name));
  if (unknown.length || absent.length) throw new Error(`MANIFEST_INVENTORY_MISMATCH: ${JSON.stringify({ unknown, absent })}`);
  for (const [name, spec] of Object.entries(catalog.functions)) {
    if (!['event', 'http-handler', 'http-server'].includes(spec.kind) || typeof spec.production !== 'boolean'
      || (spec.legacyAdapter && typeof legacy[spec.legacyAdapter] !== 'function')
      || (spec.nestedFunction && !catalog.functions[spec.nestedFunction])
      || (spec.dynamicProfile && !catalog.dynamicProfiles[spec.dynamicProfile])) throw new Error(`INVALID_FUNCTION_MANIFEST: ${name}`);
  }
  return { functions: ALL_FUNCTIONS, production: PRODUCTION_FUNCTIONS, sharedDirectories: catalog.sharedDirectories, remoteOnlyExclusions: catalog.remoteOnlyExclusions };
}

function assertDestination(destination) {
  const resolved = path.resolve(destination);
  if (inside(cloudfunctionsRoot, resolved) || inside(resolved, cloudfunctionsRoot)
    || inside(path.join(repoRoot, 'packages'), resolved) || inside(resolved, path.join(repoRoot, 'packages'))
    || resolved === path.parse(resolved).root || resolved === os.homedir()) throw new Error(`SOURCE_DIRECTORY_DEPLOY_FORBIDDEN: ${resolved}`);
  // Never recursively replace an arbitrary user-provided directory.
  if (fs.existsSync(resolved) && fs.readdirSync(resolved).length) throw new Error(`ARTIFACT_DESTINATION_NOT_EMPTY: ${resolved}`);
  for (let parent = resolved; parent !== path.dirname(parent); parent = path.dirname(parent)) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN: ${parent}`);
  }
  return resolved;
}

function copy(from, to) {
  if (fs.lstatSync(from).isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN: ${from}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function requiredFiles(name) {
  const spec = catalog.functions[name];
  return ['index.js', 'package.json', ...(spec.requiredFiles || []), ...(spec.vendors || []).flatMap((vendor) => [`vendor/${vendor}/package.json`, `vendor/${vendor}/src/index.js`])];
}

function stageCloudFunction(name, destination) {
  const spec = catalog.functions[name];
  if (!spec) throw new Error(`MANIFEST_MISSING: ${name}`);
  const root = assertDestination(destination);
  const source = path.join(cloudfunctionsRoot, name);
  const sourceAudit = auditDependencies(name, source, { source: true });
  if (sourceAudit.missingFiles.length) throw new Error(`SOURCE_CLOSURE_FAILED: ${JSON.stringify(sourceAudit)}`);
  fs.mkdirSync(root, { recursive: true });
  if (spec.legacyAdapter) {
    legacy[spec.legacyAdapter](root);
  } else {
    for (const file of [...new Set([...sourceAudit.files, ...requiredFiles(name).filter((file) => !file.startsWith('vendor/'))])]) copy(path.join(source, file), path.join(root, file));
    const metadata = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    for (const vendor of spec.vendors || []) {
      const vendorSource = path.join(repoRoot, 'packages', vendor);
      const vendorMetadata = JSON.parse(fs.readFileSync(path.join(vendorSource, 'package.json'), 'utf8'));
      metadata.dependencies[vendorMetadata.name] = `file:vendor/${vendor}`;
      for (const file of filesIn(vendorSource)) {
        const rel = relative(vendorSource, file);
        if (rel === 'package.json' || (rel.startsWith('src/') && !rel.endsWith('.test.js'))) copy(file, path.join(root, 'vendor', vendor, rel));
      }
    }
    writeJson(path.join(root, 'package.json'), metadata);
  }
  const audit = auditDependencies(name, root, { allFiles: true });
  if (audit.missingFiles.length) throw new Error(`ARTIFACT_CLOSURE_FAILED: ${JSON.stringify(audit)}`);
  const files = filesIn(root).filter((file) => file !== path.join(root, 'artifact-manifest.json')).map((file) => ({ path: relative(root, file), bytes: fs.statSync(file).size, sha256: hash(file) }));
  const runtimeDependencies = audit.files;
  const manifest = {
    version: CONTRACT_VERSION, name, functionContract: spec, contractSha256: hash(path.join(__dirname, 'cloud-function-manifests.json')),
    runtimeDependencies, runtimeDependencyCount: runtimeDependencies.length,
    refreshRoots: [...new Set(files.map((file) => file.path.split('/')[0]))].sort(),
    dynamicDependencies: audit.dynamicDependencies, externalDependencies: audit.externalDependencies,
    requiredFiles: requiredFiles(name), files,
  };
  writeJson(path.join(root, 'artifact-manifest.json'), manifest);
  return manifest;
}

function isolatedBoot(name, root) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `d1d-v2-${name}-`));
  const isolated = path.join(parent, 'artifact');
  try {
    fs.cpSync(root, isolated, { recursive: true, filter: (file) => !relative(root, file).split('/').includes('node_modules') });
    const result = spawnSync(process.execPath, [path.join(__dirname, 'cloud-artifact-boot.js')], {
      cwd: isolated, encoding: 'utf8', timeout: 30000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), NODE_PATH: '' },
    });
    const marker = result.stdout?.split(/\r?\n/).find((line) => line.startsWith('ARTIFACT_BOOT_RESULT='));
    if (result.status !== 0 || !marker) throw new Error(`ISOLATED_BOOT_FAILED: ${name}: ${result.error?.message || result.stderr || result.stdout}`);
    return JSON.parse(marker.slice('ARTIFACT_BOOT_RESULT='.length));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}

function checkCloudArtifact(name, artifactRoot, options = {}) {
  const root = path.resolve(artifactRoot), spec = catalog.functions[name];
  if (!spec) throw new Error(`MANIFEST_MISSING: ${name}`);
  const links = findLinks(root);
  if (links.length) throw new Error(`SYMLINK_FORBIDDEN: ${JSON.stringify(links)}`);
  const { manifest, manifestSha256 } = verifyManifestIntegrity(name, root, options.expectedManifestSha256);
  if (manifest.version !== CONTRACT_VERSION || manifest.contractSha256 !== hash(path.join(__dirname, 'cloud-function-manifests.json'))
    || JSON.stringify(manifest.functionContract) !== JSON.stringify(spec)) throw new Error('ARTIFACT_CONTRACT_MISMATCH');
  const requiredFilesMissing = requiredFiles(name).filter((file) => !fs.existsSync(path.join(root, file)));
  const audit = auditDependencies(name, root, { allFiles: true });
  const expectedPaths = new Set(manifest.files.map((file) => file.path));
  const unexpectedFiles = filesIn(root).map((file) => relative(root, file)).filter((file) => !expectedPaths.has(file) && file !== 'artifact-manifest.json' && file !== 'package-lock.json');
  const missingDependencies = [...audit.missingFiles, ...requiredFilesMissing.map((file) => ({ file, reason: 'REQUIRED_FILE_MISSING' }))];
  if (missingDependencies.length || unexpectedFiles.length) throw new Error(`ARTIFACT_CLOSURE_FAILED: ${JSON.stringify({ missingDependencies, unexpectedFiles })}`);
  // Rebuild canonical source to verify ALL nested/runtime/vendor bytes, including
  // dormant modules. A self-consistent stale manifest must never pass this gate.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-v2-canonical-'));
  let canonicalDrift;
  try {
    const canonical = stageCloudFunction(name, path.join(temp, name));
    const actualFiles = new Map(manifest.files.map((file) => [file.path, file.sha256]));
    canonicalDrift = canonical.files.filter((file) => actualFiles.get(file.path) !== file.sha256).map((file) => file.path);
    canonicalDrift.push(...manifest.files.filter((file) => !canonical.files.some((item) => item.path === file.path)).map((file) => file.path));
    if (JSON.stringify(manifest.runtimeDependencies) !== JSON.stringify(canonical.runtimeDependencies)
      || JSON.stringify(manifest.dynamicDependencies) !== JSON.stringify(canonical.dynamicDependencies)
      || JSON.stringify(manifest.externalDependencies) !== JSON.stringify(canonical.externalDependencies)) throw new Error('DEPENDENCY_MANIFEST_MISMATCH');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  if (canonicalDrift.length) throw new Error(`CANONICAL_ARTIFACT_DRIFT: ${JSON.stringify(canonicalDrift)}`);
  if (spec.legacyAdapter) {
    const legacyGate = checkLegacyContract(name, root);
    if (!legacyGate.passed) throw new Error(`LEGACY_ARTIFACT_CONTRACT_FAILED: ${JSON.stringify(legacyGate)}`);
  }
  const boot = isolatedBoot(name, root);
  const installedDependencies = options.verifyInstalledDependencies ? verifyInstalledDependencies(root, audit.externalDependencies) : null;
  return { name, passed: true, missingDependencies, requiredFilesMissing, isolatedBoot: boot.passed,
    boot, manifestSha256, manifestIntegrity: true, links, embeddedRuntimeDrift: canonicalDrift,
    dynamicDependencies: audit.dynamicDependencies, artifactDependencyCount: audit.files.length, installedDependencies };
}

function verifyInstalledDependencies(root, dependencies) {
  const checked = new Set(), resolved = [], failures = [];
  for (const item of dependencies) {
    if (item.version?.startsWith('file:')) continue; // Canonical vendor + dynamic fallback already verified.
    const key = `${item.importer}:${item.request}`;
    if (checked.has(key)) continue;
    checked.add(key);
    try {
      const file = Module.createRequire(path.join(root, item.importer)).resolve(item.request);
      if (!inside(fs.realpathSync(root), fs.realpathSync(file))) throw new Error('OUTSIDE_ARTIFACT_ROOT');
      resolved.push({ importer: item.importer, request: item.request, file: relative(root, file) });
    } catch (error) { failures.push({ importer: item.importer, request: item.request, error: error.code || error.message }); }
  }
  if (failures.length) throw new Error(`REMOTE_INSTALLED_DEPENDENCIES_FAILED: ${JSON.stringify(failures)}`);
  return { passed: true, resolved };
}

module.exports = { ALL_FUNCTIONS, CONTRACT_VERSION, PRODUCTION_FUNCTIONS, assertDestination, assertInventory, catalog, checkCloudArtifact, cloudfunctionsRoot, declarationsFor, hash, isolatedBoot, requiredFiles, stageCloudFunction, verifyInstalledDependencies, writeJson };
