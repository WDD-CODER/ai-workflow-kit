<#
.SYNOPSIS
  Install the AI workflow kit into a project (thin wrapper over tools/install.mjs).
.EXAMPLE
  .\kit-install.ps1 -Target ..\my-app -Packs angular,node-express -Cursor
  .\kit-install.ps1 -Target ..\my-app -Packs react-vite -Layers supabase,upstream-owned
  .\kit-install.ps1 -Target ..\my-app -DryRun    # no -Packs and no stack.packs: proposes the detected stack, writes nothing
  .\kit-install.ps1 -Target ..\my-app -Yes       # installs the detected stack and records it in kit.config.json
  .\kit-install.ps1 -Target ..\my-app -Source github:WDD-CODER/ai-workflow-kit -Ref v0.5.0 -Packs angular
  .\kit-install.ps1 -Target ..\my-app -Adopt -Source github:WDD-CODER/ai-workflow-kit -Ref v1.0.0   # project already carries the workflow: writes only .kit/install.json
.NOTES
  Requires Node 18+. Never overwrites existing files unless -Force. -Packs '' installs the stack-neutral core only. Run kit-sync.ps1 later to see kit updates.
#>
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$Source,
  [string]$Ref,
  [string]$Config,
  [string[]]$Packs,
  [string[]]$Layers,
  [switch]$Yes,
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
# A relative path is resolved from the current folder; an absolute one is used as is (Join-Path would glue
# C:\x and C:\y into C:\x\C:\y under Windows PowerShell 5).
function Resolve-KitPath([string]$Path) {
  if ([System.IO.Path]::IsPathRooted($Path)) { return [System.IO.Path]::GetFullPath($Path) }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $Path))
}
$resolved = Resolve-KitPath $Target
Write-Host "kit-install target: $resolved"
$argsList = @("$PSScriptRoot/tools/install.mjs", '--target', $resolved)
if ($Source) { $argsList += @('--source', $Source) }
if ($Ref) { $argsList += @('--ref', $Ref) }
if ($Config) { $argsList += @('--config', (Resolve-KitPath $Config)) }
if ($PSBoundParameters.ContainsKey('Packs')) { $argsList += "--packs=$($Packs -join ',')" }
if ($PSBoundParameters.ContainsKey('Layers')) { $argsList += "--layers=$($Layers -join ',')" }
if ($Yes) { $argsList += '--yes' }
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
