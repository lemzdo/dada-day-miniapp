'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const AUTOMATOR_PACKAGE_NAME = 'miniprogram-automator';
const AUTOMATOR_VERSION = '0.12.1';
const AUTOMATOR_WS_ENDPOINT = 'ws://127.0.0.1:9420';
const DEVTOOLS_LISTENER_PORTS = Object.freeze([52849, 9420]);
const SCREENSHOT_PROVIDER = 'windows-native-primary-screen';
const PRESENTATION_EVIDENCE_MODE = 'sanitized_v1';
const PRESENTATION_EVIDENCE_VERSION = 'presentation-evidence-v3';
const EXPECTED_CLOUD_BUILD = 'generateOutfit-copy-natural-language-v4-20260811';
const EXPECTED_QA_VERSION = 'qa-batch-audit-v6-1-semantic-presentation';

const SCRIPT_ROOT = __dirname;
const MINIAPP_ROOT = path.resolve(SCRIPT_ROOT, '..');
const REPO_ROOT = path.resolve(SCRIPT_ROOT, '..', '..', '..');

class RunnerConfigError extends Error {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues : [issues];
    super(normalized.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
    this.name = 'RunnerConfigError';
    this.code = 'RUNNER_CONFIG_INVALID';
    this.issues = normalized;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashConfig(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function addIssue(issues, field, code, message, details = {}) {
  issues.push({ field, code, message, details });
}

function readBoolean(env, name, issues) {
  const value = env[name];
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  addIssue(issues, name, 'CONFIG_BOOLEAN_INVALID', `${name} must be exactly true or false`, { value });
  return false;
}

function parseArguments(argv, issues) {
  let preflightOnly = false;
  const normalizedArgv = argv == null ? [] : Array.isArray(argv) ? argv : [argv];
  for (const argument of normalizedArgv) {
    if (typeof argument !== 'string' || argument.length === 0) {
      addIssue(issues, 'argv', 'RUNNER_ARGV_INVALID', 'runner argv must not contain null, undefined, or empty-string arguments', { argument });
      continue;
    }
    if (argument === '--preflight-only') {
      preflightOnly = true;
      continue;
    }
    addIssue(issues, 'argv', 'RUNNER_ARGUMENT_INVALID', `unsupported runner argument: ${argument}`, { argument });
  }
  return { preflightOnly };
}

function normalizePath(value, field, issues) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const unquoted = value.trim().replace(/^"|"$/g, '');
  try {
    return path.normalize(path.resolve(unquoted));
  } catch (caught) {
    addIssue(issues, field, 'CONFIG_PATH_INVALID', `${field} cannot be normalized: ${caught.message || caught}`, { value });
    return null;
  }
}

function packageRootFromValue(value, field, issues) {
  const normalized = normalizePath(value, field, issues);
  if (!normalized) return null;
  let stat = null;
  try { stat = fs.statSync(normalized); } catch {}
  if (stat?.isFile()) {
    if (path.basename(normalized).toLowerCase() === 'package.json') return path.dirname(normalized);
    if (path.basename(path.dirname(normalized)).toLowerCase() === 'out') return path.dirname(path.dirname(normalized));
    addIssue(issues, field, 'AUTOMATOR_PATH_FORMAT_INVALID', 'automator path must be a package directory, package.json, or its out entry', { value: normalized });
    return null;
  }
  return normalized;
}

function resolveAutomatorPackage(env, issues) {
  const supplied = env.MINIPROGRAM_AUTOMATOR_PATH;
  let packageRoot = null;
  let source = 'require.resolve';
  if (supplied !== undefined && supplied.trim() !== '') {
    source = 'MINIPROGRAM_AUTOMATOR_PATH';
    packageRoot = packageRootFromValue(supplied, 'MINIPROGRAM_AUTOMATOR_PATH', issues);
  } else {
    const searchedRoots = [REPO_ROOT, MINIAPP_ROOT];
    for (const searchRoot of searchedRoots) {
      try {
        const packageJsonPath = require.resolve(`${AUTOMATOR_PACKAGE_NAME}/package.json`, { paths: [searchRoot] });
        packageRoot = path.dirname(packageJsonPath);
        break;
      } catch {}
    }
    if (!packageRoot) {
      addIssue(
        issues,
        'MINIPROGRAM_AUTOMATOR_PATH',
        'AUTOMATOR_MODULE_NOT_RESOLVED',
        'miniprogram-automator was not resolved from the repository root or apps/miniapp module paths',
        { packageName: AUTOMATOR_PACKAGE_NAME, searchRoots: searchedRoots },
      );
    }
  }

  const result = {
    packageRoot: packageRoot ? path.normalize(packageRoot) : null,
    source,
    packageJson: null,
    module: null,
    resolvedEntry: null,
  };
  if (!packageRoot) return result;

  const packageJsonPath = path.join(packageRoot, 'package.json');
  try {
    result.packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (caught) {
    addIssue(issues, 'MINIPROGRAM_AUTOMATOR_PATH', 'AUTOMATOR_PACKAGE_JSON_INVALID', `cannot read automator package.json: ${caught.message || caught}`, { packageJsonPath });
    return result;
  }
  if (result.packageJson.name !== AUTOMATOR_PACKAGE_NAME) {
    addIssue(issues, 'MINIPROGRAM_AUTOMATOR_PATH', 'AUTOMATOR_PACKAGE_NAME_INVALID', `expected package ${AUTOMATOR_PACKAGE_NAME}`, { actual: result.packageJson.name, packageJsonPath });
  }
  if (result.packageJson.version !== AUTOMATOR_VERSION) {
    addIssue(issues, 'MINIPROGRAM_AUTOMATOR_PATH', 'AUTOMATOR_PACKAGE_VERSION_INVALID', `expected automator version ${AUTOMATOR_VERSION}`, { actual: result.packageJson.version, packageJsonPath });
  }
  try {
    result.resolvedEntry = require.resolve(packageRoot);
    result.module = require(packageRoot);
  } catch (caught) {
    addIssue(issues, 'MINIPROGRAM_AUTOMATOR_PATH', 'AUTOMATOR_MODULE_UNLOADABLE', `automator package cannot be loaded: ${caught.message || caught}`, { packageRoot });
    return result;
  }
  if (typeof result.module?.connect !== 'function') {
    addIssue(issues, 'MINIPROGRAM_AUTOMATOR_PATH', 'AUTOMATOR_CONNECT_EXPORT_MISSING', 'automator package must export connect()', { exports: Object.keys(result.module || {}) });
  }
  return result;
}

function resolveWindowHandle(env, issues) {
  // Direct automator connectivity is the sole DevTools liveness signal.
  // Window handles are legacy metadata and must never gate acceptance.
  return null;
}

function resolveRunnerConfig({ env = process.env, argv = process.argv.slice(2), preResolvedConfigJson = env.D1D_RUNNER_RESOLVED_CONFIG_JSON } = {}) {
  const issues = [];
  const parsedArguments = parseArguments(argv, issues);
  const legacyPreconditionOnly = readBoolean(env, 'PRECONDITION_ONLY', issues);
  const evidenceOnly = readBoolean(env, 'EVIDENCE_ONLY', issues) || readBoolean(env, 'PRESENTATION_EVIDENCE_ONLY', issues);
  const capturePresentationEvidence = readBoolean(env, 'CAPTURE_PRESENTATION_EVIDENCE', issues);
  const preflightOnly = parsedArguments.preflightOnly || legacyPreconditionOnly;
  const evidenceDir = normalizePath(env.EVIDENCE_DIR, 'EVIDENCE_DIR', issues);
  if (!evidenceDir) addIssue(issues, 'EVIDENCE_DIR', 'EVIDENCE_DIR_REQUIRED', 'EVIDENCE_DIR is required before the runner starts');
  const windowHandle = resolveWindowHandle(env, issues);
  const screenshotProvider = env.SCREENSHOT_PROVIDER?.trim() || SCREENSHOT_PROVIDER;
  if (screenshotProvider !== SCREENSHOT_PROVIDER) {
    addIssue(issues, 'SCREENSHOT_PROVIDER', 'SCREENSHOT_PROVIDER_INVALID', `SCREENSHOT_PROVIDER must be ${SCREENSHOT_PROVIDER}`, { value: screenshotProvider });
  }
  const automatorWsEndpoint = env.AUTOMATOR_WS_ENDPOINT?.trim() || AUTOMATOR_WS_ENDPOINT;
  if (automatorWsEndpoint !== AUTOMATOR_WS_ENDPOINT) {
    addIssue(issues, 'AUTOMATOR_WS_ENDPOINT', 'AUTOMATOR_ENDPOINT_INVALID', `AUTOMATOR_WS_ENDPOINT must be ${AUTOMATOR_WS_ENDPOINT}`, { value: automatorWsEndpoint });
  }
  if (preflightOnly && evidenceOnly) addIssue(issues, 'mode', 'PREFLIGHT_MODE_CONFLICT', '--preflight-only cannot be combined with evidence-only mode');
  if (preflightOnly && !capturePresentationEvidence) {
    addIssue(issues, 'CAPTURE_PRESENTATION_EVIDENCE', 'PREFLIGHT_CAPTURE_REQUIRED', 'preflight requires CAPTURE_PRESENTATION_EVIDENCE=true');
  }

  const automator = resolveAutomatorPackage(env, issues);
  const captureHelper = path.join(SCRIPT_ROOT, 'windows-devtools-capture.ps1');
  const runner = path.join(SCRIPT_ROOT, 'recommendation-v6-e2e.cjs');
  for (const [field, file] of [['captureHelper', captureHelper], ['runner', runner]]) {
    if (!fs.existsSync(file)) addIssue(issues, field, 'RUNNER_PATH_MISSING', `${field} does not exist`, { file });
  }

  const withoutEnvelope = {
    schemaVersion: 'd1d-runner-resolved-config-v1',
    repoRoot: REPO_ROOT,
    miniappRoot: MINIAPP_ROOT,
    scriptRoot: SCRIPT_ROOT,
    evidenceDir,
    automatorModulePath: automator.packageRoot,
    automatorPackageName: automator.packageJson?.name || null,
    automatorVersion: automator.packageJson?.version || null,
    automatorResolvedEntry: automator.resolvedEntry,
    automatorWsEndpoint,
    devtoolsListenerPorts: DEVTOOLS_LISTENER_PORTS,
    windowHandle,
    screenshotProvider,
    capturePresentationEvidence,
    evidenceOnly,
    preflightOnly,
    captureHelper,
    runner,
    contracts: {
      todayPagePath: 'pages/today/index',
      todayRelaunchUrl: '/pages/today/index',
      initialScene: 'sport',
      initialSlot: 'initial',
      expectedCloudBuild: EXPECTED_CLOUD_BUILD,
      expectedQaVersion: EXPECTED_QA_VERSION,
      presentationEvidenceMode: PRESENTATION_EVIDENCE_MODE,
      presentationEvidenceVersion: PRESENTATION_EVIDENCE_VERSION,
    },
  };
  const config = { ...withoutEnvelope, configHash: hashConfig(withoutEnvelope) };

  if (preResolvedConfigJson) {
    let envelope;
    try { envelope = JSON.parse(preResolvedConfigJson); } catch (caught) {
      addIssue(issues, 'D1D_RUNNER_RESOLVED_CONFIG_JSON', 'RESOLVED_CONFIG_JSON_INVALID', `resolved config JSON is invalid: ${caught.message || caught}`);
    }
    if (envelope) {
      const envelopeCopy = { ...envelope };
      delete envelopeCopy.configHash;
      if (envelope.configHash !== hashConfig(envelopeCopy)) {
        addIssue(issues, 'D1D_RUNNER_RESOLVED_CONFIG_JSON', 'RESOLVED_CONFIG_HASH_INVALID', 'resolved config hash does not match its contents');
      }
      if (envelope.configHash !== config.configHash) {
        addIssue(issues, 'D1D_RUNNER_RESOLVED_CONFIG_JSON', 'RESOLVED_CONFIG_MISMATCH', 'runner did not receive the same normalized config produced by the entrypoint', { entrypointHash: envelope.configHash, runnerHash: config.configHash });
      }
    }
  }

  if (issues.length > 0) throw new RunnerConfigError(issues);
  return config;
}

function runCli() {
  try {
    const config = resolveRunnerConfig({ argv: process.argv.slice(2) });
    process.stdout.write(`${JSON.stringify({ ok: true, config })}\n`);
    return 0;
  } catch (caught) {
    const payload = {
      ok: false,
      code: caught.code || 'RUNNER_CONFIG_INVALID',
      message: caught.message || String(caught),
      issues: caught.issues || [{ code: 'RUNNER_CONFIG_INVALID', message: caught.message || String(caught) }],
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return 2;
  }
}

module.exports = {
  AUTOMATOR_PACKAGE_NAME,
  AUTOMATOR_VERSION,
  AUTOMATOR_WS_ENDPOINT,
  DEVTOOLS_LISTENER_PORTS,
  SCREENSHOT_PROVIDER,
  RunnerConfigError,
  hashConfig,
  resolveRunnerConfig,
  stableStringify,
};

if (require.main === module) process.exitCode = runCli();
