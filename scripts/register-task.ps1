<#
.SYNOPSIS
  Installs the twice-weekly overnight generation run for the Clarity Pinterest pipeline.

.DESCRIPTION
  Registers a Windows scheduled task that runs `npm run generate` in this repo every
  Monday and Thursday at 02:00. The job is queue-aware: if the posting calendar already
  runs far enough ahead it exits immediately without generating anything. It never posts
  to Pinterest and never approves a list - approving stays a manual step.

  Wakes the machine at 02:00 to run (-WakeToRun). This needs Windows "Allow wake timers" enabled
  for the active power plan - on battery it is often off by default, in which case the run is simply
  deferred. StartWhenAvailable is the safety net: a missed run fires at the next logon.

  Runs as the current user, so no elevated prompt is needed and the task only fires while
  you are logged on. StartWhenAvailable means a run missed because the machine was off
  fires the next time you are logged in.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -Unregister
#>
param([switch]$Unregister)

$ErrorActionPreference = "Stop"
$TaskName = "Clarity Pinterest generation"
$RepoDir = Split-Path -Parent $PSScriptRoot

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
    return
}

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm.cmd was not found on PATH. Install Node.js, or edit this script to point at npm.cmd directly." }

$action = New-ScheduledTaskAction -Execute $npm -Argument "run generate" -WorkingDirectory $RepoDir
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Thursday -At 2am
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Clarity: top up the Pinterest review queue (ideas -> draft -> design -> review). Never posts." `
    -Force | Out-Null

Write-Host "Registered '$TaskName' - Mondays and Thursdays at 02:00."
Write-Host "Working directory: $RepoDir"
Write-Host ""
Write-Host "Run it now:      Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Check last run:  Get-ScheduledTaskInfo -TaskName '$TaskName'"
Write-Host "Remove it:       powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -Unregister"
