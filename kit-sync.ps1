<#
.SYNOPSIS
  Show what a newer kit would change in an installed project (thin wrapper over tools/sync.mjs).
.DESCRIPTION
  Dry-run by default: prints new / kit-update / conflict / local-only files and stops.
  -Apply writes only new and kit-update files; conflicts are never overwritten.
.EXAMPLE
  .\kit-sync.ps1 -Target ..\my-app
  .\kit-sync.ps1 -Target ..\my-app -Apply
  .\kit-sync.ps1 -Target ..\my-app -Ref v1.1.0 -Apply      # upgrade a GitHub install to another release
#>
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Source,
  [string]$Ref,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is required (Node 18+).'; exit 1 }
$resolved = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Target))
Write-Host "kit-sync target: $resolved"
$argsList = @("$PSScriptRoot/tools/sync.mjs", '--target', $resolved)
if ($Source) { $argsList += @('--source', $Source) }
if ($Ref) { $argsList += @('--ref', $Ref) }
if ($Apply) { $argsList += '--apply' }
& node @argsList
exit $LASTEXITCODE
