<#
One entry point for the containerised CLI agents. Everything else in this
folder is machinery; this is the thing a person runs.

  .\agents.ps1                 dashboard, then a menu
  .\agents.ps1 -Check          just show who is signed in
  .\agents.ps1 -Login gemini   sign one agent in, start to finish
  .\agents.ps1 -Run            run the graded task on every signed-in agent
  .\agents.ps1 -Ask "..."      send one prompt to every signed-in agent

Agents run on your own subscription. There is no API-key path.
Which agents are in play comes from agents.json.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  # Valid names come from the roster in agents.json.
  [string]$Login,
  [switch]$Run,
  [string]$Ask
)

# Native tools log progress to stderr; 'Stop' would turn that into a crash.
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Which agents to operate on comes from agents.json, so disabling one is a config
# change rather than an edit in every script. ValidateSet above still accepts every
# name, so asking for a disabled agent gives a clear message instead of a parameter error.
function Get-AgentConfig([string]$root) {
  $f = Join-Path $root 'agents.json'
  $c = Get-Content $f -Raw | ConvertFrom-Json
  $members = @{}
  $c.roster.PSObject.Properties | ForEach-Object {
    $members[$_.Name] = @{
      Runtime = $_.Value.runtime; Model = $_.Value.model; Role = $_.Value.role
      Image   = $c.runtimes.($_.Value.runtime).image
    }
  }
  $disabled = @{}
  if ($c.disabled) { $c.disabled.PSObject.Properties | ForEach-Object { $disabled[$_.Name] = $_.Value } }
  return @{ Enabled = @($members.Keys); Members = $members; Disabled = $disabled }
}

$Config = Get-AgentConfig $Here
$Agents = $Config.Enabled

function Get-Image([string]$a) {
  if ($a -eq 'codex') { return 'stride-agent-codex-official' }
  return "stride-agent-$a"
}

function Get-BaseArgs([string]$a) {
  $d = @('run', '--rm', '-v', "agent-$a-home:/home/agent")
  # Gemini's credential store cannot be read in a container other than the one
  # that wrote it, and docker takes the hostname from the random container ID
  # unless told otherwise. Pin it so a login survives. --name does NOT do this.
  if ($a -eq 'gemini') { $d += @('--hostname', 'stride-agent-gemini') }
  return $d
}

function Write-Line([string]$text, [string]$colour = 'Gray') {
  Write-Host $text -ForegroundColor $colour
}

# ---------------------------------------------------------------- status ----
function Test-Agent([string]$a) {
  $d = (Get-BaseArgs $a) + @((Get-Image $a))

  if ($a -eq 'claude') {
    $out = (& docker @($d + @('claude', 'auth', 'status')) 2>&1 | Out-String)
    if ($out -match '"loggedIn":\s*true') {
      $plan = if ($out -match '"subscriptionType":\s*"([^"]+)"') { $matches[1] } else { 'subscription' }
      return @{ Ready = $true; Detail = "Claude $plan subscription" }
    }
    return @{ Ready = $false; Detail = 'not signed in' }
  }

  if ($a -eq 'codex') {
    $out = (& docker @($d + @('codex', 'login', 'status')) 2>&1 | Out-String)
    if ($out -match 'Logged in') { return @{ Ready = $true; Detail = 'ChatGPT sign-in' } }
    return @{ Ready = $false; Detail = 'not signed in' }
  }

  # Gemini has no status command, and a credential file on disk proves nothing:
  # we have seen files that exist but cannot be decrypted. Ask it something.
  $out = (& docker @($d + @('gemini', '--prompt', 'reply with the single word OK')) 2>&1 | Out-String)
  if ($out -match 'Corrupted credentials') { return @{ Ready = $false; Detail = 'credentials unreadable' } }
  if ($out -match 'Auth method|GEMINI_API_KEY') { return @{ Ready = $false; Detail = 'not signed in' } }
  if ($out -match 'OK') { return @{ Ready = $true; Detail = 'Google sign-in' } }
  return @{ Ready = $false; Detail = 'no response' }
}

function Show-Status {
  Write-Host ""
  Write-Line "  CLI AGENTS" 'White'
  Write-Line "  ---------------------------------------------" 'DarkGray'
  # Each check really asks the agent, so this takes a few seconds. Print the
  # result only once it is known - a "checking..." placeholder overwritten with
  # a carriage return looks fine live but leaves both strings on the line when
  # the output is piped or captured.
  Write-Line "  (checking each one - a few seconds)" 'DarkGray'
  $results = @{}
  foreach ($a in $Agents) {
    $r = Test-Agent $a
    $results[$a] = $r
    Write-Host ("  {0,-8} " -f $a) -NoNewline
    if ($r.Ready) { Write-Host "READY   " -ForegroundColor Green -NoNewline }
    else { Write-Host "SIGN IN " -ForegroundColor Yellow -NoNewline }
    Write-Host $r.Detail -ForegroundColor DarkGray
  }
  Write-Line "  ---------------------------------------------" 'DarkGray'
  Write-Host ""
  return $results
}

# ----------------------------------------------------------------- login ----
function Invoke-Login([string]$a) {
  # A login shell left running holds the OAuth callback ports and blocks the
  # next attempt with an error that names the port but not the container.
  & docker rm -f "stride-login-$a" 2>&1 | Out-Null

  if ($a -eq 'claude') {
    # Claude's login ends at a "Paste code here" prompt, and a container TTY on
    # Windows cannot receive a paste. claude-login.ps1 runs it with stdin on a
    # fifo so the code can be delivered from out here instead.
    & (Join-Path $Here 'claude-login.ps1') -Start
    if ($LASTEXITCODE -ne 0) { return }
    $code = Read-Host "  Paste the code from the browser here"
    if (-not $code -or -not $code.Trim()) { Write-Line "  Nothing pasted - cancelled." 'Yellow'; return }
    & (Join-Path $Here 'claude-login.ps1') -Code $code.Trim()
    return
  }

  $d = @('run', '--rm', '-it', '--name', "stride-login-$a", '-v', "agent-$a-home:/home/agent")
  if ($a -eq 'gemini') { $d += @('--hostname', 'stride-agent-gemini', '-p', '8085:8085', '-p', '7777:7777') }
  if ($a -eq 'codex') { $d += @('-p', '1455:1455') }
  $d += @((Get-Image $a))

  Write-Host ""
  if ($a -eq 'gemini') {
    Write-Line "  Gemini is starting inside the container. In it:" 'Cyan'
    Write-Line "    - Trust the folder if asked   ->  1" 'Gray'
    Write-Line "    - Auth method                 ->  Login with Google" 'Gray'
    Write-Line "      (NOT 'Gemini API key' - you are on a subscription)" 'DarkGray'
    Write-Line "    - No menu appears?            ->  type  /auth" 'DarkGray'
    Write-Line "    - Open the URL it prints, sign in, then type  /quit" 'Gray'
    Write-Host ""
    $d += @('gemini')
  }
  else {
    Write-Line "  A shell is opening. In it, run:" 'Cyan'
    Write-Line "      codex login --device-auth" 'Yellow'
    Write-Line "  then type  exit" 'Gray'
    Write-Host ""
    $d += @('bash')
  }

  & docker @d
  & docker rm -f "stride-login-$a" 2>&1 | Out-Null

  Write-Host ""
  Write-Line "  Checking whether that worked..." 'Cyan'
  $r = Test-Agent $a
  if ($r.Ready) { Write-Line "  $a is signed in ($($r.Detail))." 'Green' }
  else { Write-Line "  $a is still not signed in ($($r.Detail))." 'Yellow' }
}

# ------------------------------------------------------------------ work ----
function Invoke-Work([string[]]$ready, [string]$prompt, [bool]$graded) {
  if (-not $ready -or $ready.Count -eq 0) {
    Write-Line "  No agent is signed in yet - sign one in first." 'Yellow'
    return
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $results = @()

  foreach ($a in $ready) {
    $run = Join-Path $Here "runs\$a\$stamp"
    New-Item -ItemType Directory -Path $run -Force | Out-Null
    if ($graded) {
      Copy-Item (Join-Path $Here 'workspace\TASK.md')   $run -Force
      Copy-Item (Join-Path $Here 'workspace\verify.js') $run -Force
    }

    $cmd = switch ($a) {
      'claude' { @('claude', '--print', '--permission-mode', 'bypassPermissions', $prompt) }
      'codex'  { @('codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', $prompt) }
      'gemini' { @('gemini', '--yolo', '--prompt', $prompt) }
    }
    $d = (Get-BaseArgs $a) + @('-v', "${run}:/work", '-w', '/work', (Get-Image $a)) + $cmd

    Write-Host ""
    Write-Line "  === $a ===" 'Cyan'
    $t0 = Get-Date
    # PowerShell 5.1 wraps native stderr in ErrorRecord objects, which renders
    # agent output as a wall of NativeCommandError. Flatten to plain strings.
    & docker @d *>&1 |
      ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { if ($null -ne $_.Exception) { $_.Exception.Message } else { $_.ToString() } } else { $_ } }  # An empty stderr line makes ToString() return the type name; Exception.Message is the real text, and is '' for a blank line. |
      Tee-Object -FilePath (Join-Path $run 'agent-output.txt') | Out-Null
    $secs = [int]((Get-Date) - $t0).TotalSeconds

    $verdict = 'done'
    if ($graded) {
      if (Test-Path (Join-Path $run 'roman.js')) {
        # Grade in a clean node image, never in the agent's own container.
        $g = (& docker run --rm -v "${run}:/work" -w /work node:24-slim node verify.js 2>&1 | Out-String)
        if ($g -match 'RESULT:\s*PASS') { $verdict = 'PASS' }
        elseif ($g -match '(\d+) passed, (\d+) failed') { $verdict = "FAIL ($($matches[2]) failed)" }
        else { $verdict = 'FAIL' }
      }
      else { $verdict = 'no file produced' }
    }

    $colour = if ($verdict -eq 'PASS') { 'Green' } elseif ($verdict -eq 'done') { 'Gray' } else { 'Red' }
    Write-Line "  -> $verdict  (${secs}s)" $colour
    $results += [pscustomobject]@{ Agent = $a; Result = $verdict; Seconds = $secs; Folder = $run }
  }

  Write-Host ""
  Write-Line "  Results" 'White'
  $results | Format-Table -AutoSize | Out-String | Write-Host
}

# ------------------------------------------------------------------ main ----
$taskPrompt = 'Read TASK.md in the current directory and implement exactly what it asks. Create roman.js. Then run `node verify.js` and keep fixing roman.js until it prints RESULT: PASS. Do not edit TASK.md or verify.js.'

if ($Login) { Invoke-Login $Login; exit 0 }
if ($Check) { Show-Status | Out-Null; exit 0 }

$status = Show-Status
$ready = @($Agents | Where-Object { $status[$_].Ready })

if ($Run) { Invoke-Work $ready $taskPrompt $true; exit 0 }
if ($Ask) { Invoke-Work $ready $Ask $false; exit 0 }

while ($true) {
  Write-Line "  What would you like to do?" 'White'
  $n = 0
  $choices = @{}
  foreach ($a in $Agents) {
    if (-not $status[$a].Ready) {
      $n++; $choices["$n"] = @('login', $a)
      Write-Line "   $n) Sign in to $a" 'Yellow'
    }
  }
  $n++; $choices["$n"] = @('run', ''); Write-Line "   $n) Run the test task on every signed-in agent" 'Gray'
  $n++; $choices["$n"] = @('ask', ''); Write-Line "   $n) Ask every signed-in agent to do something" 'Gray'
  $n++; $choices["$n"] = @('status', ''); Write-Line "   $n) Re-check who is signed in" 'Gray'
  Write-Line "   q) Quit" 'DarkGray'
  Write-Host ""

  $pick = Read-Host "  Choose"
  Write-Host ""
  if ($pick -eq 'q') { break }
  if (-not $choices.ContainsKey($pick)) { Write-Line "  Not one of the options." 'Red'; continue }

  $action = $choices[$pick][0]
  $arg = $choices[$pick][1]

  if ($action -eq 'login') {
    Invoke-Login $arg
    $status = Show-Status
    $ready = @($Agents | Where-Object { $status[$_].Ready })
  }
  elseif ($action -eq 'run') { Invoke-Work $ready $taskPrompt $true }
  elseif ($action -eq 'ask') {
    $q = Read-Host "  What should they do"
    if ($q -and $q.Trim()) { Invoke-Work $ready $q.Trim() $false }
  }
  elseif ($action -eq 'status') {
    $status = Show-Status
    $ready = @($Agents | Where-Object { $status[$_].Ready })
  }
}
