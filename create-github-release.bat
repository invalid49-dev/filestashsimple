@echo off
echo ========================================
echo   FileStash - GitHub Release v2.0.1
echo   "Filestash Super Beta 2.0.1 Rar Removed (Need UI Fixes)"
echo ========================================
echo.

echo Step 1: Checking git status...
git status
echo.

echo Step 2: Adding all changes...
git add .
if errorlevel 1 (
    echo ERROR: Failed to add files!
    pause
    exit /b 1
)
echo.

echo Step 3: Committing changes...
git commit -m "Release v2.0.1: Fixed CRC32 consistency bug, removed WinRAR, added testing tools"
if errorlevel 1 (
    echo WARNING: Nothing to commit or commit failed
)
echo.

echo Step 4: Creating tag...
git tag -a v2.0.1 -m "Filestash Super Beta 2.0.1 Rar Removed (Need UI Fixes) - Critical CRC32 fix + WinRAR removal"
if errorlevel 1 (
    echo ERROR: Failed to create tag!
    pause
    exit /b 1
)
echo.

echo Step 5: Pushing to GitHub...
echo Pushing commits...
git push origin main
if errorlevel 1 (
    echo ERROR: Failed to push commits!
    pause
    exit /b 1
)
echo.

echo Pushing tags...
git push origin v2.0.1
if errorlevel 1 (
    echo ERROR: Failed to push tag!
    pause
    exit /b 1
)
echo.

echo ========================================
echo   SUCCESS! Release v2.0.1 created!
echo ========================================
echo.
echo Next steps:
echo 1. Go to GitHub repository
echo 2. Navigate to "Releases"
echo 3. Click "Draft a new release"
echo 4. Select tag: v2.0.1
echo 5. Title: "Filestash Super Beta 2.0.1 Rar Removed (Need UI Fixes)"
echo 6. Copy release notes from CHANGELOG.md
echo 7. Mark as "Pre-release" (beta)
echo 8. Publish release
echo.
pause
