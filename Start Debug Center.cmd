@echo off
setlocal
title Pulse Med - Debug Control Center
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js 20+ or open this from a terminal where node is available.
  pause
  exit /b 1
)

echo Starting Pulse Med Debug Control Center...
node "tools\debug-center\launch.mjs" %*
if errorlevel 1 (
  echo.
  echo The Debug Control Center could not be started.
  echo Check debug-center-data\center.err.log and center.out.log.
  pause
  exit /b 1
)
exit /b 0
