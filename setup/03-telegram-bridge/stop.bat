@echo off
if not exist bot.pid (
  echo No bot.pid found - bot doesn't appear to be running.
  exit /b 1
)
set /p PID=<bot.pid
taskkill /PID %PID% /F
del bot.pid
