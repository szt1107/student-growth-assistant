@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动美化版.ps1" -OpenBrowser
if errorlevel 1 pause
