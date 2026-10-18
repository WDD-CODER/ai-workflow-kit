<#
.SYNOPSIS
  Check that a project's workflow files still match the kit, except for its declared overrides (thin wrapper over tools/drift-check.mjs).
.DESCRIPTION
  Renders every managed kit file with the project's kit.config.json and compares it with the project's copy.
  Read-only. Exit 0 = no undeclared differences; 1 = drift, missing files, or a config error.
  Works before kit-install (no .kit/install.json needed).
.EXAMPLE
  .\kit-drift.ps1 -Target ..\my-app
  .\kit-drift.ps1 -Target ..\my-app -Verbose
  .\kit-drift.ps1 -Target ..\my-app -Source github:WDD-CODER/ai-workflow-kit -Ref v0.5.0
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Source,
  [string]$Ref
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is required (Node 18+).'; exit 1 }
$resolved = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Target))
Write-Host "kit-drift target: $resolved"
$argsList = @("$PSScriptRoot/tools/drift-check.mjs", '--target', $resolved)
if ($Source) { $argsList += @('--source', $Source) }
if ($Ref) { $argsList += @('--ref', $Ref) }
if ($PSBoundParameters['Verbose']) { $argsList += '--verbose' }
& node @argsList
exit $LASTEXITCODE
