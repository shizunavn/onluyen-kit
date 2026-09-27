@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\puppeteer\package.json" (
  set PUPPETEER_SKIP_DOWNLOAD=true
  call npm install --no-audit --no-fund
)
node "cli\bulk-runner.js" --links "bulk-tests.txt" --dry-run %*
set EXIT_CODE=%ERRORLEVEL%
echo.
pause
exit /b %EXIT_CODE%
