param(
  [string]$EnvironmentId = 'cloud1-d8gl3k1vkdf0b7f05',
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$CliPath = '',
  [int]$Port = 52849
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sourceRoot = Join-Path $ProjectPath 'cloudfunctions\generateOutfit'
$artifactRoot = Join-Path $repoRoot 'artifacts\voice-renderer-v2-lab'
$stageRoot = Join-Path $artifactRoot '.cloud-benchmark-stage\generateOutfit'
$auditFile = Join-Path $artifactRoot 'cloud-benchmark-staging.json'
$checker = Join-Path $PSScriptRoot 'check-generate-outfit-package.js'
$marker = Join-Path $PSScriptRoot 'xiaoda-ai-voice-spike\mark-deployment-files.js'

$status = & git -C $repoRoot status --porcelain -- 'apps/miniapp/cloudfunctions/generateOutfit'
if ($LASTEXITCODE -ne 0) { throw 'Unable to read generateOutfit git status.' }
if ($status) { throw 'Deployment requires a clean production generateOutfit source tree.' }
if (-not (Test-Path -LiteralPath $auditFile)) { throw 'Cloud benchmark staging audit is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $stageRoot 'benchmarkVoiceRendererV2.js'))) { throw 'Cloud benchmark helper is missing.' }
if ((Get-Content -LiteralPath (Join-Path $sourceRoot 'index.js') -Raw) -match 'voiceRendererV2Benchmark') { throw 'Production source must remain uninjected.' }

& node $checker $stageRoot
if ($LASTEXITCODE -ne 0) { throw 'Staged package integrity check failed.' }
& node $marker $stageRoot | Out-Null
& node $checker $stageRoot
if ($LASTEXITCODE -ne 0) { throw 'Marked staged package integrity check failed.' }

if ([string]::IsNullOrWhiteSpace($CliPath)) {
  $cliCandidates = @(Get-ChildItem -LiteralPath 'D:\soft\Tecent' -Recurse -Filter 'cli.bat' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '(?i)web|微信' })
  if ($cliCandidates.Count -ne 1) { throw "Expected exactly one WeChat DevTools CLI, found $($cliCandidates.Count)." }
  $CliPath = $cliCandidates[0].FullName
}
& $CliPath cloud functions deploy --env $EnvironmentId --paths $stageRoot --remote-npm-install --report --project $ProjectPath --port $Port
if ($LASTEXITCODE -ne 0) { throw "Voice Renderer benchmark deployment failed with exit code $LASTEXITCODE." }
