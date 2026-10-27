@echo off
rem Fallback: run the project's Electron directly, also from cmd (avoids Explorer SmartScreen).
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
"%~dp0node_modules\electron\dist\electron.exe" "."
if errorlevel 1 pause
