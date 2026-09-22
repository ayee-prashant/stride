@echo off
REM One entry point for the agent team.
REM
REM   agents doctor          check everything; say how to fix what is broken
REM   agents setup           build and wire everything (safe to re-run)
REM   agents status          the team at a glance
REM   agents login claude    sign in a runtime
REM   agents run manager "plan and assign ..."
REM   agents ui              open the tracking panel
REM
REM %~dp0 is this file's own folder, so it works from anywhere - Windows does
REM not search the current directory for commands by default.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agents.ps1" %1 %2 %3
endlocal
