Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Emily\emily-telegram"
WshShell.Run "node bot.js", 0, False
