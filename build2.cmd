@echo off
cd /d "%~dp0"
node node_modules\vite\bin\vite.js build > build-final2.log 2>&1
echo EXIT=%errorlevel% >> build-final2.log
