@echo off
cd /d "%~dp0"
set NODE_ENV=production
set PORT=3000
set PULSE_DATA_DIR=%APPDATA%\pulse-med
node node_modules\tsx\dist\cli.mjs server.ts >> server-live.log 2>&1
echo EXIT=%errorlevel% >> server-live.log
