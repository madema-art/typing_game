@echo off
rem Installs KEYSTORM for this Windows user and creates a desktop shortcut.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Keystorm.ps1" %*
if errorlevel 1 pause
