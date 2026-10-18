<#
.SYNOPSIS
  Install the AI workflow kit into a project (thin wrapper over tools/install.mjs).
.EXAMPLE
  .\kit-install.ps1 -Target ..\my-app -Packs angular,node-express -Cursor
  .\kit-install.ps1 -Target ..\my-app -Source github:WDD-CODER/ai-workflow-kit -Ref v0.5.0 -Packs angular
  .\kit-install.ps1 -Target ..\my-app -Adopt -Source github:WDD-CODER/ai-workflow-kit -Ref v1.0.0   # project already carries the workflow: writes only .kit/install.json
.NOTES
  Requires Node 18+. Never overwrites existing files unless -Force. Run kit-sync.ps1 later to see kit updates.
#>
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Source,
  [string]$Ref,
  [string]$Config,
  [string[]]$Packs,
  [switch]$Cursor,
  [switch]$YesChef,
  [switch]$DryRun,
  [switch]$Force,
  [switch]$AllowUnfilled,
  [switch]$InstallDeps,
  [switch]$Adopt,
  [switch]$NoCursor
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is required (Node 18+).'; exit 1 }
$resolved = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Target))
Write-Host "kit-install target: $resolved"
$argsList = @("$PSScriptRoot/tools/install.mjs", '--target', $resolved)
if ($Source) { $argsList += @('--source', $Source) }
if ($Ref) { $argsList += @('--ref', $Ref) }
if ($Config) { $argsList += @('--config', [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Config))) }
if ($Packs) { $argsList += @('--packs', ($Packs -join ',')) }
if ($Cursor) { $argsList += '--cursor' }
if ($YesChef) { $argsList += '--yes-chef' }
if ($DryRun) { $argsList += '--dry-run' }
if ($Force) { $argsList += '--force' }
if ($AllowUnfilled) { $argsList += '--allow-unfilled' }
if ($InstallDeps) { $argsList += '--install-deps' }
if ($Adopt) { $argsList += '--adopt' }
if ($NoCursor) { $argsList += '--no-cursor' }
& node @argsList
exit $LASTEXITCODE
