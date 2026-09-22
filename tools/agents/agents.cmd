@echo off
REM One entry point for the CLI agents. Works from CMD, PowerShell, or a
REM double-click in Explorer.
REM
REM   agents.cmd            dashboard and menu
REM   agents.cmd check      who is signed in
REM   agents.cmd login gemini
REM   agents.cmd run        graded task on every signed-in agent
REM   agents.cmd ask "..."  one prompt to every signed-in agent
REM
REM %~dp0 is this file's own folder, so the path is right no matter where it
REM is run from - which matters because Windows does not search the current
REM directory for commands by default.
setlocal

set PS=powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agents.ps1"

if "%~1"=="" goto menu
if /I "%~1"=="check" ( %PS% -Check & goto done )
if /I "%~1"=="run"   ( %PS% -Run   & goto done )
if /I "%~1"=="login" (
  if "%~2"=="" ( echo usage: agents.cmd login ^<claude^|codex^|gemini^> & goto done )
  %PS% -Login %~2
  goto done
)
if /I "%~1"=="ask" (
  if "%~2"=="" ( echo usage: agents.cmd ask "what they should do" & goto done )
  %PS% -Ask "%~2"
  goto done
)

echo Unknown command: %~1
echo.
echo   agents.cmd            dashboard and menu
echo   agents.cmd check      who is signed in
echo   agents.cmd login ^<claude^|codex^|gemini^>
echo   agents.cmd run        graded task on every signed-in agent
echo   agents.cmd ask "..."  one prompt to every signed-in agent
goto done

:menu
%PS%
REM Keep the window open when launched by double-click, so the output is readable.
if /I "%~0"=="%~f0" pause

:done
endlocal
