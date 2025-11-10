@echo off
echo ========================================
echo FileStash Simple - Release Preparation
echo ========================================
echo.

echo [1/5] Checking Git status...
git status
echo.

echo [2/5] Adding all changes...
git add .
echo.

echo [3/5] Creating commit...
set /p commit_msg="Enter commit message (or press Enter for default): "
if "%commit_msg%"=="" set commit_msg=Release v2.0.0 - Performance Revolution

git commit -m "%commit_msg%"
echo.

echo [4/5] Creating tag v2.0.0...
git tag -a v2.0.0 -m "Version 2.0.0 - Database caching, lazy tree loading, smart search"
echo.

echo [5/5] Ready to push!
echo.
echo To push to GitHub, run:
echo   git push origin main
echo   git push origin v2.0.0
echo.
echo Or run: git push origin main --tags
echo.

pause
