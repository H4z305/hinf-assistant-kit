' watchdog-hidden.vbs
' Launches watchdog.js with NO console window. The "0" argument to Run is the
' whole point: it means SW_HIDE, so nothing appears on screen -- not a window,
' not a taskbar entry, not a flash. That matters because the watchdog fires
' every five minutes; a cmd window stealing focus that often would be worse
' than the outage it exists to prevent.
'
' False as the third argument means do not wait for it to finish; the watchdog
' exits in well under a second anyway.
'
' Runs from this script's own folder, so it works wherever the kit is copied.
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "node watchdog.js", 0, False
