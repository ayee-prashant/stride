@echo off
REM Start the local agent control panel and open it in the browser.
REM
REM   ui.cmd          start on port 7391
REM   ui.cmd 8080     start on another port
REM
REM It has to run locally: every button shells out to docker on this machine.
setlocal

set PORT=%~1
if "%PORT%"=="" set PORT=7391

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required but was not found on PATH.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

docker version >nul 2>&1
if errorlevel 1 (
  echo Docker does not appear to be running. Start Docker Desktop and try again.
  pause
  exit /b 1
)

echo.
echo   Starting the control panel on http://localhost:%PORT%
echo   Leave this window open. Ctrl+C to stop.
echo.

REM Give the server a moment to bind before the browser asks for the page.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"

set PORT=%PORT%
node "%~dp0ui.mjs"

endlocal
