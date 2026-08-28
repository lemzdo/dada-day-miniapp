param(
  [string]$EnvironmentId = 'cloud1-d8gl3k1vkdf0b7f05',
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$CliPath = '',
  [int]$Port = 52849,
  [string[]]$Functions = @('generateOutfit', 'recommendationStream')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$stager = Join-Path $PSScriptRoot 'stage-recommendation-artifacts.js'
$checker = Join-Path $PSScriptRoot 'check-recommendation-artifacts.js'
$stageParent = Join-Path $ProjectPath ('.recommendation-deploy-' + [guid]::NewGuid().ToString('N'))
$generateOutfitStage = Join-Path $stageParent 'generateOutfit'
$recommendationStreamStage = Join-Path $stageParent 'recommendationStream'
$deploymentMarker = 'recommendation-deploy-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff') + '-' + [guid]::NewGuid().ToString('N')
$allowedFunctions = @('generateOutfit', 'recommendationStream')

foreach ($functionName in $Functions) {
  if ($functionName -notin $allowedFunctions) { throw "Unsupported deployment target: $functionName" }
}

$status = & git -C $repoRoot status --porcelain -- `
  'apps/miniapp/cloudfunctions/generateOutfit' `
  'apps/miniapp/cloudfunctions/recommendationStream' `
  'packages/ai-core' `
  'packages/garment-assets'
if ($LASTEXITCODE -ne 0) { throw 'Unable to read recommendation runtime git status.' }
if ($status) { throw 'Deployment requires clean recommendation runtime source trees.' }

function Invoke-CloudFunctionDeploy {
  param([string]$Name, [string]$StageRoot)

  $deployed = $false
  for ($attempt = 1; $attempt -le 5; $attempt += 1) {
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $deploymentOutput = & $CliPath cloud functions deploy --env $EnvironmentId --paths $StageRoot --remote-npm-install --report --project $ProjectPath --port $Port 2>&1
    $deploymentExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorPreference
    $deploymentOutput | ForEach-Object { Write-Host $_ }
    $deploymentText = $deploymentOutput -join "`n"
    $deploymentFailed = $deploymentExitCode -ne 0 -or $deploymentText -match '(?im)^\s*[×x]\s|initialize error|deployment failed|\[error\]'
    if (-not $deploymentFailed) {
      $deployed = $true
      break
    }
    if ($deploymentText -notmatch '(?i)cloudfunction is updating|处于Updating状态' -or $attempt -eq 5) {
      throw "$Name full deployment failed with exit code $deploymentExitCode."
    }
    Start-Sleep -Seconds 10
  }
  if (-not $deployed) { throw "$Name full deployment did not complete." }
  Start-Sleep -Seconds 8

  # WeChat DevTools full deploy can report success before existing nested
  # directories are refreshed. The artifact manifest owns this list, so every
  # runtime root is refreshed without maintaining a missing-file allowlist.
  $manifest = Get-Content -LiteralPath (Join-Path $StageRoot 'artifact-manifest.json') -Raw | ConvertFrom-Json
  foreach ($runtimeRoot in $manifest.refreshRoots) {
    $refreshed = $false
    for ($attempt = 1; $attempt -le 5; $attempt += 1) {
      $previousErrorPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      $refreshOutput = & $CliPath cloud functions inc-deploy --env $EnvironmentId --path $StageRoot --file $runtimeRoot --project $ProjectPath --port $Port 2>&1
      $refreshExitCode = $LASTEXITCODE
      $ErrorActionPreference = $previousErrorPreference
      $refreshOutput | ForEach-Object { Write-Host $_ }
      $refreshText = $refreshOutput -join "`n"
      if ($refreshExitCode -eq 0 -and $refreshText -notmatch '(?im)^\s*[×x]\s|incremental deploy failed|\[error\]') {
        $refreshed = $true
        break
      }
      if ($attempt -lt 5) { Start-Sleep -Seconds 8 }
    }
    if (-not $refreshed) { throw "$Name runtime directory refresh failed: $runtimeRoot" }
    Start-Sleep -Seconds 5
  }
}

New-Item -ItemType Directory -Path $stageParent -Force | Out-Null
try {
  & node $stager generateOutfit $generateOutfitStage $deploymentMarker
  if ($LASTEXITCODE -ne 0) { throw 'generateOutfit artifact assembly failed.' }
  & node $stager recommendationStream $recommendationStreamStage $deploymentMarker
  if ($LASTEXITCODE -ne 0) { throw 'recommendationStream artifact assembly failed.' }
  & node $checker $generateOutfitStage $recommendationStreamStage
  if ($LASTEXITCODE -ne 0) { throw 'Recommendation artifact integrity gate failed; deployment was not attempted.' }

  if ([string]::IsNullOrWhiteSpace($CliPath)) {
    $cliCandidates = @(Get-ChildItem -LiteralPath 'D:\soft\Tecent' -Recurse -Filter 'cli.bat' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '(?i)web|微信' })
    if ($cliCandidates.Count -ne 1) { throw "Expected exactly one WeChat DevTools CLI under D:\soft\Tecent, found $($cliCandidates.Count). Pass -CliPath explicitly." }
    $CliPath = $cliCandidates[0].FullName
  }
  if (-not (Test-Path -LiteralPath $CliPath)) { throw "WeChat DevTools CLI not found: $CliPath" }

  foreach ($functionName in $Functions) {
    $stageRoot = if ($functionName -eq 'generateOutfit') { $generateOutfitStage } else { $recommendationStreamStage }
    Invoke-CloudFunctionDeploy -Name $functionName -StageRoot $stageRoot
  }
  Write-Host ('DEPLOYED=' + (($Functions | Sort-Object -Unique) -join ','))
}
finally {
  if (Test-Path -LiteralPath $stageParent) { Remove-Item -LiteralPath $stageParent -Recurse -Force }
}
