@echo off
title FileStash Simple - Main Menu
color 0F

:menu
cls
echo.
echo ========================================
echo        FileStash Simple v2.0
echo     Advanced File Manager System
echo ========================================
echo.
echo Select an option:
echo.
echo [1] Setup - First time installation
echo [2] Start Server - Launch the application
echo [3] Open Browser - Access web interface
echo [4] Run Tests - Test functionality
echo [5] View Documentation - Open README
echo [6] Exit
echo.
echo ========================================
echo.

set /p choice="Enter your choice (1-6): "

if "%choice%"=="1" goto setup
if "%choice%"=="2" goto start
if "%choice%"=="3" goto browser
if "%choice%"=="4" goto test
if "%choice%"=="5" goto docs
if "%choice%"=="6" goto exit

echo Invalid choice. Please try again.
timeout /t 2 /nobreak >nul
goto menu

:setup
cls
echo.
echo Running setup wizard...
echo.
call setup.bat
pause
goto menu

:start
cls
echo.
echo Starting FileStash Simple server...
echo.
call start-server.bat
pause
goto menu

:browser
cls
echo.
echo Opening web interface...
echo.
call open-browser.bat
pause
goto menu

:test
cls
echo.
echo Running test suite...
echo.
call test-server.bat
pause
goto menu

:docs
cls
echo.
echo Opening documentation...
echo.
if exist "README.md" (
    start "" "README.md"
    echo README.md opened in default application
) else (
    echo README.md not found
)
if exist "ENHANCED_FEATURES_REPORT.md" (
    start "" "ENHANCED_FEATURES_REPORT.md"
    echo Features report opened
)
echo.
pause
goto menu

:exit
cls
echo.
echo ========================================
echo     Thank you for using FileStash!
echo ========================================
echo.
echo FileStash Simple - Advanced File Manager
echo.
echo Features:
echo   ✓ Recursive directory scanning
echo   ✓ Multi-threaded processing
echo   ✓ Database backup/restore
echo   ✓ File operations (copy/move/delete)
echo   ✓ Archive creation (7-Zip/WinRAR)
echo   ✓ Advanced search and filtering
echo   ✓ Web-based interface
echo.
echo For support or updates, check the documentation.
echo.
timeout /t 3 /nobreak >nul
exit /b 0