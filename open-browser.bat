@echo off
title FileStash Simple - Open Browser
color 0C

echo.
echo ========================================
echo    Opening FileStash Simple in Browser
echo ========================================
echo.

REM Check if server is running on common ports
echo [INFO] Checking for running FileStash server...

set "server_found=false"
set "server_port="

REM Check ports 3000-3010
for /L %%i in (3000,1,3010) do (
    netstat -an | find "%%i" | find "LISTENING" >nul
    if not errorlevel 1 (
        set "server_found=true"
        set "server_port=%%i"
        goto :found_server
    )
)

:found_server
if "%server_found%"=="false" (
    echo [WARNING] FileStash server not found on common ports
    echo.
    echo The server may be running on a different port or not started.
    echo.
    set /p choice="Try to start server now? (y/n): "
    if /i "!choice!"=="y" (
        echo.
        echo Starting server with auto-browser opening...
        start "" cmd /c start-server.bat
        echo.
        echo Server will open browser automatically when ready.
        timeout /t 3 /nobreak >nul
        exit /b 0
    ) else (
        echo.
        echo Please start the server manually:
        echo   1. Run start-server.bat (recommended - opens browser automatically)
        echo   2. Or run: node startup.js
        pause
        exit /b 1
    )
) else (
    echo [SUCCESS] Server found on port %server_port%
)

echo [INFO] Opening browser...
echo.
if defined server_port (
    echo URL: http://localhost:%server_port%
    echo.
    
    REM Try to open in default browser
    start "" "http://localhost:%server_port%"
    
    if errorlevel 1 (
        echo [ERROR] Could not open browser automatically
        echo.
        echo Please open your browser manually and go to:
        echo http://localhost:%server_port%
    ) else (
        echo [SUCCESS] Browser opened successfully
    )
) else (
    echo [INFO] Trying default port 3000...
    start "" "http://localhost:3000"
    echo.
    echo If this doesn't work, check the server console for the correct port.
)

echo.
echo FileStash Simple should now be loading...
echo.
echo Features to test:
echo   • Scanning tab - Select directories and scan
echo   • Search tab - Find files and perform operations
echo   • Settings tab - Configure threads and backup database
echo.

timeout /t 3 /nobreak >nul
echo Closing this window...
timeout /t 2 /nobreak >nul