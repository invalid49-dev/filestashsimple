@echo off
title FileStash Simple - Setup
color 0E

echo.
echo ========================================
echo    FileStash Simple - Setup Wizard
echo ========================================
echo.

REM Check if Node.js is installed
echo [STEP 1] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Recommended version: LTS (Long Term Support)
    echo.
    echo After installation, restart this script.
    echo.
    pause
    exit /b 1
) else (
    echo [SUCCESS] Node.js is installed
    node --version
)
echo.

REM Check npm
echo [STEP 2] Checking npm...
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not available
    echo.
    pause
    exit /b 1
) else (
    echo [SUCCESS] npm is available
    npm --version
)
echo.

REM Install dependencies
echo [STEP 3] Installing dependencies...
if exist "node_modules" (
    echo [INFO] Dependencies already installed, updating...
    npm update
) else (
    echo [INFO] Installing fresh dependencies...
    npm install
)

if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    echo.
    echo Try running: npm install --force
    echo.
    pause
    exit /b 1
) else (
    echo [SUCCESS] Dependencies installed successfully
)
echo.

REM Create required directories
echo [STEP 4] Creating required directories...
if not exist "archives" (
    mkdir archives
    echo [CREATED] archives directory
)
if not exist "backups" (
    mkdir backups
    echo [CREATED] backups directory
)
if not exist "public" (
    echo [ERROR] public directory missing!
    pause
    exit /b 1
) else (
    echo [SUCCESS] public directory exists
)
echo.

REM Check database
echo [STEP 5] Checking database...
if exist "filestash.db" (
    echo [INFO] Database file exists
) else (
    echo [INFO] Database will be created on first run
)
echo.

REM Check for external archivers
echo [STEP 6] Checking external archivers...
7z >nul 2>&1
if not errorlevel 1 (
    echo [FOUND] 7-Zip is available
) else (
    if exist "C:\Program Files\7-Zip\7z.exe" (
        echo [FOUND] 7-Zip is installed at default location
    ) else (
        echo [INFO] 7-Zip not found - install from https://www.7-zip.org/
    )
)

winrar >nul 2>&1
if not errorlevel 1 (
    echo [FOUND] WinRAR is available
) else (
    if exist "C:\Program Files\WinRAR\WinRAR.exe" (
        echo [FOUND] WinRAR is installed at default location
    ) else (
        echo [INFO] WinRAR not found - install from https://www.win-rar.com/
    )
)
echo.

echo ========================================
echo           SETUP COMPLETE!
echo ========================================
echo.
echo FileStash Simple is ready to use!
echo.
echo To start the server:
echo   1. Double-click start-server.bat
echo   2. Or run: npm start
echo.
echo To test the application:
echo   1. Double-click test-server.bat
echo   2. Or run individual test files
echo.
echo Server will be available at:
echo   http://localhost:3000
echo.
echo Features available:
echo   ✓ File scanning with batch processing
echo   ✓ Database backup and restore
echo   ✓ File operations (copy/move/delete)
echo   ✓ Archive creation (if 7-Zip/WinRAR installed)
echo   ✓ Directory browsing with expand/collapse
echo   ✓ Search with pagination (50-200 results)
echo.

set /p choice="Start server now? (y/n): "
if /i "%choice%"=="y" (
    echo.
    echo Starting server...
    call start-server.bat
) else (
    echo.
    echo Setup complete. Run start-server.bat when ready.
)

pause