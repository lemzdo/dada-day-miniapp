'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const SCRIPT_PATH = path.join(__dirname, 'run-sport-windows-acceptance.ps1');
const CMD_PATH = path.join(__dirname, 'run-sport-windows-acceptance.cmd');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function writePowerShellUtf8(file, content) {
  fs.writeFileSync(file, Buffer.concat([UTF8_BOM, Buffer.from(content, 'utf8')]));
}

test('one-click Sport entry passes discovery, HWND, evidence, provider, and exit status', () => {
  const script = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const cmd = fs.readFileSync(CMD_PATH, 'utf8');
  assert.equal(script.charCodeAt(0), 0xfeff, 'PowerShell entry must be UTF-8 BOM');
  assert.match(script, /Resolve-Path \(Join-Path \$scriptRoot/);
  assert.match(script, /ValueFromRemainingArguments/);
  assert.match(script, /runner-preflight-resolver\.cjs/);
  assert.match(script, /Get-NetTCPConnection -State Listen -LocalPort \$port/);
  assert.match(script, /@\(52849, 9420\)/);
  assert.match(script, /Invoke-CaptureHelperJson -Arguments @\('-Discover'\)/);
  assert.match(script, /Assert-PrimaryScreenPng/);
  assert.match(script, /-WindowHandle', \[string\]\$windowHandle/);
  assert.match(script, /\$env:EVIDENCE_DIR = \$evidenceDir/);
  assert.match(script, /\$env:D1D_DEVTOOLS_HWND = \[string\]\$windowHandle/);
  assert.match(script, /\$env:SCREENSHOT_PROVIDER = 'windows-native-primary-screen'/);
  assert.match(script, /\$env:CAPTURE_PRESENTATION_EVIDENCE = 'true'/);
  assert.match(script, /D1D_RUNNER_RESOLVED_CONFIG_JSON/);
  assert.match(script, /MINIPROGRAM_AUTOMATOR_PATH = \[string\]\$resolvedConfig\.automatorModulePath/);
  assert.match(script, /Invoke-RunnerResolverJson/);
  assert.match(script, /\$RunnerArguments/);
  assert.match(script, /AllowEmptyCollection/);
  assert.match(script, /Normalize-RunnerArguments/);
  assert.match(script, /EVIDENCE_ONLY = \$null/);
  assert.match(script, /D1D_RUNNER_RESOLVED_CONFIG_JSON = \$null/);
  assert.match(script, /keyFileHashes/);
  assert.match(script, /\$runnerExitCode = \$LASTEXITCODE/);
  assert.match(script, /errors\.jsonl/);
  assert.match(script, /exit \$exitCode/);
  assert.match(cmd, /run-sport-windows-acceptance\.ps1/);
  assert.match(cmd, /pause/);
  assert.match(cmd, /exit \/b %EXIT_CODE%/);
});

test('absolute one-click cmd launch is independent from the current working directory', { skip: process.platform !== 'win32' }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-one-click-cwd-'));
  const entryDir = path.join(tempDir, 'entry folder');
  const externalCwd = path.join(tempDir, 'external cwd');
  const copiedCmd = path.join(entryDir, path.basename(CMD_PATH));
  const stubScript = path.join(entryDir, path.basename(SCRIPT_PATH));
  const probePath = path.join(tempDir, 'probe.json');
  fs.mkdirSync(entryDir, { recursive: true });
  fs.mkdirSync(externalCwd, { recursive: true });
  fs.copyFileSync(CMD_PATH, copiedCmd);
  writePowerShellUtf8(stubScript, [
    'param([string]$Marker)',
    "$ErrorActionPreference = 'Stop'",
    '$payload = [ordered]@{',
    '  scriptPath = $MyInvocation.MyCommand.Path',
    '  currentDirectory = (Get-Location).Path',
    '  marker = $Marker',
    '}',
    '[IO.File]::WriteAllText($env:D1D_CMD_CWD_PROBE, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))',
    'exit 23',
  ].join('\r\n') + '\r\n');

  try {
    const result = childProcess.spawnSync(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/c',
      copiedCmd,
      'probe-value',
    ], {
      cwd: externalCwd,
      encoding: 'utf8',
      env: { ...process.env, D1D_CMD_CWD_PROBE: probePath },
      input: '\r\n',
      timeout: 30000,
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 23, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(fs.existsSync(probePath), 'cmd must invoke the PowerShell script beside itself');
    const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
    assert.equal(path.resolve(probe.scriptPath).toLowerCase(), path.resolve(stubScript).toLowerCase());
    assert.equal(path.resolve(probe.currentDirectory).toLowerCase(), path.resolve(externalCwd).toLowerCase());
    assert.equal(probe.marker, 'probe-value');
    assert.match(result.stdout, /SPORT WINDOWS ACCEPTANCE: FAIL \(exit 23\)/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
