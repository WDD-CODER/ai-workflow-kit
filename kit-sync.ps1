<#
.SYNOPSIS
  Show what a newer kit would change in an installed project (thin wrapper over tools/sync.mjs).
.DESCRIPTION
  Dry-run by default: prints new / kit-update / conflict / local-only files and stops.
  -Apply writes only new and kit-update files; conflicts are never overwritten.
.EXAMPLE
  .\kit-sync.ps1 -Target ..\my-app
  .\kit-sync.ps1 -Target ..\my-app -Apply
#>
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is required (Node 18+).'; exit 1 }
$argsList = @("$PSScriptRoot/tools/sync.mjs", '--target', $Target)
if ($Apply) { $argsList += '--apply' }
& node @argsList
exit $LASTEXITCODE
