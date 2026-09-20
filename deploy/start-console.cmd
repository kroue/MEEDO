@echo off
REM Starts the MEEDO Admin Console for the office.
REM
REM Serves the BUILT app: it does not compile anything, so a code change needs
REM update-console.cmd (or npm run build) before it shows up here.
REM
REM Registered as a scheduled task that runs at startup, so the console comes
REM back on its own after a power cut and needs nobody logged in.

cd /d "%~dp0.."

if not exist ".next" (
  echo No build found. Run: npm run build
  exit /b 1
)

set NODE_ENV=production
npm run start
