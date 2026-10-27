@echo off
set "ELECTRON_RUN_AS_NODE="
cd /d "%~dp0"
"..\node_modules\electron\dist\electron.exe" . > "C:\Users\13704\AppData\Local\Temp\mini-launch.log" 2>&1
echo EXIT=%ERRORLEVEL% >> "C:\Users\13704\AppData\Local\Temp\mini-launch.log"
