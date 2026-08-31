param([string]$EnvironmentId = 'cloud1-d8gl3k1vkdf0b7f05')

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Write-Warning 'Deprecated wrapper. Formal deployment is: pnpm cloud:deploy generateOutfit'
Push-Location $repoRoot
try {
  & cmd /c pnpm cloud:deploy generateOutfit --env-id $EnvironmentId
  if ($LASTEXITCODE -ne 0) { throw "Canonical generateOutfit deployment failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }
