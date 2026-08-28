param(
  [string]$EnvironmentId = 'cloud1-d8gl3k1vkdf0b7f05',
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$CliPath = '',
  [int]$Port = 52849
)

$ErrorActionPreference = 'Stop'
$deployRecommendationFunctions = Join-Path $PSScriptRoot 'deploy-recommendation-functions.ps1'
& $deployRecommendationFunctions `
  -EnvironmentId $EnvironmentId `
  -ProjectPath $ProjectPath `
  -CliPath $CliPath `
  -Port $Port `
  -Functions @('generateOutfit')
if ($LASTEXITCODE -ne 0) { throw "generateOutfit deployment failed with exit code $LASTEXITCODE." }
