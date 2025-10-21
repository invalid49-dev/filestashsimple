@echo off
title FileStash Simple - Test Suite
color 0B

echo.
echo ========================================
echo    FileStash Simple - Test Suite
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

echo [INFO] Running tests...
echo.

REM Test 1: Simple API test
echo [TEST 1] Basic API functionality...
node simple-test.js
if errorlevel 1 (
    echo [WARNING] Basic API test had issues
) else (
    echo [SUCCESS] Basic API test passed
)
echo.

REM Test 2: Features test
echo [TEST 2] Enhanced features...
node test-features-simple.js
if errorlevel 1 (
    echo [WARNING] Features test had issues
) else (
    echo [SUCCESS] Features test passed
)
echo.

REM Test 3: Fixes test
echo [TEST 3] Bug fixes...
node test-fixes.js
if errorlevel 1 (
    echo [WARNING] Fixes test had issues
) else (
    echo [SUCCESS] Fixes test passed
)
echo.

echo ========================================
echo All tests completed!
echo.
echo If server is running, you can test manually at:
echo http://localhost:3000
echo.
pause