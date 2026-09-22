@echo off
REM CMD wrapper for agent.ps1, so you can stay in a normal command prompt.
REM
REM   agent.cmd codex status
REM   agent.cmd codex login
REM   agent.cmd codex task
REM   agent.cmd codex ask "write a haiku about docker"
REM
setlocal

set AGENT=%~1
set ACTION=%~2

if "%AGENT%"=="" goto usage
if "%ACTION%"=="" goto usage

if /I "%ACTION%"=="status" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" -Agent %AGENT% -Status
  goto end
)
if /I "%ACTION%"=="login" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" -Agent %AGENT% -Login
  goto end
)
REM Claude finishes login by submitting the code the browser gave you.
if /I "%ACTION%"=="code" (
  if "%~3"=="" echo Give the code in quotes: agent.cmd claude code "<code>" ^& goto end
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0claude-login.ps1" -Code "%~3"
  goto end
)
if /I "%ACTION%"=="task" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" -Agent %AGENT% -Task
  goto end
)
if /I "%ACTION%"=="ask" (
  if "%~3"=="" echo Give a prompt in quotes: agent.cmd %AGENT% ask "your prompt" & goto end
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" -Agent %AGENT% -Prompt "%~3"
  goto end
)

echo Unknown action: %ACTION%

:usage
echo.
echo usage: agent.cmd ^<claude^|codex^|gemini^> ^<status^|login^|task^|ask "prompt"^>
echo.
echo   agent.cmd codex status
echo   agent.cmd codex login
echo   agent.cmd codex task
echo   agent.cmd codex ask "write a haiku about docker"
echo.

:end
endlocal
