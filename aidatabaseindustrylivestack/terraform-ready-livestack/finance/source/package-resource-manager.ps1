[CmdletBinding()]
param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSCommandPath
$builder = Join-Path $root 'scripts/build_resource_manager_package.py'
$arguments = @($builder)
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $arguments += @('--output', $OutputPath)
}

$pyLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($null -ne $pyLauncher) {
  & $pyLauncher.Source -3 @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Resource Manager packaging failed with exit code $LASTEXITCODE."
  }
  return
}

$python = Get-Command python3 -ErrorAction SilentlyContinue
if ($null -eq $python) {
  $python = Get-Command python -ErrorAction SilentlyContinue
}
if ($null -eq $python) {
  throw 'Python 3 is required to build and verify the Resource Manager archive.'
}

& $python.Source @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Resource Manager packaging failed with exit code $LASTEXITCODE."
}
