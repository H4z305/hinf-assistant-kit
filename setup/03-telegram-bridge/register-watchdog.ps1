# register-watchdog.ps1
# Registers a Windows Scheduled Task that restarts the Telegram bridge if it dies.
#
# DO NOT RUN THIS UNLESS YOU HAVE DECIDED YOU WANT STANDING OS-LEVEL AUTOMATION.
# It creates a Scheduled Task that fires every 5 minutes for as long as it is
# registered. Remove it with:  schtasks /Delete /TN TelegramBridgeWatchdog /F
#
# The task stays invisible (no console flash every 5 minutes) via two things,
# not the Hidden flag (which only hides it in the Task Scheduler UI):
#   - wscript.exe is the WINDOWLESS script host, unlike cscript.exe
#   - watchdog-hidden.vbs calls WshShell.Run with 0 = SW_HIDE
#
# WHY schtasks.exe AND NOT Register-ScheduledTask:
# Register-ScheduledTask fails with "Access is denied" from a non-elevated
# shell, and so does `schtasks /Create /XML` (the XML declares a Principal).
# `schtasks /Create /SC MINUTE` succeeds as the current user. Settings that
# schtasks cannot express are then applied with Set-ScheduledTask, which is
# permitted on a task you already own. This sequence is verified working
# unelevated -- do not "simplify" it back to Register-ScheduledTask.

$taskName = "TelegramBridgeWatchdog"
$vbsPath  = Join-Path $PSScriptRoot "watchdog-hidden.vbs"

if (-not (Test-Path $vbsPath)) {
    Write-Error "Launcher not found at $vbsPath -- aborting."
    exit 1
}

# Step 1: create the task. /F replaces any previous registration.
# The vbs path may contain spaces, so /TR is quoted.
$trValue = "wscript.exe `"$vbsPath`""
schtasks.exe /Create /TN $taskName /TR $trValue /SC MINUTE /MO 5 /F | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "schtasks /Create failed with exit code $LASTEXITCODE. NO watchdog is active."
    exit 1
}

# Step 2: apply what schtasks cannot express.
# Priority 7 is BelowNormal, so the watchdog can never contend with a game for
# CPU. Battery restrictions are switched off so it keeps running on a laptop.
# RunOnlyIfIdle is deliberately NOT set: it would disable the watchdog exactly
# while you are at the machine, which is when you would notice it missing.
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
# above.
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
