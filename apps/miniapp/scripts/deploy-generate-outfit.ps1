param(
  [string]$EnvironmentId = 'cloud1-d8gl3k1vkdf0b7f05',
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$CliPath = '',
  [int]$Port = 52849
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$functionRoot = Join-Path $ProjectPath 'cloudfunctions\generateOutfit'
$checker = Join-Path $PSScriptRoot 'check-generate-outfit-package.js'
$stageParent = Join-Path $ProjectPath ('.generateOutfit-deploy-' + [guid]::NewGuid().ToString('N'))
$stageRoot = Join-Path $stageParent 'generateOutfit'
$deploymentMarker = 'generateOutfit-deploy-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff') + '-' + [guid]::NewGuid().ToString('N')

$status = & git -C $repoRoot status --porcelain -- 'apps/miniapp/cloudfunctions/generateOutfit'
if ($LASTEXITCODE -ne 0) { throw 'Unable to read git status.' }
if ($status) { throw 'Deployment requires a clean generateOutfit source tree.' }

& node $checker $functionRoot
if ($LASTEXITCODE -ne 0) { throw 'generateOutfit package integrity check failed; deployment was not attempted.' }

New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
try {
  $sourceFiles = Get-ChildItem -LiteralPath $functionRoot -Recurse -File | Where-Object {
    $_.FullName -notmatch "\\node_modules\\" -and
    $_.Name -notmatch "\.(test|fixtures|harness|report)(\.test)?\.js$"
  }
  foreach ($sourceFile in $sourceFiles) {
    $relative = $sourceFile.FullName.Substring($functionRoot.Length).TrimStart('\', '/')
    $destination = Join-Path $stageRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile.FullName -Destination $destination -Force
    if ($sourceFile.Extension -eq '.js') {
      $contents = [System.IO.File]::ReadAllText($destination)
      [System.IO.File]::WriteAllText($destination, "// $deploymentMarker`r`n$contents", [System.Text.UTF8Encoding]::new($false))
    }
  }

  & node $checker $stageRoot
  if ($LASTEXITCODE -ne 0) { throw 'Staged generateOutfit package integrity check failed; deployment was not attempted.' }

  if ([string]::IsNullOrWhiteSpace($CliPath)) {
    $cliCandidates = @(Get-ChildItem -LiteralPath 'D:\soft\Tecent' -Recurse -Filter 'cli.bat' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '(?i)web|微信' })
    if ($cliCandidates.Count -ne 1) { throw "Expected exactly one WeChat DevTools CLI under D:\soft\Tecent, found $($cliCandidates.Count). Pass -CliPath explicitly." }
    $CliPath = $cliCandidates[0].FullName
  }
  if (-not (Test-Path -LiteralPath $CliPath)) { throw "WeChat DevTools CLI not found: $CliPath" }
  & $CliPath cloud functions deploy --env $EnvironmentId --paths $stageRoot --remote-npm-install --report --project $ProjectPath --port $Port
  if ($LASTEXITCODE -ne 0) { throw "generateOutfit deployment failed with exit code $LASTEXITCODE." }
}
finally {
  if (Test-Path -LiteralPath $stageParent) { Remove-Item -LiteralPath $stageParent -Recurse -Force }
}
