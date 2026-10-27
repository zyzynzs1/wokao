@echo off
rem SmartScreen only checks Explorer/Shell launches. Launching from cmd avoids it.
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
"%~dp0wokao.exe"
if errorlevel 1 pause
