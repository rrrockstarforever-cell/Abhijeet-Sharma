@echo off
cd /d "%~dp0"
node node_modules\vite\bin\vite.js build > build-live.log 2>&1
echo EXIT=%errorlevel% >> build-live.log
