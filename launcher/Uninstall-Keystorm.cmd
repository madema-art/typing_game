@echo off
rem Removes KEYSTORM, its shortcuts and its saved data.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-Keystorm.ps1" %*
pause
