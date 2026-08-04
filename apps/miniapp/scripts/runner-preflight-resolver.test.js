'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'runner-preflight.manifest.json'), 'utf8'));
const resolver = require('./runner-preflight-resolver.cjs');

function validEnv(evidenceDir, overrides = {}) {
  return {
    EVIDENCE_DIR: evidenceDir,
    D1D_DEVTOOLS_HWND: '12345',
    SCREENSHOT_PROVIDER: 'windows-native-primary-screen',
    CAPTURE_PRESENTATION_EVIDENCE: 'true',
    ...overrides,
  };
}

test('cleared custom automator env resolves from repository module paths', () => {
  const evidenceDir = path.join(os.tmpdir(), 'd1d resolver auto evidence');
  const config = resolver.resolveRunnerConfig({
    env: validEnv(evidenceDir),
    argv: ['--preflight-only'],
  });
  assert.equal(config.automatorPackageName, 'miniprogram-automator');
  assert.equal(config.automatorVersion, '0.12.1');
  assert.equal(path.basename(config.automatorModulePath), 'miniprogram-automator');
  assert.equal(config.preflightOnly, true);
  assert.match(config.configHash, /^[a-f0-9]{64}$/);
});

test('explicit package.json and out entry normalize to the package directory', () => {
  const auto = resolver.resolveRunnerConfig({ env: validEnv(path.join(os.tmpdir(), 'd1d resolver explicit')), argv: [] });
  const packageJson = path.join(auto.automatorModulePath, 'package.json');
  const outEntry = auto.automatorResolvedEntry;
  for (const supplied of [auto.automatorModulePath, packageJson, outEntry]) {
    const config = resolver.resolveRunnerConfig({
      env: validEnv(path.join(os.tmpdir(), 'd1d resolver explicit evidence'), { MINIPROGRAM_AUTOMATOR_PATH: supplied }),
      argv: [],
    });
    assert.equal(config.automatorModulePath, auto.automatorModulePath);
  }
});

test('formal no-argument mode normalizes to a real empty argv and cannot accept empty strings', () => {
  const noArguments = resolver.resolveRunnerConfig({
    env: validEnv(path.join(os.tmpdir(), 'd1d resolver no arguments')), argv: null,
  });
  assert.equal(noArguments.preflightOnly, false);
  assert.throws(() => resolver.resolveRunnerConfig({
    env: validEnv(path.join(os.tmpdir(), 'd1d resolver empty argument')), argv: [''],
  }), (caught) => caught.issues.some((issue) => issue.code === 'RUNNER_ARGV_INVALID'));
});

test('invalid external values are aggregated before any connection attempt', () => {
  assert.throws(() => resolver.resolveRunnerConfig({
    env: validEnv(path.join(os.tmpdir(), 'd1d resolver invalid'), {
      MINIPROGRAM_AUTOMATOR_PATH: path.join(os.tmpdir(), 'missing automator'),
      D1D_DEVTOOLS_HWND: 'bad',
      SCREENSHOT_PROVIDER: 'wrong',
      CAPTURE_PRESENTATION_EVIDENCE: 'yes',
    }),
    argv: ['--preflight-only', '--unsupported'],
  }), (caught) => {
    assert.equal(caught.code, 'RUNNER_CONFIG_INVALID');
    const codes = caught.issues.map((issue) => issue.code);
    assert.ok(codes.includes('RUNNER_ARGUMENT_INVALID'));
    assert.ok(codes.includes('WINDOW_HANDLE_INVALID'));
    assert.ok(codes.includes('SCREENSHOT_PROVIDER_INVALID'));
    assert.ok(codes.includes('CONFIG_BOOLEAN_INVALID'));
    assert.ok(codes.includes('AUTOMATOR_PACKAGE_JSON_INVALID'));
    return true;
  });
});

test('entrypoint envelope must be identical in the runner child process', () => {
  const base = resolver.resolveRunnerConfig({ env: validEnv(path.join(os.tmpdir(), 'd1d resolver envelope')), argv: ['--preflight-only'] });
  const serialized = JSON.stringify(base);
  const same = resolver.resolveRunnerConfig({
    env: validEnv(base.evidenceDir, { MINIPROGRAM_AUTOMATOR_PATH: base.automatorModulePath, D1D_RUNNER_RESOLVED_CONFIG_JSON: serialized }),
    argv: ['--preflight-only'],
  });
  assert.equal(same.configHash, base.configHash);
  assert.throws(() => resolver.resolveRunnerConfig({
    env: validEnv(base.evidenceDir, { MINIPROGRAM_AUTOMATOR_PATH: base.automatorModulePath, D1D_RUNNER_RESOLVED_CONFIG_JSON: JSON.stringify({ ...base, windowHandle: '99999' }) }),
    argv: ['--preflight-only'],
  }), (caught) => caught.issues.some((issue) => issue.code === 'RESOLVED_CONFIG_HASH_INVALID' || issue.code === 'RESOLVED_CONFIG_MISMATCH'));
});

test('manifest enumerates every required configuration domain used by preflight', () => {
  const required = manifest.requiredConfigurationFromCurrentCode;
  for (const key of ['evidenceDir', 'automatorModule', 'devtools', 'window', 'screenshot', 'captureHook', 'mode', 'contracts', 'runnerMethods']) {
    assert.ok(required[key], key);
  }
  assert.deepEqual(required.devtools.listenerPorts, [52849, 9420]);
  assert.equal(required.automatorModule.historicalVersion, '0.12.1');
  assert.equal(required.screenshot.requiredValue, 'windows-native-primary-screen');
});
