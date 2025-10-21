@echo off
title FileStash Simple Server
color 0A

echo.
echo ========================================
echo    FileStash Simple - File Manager
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [INFO] Node.js version:
node --version

REM Check if package.json exists
if not exist "package.json" (
    echo [ERROR] package.json not found
    echo Make sure you're running this from the filestash-simple directory
    echo.
    pause
    exit /b 1
)

REM Check if node_modules exists, if not install dependencies
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    echo.
    npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [SUCCESS] Dependencies installed successfully
    echo.
)

REM Create directories if they don't exist
if not exist "archives" mkdir archives
if not exist "backups" mkdir backups

echo [INFO] Starting FileStash Simple server...
echo.
echo [INFO] Automatic port detection enabled
echo [INFO] Browser will open automatically
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

REM Start the server with enhanced startup
node startup.js

REM Fallback to npm start if startup.js fails
if errorlevel 1 (
    echo.
    echo [WARNING] Enhanced startup failed, trying standard startup...
    npm start
)

REM If server stops, show message
echo.
echo [INFO] Server stopped
echo.
pause