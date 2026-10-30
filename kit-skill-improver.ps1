<#
.SYNOPSIS
  Register or remove the daily skill-improver task (Windows PowerShell 5).
.DESCRIPTION
  -Register   creates the task "ai-workflow-kit skill-improver": daily at -Time (default 02:10, so the nightly
              kit-learn run at 03:10 follows it), runs node tools/skill-improver/run.mjs --target skill from this
              kit checkout, only on AC power. StartWhenAvailable is OFF: if the PC is off at that time the run is
              skipped and never caught up.
  -Unregister removes the task.
  -Status     prints the task XML (daily trigger, StartWhenAvailable).
  -PrintOnly  with -Register: print the exact command and change nothing.
  Registering changes the machine: run -PrintOnly first and register only on purpose.
.EXAMPLE
  .\kit-skill-improver.ps1 -Register -PrintOnly
  .\kit-skill-improver.ps1 -Register
  .\kit-skill-improver.ps1 -Register -Time 02:30
  .\kit-skill-improver.ps1 -Status
  .\kit-skill-improver.ps1 -Unregister
#>
[CmdletBinding()]
param(
  [switch]$Register,
  [switch]$Unregister,
  [switch]$Status,
  [switch]$PrintOnly,
  [string]$Time = '02:10'
)
$ErrorActionPreference = 'Stop'
$TaskName = 'ai-workflow-kit skill-improver'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'node is required (Node 18+).'; exit 1 }
$run = Join-Path $PSScriptRoot 'tools\skill-improver\run.mjs'
$argument = '"' + $run + '" --target skill'

if ($Status) {
  schtasks /query /tn $TaskName /xml
  exit $LASTEXITCODE
}
if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed '$TaskName'."
  exit 0
}
if ($Register) {
  $action = New-ScheduledTaskAction -Execute $node.Source -Argument $argument -WorkingDirectory $PSScriptRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $Time
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $settings.StartWhenAvailable = $false
  $settings.DisallowStartIfOnBatteries = $true
  $settings.StopIfGoingOnBatteries = $true
  if ($PrintOnly) {
    Write-Host "Would register '$TaskName': daily at $Time, StartWhenAvailable off, AC power only"
    Write-Host "  $($node.Source) $argument   (in $PSScriptRoot)"
    exit 0
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Nightly evidence-driven skill upgrades (opens a kit PR only when the new version scores higher).' | Out-Null
  Write-Host "Registered '$TaskName' daily at $Time. Check: .\kit-skill-improver.ps1 -Status"
  exit 0
}
Get-Help $MyInvocation.MyCommand.Path -Detailed
