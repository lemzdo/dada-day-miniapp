'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkArtifactContract } = require('./check-recommendation-artifacts');
const {
  generateOutfitSource,
  recommendationStreamSource,
  stageGenerateOutfit,
  stageRecommendationStream,
} = require('./stage-recommendation-artifacts');

const DEFAULT_ENVIRONMENT_ID = 'cloud1-d8gl3k1vkdf0b7f05';
const CONTRACT_VERSION = 'cloudbase-artifact-root-v1';
const SUPPORTED_FUNCTIONS = Object.freeze(['generateOutfit', 'recommendationStream']);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const cloudfunctionsRoot = path.resolve(__dirname, '..', 'cloudfunctions');

const adapters = Object.freeze({
  generateOutfit: Object.freeze({ assemble: stageGenerateOutfit, httpFunction: false }),
  recommendationStream: Object.freeze({ assemble: stageRecommendationStream, httpFunction: true }),
});

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
    } else if (value === 'all') {
      options.functions.push(...SUPPORTED_FUNCTIONS);
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
    || resolved === path.resolve(recommendationStreamSource)) {
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
    'apps/miniapp/cloudfunctions/generateOutfit',
    'apps/miniapp/cloudfunctions/recommendationStream',
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
  const isDeploy = args[0] === 'fn' && args[1] === 'deploy';
  const result = spawnSync(process.execPath, [tcbCli, ...args], {
    cwd,
    encoding: 'utf8',
    input: isDeploy ? '\n' : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tcb ${args.join(' ')} failed with exit code ${result.status}`);
  if (isDeploy && !/(?:云函数(?:部署|更新)成功|function\s+(?:deployed|updated)\s+successfully)/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error('tcb deploy exited without a positive deployment-success marker');
  }
  return result;
}

function buildDeployArgs(name, environmentId) {
  const args = [
    'fn', 'deploy', name,
    '--env-id', environmentId,
    '--dir', '.',
    '--deployMode', 'cos',
    '--install-dependency', 'true',
    '--force',
  ];
  if (adapters[name].httpFunction) args.push('--httpFn');
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
  console.log(`${scope}_SYMLINK_JUNCTIONS=${JSON.stringify(report.links)}`);
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
  const deploymentMarker = `canonical-deploy-${Date.now()}-${process.pid}`;

  try {
    console.log(`DEPLOYMENT_CONTRACT=${CONTRACT_VERSION}`);
    console.log(`DEPLOYMENT_FUNCTION=${name}`);
    adapter.assemble(artifactRoot, { deploymentMarker });
    assertArtifactRoot(name, artifactRoot);
    const localGate = checkArtifactContract(name, artifactRoot);
    if (!localGate.passed) throw new Error(`${name} local artifact gate failed: ${JSON.stringify(localGate)}`);
    printGate(`${machineName(name)}_LOCAL`, localGate);

    const deployArgs = buildDeployArgs(name, environmentId);
    if (deployArgs.includes(path.resolve(generateOutfitSource)) || deployArgs.includes(path.resolve(recommendationStreamSource))) {
      throw new Error('SOURCE_DIRECTORY_DEPLOY_FORBIDDEN');
    }
    console.log(`ARTIFACT_ROOT_DEPLOY=${artifactRoot}`);
    runner(tcbCli, deployArgs, artifactRoot);
    console.log(`${machineName(name)}_CLI_UPLOAD=PASS`);

    fs.mkdirSync(path.dirname(remoteDestination), { recursive: true });
    runner(tcbCli, ['fn', 'code', 'download', name, remoteDestination, '--env-id', environmentId], workRoot);
    const remoteRoot = resolveDownloadedArtifact(remoteDestination, name);
    const remoteGate = checkArtifactContract(name, remoteRoot, {
      expectedManifestSha256: localGate.manifestSha256,
    });
    if (!remoteGate.passed) throw new Error(`${name} remote artifact gate failed: ${JSON.stringify(remoteGate)}`);
    printGate(`${machineName(name)}_REMOTE`, remoteGate);
    console.log(`REMOTE_ARTIFACT_VERIFIED=${name}`);
    return { name, localGate, remoteGate, deployArgs, artifactRoot };
  } finally {
    if (ownsWorkRoot) fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assertCleanRuntimeSources();
  const tcbCli = resolveTcbCli(options.tcbCli);
  const reports = [];
  for (const name of options.functions) {
    reports.push(deployFunction(name, { environmentId: options.environmentId, tcbCli }));
  }
  console.log(`DEPLOYMENT_SUCCESS=${reports.map((report) => report.name).join(',')}`);
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
};
