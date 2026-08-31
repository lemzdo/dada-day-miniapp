param(
  [string]$EnvironmentId = 'cloud1-d8gl3k1vkdf0b7f05',
  [string[]]$Functions = @('recommendationStream')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Write-Warning 'Deprecated wrapper. Formal deployment is: pnpm cloud:deploy <function>'
Push-Location $repoRoot
try {
  foreach ($functionName in $Functions) {
    if ($functionName -notin @('generateOutfit', 'recommendationStream')) { throw "Unsupported deployment target: $functionName" }
    & cmd /c pnpm cloud:deploy $functionName --env-id $EnvironmentId
    if ($LASTEXITCODE -ne 0) { throw "Canonical $functionName deployment failed with exit code $LASTEXITCODE." }
  }
}
finally { Pop-Location }
