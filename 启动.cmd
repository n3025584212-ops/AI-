@echo off
title 冷轧轧制力预测云平台
cd /d "%~dp0"
set "TEMP=%~dp0tmp\process"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
curl -s -m 2 http://127.0.0.1:5189/api/health | findstr /c:"ok" >nul 2>&1
if not errorlevel 1 goto :open
echo 正在启动本地服务...
start "本地服务" /min cmd /c "node "%~dp0scripts\serve.mjs""
:wait
timeout /t 1 /nobreak >nul
curl -s -m 2 http://127.0.0.1:5189/api/health | findstr /c:"ok" >nul 2>&1
if errorlevel 1 goto :wait
:open
start http://127.0.0.1:5189/
echo.
echo  AI大模型与量子机器学习协同驱动的冷轧轧制力预测云平台 已就绪: http://127.0.0.1:5189/
echo  浏览器已打开。本窗口保持开着 = 服务在运行；关窗即停服务。
echo.
pause
