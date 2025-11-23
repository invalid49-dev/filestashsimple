@echo off
echo ========================================
echo   Verifying CRC32 Fix
echo ========================================
echo.

echo Step 1: Testing file consistency...
node test-crc32-consistency.js "P:\Video\A\Amelia Model.wmv"
if errorlevel 1 (
    echo ERROR: Consistency test failed!
    pause
    exit /b 1
)
echo.

echo Step 2: Testing another large file...
node test-crc32-consistency.js "p:\Video\S\StarSession\Julia\Julia-030p.4K.mp4"
if errorlevel 1 (
    echo ERROR: Consistency test failed!
    pause
    exit /b 1
)
echo.

echo ========================================
echo   All tests PASSED!
echo ========================================
echo.
echo Next steps:
echo 1. Restart FileStash server
echo 2. Clear database (or run fix-crc32-mismatches.js)
echo 3. Rescan directories
echo 4. Run integrity check
echo.
pause
