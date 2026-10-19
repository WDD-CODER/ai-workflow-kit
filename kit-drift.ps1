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
# A folder or file as PowerShell itself resolves it: relative to the current location, absolute, drive-relative
# (C:foo) or root-relative (\foo). (Join-Path glued an absolute path onto the current folder under Windows PowerShell 5.)
# A trailing slash is dropped, except on a drive root: "...\my-app\" would end the quoted argument node receives in \"
# and swallow the arguments after it.
function Resolve-KitPath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path))
  $root = [System.IO.Path]::GetPathRoot($full)
  if ($full.Length -gt $root.Length) { $full = $full.TrimEnd('\', '/') }
  return $full
}
$resolved = Resolve-KitPath $Target
Write-Host "kit-drift target: $resolved"
$argsList = @("$PSScriptRoot/tools/drift-check.mjs", '--target', $resolved)
if ($Source) { $argsList += @('--source', $Source) }
if ($Ref) { $argsList += @('--ref', $Ref) }
if ($PSBoundParameters['Verbose']) { $argsList += '--verbose' }
& node @argsList
exit $LASTEXITCODE
