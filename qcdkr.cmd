@echo off
setlocal
cd /d "%~dp0"
set "PATH=%~dp0toolchain\node;%PATH%"
set "TEMP=%~dp0tmp\process"
set "TMP=%TEMP%"
set "npm_config_cache=%~dp0tmp\npm-cache"
set "ELECTRON_BUILDER_CACHE=%~dp0toolchain\builder-cache"
if not exist "%TEMP%" mkdir "%TEMP%"
if "%~1"=="" (
  echo Usage: qcdkr.cmd verify ^| test ^| build ^| dev ^| start ^| app ^| package:dir ^| package
  exit /b 0
)
"%~dp0toolchain\node\node.exe" "%~dp0toolchain\node\node_modules\npm\bin\npm-cli.js" run %*
exit /b %errorlevel%
