[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)][AllowEmptyCollection()][string[]]$RunnerArguments
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$powershellScriptPath = $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..\..')).Path
$captureHelper = Join-Path $scriptRoot 'windows-devtools-capture.ps1'
$runner = Join-Path $scriptRoot 'recommendation-v6-e2e.cjs'
$resolver = Join-Path $scriptRoot 'runner-preflight-resolver.cjs'
$evidenceRoot = Join-Path $repoRoot 'artifacts\recommendation-v6-e2e'
$evidenceName = 'sport-windows-{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmssfff'), ([Guid]::NewGuid().ToString('N').Substring(0, 8))
$evidenceDir = Join-Path $evidenceRoot $evidenceName
$transcriptStarted = $false
$exitCode = 1
$failure = $null

function New-Utf8Encoding {
  New-Object System.Text.UTF8Encoding($true)
}

function Normalize-RunnerArguments {
  param(
    [Parameter(Mandatory = $false)][AllowNull()][object[]]$Value
  )

  $normalized = New-Object 'System.Collections.Generic.List[string]'
  foreach ($item in @($Value)) {
    if ($null -eq $item) { continue }
    $text = [string]$item
    if ([string]::IsNullOrEmpty($text)) { continue }
    [void]$normalized.Add($text)
  }
  return ,([string[]]$normalized.ToArray())
}

function Get-KeyFileHashes {
  $files = [ordered]@{
    cmd = Join-Path $scriptRoot 'run-sport-windows-acceptance.cmd'
    powershell = $powershellScriptPath
    resolver = $resolver
    runner = $runner
    manifest = Join-Path $scriptRoot 'runner-preflight.manifest.json'
    captureHelper = $captureHelper
  }
  $hashes = [ordered]@{}
  foreach ($entry in $files.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath $entry.Value)) {
      $hashes[$entry.Key] = [ordered]@{ path = $entry.Value; sha256 = $null; exists = $false }
      continue
    }
    $hash = (Get-FileHash -LiteralPath $entry.Value -Algorithm SHA256).Hash.ToLowerInvariant()
    $hashes[$entry.Key] = [ordered]@{ path = (Resolve-Path -LiteralPath $entry.Value).Path; sha256 = $hash; exists = $true }
  }
  $hashes
}

function Write-Utf8Json {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value
  )
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 10), (New-Utf8Encoding))
}

function Throw-AcceptanceError {
  param(
    [Parameter(Mandatory = $true)][string]$Code,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $error = New-Object System.Exception($Message)
  $error.Data['AcceptanceCode'] = $Code
  throw $error
}

function Invoke-CaptureHelperJson {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments)

  $output = @(& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $captureHelper @Arguments 2>&1 | ForEach-Object { [string]$_ })
  $helperExitCode = $LASTEXITCODE
  $parsed = $null
  for ($index = $output.Count - 1; $index -ge 0; $index--) {
    try {
      $parsed = $output[$index] | ConvertFrom-Json
      break
    }
    catch {
      continue
    }
  }
  if ($null -eq $parsed) {
    Throw-AcceptanceError 'CAPTURE_HELPER_JSON_INVALID' "Windows helper 没有返回可解析 JSON（exit $helperExitCode）"
  }
  [ordered]@{
    exitCode = $helperExitCode
    result = $parsed
    rawOutput = @($output)
  }
}

function Invoke-RunnerResolverJson {
  param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments
  )

  $output = @(& $NodePath $resolver @Arguments 2>&1 | ForEach-Object { [string]$_ })
  $resolverExitCode = $LASTEXITCODE
  $parsed = $null
  for ($index = $output.Count - 1; $index -ge 0; $index--) {
    try {
      $parsed = $output[$index] | ConvertFrom-Json
      break
    }
    catch {
      continue
    }
  }
  if ($null -eq $parsed) {
    Throw-AcceptanceError 'RUNNER_CONFIG_INVALID' "Runner resolver 没有返回可解析 JSON（exit $resolverExitCode）"
  }
  if ($resolverExitCode -ne 0 -or $parsed.ok -ne $true) {
    $issues = @($parsed.issues | ForEach-Object { "[$($_.code)] $($_.field): $($_.message)" })
    $message = if ($issues.Count -gt 0) { $issues -join '; ' } else { [string]$parsed.message }
    Throw-AcceptanceError 'RUNNER_CONFIG_INVALID' $message
  }
  $parsed
}

function Get-ListenerCheck {
  $rows = @()
  foreach ($port in @(52849, 9420)) {
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($connections.Count -eq 0) {
      Throw-AcceptanceError 'DEVTOOLS_LISTENER_NOT_FOUND' "端口 $port 未监听"
    }
    $pids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    $rows += [ordered]@{ port = $port; processIds = @($pids) }
  }
  $rows
}

function Assert-PrimaryScreenPng {
  param(
    [Parameter(Mandatory = $true)]$Capture,
    [Parameter(Mandatory = $true)][string]$Path
  )
  if ($Capture.ok -ne $true) {
    Throw-AcceptanceError ([string]$Capture.errorCode) ([string]$Capture.errorMessage)
  }
  if ([string]$Capture.screenshotProvider -ne 'windows-native-primary-screen') {
    Throw-AcceptanceError 'SCREENSHOT_PROVIDER_MISMATCH' "截图 provider 不正确：$($Capture.screenshotProvider)"
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    Throw-AcceptanceError 'SCREENSHOT_INVALID' '冒烟截图没有写入磁盘'
  }
  $file = Get-Item -LiteralPath $Path
  if (-not $file.PSIsContainer -and $file.Length -gt 0) {
    $image = $null
    try {
      Add-Type -AssemblyName System.Drawing
      $image = [System.Drawing.Image]::FromFile($Path)
      $expectedWidth = [int]$Capture.primaryScreenBounds.width
      $expectedHeight = [int]$Capture.primaryScreenBounds.height
      if ($image.Width -ne $expectedWidth -or $image.Height -ne $expectedHeight) {
        Throw-AcceptanceError 'SCREENSHOT_DIMENSIONS_MISMATCH' "冒烟 PNG 尺寸 $($image.Width)x$($image.Height) 不等于主屏幕 $expectedWidth x $expectedHeight"
      }
    }
    finally {
      if ($null -ne $image) { $image.Dispose() }
    }
  }
  else {
    Throw-AcceptanceError 'SCREENSHOT_INVALID' '冒烟截图为空或不是文件'
  }
}

try {
  if (-not (Test-Path -LiteralPath $captureHelper)) { Throw-AcceptanceError 'CAPTURE_HELPER_MISSING' $captureHelper }
  if (-not (Test-Path -LiteralPath $runner)) { Throw-AcceptanceError 'RUNNER_MISSING' $runner }
  if (-not (Test-Path -LiteralPath $resolver)) { Throw-AcceptanceError 'RUNNER_RESOLVER_MISSING' $resolver }
  $listenerCheck = Get-ListenerCheck

  [IO.Directory]::CreateDirectory($evidenceDir) | Out-Null
  $transcriptPath = Join-Path $evidenceDir 'transcript.log'
  Start-Transcript -Path $transcriptPath -Force | Out-Null
  $transcriptStarted = $true
  Write-Host "仓库根目录: $repoRoot"
  Write-Host "监听检查: $($listenerCheck | ConvertTo-Json -Compress)"
  Write-Host '自动识别 DevTools 主窗口...'

  $discoveryCall = Invoke-CaptureHelperJson -Arguments @('-Discover')
  $discovery = $discoveryCall.result
  if ($discoveryCall.exitCode -ne 0 -or $discovery.ok -ne $true) {
    Throw-AcceptanceError ([string]$discovery.errorCode) ([string]$discovery.errorMessage)
  }
  if ([int64]$discovery.windowHandle -le 0) {
    Throw-AcceptanceError 'DEVTOOLS_WINDOW_INVALID' '自动识别没有返回有效 HWND'
  }

  $windowHandle = [int64]$discovery.windowHandle
  $smokePath = Join-Path $evidenceDir 'smoke-primary-screen.png'
  $acceptanceEnvironment = [ordered]@{
    evidenceDir = $evidenceDir
    windowHandle = $windowHandle
    screenshotProvider = 'windows-native-primary-screen'
    listenerCheck = $listenerCheck
    discovery = $discovery
  }
  Write-Utf8Json -Path (Join-Path $evidenceDir 'acceptance-environment.json') -Value $acceptanceEnvironment
  Write-Host "DevTools HWND: $windowHandle；标题和路径仅作为证据输出。"
  Write-Host '执行一次主屏幕截图冒烟...'
  $smokeCall = Invoke-CaptureHelperJson -Arguments @('-OutputPath', $smokePath, '-WindowHandle', [string]$windowHandle)
  $smoke = $smokeCall.result
  Assert-PrimaryScreenPng -Capture $smoke -Path $smokePath
  if ($smokeCall.exitCode -ne 0) { Throw-AcceptanceError ([string]$smoke.errorCode) ([string]$smoke.errorMessage) }
  Write-Host '主屏幕截图冒烟通过。'

  $env:EVIDENCE_DIR = $evidenceDir
  $env:D1D_DEVTOOLS_HWND = [string]$windowHandle
  $env:SCREENSHOT_PROVIDER = 'windows-native-primary-screen'
  $env:CAPTURE_PRESENTATION_EVIDENCE = 'true'
  # Formal mode is selected only by an explicit --preflight-only argument. Do
  # not inherit stale mode switches, aliases, endpoints, or resolved config.
  $env:EVIDENCE_ONLY = $null
  $env:PRESENTATION_EVIDENCE_ONLY = $null
  $env:PRECONDITION_ONLY = $null
  $env:D1D_WINDOW_HANDLE = $null
  $env:WINDOW_HANDLE = $null
  $env:AUTOMATOR_WS_ENDPOINT = $null
  $env:MINIPROGRAM_AUTOMATOR_PATH = $null
  $env:D1D_RUNNER_RESOLVED_CONFIG_JSON = $null
  Write-Host '启动 Sport Initial / Refresh runner...'
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $resolverArguments = Normalize-RunnerArguments -Value $RunnerArguments
  $resolvedCall = Invoke-RunnerResolverJson -NodePath $node -Arguments $resolverArguments
  $resolvedConfig = $resolvedCall.config
  $resolvedJson = $resolvedConfig | ConvertTo-Json -Depth 20 -Compress
  $env:MINIPROGRAM_AUTOMATOR_PATH = [string]$resolvedConfig.automatorModulePath
  $env:D1D_RUNNER_RESOLVED_CONFIG_JSON = $resolvedJson
  $acceptanceEnvironment.entrypoint = [ordered]@{
    cmd = [ordered]@{
      script = Join-Path $scriptRoot 'run-sport-windows-acceptance.cmd'
      rawPercentStar = '%*'
      argv = @($resolverArguments)
    }
    powershell = [ordered]@{
      script = $MyInvocation.MyCommand.Path
      argv = @($resolverArguments)
      cwd = (Get-Location).Path
      host = $Host.Name
      version = $PSVersionTable.PSVersion.ToString()
    }
    node = [ordered]@{
      executable = $node
      script = $runner
      argv = @($resolverArguments)
      cwd = (Get-Location).Path
    }
    environment = [ordered]@{
      EVIDENCE_DIR = $env:EVIDENCE_DIR
      D1D_DEVTOOLS_HWND = $env:D1D_DEVTOOLS_HWND
      SCREENSHOT_PROVIDER = $env:SCREENSHOT_PROVIDER
      CAPTURE_PRESENTATION_EVIDENCE = $env:CAPTURE_PRESENTATION_EVIDENCE
      EVIDENCE_ONLY = $env:EVIDENCE_ONLY
      PRESENTATION_EVIDENCE_ONLY = $env:PRESENTATION_EVIDENCE_ONLY
      PRECONDITION_ONLY = $env:PRECONDITION_ONLY
      D1D_WINDOW_HANDLE = $env:D1D_WINDOW_HANDLE
      WINDOW_HANDLE = $env:WINDOW_HANDLE
      AUTOMATOR_WS_ENDPOINT = $env:AUTOMATOR_WS_ENDPOINT
      MINIPROGRAM_AUTOMATOR_PATH = $env:MINIPROGRAM_AUTOMATOR_PATH
      D1D_RUNNER_RESOLVED_CONFIG_JSON = $env:D1D_RUNNER_RESOLVED_CONFIG_JSON
    }
  }
  $acceptanceEnvironment.resolvedConfig = [ordered]@{
    configHash = $resolvedConfig.configHash
    preflightOnly = $resolvedConfig.preflightOnly
    evidenceOnly = $resolvedConfig.evidenceOnly
    capturePresentationEvidence = $resolvedConfig.capturePresentationEvidence
    automatorModulePath = $resolvedConfig.automatorModulePath
    automatorResolvedEntry = $resolvedConfig.automatorResolvedEntry
    automatorWsEndpoint = $resolvedConfig.automatorWsEndpoint
    windowHandle = $resolvedConfig.windowHandle
    screenshotProvider = $resolvedConfig.screenshotProvider
    contracts = $resolvedConfig.contracts
  }
  $acceptanceEnvironment.keyFileHashes = Get-KeyFileHashes
  Write-Utf8Json -Path (Join-Path $evidenceDir 'acceptance-environment.json') -Value $acceptanceEnvironment
  Write-Host "Runner resolver: $($resolvedConfig.configHash)；automator: $($resolvedConfig.automatorModulePath)"
  $runnerArguments = Normalize-RunnerArguments -Value $RunnerArguments
  $runnerOutput = @(& $node $runner @runnerArguments 2>&1 | ForEach-Object { [string]$_ })
  $runnerExitCode = $LASTEXITCODE
  $runnerOutput | ForEach-Object { Write-Host $_ }
  if ($runnerExitCode -ne 0) {
    $runnerErrorsPath = Join-Path $evidenceDir 'errors.jsonl'
    if (Test-Path -LiteralPath $runnerErrorsPath) {
      $firstRunnerError = $null
      foreach ($line in @(Get-Content -LiteralPath $runnerErrorsPath -Encoding UTF8)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try { $firstRunnerError = $line | ConvertFrom-Json; break } catch { continue }
      }
      if ($null -ne $firstRunnerError) {
        $firstCode = if ([string]::IsNullOrWhiteSpace([string]$firstRunnerError.code)) { 'SPORT_ACCEPTANCE_FAILED' } else { [string]$firstRunnerError.code }
        $firstMessage = if ([string]::IsNullOrWhiteSpace([string]$firstRunnerError.message)) { "runner 退出码 $runnerExitCode" } else { [string]$firstRunnerError.message }
        Throw-AcceptanceError $firstCode $firstMessage
      }
    }
    Throw-AcceptanceError 'SPORT_ACCEPTANCE_FAILED' "runner 退出码 $runnerExitCode；未找到可解析的 errors.jsonl 主错误"
  }

  $exitCode = 0
}
catch {
  $code = $_.Exception.Data['AcceptanceCode']
  if ([string]::IsNullOrWhiteSpace([string]$code)) { $code = 'SPORT_ACCEPTANCE_FAILED' }
  $failure = [ordered]@{ code = [string]$code; message = [string]$_.Exception.Message }
  $exitCode = 1
}
finally {
  if ($transcriptStarted) {
    try { Stop-Transcript | Out-Null } catch { }
  }
  Write-Host ''
  if ($exitCode -eq 0) {
    Write-Host 'SPORT WINDOWS ACCEPTANCE: PASS'
  }
  else {
    Write-Host 'SPORT WINDOWS ACCEPTANCE: FAIL'
    if ($null -ne $failure) { Write-Host ("主错误 [{0}] {1}" -f $failure.code, $failure.message) }
  }
  Write-Host "Evidence: $evidenceDir"
  Write-Host '此流程不会自动重试；失败后请保留最早主错误和 evidence。'
  exit $exitCode
}
