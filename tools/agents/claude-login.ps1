<#
Subscription login for the Claude container, without typing into a container TTY.

  .\claude-login.ps1 -Start          start the flow and print the sign-in URL
  .\claude-login.ps1 -Code "<code>"  submit the code the browser gave you
  .\claude-login.ps1 -Status         show whether it worked
  .\claude-login.ps1 -Cancel         tear the helper container down

Why this exists: `claude auth login` prints a URL, then waits at a "Paste code
here" prompt. Pasting into `docker run -it` on Windows is unreliable, so the
CLI instead runs detached (see login-init.sh) with its stdin on a fifo. -Code
writes into that fifo from outside, so the paste happens in PowerShell, which
can paste, rather than in the container.

This is the Claude *subscription* flow (--claudeai). No API key is involved.

Implementation note: never pass shell code to docker as an argument here.
PowerShell 5.1 splits native-command arguments on embedded double quotes, so
`bash -lc "script -qfc \"claude auth login\" ..."` arrives at docker already
torn into pieces. Shell code is therefore either mounted as a file or piped
into `docker exec -i bash` on stdin.
#>
[CmdletBinding()]
param(
  [switch]$Start,
  [string]$Code,
  [switch]$Status,
  [switch]$Cancel
)

# Native tools log to stderr; 'Stop' would turn that into a terminating error.
$ErrorActionPreference = 'Continue'

$Here      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Image     = 'stride-agent-claude'
$HomeVol   = 'agent-claude-home'
$Container = 'claude-login'

function Test-Helper {
  $id = & docker ps -q -f "name=^$Container$"
  return [bool]$id
}

function Invoke-InContainer {
  # IMPORTANT: $Script must not contain a double quote. PowerShell 5.1 splits a
  # native-command argument on embedded double quotes (verified: `script -qfc
  # "a b c"` arrived at docker as three separate argv entries), but it does
  # preserve spaces and passes single quotes through untouched. Piping the
  # script on stdin instead is not an option either - that route prepends a
  # UTF-8 BOM that bash reports as a syntax error on line 1.
  param([string]$Script)
  if ($Script.Contains('"')) { throw "Invoke-InContainer: script must not contain double quotes." }
  return (& docker exec $Container bash -lc $Script | Out-String)
}

function Get-LoginOutput {
  # The TUI emits ANSI escapes and OSC-8 hyperlinks; strip them so text is readable.
  $raw = Invoke-InContainer 'cat /tmp/out 2>/dev/null'
  $clean = $raw -replace "`e\]8;;[^`e]*`e\\", ''
  $clean = $clean -replace "`e\]8;;[^\x07]*\x07", ''
  $clean = $clean -replace "`e\[[0-9;?]*[a-zA-Z]", ''
  return ($clean -replace "`r", '')
}

if ($Cancel) {
  & docker rm -f $Container | Out-Null
  Write-Host "Helper container removed. Nothing in $HomeVol was changed." -ForegroundColor Yellow
  exit 0
}

if ($Status) {
  Write-Host "=== claude auth status ===" -ForegroundColor Cyan
  & docker run --rm -v "${HomeVol}:/home/agent" $Image claude auth status
  exit $LASTEXITCODE
}

if ($Start) {
  & docker rm -f $Container 2>&1 | Out-Null

  $init = Join-Path $Here 'login-init.sh'
  if (-not (Test-Path $init)) { Write-Host "Missing $init" -ForegroundColor Red; exit 1 }

  & docker run -d --name $Container `
      -v "${HomeVol}:/home/agent" `
      -v "${init}:/init.sh:ro" `
      $Image bash /init.sh | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "Could not start the helper container." -ForegroundColor Red; exit 1 }

  # Wait inside the container rather than busy-polling from PowerShell.
  Invoke-InContainer 'for i in $(seq 1 40); do grep -q https:// /tmp/out 2>/dev/null && break; sleep 1; done' | Out-Null

  $out = Get-LoginOutput
  $m = [regex]::Match($out, 'https://claude\.com/cai/oauth/authorize\?[^\s]+')
  if (-not $m.Success) {
    Write-Host "Could not find a sign-in URL. Raw output:" -ForegroundColor Red
    Write-Host $out
    Write-Host "(Use .\claude-login.ps1 -Cancel to clean up.)" -ForegroundColor Yellow
    exit 1
  }
  # The hyperlink target and the visible text are concatenated; keep the first URL.
  $url = $m.Value
  $second = $url.IndexOf('https://', 8)
  if ($second -gt 0) { $url = $url.Substring(0, $second) }

  Write-Host ""
  Write-Host "1. Open this URL and approve it with your Claude subscription:" -ForegroundColor Cyan
  Write-Host ""
  Write-Host $url
  Write-Host ""
  Write-Host "2. Copy the code the page shows, then run:" -ForegroundColor Cyan
  Write-Host '     .\claude-login.ps1 -Code "<paste here>"' -ForegroundColor Yellow
  Write-Host ""
  exit 0
}

if ($Code) {
  if (-not (Test-Helper)) {
    Write-Host "No login is in progress. Run:  .\claude-login.ps1 -Start" -ForegroundColor Red
    exit 1
  }
  $clean = $Code.Trim().Trim('"').Trim("'")
  if (-not $clean) { Write-Host "Empty code." -ForegroundColor Red; exit 1 }

  # Single-quote inside the shell so '#' in code#state is not taken as a comment.
  $safe = $clean.Replace("'", "'\''")
  Invoke-InContainer "printf '%s\n' '$safe' > /tmp/in" | Out-Null

  Invoke-InContainer 'for i in $(seq 1 30); do grep -qEi ''logged in|success|error|invalid|expired|EXITCODE'' /tmp/out 2>/dev/null && break; sleep 1; done' | Out-Null

  Write-Host ""
  Write-Host "=== login output (tail) ===" -ForegroundColor Cyan
  (Get-LoginOutput) -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 6 | ForEach-Object { Write-Host "  $($_.Trim())" }
  Write-Host ""

  Write-Host "=== verifying in a fresh container ===" -ForegroundColor Cyan
  & docker run --rm -v "${HomeVol}:/home/agent" $Image claude auth status
  $ok = ($LASTEXITCODE -eq 0)

  if ($ok) {
    & docker rm -f $Container | Out-Null
    Write-Host ""
    Write-Host "Authenticated with your subscription. Helper container removed." -ForegroundColor Green
    Write-Host "Try:  .\agent.ps1 -Agent claude -Task" -ForegroundColor Green
  }
  else {
    Write-Host ""
    Write-Host "Not authenticated yet - the code may have expired (they are short-lived)." -ForegroundColor Yellow
    Write-Host "Start over with:  .\claude-login.ps1 -Start" -ForegroundColor Yellow
  }
  exit 0
}

Write-Host 'usage: .\claude-login.ps1 -Start | -Code "<code>" | -Status | -Cancel'
