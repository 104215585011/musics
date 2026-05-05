@echo off
setlocal

set "APP_DIR=C:\Users\10421\musics"
set "ELECTRON_EXE=%APP_DIR%\node_modules\electron\dist\electron.exe"
set "PORTS=3000 4000 9333"

echo.
echo [Claudio Desktop] Cleaning Claudio ports...
for %%A in (%PORTS%) do (
  for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%%A .*LISTENING"') do (
    echo [Claudio Desktop] Port %%A is used by PID %%P. Stopping it...
    taskkill /PID %%P /T /F >nul 2>nul
  )
)

echo [Claudio Desktop] Cleaning old Claudio Node/Electron processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -match '^(node|electron)\.exe$') -and ($_.CommandLine -like '*C:\Users\10421\musics*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo [Claudio Desktop] Starting desktop app...
cd /d "%APP_DIR%"

if exist "%ELECTRON_EXE%" (
  start "Claudio FM Desktop" /D "%APP_DIR%" "%ELECTRON_EXE%" .
) else (
  start "Claudio FM Desktop" /D "%APP_DIR%" cmd /c npm run desktop
)

echo [Claudio Desktop] Launched.
endlocal
