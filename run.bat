@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo VXL needs Node.js 22 or newer. Install Node.js, then reopen this launcher.
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo VXL needs pnpm. With Node.js installed, run: npm install -g pnpm@11
  pause
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  call pnpm install
  if errorlevel 1 goto :failed
)
call pnpm models:setup
if errorlevel 1 goto :failed
call pnpm dev --open
if errorlevel 1 goto :failed
exit /b 0
:failed
echo VXL could not start. See the message above.
pause
exit /b 1
