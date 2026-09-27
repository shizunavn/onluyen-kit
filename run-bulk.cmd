@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js. Hay cai Node.js 20 tro len.
  pause
  exit /b 1
)

if not exist "node_modules\puppeteer\package.json" (
  echo Dang cai Puppeteer lan dau...
  set PUPPETEER_SKIP_DOWNLOAD=true
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Cai Puppeteer that bai.
    pause
    exit /b 1
  )
)

node "cli\bulk-runner.js" --links "bulk-tests.txt" --submit --headless %*
set EXIT_CODE=%ERRORLEVEL%
echo.
pause
exit /b %EXIT_CODE%
