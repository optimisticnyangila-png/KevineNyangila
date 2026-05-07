@echo off
echo 🚀 Starting FlowPost Application...
echo.

echo 📋 Checking ports...
netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ❌ Port 3000 is in use. Killing process...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do taskkill /PID %%a /F >nul 2>&1
    timeout /t 2 >nul
)

netstat -ano | findstr :5000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ❌ Port 5000 is in use. Killing process...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000') do taskkill /PID %%a /F >nul 2>&1
    timeout /t 2 >nul
)

echo ✅ Ports are free. Starting servers...
npm start