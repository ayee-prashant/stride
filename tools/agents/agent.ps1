<#
Drive a containerised CLI agent from Windows.

  .\agent.ps1 -Agent codex -Status                 show whether it is logged in
  .\agent.ps1 -Agent codex -Login                  interactive login (browser/device code)
  .\agent.ps1 -Agent codex -Task                   run the built-in roman.js task and grade it
  .\agent.ps1 -Agent codex -Prompt "say hello"     send any prompt
  .\agent.ps1 -Agent codex -Prompt "..." -Keep     keep the run folder afterwards

Each run gets its own workspace folder under .\runs\<agent>\, so agents never
see each other's work. Credentials live in the docker volume agent-<name>-home.

All three run on subscription sign-in; there is no API-key path by design:
  claude   .\claude-login.ps1 -Start    (its prompt needs a paste a container TTY cannot take)
  codex    .\login.cmd codex            then inside: codex login --device-auth
  gemini   .\login.cmd gemini           then choose "Login with Google"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('claude', 'codex', 'gemini')]
  [string]$Agent,

  [string]$Prompt,
  [switch]$Task,
  [switch]$Status,
  [switch]$Login,
  [switch]$Keep
)

# Native commands write progress and diagnostics to stderr. With 'Stop' PowerShell
# turns each of those lines into a terminating NativeCommandError, so keep it Continue
# and judge success from the exit code instead.
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Codex is built from the official installer; the other two come from npm.
$Image = if ($Agent -eq 'codex') { "stride-agent-codex-official" } else { "stride-agent-$Agent" }
$HomeVol = "agent-$Agent-home"

function Invoke-Agent {
  # Note: not named $args — that is a PowerShell automatic variable.
  param([string[]]$Cmd, [string]$WorkDir, [switch]$Interactive, [string[]]$Ports = @(), [string[]]$EnvVars = @())
  $dockerArgs = @('run', '--rm')
  if ($Interactive) { $dockerArgs += '-it' }
  # Gemini's encrypted credential store cannot be read in a container other than
  # the one that wrote it; docker takes the hostname from the random container
  # ID, so pin it. Must match the value login.cmd uses or a fresh login is
  # unreadable too.
  if ($Agent -eq 'gemini') { $dockerArgs += @('--hostname', 'stride-agent-gemini') }
  $dockerArgs += @('-v', "${HomeVol}:/home/agent")
  if ($WorkDir) { $dockerArgs += @('-v', "${WorkDir}:/work", '-w', '/work') }
  foreach ($p in $Ports) { $dockerArgs += @('-p', $p) }
  foreach ($e in $EnvVars) { $dockerArgs += @('-e', $e) }
  $dockerArgs += $Image
  $dockerArgs += $Cmd
  & docker @dockerArgs
}

# Deliberately no API-key support. All three agents run on the user's own
# subscription (Claude Pro, ChatGPT, Google AI Pro). An API key is not just
# unnecessary here, it is harmful: ANTHROPIC_API_KEY takes precedence over the
# signed-in account, so a stray key silently bills the API instead of the
# subscription and makes auth failures look like key failures.
$AgentEnv = @()

# ---------- status ----------
if ($Status) {
  $probe = switch ($Agent) {
    'claude' { @('claude', 'auth', 'status') }
    'codex'  { @('codex', 'login', 'status') }
    'gemini' { @('bash', '-lc', 'ls -A /home/agent/.gemini 2>/dev/null | head -5 || echo "no ~/.gemini yet"') }
  }
  Write-Host "=== $Agent auth status ===" -ForegroundColor Cyan
  Invoke-Agent -Cmd $probe
  exit $LASTEXITCODE
}

# ---------- login ----------
if ($Login) {
  # Claude cannot be logged in this way: `claude auth login` ends at a "Paste
  # code here" prompt, and pasting into a container TTY on Windows does not
  # work. claude-login.ps1 runs the same subscription flow with stdin on a fifo
  # so the code is delivered from outside.
  if ($Agent -eq 'claude') {
    & (Join-Path $Here 'claude-login.ps1') -Start
    exit $LASTEXITCODE
  }
  $ports = switch ($Agent) {
    'codex'  { @('1455:1455') }
    'gemini' { @('8085:8085', '7777:7777') }
    default  { @() }
  }
  $hint = switch ($Agent) {
    'claude' { 'claude auth login' }
    'codex'  { 'codex login --device-auth' }
    'gemini' { 'gemini' }
  }
  Write-Host ""
  Write-Host "Opening a shell in $Image." -ForegroundColor Cyan
  Write-Host "Run this inside, then type: exit" -ForegroundColor Cyan
  Write-Host "    $hint" -ForegroundColor Yellow
  Write-Host ""
  Invoke-Agent -Cmd @('bash') -WorkDir (Join-Path $Here 'workspace') -Interactive -Ports $ports -EnvVars $AgentEnv
  exit $LASTEXITCODE
}

# ---------- decide the prompt ----------
if (-not $Prompt -and -not $Task) {
  Write-Error "Give -Prompt ""...""  or  -Task  (or use -Status / -Login)."
  exit 2
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Run = Join-Path $Here "runs\$Agent\$Stamp"
New-Item -ItemType Directory -Path $Run -Force | Out-Null

if ($Task) {
  Copy-Item (Join-Path $Here 'workspace\TASK.md')  $Run
  Copy-Item (Join-Path $Here 'workspace\verify.js') $Run
  $Prompt = 'Read TASK.md in the current directory and implement exactly what it asks. Create roman.js. Then run `node verify.js` and keep fixing roman.js until it prints RESULT: PASS. Do not edit TASK.md or verify.js.'
}

$Cmd = switch ($Agent) {
  'claude' { @('claude', '--print', '--permission-mode', 'bypassPermissions', $Prompt) }
  'codex'  { @('codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', $Prompt) }
  'gemini' { @('gemini', '--yolo', '--prompt', $Prompt) }
}

Write-Host "=== $Agent ===" -ForegroundColor Cyan
Write-Host "workspace: $Run"
Write-Host "prompt:    $($Prompt.Substring(0, [Math]::Min(90, $Prompt.Length)))..."
Write-Host ""

$Started = Get-Date
$OutFile = Join-Path $Run 'agent-output.txt'
# PowerShell 5.1 wraps each stderr line from a native command in an ErrorRecord,
# so `*>&1` renders agent output as a wall of NativeCommandError text with the
# real message buried inside it. Flatten every record to its string form first,
# so what the agent actually said is what gets printed.
Invoke-Agent -Cmd $Cmd -WorkDir $Run -EnvVars $AgentEnv *>&1 |
  ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { if ($null -ne $_.Exception) { $_.Exception.Message } else { $_.ToString() } } else { $_ } }  # An empty stderr line makes ToString() return the type name; Exception.Message is the real text, and is '' for a blank line. |
  Tee-Object -FilePath $OutFile
$Code = $LASTEXITCODE
$Elapsed = [int]((Get-Date) - $Started).TotalSeconds

Write-Host ""
Write-Host "exit=$Code  elapsed=${Elapsed}s" -ForegroundColor Cyan

# A 401 is the usual cause of an immediate failure; say so plainly.
if ((Test-Path $OutFile) -and (Select-String -Path $OutFile -Pattern '401|Unauthorized|Not logged in|authentication' -Quiet)) {
  Write-Host ""
  Write-Host "This agent is not authenticated. Run:  .\agent.ps1 -Agent $Agent -Login" -ForegroundColor Yellow
}

# ---------- grade, when it was the built-in task ----------
if ($Task) {
  Write-Host ""
  Write-Host "=== grading (identical verify.js for every agent) ===" -ForegroundColor Cyan
  if (Test-Path (Join-Path $Run 'roman.js')) {
    & docker run --rm -v "${Run}:/work" -w /work node:24-slim node verify.js
    Write-Host "grader exit=$LASTEXITCODE"
  }
  else {
    Write-Host "no roman.js was produced" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "files produced:" -ForegroundColor Cyan
Get-ChildItem $Run | Select-Object Name, Length | Format-Table -AutoSize

if (-not $Keep -and -not $Task) {
  Write-Host "(run folder kept at $Run)"
}
