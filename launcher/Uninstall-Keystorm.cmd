@echo off
rem Removes KEYSTORM and its shortcuts (saved high scores are kept unless you choose otherwise).
rem Everything runs on one line: this file may be deleted while it runs.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-Keystorm.ps1" %* & pause
