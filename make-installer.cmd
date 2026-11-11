@echo off
cd /d "%~dp0"
set CSC_IDENTITY_AUTO_DISCOVERY=false
echo === build client === > release-build.log
node node_modules\vite\bin\vite.js build >> release-build.log 2>&1
if errorlevel 1 goto fail
echo === bundle server === >> release-build.log
node node_modules\esbuild\bin\esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=server.mjs --external:vite >> release-build.log 2>&1
if errorlevel 1 goto fail
echo === secret guard === >> release-build.log
node tools\check-secrets.mjs >> release-build.log 2>&1
if errorlevel 1 goto fail
echo === electron-builder === >> release-build.log
node node_modules\electron-builder\out\cli\cli.js --win nsis --x64 --publish never >> release-build.log 2>&1
if errorlevel 1 goto fail
echo EXIT=0 >> release-build.log
goto end
:fail
echo EXIT=%errorlevel% >> release-build.log
:end
