# register-watchdog.ps1
# Registers a Windows Scheduled Task that restarts the Telegram bridge if it dies.
#
# DO NOT RUN THIS SCRIPT WITHOUT ASKING THAMER FIRST -- it creates standing
# OS-level automation. He approved this specific registration on 2026-08-18;
# that approval covers this task, not a standing licence for any future session
# to re-register or alter OS automation.
#
# HARD CONSTRAINT, his words: "do not let it interrupt my pc play."
# The invisibility does NOT come from the task's Hidden flag (that only controls
# whether it shows in the Task Scheduler UI). It comes from two things:
#   - wscript.exe is the WINDOWLESS script host, unlike cscript.exe
#   - watchdog-hidden.vbs calls WshShell.Run with 0 = SW_HIDE
# Together those mean node never gets a console, so nothing can flash on screen
# every five minutes.
#
# WHY schtasks.exe AND NOT Register-ScheduledTask:
# Register-ScheduledTask fails with "Access is denied" from a non-elevated
# shell, and so does `schtasks /Create /XML` (the XML declares a Principal).
# `schtasks /Create /SC MINUTE` succeeds as the current user. Settings that
# schtasks cannot express are then applied with Set-ScheduledTask, which is
# permitted on a task you already own. This sequence is verified working
# unelevated -- do not "simplify" it back to Register-ScheduledTask.

$taskName    = "EmilyTelegramWatchdog"
$oldTaskName = "Emily-Bridge-Watchdog"   # dormant OpenClaw-era task this replaces
$vbsPath     = "C:\Emily\emily-telegram\watchdog-hidden.vbs"

if (-not (Test-Path $vbsPath)) {
    Write-Error "Launcher not found at $vbsPath -- aborting."
    exit 1
}

# Remove the dormant OpenClaw-era watchdog so two of them cannot both fire.
$old = Get-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue
if ($null -ne $old) {
    try {
        Unregister-ScheduledTask -TaskName $oldTaskName -Confirm:$false -ErrorAction Stop
        Write-Output "Removed the dormant '$oldTaskName' task."
    } catch {
        Write-Warning "Could not remove '$oldTaskName': $($_.Exception.Message)"
    }
}

# Step 1: create the task. /F replaces any previous registration.
# The vbs path contains no spaces, so /TR needs no nested quoting.
$trValue = "wscript.exe $vbsPath"
schtasks.exe /Create /TN $taskName /TR $trValue /SC MINUTE /MO 5 /F | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "schtasks /Create failed with exit code $LASTEXITCODE. NO watchdog is active."
    exit 1
}

# Step 2: apply what schtasks cannot express.
# Priority 7 is BelowNormal, so the watchdog can never contend with a game for
# CPU. Battery restrictions are switched off so it keeps running on a laptop.
# RunOnlyIfIdle is deliberately NOT set: it would disable the watchdog exactly
# while Thamer is at the machine, which is when he would notice it missing.
try {
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                                             -DontStopIfGoingOnBatteries `
                                             -StartWhenAvailable `
                                             -Hidden `
                                             -MultipleInstances IgnoreNew `
                                             -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    $settings.Priority = 7
    Set-ScheduledTask -TaskName $taskName -Settings $settings -ErrorAction Stop | Out-Null
} catch {
    Write-Warning "Task created but settings could not be applied: $($_.Exception.Message)"
    Write-Warning "The watchdog still works; it just kept schtasks defaults."
}

# Step 3: verify against the actual task store rather than trusting the calls
# above. An earlier version of this script printed "Registered" while the
# registration had in fact been rejected -- precisely the silent failure this
# whole rework exists to eliminate.
$registered = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $registered) {
    Write-Error "Registration reported success but '$taskName' is not in the task store. NO watchdog is active."
    exit 1
}

$xml = schtasks /Query /TN $taskName /XML | Out-String
$hasRepeat = $xml -match "<Interval>PT5M</Interval>"
$openEnded = -not ($xml -match "<Repetition>[\s\S]*?<Duration>")

Write-Output "Verified '$taskName'. State: $($registered.State)"
Write-Output "  repeats every 5 minutes : $hasRepeat"
Write-Output "  repeats indefinitely    : $openEnded"
Write-Output "  runs as                 : $env:USERNAME (interactive)"
Write-Output ""
Write-Output "Test it: kill the bridge, then run"
Write-Output "  Start-ScheduledTask -TaskName '$taskName'"
Write-Output "and check watchdog.log for 'Bridge restarted.'"
