'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const HELPER_PATH = path.join(__dirname, 'windows-devtools-capture.ps1');
const RUNTIME_LAUNCHER_PATH = path.join(__dirname, 'windows-devtools-capture-runtime-launcher.test.ps1');
const RUNTIME_ORCHESTRATOR_PATH = path.join(__dirname, 'windows-devtools-capture-runtime-orchestrator.test.ps1');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function writePowerShellUtf8(file, content) {
  fs.writeFileSync(file, Buffer.concat([UTF8_BOM, Buffer.from(content, 'utf8')]));
}

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseLastJsonLine(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      continue;
    }
  }
  throw new Error(`no JSON object found in output:\n${output}`);
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for runtime result: ${file}`);
}

function readEmbeddedCSharp() {
  const source = fs.readFileSync(HELPER_PATH, 'utf8');
  const match = source.match(/Add-Type\s+-TypeDefinition\s+@'\r?\n([\s\S]*?)\r?\n'@/);
  assert.ok(match, 'capture helper must contain a complete Add-Type here-string');
  return match[1];
}

function runCSharpProbe(lines) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-capture-probe-'));
  const scriptPath = path.join(tempDir, 'probe.ps1');
  const csharp = readEmbeddedCSharp();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -TypeDefinition @\'',
    csharp,
    "'@",
    ...lines,
  ].join('\r\n') + '\r\n';
  writePowerShellUtf8(scriptPath, script);

  try {
    return childProcess.execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], { encoding: 'utf8', timeout: 45000, windowsHide: true });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('Windows PowerShell compiles the complete capture helper C# without capturing', { skip: process.platform !== 'win32' }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-capture-compile-'));
  const scriptPath = path.join(tempDir, 'compile-helper.ps1');
  const csharp = readEmbeddedCSharp();
  const compileScript = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -TypeDefinition @\'',
    csharp,
    "'@",
    "Write-Output 'ADD_TYPE_OK'",
  ].join('\r\n') + '\r\n';
  writePowerShellUtf8(scriptPath, compileScript);

  try {
    const stdout = childProcess.execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], { encoding: 'utf8', timeout: 45000, windowsHide: true });
    assert.match(stdout, /ADD_TYPE_OK/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('every production PowerShell D1dWindowCapture call matches a real public static method contract', { skip: process.platform !== 'win32' }, () => {
  const stdout = runCSharpProbe([
    `$helperPath = ${quotePowerShellLiteral(HELPER_PATH)}`,
    '$tokens = $null',
    '$parseErrors = $null',
    '$ast = [Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$tokens, [ref]$parseErrors)',
    'if ($parseErrors.Count -gt 0) { throw ($parseErrors | ForEach-Object Message | Out-String) }',
    '$calls = @($ast.FindAll({',
    '  param($node)',
    '  $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and',
    '    $node.Static -and',
    '    $node.Expression.Extent.Text -eq "[D1dWindowCapture]"',
    '}, $true))',
    'if ($calls.Count -eq 0) { throw "no D1dWindowCapture production calls were extracted" }',
    '$flags = [Reflection.BindingFlags]::Public -bor [Reflection.BindingFlags]::Static',
    '$publicMethods = @([D1dWindowCapture].GetMethods($flags))',
    '$contracts = @()',
    'foreach ($call in $calls) {',
    '  $name = [string]$call.Member.Value',
    '  $arguments = @($call.Arguments | Where-Object { $null -ne $_ })',
    '  $argumentCount = $arguments.Count',
    '  $matches = @($publicMethods | Where-Object { $_.Name -eq $name -and $_.GetParameters().Count -eq $argumentCount })',
    '  if ($matches.Count -ne 1) { throw "call $($call.Extent.Text) resolved to $($matches.Count) public static methods" }',
    '  $method = $matches[0]',
    '  $parameters = @($method.GetParameters())',
    '  $probeArguments = New-Object object[] $parameters.Count',
    '  for ($index = 0; $index -lt $parameters.Count; $index++) {',
    '    $parameterType = $parameters[$index].ParameterType',
    '    $argumentStaticType = $arguments[$index].StaticType',
    '    if ($null -ne $argumentStaticType -and $argumentStaticType -ne [object] -and -not $parameterType.IsAssignableFrom($argumentStaticType)) {',
    '      throw "call $($call.Extent.Text) argument $index static type $($argumentStaticType.FullName) does not match $($parameterType.FullName)"',
    '    }',
    '    if ($parameterType -eq [IntPtr]) { $probeArguments[$index] = [IntPtr]::Zero }',
    '    elseif ($parameterType -eq [string]) { $probeArguments[$index] = [string]::Empty }',
    '    elseif ($parameterType -eq [string[]]) { $probeArguments[$index] = [string[]]@() }',
    '    elseif ($parameterType.IsValueType) { $probeArguments[$index] = [Activator]::CreateInstance($parameterType) }',
    '    else { throw "unsupported production parameter type $($parameterType.FullName) on $name" }',
    '  }',
    '  $cursor = $call.Parent',
    '  $requiresBoolean = $false',
    '  while ($null -ne $cursor -and $cursor -isnot [Management.Automation.Language.StatementBlockAst]) {',
    '    if ($cursor -is [Management.Automation.Language.UnaryExpressionAst] -and $cursor.TokenKind -eq [Management.Automation.Language.TokenKind]::Not) { $requiresBoolean = $true }',
    '    $cursor = $cursor.Parent',
    '  }',
    '  if ($requiresBoolean -and $method.ReturnType -ne [bool]) { throw "boolean call $($call.Extent.Text) returns $($method.ReturnType.FullName)" }',
    '  try { $method.Invoke($null, $probeArguments) | Out-Null }',
    '  catch { throw "runtime reflection invocation failed for $($call.Extent.Text): $($_.Exception.InnerException.Message)" }',
    '  $contracts += [ordered]@{',
    '    call = $call.Extent.Text',
    '    method = $name',
    '    argumentCount = $argumentCount',
    '    parameterTypes = @($parameters | ForEach-Object { $_.ParameterType.FullName })',
    '    returnType = $method.ReturnType.FullName',
    '  }',
    '}',
    '[ordered]@{ callCount = $calls.Count; contracts = $contracts } | ConvertTo-Json -Depth 8 -Compress',
  ]);
  const result = JSON.parse(stdout.trim());
  assert.ok(result.callCount >= 10, 'contract test must cover the complete production call chain');
  assert.equal(result.contracts.length, result.callCount);
  assert.equal(result.contracts.some((contract) => contract.method === 'GetDpiForWindow'), false);
  assert.equal(result.contracts.some((contract) => contract.method === 'GetDpiForSystem'), false);
});

test('dynamic Unicode path matching accepts title=d1d and rejects disallowed window shapes', { skip: process.platform !== 'win32' }, () => {
  const stdout = runCSharpProbe([
    '$install = "C:\\微信开发者工具"',
    '$exe = "C:\\微信开发者工具\\微信开发者工具.exe"',
    '$other = "C:\\其他开发者工具\\微信开发者工具.exe"',
    '$results = @(',
    '  [D1dWindowCapture]::PathsEqual("C:\\微信开发者工具\\", "C:\\微信开发者工具\\.\\"),',
    '  [D1dWindowCapture]::EvaluateWindow($exe, @($install), "d1d", $true, $true, $true, $true, $true, $true),',
    '  [D1dWindowCapture]::EvaluateWindow($other, @($install), "任意标题", $true, $true, $true, $true, $true, $true),',
    '  [D1dWindowCapture]::EvaluateWindow($exe, @($install), "任意标题", $false, $true, $true, $true, $true, $true),',
    '  [D1dWindowCapture]::EvaluateWindow($exe, @($install), "任意标题", $true, $false, $true, $true, $true, $true),',
    '  [D1dWindowCapture]::EvaluateWindow($exe, @($install), "任意标题", $true, $true, $false, $true, $true, $true),',
    '  [D1dWindowCapture]::EvaluateWindow($exe, @($install), "任意标题", $true, $true, $true, $false, $true, $true),',
    '  [D1dWindowCapture]::EvaluateWindow($exe, @($install), "任意标题", $true, $true, $true, $true, $false, $true),',
    '  [D1dWindowCapture]::EvaluateWindow($exe, @($install), "任意标题", $true, $true, $true, $true, $true, $false)',
    ')',
    '$results | ConvertTo-Json -Compress',
  ]);
  const results = JSON.parse(stdout.trim());
  assert.equal(results[0], true);
  assert.equal(results[1].IsCandidate, true);
  assert.deepEqual(results.slice(2).map((result) => result.RejectionReason), [
    'executable-directory-mismatch',
    'window-hidden',
    'child-window',
    'owned-window',
    'tool-window',
    'cloaked-window',
    'invalid-window-rect',
  ]);
});

test('real P/Invoke entries resolve and safe existing-window probes do not change window state', { skip: process.platform !== 'win32' }, () => {
  const stdout = runCSharpProbe([
    '$flags = [Reflection.BindingFlags]::NonPublic -bor [Reflection.BindingFlags]::Static',
    '$imports = @([D1dWindowCapture].GetMethods($flags) | ForEach-Object {',
    '  $attribute = $_.GetCustomAttributes([Runtime.InteropServices.DllImportAttribute], $false)',
    '  if ($attribute.Count -gt 0) { [ordered]@{ method = $_.Name; dll = $attribute[0].Value; entryPoint = $attribute[0].EntryPoint } }',
    '})',
    '$expectedMethods = @("EnumWindows", "IsWindowVisible", "IsWindow", "GetWindow", "GetParent", "GetWindowLongPtr64", "GetWindowLong32", "GetWindowThreadProcessId", "GetWindowText", "GetWindowRect", "DwmGetWindowAttribute", "DwmFlush", "GetForegroundWindow", "ShowWindow", "SetWindowPos", "BringWindowToTop", "SetForegroundWindow", "SetProcessDPIAware", "SetProcessDpiAwarenessContext", "IsIconicNative")',
    'foreach ($name in $expectedMethods) {',
    '  $entry = $imports | Where-Object { $_.method -eq $name }',
    '  if ($null -eq $entry -or [string]::IsNullOrWhiteSpace($entry.entryPoint)) { throw "missing DllImport entry: $name" }',
    '}',
    '$iconicEntry = ($imports | Where-Object { $_.method -eq "IsIconicNative" }).entryPoint',
    'if ($iconicEntry -ne "IsIconic") { throw "IsIconicNative entry point is $iconicEntry" }',
    '[D1dWindowCapture].GetMethod("IsIconicNative", $flags).Invoke($null, @([IntPtr]::Zero)) | Out-Null',
    '[D1dWindowCapture].GetMethod("GetWindow", $flags).Invoke($null, @([IntPtr]::Zero, [uint32]4)) | Out-Null',
    '[D1dWindowCapture].GetMethod("GetParent", $flags).Invoke($null, @([IntPtr]::Zero)) | Out-Null',
    '$target = [D1dWindowCapture]::GetForeground()',
    '$windowProbeSkipped = $target -eq [IntPtr]::Zero',
    '$windowChecks = [ordered]@{ isWindow = $false; isWindowVisible = $false; isIconic = $false }',
    '$rectResult = $false',
    'if (-not $windowProbeSkipped) {',
    '  $beforeForeground = [D1dWindowCapture]::GetForeground()',
    '  $windowChecks.isWindow = [bool]([D1dWindowCapture].GetMethod("IsWindow", $flags).Invoke($null, @($target)))',
    '  $windowChecks.isWindowVisible = [bool]([D1dWindowCapture].GetMethod("IsWindowVisible", $flags).Invoke($null, @($target)))',
    '  $windowChecks.isIconic = [bool]([D1dWindowCapture].GetMethod("IsIconic", $flags).Invoke($null, @($target)))',
    '  $rectArgs = @($target, $null)',
    '  $rectResult = [bool]([D1dWindowCapture].GetMethod("GetWindowRect", $flags).Invoke($null, $rectArgs))',
    '  $afterForeground = [D1dWindowCapture]::GetForeground()',
    '  if ($beforeForeground -ne $afterForeground) { throw "safe probes changed foreground HWND" }',
    '  if (-not $windowChecks.isWindow -or -not $rectResult -or $null -eq $rectArgs[1]) { throw "safe existing-window probe failed" }',
    '}',
    'else {',
    '  [D1dWindowCapture].GetMethod("IsWindow", $flags).Invoke($null, @([IntPtr]::Zero)) | Out-Null',
    '  [D1dWindowCapture].GetMethod("IsWindowVisible", $flags).Invoke($null, @([IntPtr]::Zero)) | Out-Null',
    '  $zeroRectArgs = @([IntPtr]::Zero, $null); [D1dWindowCapture].GetMethod("GetWindowRect", $flags).Invoke($null, $zeroRectArgs) | Out-Null',
    '}',
    '[D1dWindowCapture]::InspectVisibleTopLevelWindows(@("C:\\path-that-does-not-exist")) | Out-Null',
    '[D1dWindowCapture].GetMethod("GetWindowLongPtr64", $flags).Invoke($null, @([IntPtr]::Zero, [int]-20)) | Out-Null',
    '[D1dWindowCapture].GetMethod("GetWindowLong32", $flags).Invoke($null, @([IntPtr]::Zero, [int]-20)) | Out-Null',
    '$pidArgs = @([IntPtr]::Zero, [uint32]0); [D1dWindowCapture].GetMethod("GetWindowThreadProcessId", $flags).Invoke($null, $pidArgs) | Out-Null',
    '[System.Text.StringBuilder]$builder = New-Object System.Text.StringBuilder; $textArgs = New-Object object[] 3; $textArgs[0] = [IntPtr]::Zero; $textArgs[1] = $builder; $textArgs[2] = 16; [D1dWindowCapture].GetMethod("GetWindowText", $flags).Invoke($null, $textArgs) | Out-Null',
    '$dwmArgs = @([IntPtr]::Zero, 14, [int]0, 4); [D1dWindowCapture].GetMethod("DwmGetWindowAttribute", $flags).Invoke($null, $dwmArgs) | Out-Null',
    '[D1dWindowCapture].GetMethod("ShowWindow", $flags).Invoke($null, @([IntPtr]::Zero, 0)) | Out-Null',
    '$showWindowParameters = @([D1dWindowCapture].GetMethod("ShowWindow", $flags).GetParameters() | ForEach-Object { $_.ParameterType.FullName }) -join ","',
    'if ($showWindowParameters -ne "System.IntPtr,System.Int32") { throw "ShowWindow parameter types are $showWindowParameters" }',
    'if ((($imports | Where-Object { $_.method -eq "ShowWindow" }).entryPoint) -ne "ShowWindow") { throw "ShowWindow entry point is incorrect" }',
    '$setWindowPosMethod = [D1dWindowCapture].GetMethod("SetWindowPos", $flags)',
    '$setWindowPosParameters = @($setWindowPosMethod.GetParameters() | ForEach-Object { $_.ParameterType.FullName }) -join ","',
    'if ($setWindowPosParameters -ne "System.IntPtr,System.IntPtr,System.Int32,System.Int32,System.Int32,System.Int32,System.UInt32") { throw "SetWindowPos parameter types are $setWindowPosParameters" }',
    'if ((($imports | Where-Object { $_.method -eq "SetWindowPos" }).entryPoint) -ne "SetWindowPos") { throw "SetWindowPos entry point is incorrect" }',
    '$setWindowPosMethod.Invoke($null, @([IntPtr]::Zero, [IntPtr]::new(-1), [int]0, [int]0, [int]0, [int]0, [uint32]0x0013)) | Out-Null',
    '$dwmFlushMethod = [D1dWindowCapture].GetMethod("DwmFlush", $flags)',
    'if ($dwmFlushMethod.GetParameters().Count -ne 0) { throw "DwmFlush must have no parameters" }',
    'if ((($imports | Where-Object { $_.method -eq "DwmFlush" }).entryPoint) -ne "DwmFlush") { throw "DwmFlush entry point is incorrect" }',
    '$dwmFlushMethod.Invoke($null, @()) | Out-Null',
    '[D1dWindowCapture].GetMethod("BringWindowToTop", $flags).Invoke($null, @([IntPtr]::Zero)) | Out-Null',
    '[D1dWindowCapture].GetMethod("SetForegroundWindow", $flags).Invoke($null, @([IntPtr]::Zero)) | Out-Null',
    '[D1dWindowCapture].GetMethod("SetProcessDPIAware", $flags).Invoke($null, @()) | Out-Null',
    '[D1dWindowCapture].GetMethod("SetProcessDpiAwarenessContext", $flags).Invoke($null, @([IntPtr]::Zero)) | Out-Null',
    '[ordered]@{ imports = $imports; target = $target.ToInt64(); windowProbeSkipped = $windowProbeSkipped; windowChecks = $windowChecks; rect = $rectResult } | ConvertTo-Json -Depth 8 -Compress',
  ]);
  const result = JSON.parse(stdout.trim());
  assert.equal(result.imports.length, 20);
  assert.equal(result.imports.find((entry) => entry.method === 'IsIconicNative').entryPoint, 'IsIconic');
  if (result.windowProbeSkipped) {
    assert.equal(result.target, 0);
    return;
  }
  assert.equal(result.windowChecks.isWindow, true);
  assert.equal(result.rect, true);
});

test('production helper captures a real visible WinForms window and writes a valid non-transparent PNG', { skip: process.platform !== 'win32' }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-capture-runtime-'));
  const configuredEvidenceRoot = process.env.D1D_CAPTURE_RUNTIME_EVIDENCE_DIR;
  const evidenceRoot = configuredEvidenceRoot
    ? path.resolve(configuredEvidenceRoot)
    : path.join(tempDir, 'evidence');
  const evidenceDir = path.join(evidenceRoot, `runtime-${Date.now()}-${process.pid}`);
  const pngPath = path.join(evidenceDir, 'runtime-primary-screen.png');
  const resultPath = path.join(evidenceDir, 'runtime-self-test.json');
  fs.mkdirSync(evidenceDir, { recursive: true });

  let launchedProcessId = null;
  try {
    const launcherOutput = childProcess.execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      RUNTIME_LAUNCHER_PATH,
      '-DesktopName',
      'INPUT',
      '-OrchestratorPath',
      RUNTIME_ORCHESTRATOR_PATH,
      '-HelperPath',
      HELPER_PATH,
      '-EvidenceDir',
      evidenceDir,
      '-ResultPath',
      resultPath,
    ], {
      encoding: 'utf8',
      timeout: 45000,
      windowsHide: true,
    });
    const launcher = parseLastJsonLine(launcherOutput);
    assert.equal(launcher.ok, true);
    assert.ok(launcher.processId > 0, 'desktop launcher must return the orchestrator process ID');
    assert.match(launcher.desktopName, /^WinSta0\\/);
    launchedProcessId = launcher.processId;

    await waitForFile(resultPath, 60000);
    const runtime = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(runtime.ok, true, runtime.error);
    assert.equal(runtime.desktopName, launcher.desktopName.split('\\').at(-1));
    assert.equal(runtime.title, 'D1D_CAPTURE_RUNTIME_TEST');
    assert.ok(runtime.hwnd > 0, 'runtime result must contain a real HWND');
    assert.equal(runtime.screenshotProvider, 'windows-native-primary-screen');
    assert.equal(runtime.restoredTopMost, true);
    assert.equal(runtime.windowClosed, true);
    assert.equal(path.resolve(runtime.pngPath), path.resolve(pngPath));
    assert.ok(fs.existsSync(pngPath), 'runtime PNG must exist');
    assert.equal(fs.statSync(pngPath).size, runtime.bytes);
    assert.ok(runtime.bytes > 0, 'runtime PNG must be non-empty');
    assert.equal(runtime.width, runtime.primaryScreenBounds.width);
    assert.equal(runtime.height, runtime.primaryScreenBounds.height);
    assert.ok(runtime.opaquePixels > 0, 'runtime PNG must not be fully transparent');
    assert.equal(runtime.hasMultipleColors, true, 'runtime PNG must contain rendered desktop/window content');
    t.diagnostic(`runtime desktop: ${runtime.desktopName}`);
    t.diagnostic(`runtime HWND: ${runtime.hwnd}`);
    t.diagnostic(`runtime PNG evidence: ${pngPath}`);
    t.diagnostic(`runtime JSON evidence: ${resultPath}`);
  } finally {
    if (launchedProcessId !== null) {
      try { process.kill(launchedProcessId, 0); process.kill(launchedProcessId); } catch { }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('helper uses listener PIDs and emits explicit zero/multiple candidate failures', () => {
  const source = fs.readFileSync(HELPER_PATH, 'utf8');
  assert.equal(source.charCodeAt(0), 0xfeff, 'PowerShell helper must be UTF-8 BOM');
  assert.match(source, /Get-NetTCPConnection\s+-State Listen/);
  assert.match(source, /52849/);
  assert.match(source, /9420/);
  assert.match(source, /GetProcessById/);
  assert.match(source, /NormalizePath/);
  assert.match(source, /DllImport\("user32\.dll", EntryPoint = "IsIconic", ExactSpelling = true/);
  assert.match(source, /DEVTOOLS_WINDOW_NOT_FOUND/);
  assert.match(source, /DEVTOOLS_WINDOW_NOT_UNIQUE/);
  assert.doesNotMatch(source, /ExpectedExecutablePath|ExpectedTitleMarker|WeChat Web Devtools|搭搭day/);
  assert.doesNotMatch(source, /title\.IndexOf|title\.Contains|title\.StartsWith/);
  assert.match(source, /visibleWindows = @\(\$visibleWindowDiagnostics\)/);
  assert.match(source, /candidateWindows = @\(\$candidateDiagnostics\)/);
});

test('capture is maximize, temporary topmost, composition-flushed, primary-screen CopyFromScreen, and single-shot', () => {
  const source = fs.readFileSync(HELPER_PATH, 'utf8');
  assert.match(source, /RestoreAndMaximize/);
  assert.match(source, /ShowWindow\(hWnd, SwMaximize\)/);
  assert.match(source, /SetWindowPos/);
  assert.match(source, /HwndTopmost/);
  assert.match(source, /SwpNoActivate/);
  assert.match(source, /FlushComposition/);
  assert.match(source, /DwmFlush/);
  assert.match(source, /RestoreTopMost/);
  assert.match(source, /HwndNotTopmost/);
  assert.doesNotMatch(source, /DEVTOOLS_WINDOW_NOT_FOREGROUND/);
  assert.doesNotMatch(source, /GetForeground\(\) -ne \$targetHandle/);
  assert.doesNotMatch(source, /FOREGROUND_RESTORE_FAILED/);
  assert.match(source, /\[System\.Windows\.Forms\.Screen\]::PrimaryScreen\.Bounds/);
  assert.equal((source.match(/CopyFromScreen/g) || []).length, 1);
  assert.match(source, /primaryScreenBounds/);
  assert.match(source, /SCREENSHOT_DIMENSIONS_MISMATCH/);
  assert.match(source, /Image\]::FromFile/);
  assert.doesNotMatch(source, /GetDpiForWindow|GetDpiForSystem|GetWindowDpi|GetSystemDpi|\bdpi\s*=/);
  assert.doesNotMatch(source, /mini\.screenshot|App\.captureScreenshot|MonitorFromWindow|fixed coordinate/i);
});
