# register-checkin-task.ps1
# Registers a Windows Scheduled Task that runs proactive-checkin.js daily at 8:03am local time.
# DO NOT RUN THIS SCRIPT UNLESS YOU HAVE DECIDED YOU WANT STANDING OS-LEVEL AUTOMATION — it creates standing OS-level automation,
# which the design spec explicitly requires his go-ahead for at execution time, not just at design time.

$taskName = "EmilyTelegramCheckin"
$scriptPath = "C:\Emily\emily-telegram\proactive-checkin.js"
$nodePath = (Get-Command node).Source

$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$scriptPath`"" -WorkingDirectory (Split-Path $scriptPath)
$trigger = New-ScheduledTaskTrigger -Daily -At "8:03AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Emily proactive Telegram check-in"

Write-Output "Registered task '$taskName'. Test it once manually via: Start-ScheduledTask -TaskName '$taskName', then check proactive.log."
