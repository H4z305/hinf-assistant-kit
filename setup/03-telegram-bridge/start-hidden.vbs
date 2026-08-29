' start-hidden.vbs
' Launches the bridge (node bot.js) with no console window (the 0 = SW_HIDE).
' Runs from this script's own folder, so it works wherever the kit is copied.
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "node bot.js", 0, False
