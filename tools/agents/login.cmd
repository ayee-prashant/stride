@echo off
REM Interactive login for one agent container. Run from this folder:
REM     login.cmd codex     |     login.cmd claude     |     login.cmd gemini
setlocal

set AGENT=%~1
if "%AGENT%"=="" goto usage
if /I "%AGENT%"=="claude" goto ok
if /I "%AGENT%"=="codex"  goto ok
if /I "%AGENT%"=="gemini" goto ok
goto usage

:ok
set PORTS=
set IMGSUFFIX=
if /I "%AGENT%"=="codex" set IMGSUFFIX=-official
if /I "%AGENT%"=="codex"  set PORTS=-p 1455:1455
if /I "%AGENT%"=="gemini" set PORTS=-p 8085:8085 -p 7777:7777

REM Launch the CLI itself, not a bash prompt. Dropping the user at a shell and
REM telling them to type the command invites typing it into the host shell by
REM mistake, which just reports "not recognized".
set LAUNCH=bash
if /I "%AGENT%"=="gemini" set LAUNCH=gemini

echo.
if /I "%AGENT%"=="claude" (
  echo Claude cannot be logged in here - its prompt needs a paste that a
  echo container TTY on Windows cannot receive. Use instead:
  echo     .\claude-login.ps1 -Start
  echo.
  goto end
)
if /I "%AGENT%"=="gemini" (
  echo Starting Gemini inside the container. At the prompts choose:
  echo     Do you trust the files in this folder?  -^> 1  ^(Trust folder^)
  echo     Auth method                             -^> Login with Google
  echo Then open the URL it prints. Nothing to paste - the callback returns
  echo to localhost:8085 on its own. Type /quit when it says you are signed in.
)
if /I "%AGENT%"=="codex" (
  echo Opening a shell. Run:  codex login --device-auth    then type: exit
)
echo.

REM A login shell left running keeps holding the OAuth callback ports, so the
REM next login dies with "Bind for 0.0.0.0:7777 failed: port is already
REM allocated" - which names the port but not the container. Giving the helper
REM a fixed name lets us reclaim it automatically. This container is a
REM disposable login shell; credentials live in the agent-%AGENT%-home volume,
REM so nothing is lost by replacing it.
REM Gemini's credential store is encrypted and a file written in one container
REM cannot be read in the next - verified twice, including a file created
REM minutes earlier. Docker derives the hostname from the random container ID
REM unless told otherwise, so pin it. --name is NOT enough: it does not set the
REM hostname. Login and task runs must use the same value.
set HOSTARG=
if /I "%AGENT%"=="gemini" set HOSTARG=--hostname stride-agent-gemini

set CNAME=stride-login-%AGENT%
docker rm -f %CNAME% >nul 2>&1

docker run --rm -it --name %CNAME% %HOSTARG% -v agent-%AGENT%-home:/home/agent -v "%~dp0workspace:/work" %PORTS% stride-agent-%AGENT%%IMGSUFFIX% %LAUNCH%

REM -it leaves the container running if the window is closed rather than exited.
docker rm -f %CNAME% >nul 2>&1
goto end

:usage
echo usage: login.cmd claude^|codex^|gemini

:end
endlocal
