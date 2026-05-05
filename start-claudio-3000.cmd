@echo off
setlocal

set "APP_DIR=C:\Users\10421\musics"
set "PORT=3000"

echo.
echo [Claudio] Checking port %PORT%...

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo [Claudio] Port %PORT% is used by PID %%P. Stopping it...
  taskkill /PID %%P /F >nul 2>nul
)

echo [Claudio] Starting server...
cd /d "%APP_DIR%"

node server\server.js

echo.
echo [Claudio] Server exited.
pause
