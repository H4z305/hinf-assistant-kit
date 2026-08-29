# register-checkin-task.ps1
# Registers a Windows Scheduled Task that runs proactive-checkin.js once a day.
#
# DO NOT RUN THIS UNLESS YOU HAVE DECIDED YOU WANT STANDING OS-LEVEL AUTOMATION.
# Remove it with:  Unregister-ScheduledTask -TaskName TelegramBridgeCheckin -Confirm:$false

$taskName   = "TelegramBridgeCheckin"
$scriptPath = Join-Path $PSScriptRoot "proactive-checkin.js"
$nodePath   = (Get-Command node).Source

if (-not (Test-Path $scriptPath)) {
    Write-Error "Not found: $scriptPath -- run this from the bridge folder. Aborting."
    exit 1
}

$action  = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$scriptPath`"" -WorkingDirectory (Split-Path $scriptPath)
$trigger = New-ScheduledTaskTrigger -Daily -At "8:03AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Telegram bridge daily proactive check-in"

Write-Output "Registered task '$taskName'. Test it once: Start-ScheduledTask -TaskName '$taskName', then check proactive.log."
