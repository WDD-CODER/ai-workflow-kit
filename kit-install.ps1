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
  [switch]$AllowUnfilled
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is required (Node 18+).'; exit 1 }
$argsList = @("$PSScriptRoot/tools/install.mjs", '--target', $Target)
if ($Config) { $argsList += @('--config', $Config) }
if ($Packs) { $argsList += @('--packs', ($Packs -join ',')) }
if ($Cursor) { $argsList += '--cursor' }
if ($YesChef) { $argsList += '--yes-chef' }
if ($DryRun) { $argsList += '--dry-run' }
if ($Force) { $argsList += '--force' }
if ($AllowUnfilled) { $argsList += '--allow-unfilled' }
& node @argsList
exit $LASTEXITCODE
