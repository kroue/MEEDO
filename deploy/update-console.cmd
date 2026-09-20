@echo off
REM Ships a code change to the office: rebuild, then restart the console.
REM
REM Skipping the rebuild is the classic mistake — `next start` serves whatever
REM was last built, so without this the PCs keep running the old console.

setlocal
cd /d "%~dp0.."

echo === Building ===
call npm run build || exit /b 1

echo === Restarting the console ===
schtasks /end /tn "MEEDO Console" >nul 2>&1
schtasks /run /tn "MEEDO Console" || (
  echo Scheduled task not found - start it yourself with: npm run start
  exit /b 1
)

echo.
echo Done. Now purge the Cloudflare cache so no PC is served the old files:
echo   Cloudflare dashboard - Caching - Configuration - Purge Everything
endlocal
