@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-phone-remote.ps1"
if errorlevel 1 pause
