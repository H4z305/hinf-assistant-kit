' watchdog-hidden.vbs
' Launches watchdog.js with NO console window. The "0" argument to Run is the
' whole point: it means SW_HIDE, so nothing appears on screen -- not a window,
' not a taskbar entry, not a flash.
'
' This matters because the watchdog fires every five minutes. Thamer games on
' this machine, and a cmd window stealing focus mid-match every five minutes
' would be worse than the outage this thing exists to prevent.
'
' False as the third argument means do not wait for it to finish; the watchdog
' exits in well under a second anyway.
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Emily\emily-telegram"
WshShell.Run "node watchdog.js", 0, False
