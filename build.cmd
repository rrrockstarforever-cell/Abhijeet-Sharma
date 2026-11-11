@echo off
cd /d "%~dp0"
call npm run build > build-final.log 2>&1
echo EXIT=%errorlevel% >> build-final.log
