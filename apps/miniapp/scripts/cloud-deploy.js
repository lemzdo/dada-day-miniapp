'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  ALL_FUNCTIONS, CONTRACT_VERSION, PRODUCTION_FUNCTIONS, assertInventory, catalog,
  checkCloudArtifact: checkArtifactContract, stageCloudFunction, writeJson,
} = require('./cloud-artifact-contract');
const {
  generateOutfitSource,
  processUploadImageSource,
  recommendationStreamSource,
} = require('./stage-recommendation-artifacts');

const DEFAULT_ENVIRONMENT_ID = 'cloud1-d8gl3k1vkdf0b7f05';
const SUPPORTED_FUNCTIONS = ALL_FUNCTIONS;
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const cloudfunctionsRoot = path.resolve(__dirname, '..', 'cloudfunctions');

const adapters = Object.freeze(Object.fromEntries(SUPPORTED_FUNCTIONS.map((name) => [name, Object.freeze({
  assemble: (destination) => stageCloudFunction(name, destination),
  httpFunction: catalog.functions[name].kind.startsWith('http'),
  nestedCopyRisk: !!catalog.functions[name].nestedFunction,
})])));

function parseArgs(argv) {
  const options = { environmentId: process.env.CLOUDBASE_ENV_ID || DEFAULT_ENVIRONMENT_ID, functions: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--env-id') {
      options.environmentId = argv[index + 1];
      index += 1;
    } else if (value === '--tcb-cli') {
      options.tcbCli = argv[index + 1];
      index += 1;
    } else if (value === '--output') {
      options.output = argv[++index];
      if (!options.output || options.output.startsWith('--')) throw new Error('--output requires a directory');
    } else if (value === '--dry-run') {
      options.dryRun = true;
    } else if (value === '--verify-only') {
      options.verifyOnly = true;
    } else if (value === 'all-functions') {
      options.functions.push(...SUPPORTED_FUNCTIONS);
    } else if (value === 'all') {
      options.functions.push(...PRODUCTION_FUNCTIONS);
    } else if (SUPPORTED_FUNCTIONS.includes(value)) {
      options.functions.push(value);
    } else {
      throw new Error(`Unsupported argument: ${value || '<empty>'}`);
    }
  }
  options.functions = [...new Set(options.functions)];
  if (options.functions.length === 0) {
    throw new Error(`Usage: pnpm cloud:deploy <${SUPPORTED_FUNCTIONS.join('|')}> [--env-id <envId>]`);
  }
  if (!options.environmentId) throw new Error('CloudBase environment id is required');
  return options;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertArtifactRoot(name, artifactRoot) {
  const resolved = path.resolve(artifactRoot);
  if (isInside(cloudfunctionsRoot, resolved)
    || resolved === path.resolve(generateOutfitSource)
    || resolved === path.resolve(recommendationStreamSource)
    || resolved === path.resolve(processUploadImageSource)) {
    throw new Error(`SOURCE_DIRECTORY_DEPLOY_FORBIDDEN: ${resolved}`);
  }
  if (path.basename(resolved) !== name) throw new Error(`Artifact root basename must be ${name}: ${resolved}`);
  if (!fs.existsSync(path.join(resolved, 'artifact-manifest.json'))) {
    throw new Error(`Artifact root is not assembled: ${resolved}`);
  }
  return resolved;
}

function assertCleanRuntimeSources() {
  const result = spawnSync('git', [
    '-C', repoRoot, 'status', '--porcelain', '--',
    'apps/miniapp/cloudfunctions',
    'packages/ai-core',
    'packages/garment-assets',
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Unable to inspect runtime source state: ${result.stderr || result.stdout}`);
  if (result.stdout.trim()) throw new Error(`Deployment requires clean runtime source trees:\n${result.stdout.trim()}`);
}

function resolveTcbCli(explicitPath = '') {
  if (explicitPath) return path.resolve(explicitPath);
  const packageRoot = path.dirname(require.resolve('@cloudbase/cli/package.json'));
  return path.join(packageRoot, 'bin', 'tcb');
}

function runTcb(tcbCli, args, cwd) {
  if (!fs.existsSync(tcbCli)) throw new Error(`CloudBase CLI is not installed: ${tcbCli}`);
  const isDeploy = args[0] === 'fn' && (args[1] === 'deploy' || (args[1] === 'code' && args[2] === 'update'));
  const result = spawnSync(process.execPath, [tcbCli, ...args], {
    cwd,
    encoding: 'utf8',
    input: isDeploy ? '\n' : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout && !args.includes('--json')) process.stdout.write(result.stdout);
  if (result.stderr && (!args.includes('--json') || result.status !== 0)) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tcb ${args.join(' ')} failed with exit code ${result.status}`);
  if (isDeploy && !/(?:云函数(?:部署|更新)成功|函数代码更新成功|function\s+(?:code\s+)?(?:deployed|updated)\s+successfully)/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error('tcb deploy exited without a positive deployment-success marker');
  }
  return result;
}

function buildDeployArgs(name, environmentId) {
  const args = [
    'fn', 'code', 'update', name,
    '--env-id', environmentId,
    '--dir', '.',
    '--deployMode', 'cos',
  ];
  // These functions already exist (inventory gate). Code-only update preserves
  // remote runtime, timeout, memory, environment, triggers and HTTP configuration.
  // CLI 3.8.1 installs package.json dependencies for code updates.
  return args;
}

function resolveDownloadedArtifact(downloadDestination, name) {
  const candidates = [downloadDestination, path.join(downloadDestination, name)];
  const artifact = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'artifact-manifest.json')));
  if (!artifact) throw new Error(`${name} downloaded artifact does not contain artifact-manifest.json`);
  return artifact;
}

function printGate(scope, report) {
  console.log(`${scope}_DEPENDENCY_CLOSURE=${JSON.stringify(report.missingDependencies)}`);
  console.log(`${scope}_REQUIRED_FILES=${report.requiredFilesMissing.length === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`${scope}_ISOLATED_BOOT=${report.isolatedBoot ? 'PASS' : 'FAIL'}`);
  console.log(`${scope}_MANIFEST_HASH_INTEGRITY=${report.manifestIntegrity ? 'PASS' : 'FAIL'}`);
  console.log(`${scope}_EMBEDDED_RUNTIME_DRIFT=${JSON.stringify(report.embeddedRuntimeDrift)}`);
  console.log(`${scope}_SYMLINK_JUNCTIONS=${JSON.stringify(report.links)}`);
  if (report.installedDependencies) console.log(`${scope}_INSTALLED_DEPENDENCIES=${report.installedDependencies.passed ? 'PASS' : 'FAIL'}`);
}

function machineName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function deployFunction(name, options = {}) {
  const adapter = adapters[name];
  if (!adapter) throw new Error(`Unsupported deployment target: ${name}`);
  const environmentId = options.environmentId || DEFAULT_ENVIRONMENT_ID;
  const tcbCli = options.tcbCli || resolveTcbCli();
  const runner = options.runner || runTcb;
  const workRoot = options.workRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-cloud-deploy-'));
  const ownsWorkRoot = !options.workRoot;
  const artifactRoot = path.join(workRoot, 'staged', name);
  const remoteDestination = path.join(workRoot, 'remote', name);

  try {
    console.log(`DEPLOYMENT_CONTRACT=${CONTRACT_VERSION}`);
    console.log(`DEPLOYMENT_FUNCTION=${name}`);
    if (!options.prepared) adapter.assemble(artifactRoot);
    assertArtifactRoot(name, artifactRoot);
    const localGate = checkArtifactContract(name, artifactRoot);
    if (!localGate.passed) throw new Error(`${name} local artifact gate failed: ${JSON.stringify(localGate)}`);
    printGate(`${machineName(name)}_LOCAL`, localGate);

    const deployArgs = buildDeployArgs(name, environmentId);
    if (deployArgs.includes(path.resolve(generateOutfitSource))
      || deployArgs.includes(path.resolve(recommendationStreamSource))
      || deployArgs.includes(path.resolve(processUploadImageSource))) {
      throw new Error('SOURCE_DIRECTORY_DEPLOY_FORBIDDEN');
    }
    console.log(`ARTIFACT_ROOT_DEPLOY=${artifactRoot}`);
    if (!options.verifyOnly) {
      runner(tcbCli, deployArgs, artifactRoot);
      console.log(`${machineName(name)}_CLI_UPLOAD=PASS`);
      waitForRemoteActive(tcbCli, name, environmentId, workRoot, { runner });
    }

    fs.mkdirSync(path.dirname(remoteDestination), { recursive: true });
    runner(tcbCli, ['fn', 'code', 'download', name, remoteDestination, '--env-id', environmentId], workRoot);
    const remoteRoot = resolveDownloadedArtifact(remoteDestination, name);
    const remoteGate = checkArtifactContract(name, remoteRoot, {
      expectedManifestSha256: localGate.manifestSha256,
      verifyInstalledDependencies: options.verifyInstalledDependencies !== false,
    });
    if (!remoteGate.passed) throw new Error(`${name} remote artifact gate failed: ${JSON.stringify(remoteGate)}`);
    printGate(`${machineName(name)}_REMOTE`, remoteGate);
    console.log(`REMOTE_ARTIFACT_VERIFIED=${name}`);
    return { name, environmentId, contractVersion: CONTRACT_VERSION, verifiedAt: new Date().toISOString(), localGate, remoteGate, deployArgs, artifactRoot };
  } finally {
    if (ownsWorkRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assertInventory();
  assertCleanRuntimeSources();
  const workRoot = options.output ? path.resolve(options.output) : fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-cloud-v2-'));
  fs.mkdirSync(workRoot, { recursive: true });
  console.log(`DEPLOYMENT_EVIDENCE=${workRoot}`);
  const preflight = [];
  // Every selected artifact must pass before ANY remote mutation.
  for (const name of options.functions) {
    try {
      const artifactRoot = path.join(workRoot, 'staged', name);
      adapters[name].assemble(artifactRoot);
      const gate = checkArtifactContract(name, artifactRoot);
      preflight.push(gate);
      console.log(`PREFLIGHT_${machineName(name)}=PASS`);
    } catch (error) {
      preflight.push({ name, passed: false, error: error.message });
      console.error(`PREFLIGHT_${machineName(name)}=FAIL ${error.message}`);
    }
  }
  writeJson(path.join(workRoot, 'preflight.json'), preflight);
  if (preflight.some((item) => !item.passed)) throw new Error('FULL_PREFLIGHT_FAILED; no functions deployed');
  if (options.dryRun) { console.log(`DRY_RUN_ARTIFACTS=PASS count=${preflight.length}`); return; }
  const tcbCli = resolveTcbCli(options.tcbCli);
  const inventory = listRemoteFunctions(tcbCli, options.environmentId, workRoot);
  writeJson(path.join(workRoot, 'remote-inventory.json'), inventory);
  assertRemoteInventory(inventory);
  const reports = [];
  for (const name of options.functions) {
    try {
      reports.push(deployFunction(name, { environmentId: options.environmentId, tcbCli, workRoot, prepared: true, verifyOnly: options.verifyOnly }));
      writeJson(path.join(workRoot, 'deployment-report.json'), { version: CONTRACT_VERSION, environmentId: options.environmentId, complete: reports.length === options.functions.length, reports });
    } catch (error) {
      writeJson(path.join(workRoot, 'deployment-report.json'), { version: CONTRACT_VERSION, environmentId: options.environmentId, complete: false, reports, failed: { name, error: error.message } });
      throw error;
    }
  }
  console.log(`DEPLOYMENT_SUCCESS=${reports.map((report) => report.name).join(',')}`);
}

function listRemoteFunctions(tcbCli, environmentId, cwd, runner = runTcb) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const result = runner(tcbCli, ['fn', 'list', '--env-id', environmentId, '--limit', '100', '--offset', String(offset), '--json'], cwd);
    const page = parseTcbJson(result.stdout).data;
    if (!Array.isArray(page)) throw new Error('REMOTE_INVENTORY_INVALID');
    items.push(...page);
    if (page.length < 100) return items;
  }
}

function waitForRemoteActive(tcbCli, name, environmentId, cwd, { runner = runTcb, delayMs = 5000, attempts = 36 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const item = listRemoteFunctions(tcbCli, environmentId, cwd, runner).find((row) => row.name === name);
    if (!item) throw new Error(`REMOTE_FUNCTION_MISSING: ${name}`);
    if (/^(?:Active|Deployment completed|部署完成)$/.test(item.status)) return;
    if (/fail|失败/i.test(item.status)) throw new Error(`REMOTE_UPDATE_FAILED: ${name}: ${item.status}`);
    if (attempt < attempts - 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  }
  throw new Error(`REMOTE_ACTIVE_TIMEOUT: ${name}`);
}

function parseTcbJson(stdout) {
  // CLI progress messages can be written to stdout even with --json.
  const clean = require('node:util').stripVTControlCharacters(stdout);
  const start = clean.search(/^\s*\{\s*$/m);
  if (start < 0) throw new Error('TCB_JSON_RESPONSE_MISSING');
  return JSON.parse(clean.slice(start));
}

function assertRemoteInventory(items) {
  const unknown = items.filter((item) => !SUPPORTED_FUNCTIONS.includes(item.name) && !Object.hasOwn(catalog.remoteOnlyExclusions, item.name));
  const missing = PRODUCTION_FUNCTIONS.filter((name) => !items.some((item) => item.name === name));
  if (unknown.length || missing.length) throw new Error(`REMOTE_INVENTORY_MISMATCH: ${JSON.stringify({ unknown, missing })}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`DEPLOYMENT_FAILED=${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONTRACT_VERSION,
  SUPPORTED_FUNCTIONS,
  adapters,
  assertArtifactRoot,
  buildDeployArgs,
  deployFunction,
  parseArgs,
  resolveDownloadedArtifact,
  assertRemoteInventory,
  listRemoteFunctions,
  resolveTcbCli,
  runTcb,
  parseTcbJson,
  waitForRemoteActive,
};
