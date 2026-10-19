<#
.SYNOPSIS
  Show what a newer kit would change in an installed project (thin wrapper over tools/sync.mjs).
.DESCRIPTION
  Dry-run by default: prints new / kit-update / conflict / local-only files and stops.
  -Apply writes only new and kit-update files; conflicts are never overwritten.
  -Prune (with -Apply) deletes the files the kit stopped shipping that are unchanged since install; an edited one or a
  seed is kept and stops being kit-managed (released). Overrides and upstream-owned paths are never touched. Records of
  files already deleted are dropped on every -Apply.
.EXAMPLE
  .\kit-sync.ps1 -Target ..\my-app
  .\kit-sync.ps1 -Target ..\my-app -Apply
  .\kit-sync.ps1 -Target ..\my-app -Ref v1.1.0 -Apply      # upgrade a GitHub install to another release
  .\kit-sync.ps1 -Target ..\my-app -Packs react-vite -Layers supabase -Apply   # add a stack pack or a layer
  .\kit-sync.ps1 -Target ..\my-app -Apply -Prune                               # also delete files the kit no longer ships
#>
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Source,
  [string]$Ref,
  [string[]]$Packs,
  [string[]]$Layers,
  [switch]$Apply,
  [switch]$Prune
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'node is required (Node 18+).'; exit 1 }
# A relative path is resolved from the current folder; an absolute one is used as is (Join-Path would glue
# C:\x and C:\y into C:\x\C:\y under Windows PowerShell 5).
function Resolve-KitPath([string]$Path) {
  if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Path))
}
$resolved = Resolve-KitPath $Target
Write-Host "kit-sync target: $resolved"
$argsList = @("$PSScriptRoot/tools/sync.mjs", '--target', $resolved)
if ($Source) { $argsList += @('--source', $Source) }
if ($Ref) { $argsList += @('--ref', $Ref) }
if ($PSBoundParameters.ContainsKey('Packs')) { $argsList += "--packs=$($Packs -join ',')" }
if ($PSBoundParameters.ContainsKey('Layers')) { $argsList += "--layers=$($Layers -join ',')" }
if ($Apply) { $argsList += '--apply' }
if ($Prune) { $argsList += '--prune' }
& node @argsList
exit $LASTEXITCODE
