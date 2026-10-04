<#
.SYNOPSIS
  Install the AI workflow kit into a project (thin wrapper over tools/install.mjs).
.EXAMPLE
  .\kit-install.ps1 -Target ..\my-app -Packs angular,node-express -Cursor
.NOTES
  Requires Node 18+. Never overwrites existing files unless -Force. Run kit-sync.ps1 later to see kit updates.
#>
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Config,
  [string[]]$Packs,
  [switch]$Cursor,
  [switch]$YesChef,
  [switch]$DryRun,
  [switch]$Force,
  [switch]$AllowUnfilled,
  [switch]$InstallDeps
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is required (Node 18+).'; exit 1 }
$resolved = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Target))
Write-Host "kit-install target: $resolved"
$argsList = @("$PSScriptRoot/tools/install.mjs", '--target', $resolved)
if ($Config) { $argsList += @('--config', [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Config))) }
if ($Packs) { $argsList += @('--packs', ($Packs -join ',')) }
if ($Cursor) { $argsList += '--cursor' }
if ($YesChef) { $argsList += '--yes-chef' }
if ($DryRun) { $argsList += '--dry-run' }
if ($Force) { $argsList += '--force' }
if ($AllowUnfilled) { $argsList += '--allow-unfilled' }
if ($InstallDeps) { $argsList += '--install-deps' }
& node @argsList
exit $LASTEXITCODE
