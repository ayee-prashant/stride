<#
Run agents under the controller: the model and approval mode each one uses come
from the hub, not from the command line, so changing them in the UI changes what
actually launches.

  .\runner.ps1 -Prompt "read the shared context, then ..."     every connected agent
  .\runner.ps1 -Agent codex -Prompt "..."                      just one
  .\runner.ps1 -Show                                           what policy would apply

Approval mode here means *tool execution*: whether the agent may act without
stopping to ask. It never means the agent can approve its own work - the hub has
no tool for that, and context an agent proposes stays pending until a human
decides.
#>
[CmdletBinding()]
param(
  # No ValidateSet: valid names come from the roster in agents.json, so adding a
  # member must not require editing this file. Checked below with a message that
  # lists who actually exists.
  [string]$Agent = 'all',
  [string]$Prompt,
  [string]$HubApi = 'http://localhost:7400',
  [switch]$Repo,
  [switch]$Auto,
  [switch]$Show
)

$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# A member's image comes from its RUNTIME, not its name. manager and tester both
# run the claude image; agent1 and agent2 both run the codex one. Deriving it from
# the name is what limited this to one member per CLI.
$Cfg = Get-Content (Join-Path (Split-Path -Parent $Here) 'agents.json') -Raw | ConvertFrom-Json
$Roster = @{}
$Cfg.roster.PSObject.Properties | ForEach-Object {
  $Roster[$_.Name] = @{ Runtime = $_.Value.runtime; Image = $Cfg.runtimes.($_.Value.runtime).image; Role = $_.Value.role }
}
function Get-Image([string]$a) {
  if ($Roster.ContainsKey($a)) { return $Roster[$a].Image }
  if ($a -eq 'codex') { return 'stride-agent-codex-official' }
  return "stride-agent-$a"
}
function Get-Runtime([string]$a) { if ($Roster.ContainsKey($a)) { return $Roster[$a].Runtime } return $a }

try {
  $state = Invoke-RestMethod -Uri "$HubApi/api/state" -TimeoutSec 10
}
catch {
  Write-Host "Cannot reach the hub at $HubApi - start it with: node server.mjs" -ForegroundColor Red
  exit 1
}

$policies = @{}
foreach ($a in $state.agents) { $policies[$a.name] = $a }

# agents.json decides who is in play. An agent may still be registered with the
# hub and hold past work in the log while being disabled for now; disabling is a
# config change, not a deletion.
$cfgFile = Join-Path (Split-Path -Parent $Here) 'agents.json'
$enabled = @($Roster.Keys)
if ($Agent -ne 'all' -and -not $Roster.ContainsKey($Agent)) {
  Write-Host "Unknown member: $Agent" -ForegroundColor Red
  Write-Host ("On the roster: " + (($Roster.Keys | Sort-Object) -join ', ')) -ForegroundColor DarkGray
  exit 2
}
$names = if ($Agent -eq 'all') { @($state.agents | ForEach-Object { $_.name } | Where-Object { $enabled -contains $_ }) } else { @($Agent) }
foreach ($n in $names) {
  if ($enabled -notcontains $n) {
    Write-Host "$n is disabled in agents.json - enable it there first." -ForegroundColor Yellow
    exit 1
  }
}
if (-not $names -or $names.Count -eq 0) {
  Write-Host "No agent has connected to the hub yet. Run:  .\connect.ps1" -ForegroundColor Yellow
  exit 1
}

# Each CLI spells the same two ideas differently. This table is the controller.
function Get-AgentCommand([string]$a, $policy, [string]$prompt) {
  $auto = $policy.approval_mode -eq 'auto'
  $model = $policy.model
  switch (Get-Runtime $a) {
    'claude' {
      $c = @('claude', '--print')
      if ($auto) { $c += @('--permission-mode', 'bypassPermissions') }
      if ($model) { $c += @('--model', $model) }
      return $c + @($prompt)
    }
    'codex' {
      $c = @('codex', 'exec')
      if ($auto) { $c += '--dangerously-bypass-approvals-and-sandbox' }
      # Codex takes config overrides rather than a --model flag.
      if ($model) { $c += @('-c', "model=$model") }
      return $c + @($prompt)
    }
    'gemini' {
      $c = @('gemini')
      if ($auto) { $c += '--yolo' } else { $c += @('--approval-mode', 'default') }
      if ($model) { $c += @('-m', $model) }
      return $c + @('--prompt', $prompt)
    }
  }
}

if ($Show) {
  Write-Host ""
  Write-Host "  Controller policy (from the hub)" -ForegroundColor White
  foreach ($n in $names) {
    $p = $policies[$n]
    if (-not $p) { Write-Host ("  {0,-8} not connected" -f $n) -ForegroundColor DarkGray; continue }
    $cmd = Get-AgentCommand $n $p '<prompt>'
    Write-Host ("  {0,-8} model={1,-16} approval={2}" -f $n, $(if ($p.model) { $p.model } else { '-' }), $p.approval_mode)
    Write-Host ("           -> {0}" -f ($cmd -join ' ')) -ForegroundColor DarkGray
  }
  Write-Host ""
  exit 0
}

if (-not $Prompt) { Write-Host "Give -Prompt ""...""  (or -Show)" -ForegroundColor Red; exit 2 }

# An agent cannot follow a protocol it was never shown.
if ($Repo) { $Prompt = "Read /PROTOCOL.md first and follow it. You are working in /repo on your own branch.`n`n$Prompt" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$results = @()

foreach ($n in $names) {
  $policy = $policies[$n]
  if (-not $policy) { Write-Host "  $n is not connected to the hub - skipping" -ForegroundColor Yellow; continue }

  # Every invocation here is headless (--print / exec / --prompt). In 'prompt'
  # mode there is no one to answer the approval question, so the agent cannot run
  # git or call a single tool - it burns a full run and reports being blocked.
  # Fail fast and say exactly how to fix it rather than wasting the round trip.
  if ($policy.approval_mode -ne 'auto' -and $Auto) {
    # Explicitly asked for, so record it as a policy change rather than a hidden
    # per-run override - the UI must keep showing what actually applies.
    $b = @{ name = $n; approval_mode = 'auto' } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri "$HubApi/api/policy" -Method Post -ContentType 'application/json' -Body $b | Out-Null
    $policy.approval_mode = 'auto'
    Write-Host "  $n switched to auto-approve" -ForegroundColor DarkGray
  }
  if ($policy.approval_mode -ne 'auto') {
    Write-Host ""
    Write-Host "  $n is set to 'ask first', but this runner is headless - nothing can" -ForegroundColor Yellow
    Write-Host "  approve its tool calls, so it would stall with no work done." -ForegroundColor Yellow
    Write-Host "  Set it to auto-approve at $HubApi, or re-run with -Auto." -ForegroundColor Yellow
    Write-Host "  Skipping $n." -ForegroundColor Yellow
    $results += [pscustomobject]@{ Agent = $n; Model = 'n/a'; Approval = $policy.approval_mode; Seconds = 0 }
    continue
  }

  $run = Join-Path $Here "runs\$n\$stamp"
  New-Item -ItemType Directory -Path $run -Force | Out-Null

  $d = @('run', '--rm', '-v', "agent-$n-home:/home/agent")
  if ($Repo) {
    # Each agent gets its OWN checkout at /repo, never the real repository and
    # never another agent's. /shared is the bare repo they sync through, which
    # is what origin points at inside the container.
    $gitDir = Join-Path (Split-Path -Parent $Here) 'git'
    $clone = Join-Path $gitDir "clones\$n"
    $bare = Join-Path $gitDir 'stride.git'
    if (-not (Test-Path $clone)) {
      Write-Host "  $n has no checkout - run ..\git\git-setup.ps1 first" -ForegroundColor Yellow
      continue
    }
    $d += @('-v', "${clone}:/repo", '-v', "${bare}:/shared", '-v', "$(Join-Path $gitDir 'PROTOCOL.md'):/PROTOCOL.md:ro", '-w', '/repo')
  }
  else { $d += @('-v', "${run}:/work", '-w', '/work') }
  if ((Get-Runtime $n) -eq 'gemini') { $d += @('--hostname', 'stride-agent-gemini') }
  # Codex stores the NAME of an env var rather than the token, so the token has to
  # arrive at run time. Ask the hub for it instead of reading a cached file: a file
  # can go missing or drift from the hub, and the failure then looks like an auth
  # problem rather than a stale copy. /api/token returns the existing token for a
  # known agent, so this is idempotent and never rotates anything.
  if ((Get-Runtime $n) -eq 'codex') {
    try {
      $body = @{ name = $n } | ConvertTo-Json -Compress
      $tok = (Invoke-RestMethod -Uri "$HubApi/api/token" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10).token
      $d += @('-e', "HUB_TOKEN=$tok")
    }
    catch {
      Write-Host "  could not get codex's token from the hub - its tools will return 401" -ForegroundColor Yellow
    }
  }
  # The prompt goes in via a FILE, never as an argument. PowerShell 5.1 mangles a
  # native-command argument that contains double quotes or newlines: a multi-line
  # prompt arrived in the container as one run-together string with the quotes
  # stripped and the newlines turned into the letter n. An agent then works from a
  # corrupted brief and cannot tell that anything is missing.
  $promptFile = Join-Path $run 'prompt.txt'
  # WriteAllText with a BOM-less encoder, NOT Set-Content -Encoding utf8: in
  # PowerShell 5.1 that always writes a byte-order mark, and the agent then reads
  # an invisible U+FEFF as the first character of its own instructions.
  [System.IO.File]::WriteAllText($promptFile, $Prompt, (New-Object System.Text.UTF8Encoding $false))
  $d += @('-v', "${promptFile}:/prompt.txt:ro")
  # This instruction is deliberately free of quotes and newlines, so it survives.
  $carrier = 'Read the file /prompt.txt and do exactly what it says. It is your task; treat its contents as the instruction you were given.'
  $d += @((Get-Image $n)) + (Get-AgentCommand $n $policy $carrier)

  Write-Host ""
  Write-Host "  === $n ===" -ForegroundColor Cyan
  Write-Host ("  model={0}  approval={1}" -f $(if ($policy.model) { $policy.model } else { 'default' }), $policy.approval_mode) -ForegroundColor DarkGray

  $t0 = Get-Date
  # PowerShell 5.1 wraps native stderr in ErrorRecord objects, which renders agent
  # output as a wall of NativeCommandError. Flatten it to plain strings.
  # Flatten, show live, then write the transcript ourselves. Tee-Object picks its
  # own encoding and produced an unreadable file; WriteAllText keeps it UTF-8.
  # An empty stderr line makes ToString() return the type name, so take
  # Exception.Message, which is '' for a blank line.
  $captured = & docker @d *>&1 |
    ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { if ($null -ne $_.Exception) { $_.Exception.Message } else { $_.ToString() } } else { $_ } } |
    ForEach-Object { Write-Host $_; $_ }
  [System.IO.File]::WriteAllText((Join-Path $run 'agent-output.txt'), ($captured -join [Environment]::NewLine), (New-Object System.Text.UTF8Encoding $false))
  $secs = [int]((Get-Date) - $t0).TotalSeconds

  $results += [pscustomobject]@{ Agent = $n; Model = $(if ($policy.model) { $policy.model } else { 'default' }); Approval = $policy.approval_mode; Seconds = $secs }
}

Write-Host ""
$results | Format-Table -AutoSize | Out-String | Write-Host
