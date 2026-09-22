<#
One entry point for the agent team. Everything else in this folder is machinery.

  agents doctor          check everything; say exactly how to fix what is broken
  agents setup           do the whole setup, in order, safe to re-run
  agents status          who is on the team and what state they are in
  agents login <runtime> sign in to claude or codex
  agents run <member> "<task>"
  agents ui              open the tracking panel

Nothing here assumes you ran something else first. Every step checks what it
needs, does only what is missing, and says what to do when it cannot continue.
Re-running is always safe.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'status',
  [Parameter(Position = 1)][string]$Arg1,
  [Parameter(Position = 2)][string]$Arg2,
  [switch]$Repo,
  [switch]$Json
)
$script:AsJson = [bool]$Json

# Native tools log progress to stderr; 'Stop' would turn that into a crash.
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$HubApi = 'http://localhost:7400'
$McpUrl = 'http://host.docker.internal:7400/mcp'

# Resolve the real git binary once: PowerShell function names are case-insensitive
# and shadow external commands, so a helper named Git would call itself.
$GitExe = (Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source

function Ok([string]$t) { Write-Host "  [ok]   " -ForegroundColor Green -NoNewline; Write-Host $t }
function Bad([string]$t) { Write-Host "  [x]    " -ForegroundColor Red -NoNewline; Write-Host $t }
function Warn([string]$t) { Write-Host "  [!]    " -ForegroundColor Yellow -NoNewline; Write-Host $t }
function Fix([string]$t) { Write-Host "         fix: " -ForegroundColor DarkGray -NoNewline; Write-Host $t -ForegroundColor Cyan }
function Head([string]$t) { Write-Host ""; Write-Host "  $t" -ForegroundColor White }
function Note([string]$t) { Write-Host "         $t" -ForegroundColor DarkGray }

$Cfg = Get-Content (Join-Path $Here 'agents.json') -Raw | ConvertFrom-Json
$Members = @()
$Cfg.roster.PSObject.Properties | ForEach-Object {
  $Members += [pscustomobject]@{
    Name = $_.Name; Runtime = $_.Value.runtime; Model = $_.Value.model; Role = $_.Value.role
    Image = $Cfg.runtimes.($_.Value.runtime).image
    Base = $Cfg.runtimes.($_.Value.runtime).baseVolume
    Vol = "agent-$($_.Name)-home"
  }
}
$Runtimes = @()
$Cfg.runtimes.PSObject.Properties | Where-Object { $_.Name -notlike '_*' } | ForEach-Object {
  $Runtimes += [pscustomobject]@{
    Name = $_.Name; Image = $_.Value.image; Base = $_.Value.baseVolume
    Dockerfile = $_.Value.dockerfile; Package = $_.Value.package; SignIn = $_.Value.signIn
  }
}

# ---------------------------------------------------------------- probes ----
# Each returns $true/$false and never throws, so doctor can report on all of
# them even when the first few are broken.
function Test-Docker { try { & docker version --format '{{.Server.Version}}' 2>&1 | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false } }
function Test-Node { return [bool](Get-Command node -ErrorAction SilentlyContinue) }
function Test-Image([string]$i) { $r = & docker images -q $i 2>$null; return [bool]$r }
function Test-Volume([string]$v) { $r = & docker volume ls -q -f "name=^$v$" 2>$null; return [bool]$r }
function Test-HubUp { try { Invoke-RestMethod -Uri "$HubApi/api/state" -TimeoutSec 3 | Out-Null; return $true } catch { return $false } }

function Test-SignedIn([string]$runtime, [string]$volume) {
  if (-not (Test-Volume $volume)) { return $false }
  $img = ($Runtimes | Where-Object { $_.Name -eq $runtime }).Image
  if ($runtime -eq 'claude') {
    $out = (& docker run --rm -v "${volume}:/home/agent" $img claude auth status 2>&1 | Out-String)
    return $out -match '"loggedIn":\s*true'
  }
  $out = (& docker run --rm -v "${volume}:/home/agent" $img codex login status 2>&1 | Out-String)
  return $out -match 'Logged in'
}

function Test-McpRegistered([string]$member) {
  $m = $Members | Where-Object { $_.Name -eq $member }
  if (-not (Test-Volume $m.Vol)) { return $false }
  $probe = if ($m.Runtime -eq 'claude') { @('claude', 'mcp', 'list') } else { @('codex', 'mcp', 'list') }
  $out = (& docker run --rm -v "$($m.Vol):/home/agent" $m.Image @probe 2>&1 | Out-String)
  return $out -match '(?m)^\s*hub\b|hub:'
}

function Test-Checkout([string]$member) { return (Test-Path (Join-Path $Here "git\clones\$member")) }
function Test-Network { $r = & docker network ls -q -f "name=^stride-agents$" 2>$null; return [bool]$r }
function Test-Gateway { $r = & docker ps -q -f "name=^stride-git-gateway$" 2>$null; return [bool]$r }

# ---------------------------------------------------------------- doctor ----
# Every check records a structured result as well as printing one, so the same
# health model can be read by a person, by CI, by a bug report or by the panel.
# A diagnostic that exists only as console text cannot be consumed by anything.
$script:Checks = @()
function Rec([string]$id, [string]$status, [string]$text, [string]$fix = '', [string]$detail = '', [string]$severity = 'repairable') {
  $script:Checks += [pscustomobject]@{
    id = $id; status = $status
    # Severity only means something for a failure; reporting a passing check as
    # 'repairable' is noise for anything consuming this.
    severity = $(if ($status -eq 'ok') { $null } else { $severity })
    text = $text; fix = $fix; detail = $detail
  }
  if ($script:AsJson) { return }
  if ($status -eq 'ok') { Ok $text }
  elseif ($status -eq 'warn') { Warn $text }
  else { Bad $text }
  if ($status -ne 'ok' -and $detail) { Note $detail }
  if ($status -ne 'ok' -and $fix) { Fix $fix }
}

function Invoke-Doctor {
  $script:Checks = @()
  if (-not $script:AsJson) {
    Write-Host ""
    Write-Host "  AGENT TEAM - health check" -ForegroundColor White
    Write-Host "  ----------------------------------------------------------" -ForegroundColor DarkGray
    Head "Machine"
  }

  # Blocking: nothing downstream can work until these are true.
  if (Test-Docker) { Rec 'machine.docker' 'ok' 'Docker is running' }
  else { Rec 'machine.docker' 'error' 'Docker is not running' 'start Docker Desktop, then run this again' '' 'blocking' }
  if (Test-Node) { Rec 'machine.node' 'ok' "Node.js $(& node --version)" }
  else { Rec 'machine.node' 'error' 'Node.js is not on PATH' 'install from https://nodejs.org' '' 'blocking' }

  if (-not $script:AsJson) { Head "Images" }
  foreach ($r in $Runtimes) {
    if (Test-Image $r.Image) { Rec "image.$($r.Name)" 'ok' $r.Image }
    else { Rec "image.$($r.Name)" 'error' "$($r.Image) is not built" 'agents setup' "built from $($r.Dockerfile)" }
  }

  if (-not $script:AsJson) { Head "Hub" }
  if (Test-Path (Join-Path $Here 'hub\node_modules')) { Rec 'hub.deps' 'ok' 'hub dependencies installed' }
  else { Rec 'hub.deps' 'error' 'hub dependencies missing' 'agents setup' }
  if (Test-HubUp) { Rec 'hub.running' 'ok' "hub is running at $HubApi" }
  else { Rec 'hub.running' 'error' 'hub is not running' 'agents setup' }

  if (-not $script:AsJson) { Head "Sign-ins  (one per runtime; members share the runtime's sign-in)" }
  foreach ($r in $Runtimes) {
    # Blocking: setup refuses to build dependent resources without credentials,
    # because a member with a token and no sign-in fails later as a puzzling 401.
    if (-not (Test-Volume $r.Base)) { Rec "auth.$($r.Name)" 'error' "$($r.Name): never signed in" "agents login $($r.Name)" '' 'blocking' }
    elseif (Test-SignedIn $r.Name $r.Base) { Rec "auth.$($r.Name)" 'ok' "$($r.Name) is signed in" }
    else { Rec "auth.$($r.Name)" 'error' "$($r.Name): signed out or credentials unreadable" "agents login $($r.Name)" '' 'blocking' }
  }

  if (-not $script:AsJson) { Head "Git gateway" }
  if (Test-Network) { Rec 'git.network' 'ok' 'network stride-agents' }
  else { Rec 'git.network' 'error' 'network stride-agents is missing' 'agents setup' }
  if (Test-Gateway) { Rec 'git.gateway' 'ok' 'gateway is serving the shared repo' }
  else { Rec 'git.gateway' 'error' 'git gateway is not running' 'agents setup' 'without it agents cannot push, and a writable mount of the bare repo is what let one agent delete another branch' }
  if (Test-Path (Join-Path $Here 'git\stride.git')) {
    if (Test-Path (Join-Path $Here 'git\stride.git\hooks\update')) { Rec 'git.refpolicy' 'ok' 'ref policy installed (agents may only write refs/heads/agent/*)' }
    else { Rec 'git.refpolicy' 'error' 'ref policy hook missing - agents could push to main' 'agents setup' }
  }

  if (-not $script:AsJson) { Head "Team  ($($Members.Count) members)" }
  foreach ($m in $Members) {
    $bits = @()
    if (-not (Test-Volume $m.Vol)) { $bits += 'no home' }
    elseif (-not (Test-McpRegistered $m.Name)) { $bits += 'hub not registered' }
    if (-not (Test-Checkout $m.Name)) { $bits += 'no git checkout' }
    if ($bits.Count -eq 0) { Rec "member.$($m.Name)" 'ok' ("{0,-9} {1,-8} {2}" -f $m.Name, $m.Runtime, $m.Model) }
    else { Rec "member.$($m.Name)" 'error' ("{0,-9} {1}" -f $m.Name, ($bits -join ', ')) 'agents setup' }
  }

  # A member with resources but no longer on the roster. Reported, never removed:
  # deleting someone's home and branch because a line vanished from a config file
  # is not a repair.
  $known = @($Members.Name)
  foreach ($v in (& docker volume ls -q -f 'name=^agent-' 2>$null)) {
    $who = $v -replace '^agent-', '' -replace '-home$', ''
    if ($known -notcontains $who -and $Runtimes.Name -notcontains $who) {
      Rec "orphan.$who" 'warn' "$who has a home volume but is not on the roster" 'remove it by hand if that is intended' 'retained for safety; nothing is deleted automatically'
    }
  }

  $errors = @($script:Checks | Where-Object { $_.status -eq 'error' })
  $blocking = @($errors | Where-Object { $_.severity -eq 'blocking' })

  if ($script:AsJson) {
    # Write-Host, not the pipeline: this function also returns the error count,
    # and `exit (Invoke-Doctor)` would otherwise receive the JSON as well.
    Write-Host (([pscustomobject]@{
          healthy    = ($errors.Count -eq 0)
          blocking   = $blocking.Count
          repairable = ($errors.Count - $blocking.Count)
          checks     = $script:Checks
        } | ConvertTo-Json -Depth 4))
    return $errors.Count
  }

  Write-Host ""
  Write-Host "  ----------------------------------------------------------" -ForegroundColor DarkGray
  if ($errors.Count -eq 0) {
    Write-Host "  Everything is ready." -ForegroundColor Green
    Write-Host "         give work:  agents run manager ..." -ForegroundColor DarkGray
    Write-Host "         track it:   agents ui" -ForegroundColor DarkGray
  }
  else {
    if ($blocking.Count -gt 0) {
      Write-Host "  $($blocking.Count) blocking - nothing else can proceed until these are fixed:" -ForegroundColor Red
      foreach ($b in $blocking) { Write-Host "      $($b.fix)" -ForegroundColor Cyan }
    }
    $rep = $errors.Count - $blocking.Count
    if ($rep -gt 0) { Write-Host "  $rep repairable - handled by:  agents setup" -ForegroundColor Yellow }
  }
  Write-Host ""
  return $errors.Count
}

# ----------------------------------------------------------------- setup ----
function Invoke-Setup {
  Write-Host ""
  Write-Host "  AGENT TEAM - setup" -ForegroundColor White
  Write-Host "  Every step is skipped if already done, so this is safe to re-run." -ForegroundColor DarkGray

  if (-not (Test-Docker)) {
    Write-Host ""
    Bad "Docker is not running - nothing else can proceed."
    Fix "start Docker Desktop, then run: agents setup"
    return 1
  }
  if (-not (Test-Node)) {
    Write-Host ""
    Bad "Node.js is not on PATH - the hub cannot start."
    Fix "install from https://nodejs.org, then run: agents setup"
    return 1
  }

  # ---- 1. images ----
  Head "1. Container images"
  foreach ($r in $Runtimes) {
    if (Test-Image $r.Image) { Ok "$($r.Image) already built" ; continue }
    Write-Host "         building $($r.Image) - this takes a few minutes the first time" -ForegroundColor DarkGray
    $buildArgs = @('build', '-f', (Join-Path $Here $r.Dockerfile), '-t', $r.Image)
    if ($r.Package) { $buildArgs += @('--build-arg', "CLI=$($r.Package)") }
    $buildArgs += $Here
    & docker @buildArgs 2>&1 | Select-Object -Last 3 | ForEach-Object { Note $_ }
    if (Test-Image $r.Image) { Ok "$($r.Image) built" }
    else { Bad "$($r.Image) failed to build"; return 1 }
  }

  # ---- 2. hub ----
  Head "2. Hub"
  if (-not (Test-Path (Join-Path $Here 'hub\node_modules'))) {
    Write-Host "         installing hub dependencies" -ForegroundColor DarkGray
    Push-Location (Join-Path $Here 'hub'); & npm install --no-audit --no-fund --silent 2>&1 | Out-Null; Pop-Location
  }
  if (Test-Path (Join-Path $Here 'hub\node_modules')) { Ok "dependencies installed" } else { Bad "npm install failed"; return 1 }

  if (Test-HubUp) { Ok "hub already running" }
  else {
    Start-Process -FilePath 'node' -ArgumentList (Join-Path $Here 'hub\server.mjs') -WorkingDirectory (Join-Path $Here 'hub') -WindowStyle Hidden
    # Give it a moment to bind before anything depends on it.
    for ($i = 0; $i -lt 15; $i++) { if (Test-HubUp) { break }; Start-Sleep -Milliseconds 400 }
    if (Test-HubUp) { Ok "hub started at $HubApi" }
    else { Bad "hub did not start"; Fix "run it in a window to see why:  node hub\server.mjs"; return 1 }
  }

  # ---- 3. sign-ins ----
  Head "3. Sign-ins"
  $missing = @()
  foreach ($r in $Runtimes) {
    if ((Test-Volume $r.Base) -and (Test-SignedIn $r.Name $r.Base)) { Ok "$($r.Name) is signed in" }
    else { Warn "$($r.Name) is not signed in"; $missing += $r.Name }
  }
  if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "  Sign in to each of these, then run setup again:" -ForegroundColor Yellow
    foreach ($n in $missing) { Write-Host "      agents login $n" -ForegroundColor Cyan }
    Note "a sign-in needs you at the keyboard, so setup stops here rather than half-building the team"
    Write-Host ""
    return 1
  }

  # ---- 4. team ----
  Head "4. Team homes, tokens and hub registration"
  & (Join-Path $Here 'team-setup.ps1') -HubApi $HubApi -McpUrl $McpUrl | Out-Null
  $bad = 0
  foreach ($m in $Members) {
    if ((Test-Volume $m.Vol) -and (Test-McpRegistered $m.Name)) { Ok ("{0,-9} ready" -f $m.Name) }
    else { Bad ("{0,-9} incomplete" -f $m.Name); $bad++ }
  }
  if ($bad -gt 0) { Fix "agents doctor   (says which part)"; return 1 }

  # ---- 5. git gateway ----
  Head "5. Git gateway"
  if (-not (Test-Network)) { & docker network create stride-agents 2>&1 | Out-Null }
  if (Test-Network) { Ok "network ready" } else { Bad "could not create the network"; return 1 }

  $bare = Join-Path $Here 'git\stride.git'
  if (Test-Path $bare) {
    # Recreate rather than reuse: the mount path or repo may have moved, and a
    # stale gateway serving the wrong directory fails in a confusing way.
    & docker rm -f stride-git-gateway 2>&1 | Out-Null
    $inner = 'git config --global --add safe.directory "*"; exec git daemon --base-path=/srv --export-all --enable=receive-pack --reuseaddr'
    & docker run -d --name stride-git-gateway --network stride-agents -v "${bare}:/srv/stride.git" (($Runtimes | Select-Object -First 1).Image) bash -lc $inner 2>&1 | Out-Null
    Start-Sleep -Milliseconds 800
    if (Test-Gateway) { Ok "gateway serving git://stride-git-gateway/stride.git" }
    else { Bad "gateway did not start"; Fix "docker logs stride-git-gateway"; return 1 }
  }
  else { Note "no shared repo yet - the next step creates it" }

  # ---- 6. checkouts ----
  Head "6. Git checkouts"
  & (Join-Path $Here 'git\git-setup.ps1') | Out-Null
  foreach ($m in $Members) {
    if (Test-Checkout $m.Name) { Ok ("{0,-9} on agent/{0}" -f $m.Name) }
    else { Bad ("{0,-9} has no checkout" -f $m.Name); $bad++ }
  }
  if ($bad -gt 0) { return 1 }

  # git-setup creates the bare repo on a first run, so the gateway had nothing to
  # serve a moment ago. Bring it up now rather than making the user run setup twice.
  if (-not (Test-Gateway) -and (Test-Path (Join-Path $Here 'git\stride.git'))) {
    $inner2 = 'git config --global --add safe.directory "*"; exec git daemon --base-path=/srv --export-all --enable=receive-pack --reuseaddr'
    & docker run -d --name stride-git-gateway --network stride-agents -v "$(Join-Path $Here 'git\stride.git'):/srv/stride.git" (($Runtimes | Select-Object -First 1).Image) bash -lc $inner2 2>&1 | Out-Null
    Start-Sleep -Milliseconds 800
    if (Test-Gateway) { Ok "gateway started" }
  }

  Write-Host ""
  Write-Host "  Setup complete." -ForegroundColor Green
  Write-Host "      agents ui                          watch what they do" -ForegroundColor Cyan
  Write-Host "      agents run manager ""...""           give the team a task" -ForegroundColor Cyan
  Write-Host ""
  return 0
}

# ---------------------------------------------------------------- status ----
function Invoke-Status {
  Write-Host ""
  Write-Host "  TEAM" -ForegroundColor White
  Write-Host ("  {0,-9} {1,-8} {2,-17} {3,-13} {4}" -f 'member', 'runtime', 'model', 'role', 'state') -ForegroundColor DarkGray
  $allReady = $true
  foreach ($m in $Members) {
    $state = if (-not (Test-Volume $m.Vol)) { 'not set up' }
    elseif (-not (Test-Checkout $m.Name)) { 'no checkout' }
    else { 'ready' }
    if ($state -ne 'ready') { $allReady = $false }
    Write-Host ("  {0,-9} {1,-8} {2,-17} {3,-13} " -f $m.Name, $m.Runtime, $m.Model, $m.Role) -NoNewline
    if ($state -eq 'ready') { Write-Host $state -ForegroundColor Green } else { Write-Host $state -ForegroundColor Yellow }
  }
  Write-Host ""
  if (Test-HubUp) {
    $s = Invoke-RestMethod -Uri "$HubApi/api/state" -TimeoutSec 5
    $open = @($s.work | Where-Object { $_.state -eq 'open' }).Count
    $claimed = @($s.work | Where-Object { $_.state -eq 'claimed' }).Count
    $pending = @($s.pending).Count
    Write-Host "  hub: running  |  $open open  |  $claimed in progress  |  $pending awaiting your approval" -ForegroundColor DarkGray
    if ($pending -gt 0) { Write-Host "  You have $pending proposal(s) to review:  agents ui" -ForegroundColor Yellow }
  }
  else { Write-Host "  hub: not running" -ForegroundColor Yellow; Fix "agents setup" }
  if (-not $allReady) { Write-Host "  Some members are not ready:  agents doctor" -ForegroundColor Yellow }
  Write-Host ""
}

# ------------------------------------------------------------------ main ----
# Accept the flag spelling a person will actually type.
if ($Arg1 -eq '--json' -or $Arg2 -eq '--json') { $script:AsJson = $true }

switch ($Command.ToLower()) {
  'doctor' { exit (Invoke-Doctor) }
  'setup' { exit (Invoke-Setup) }
  'status' { Invoke-Status; exit 0 }
  'ui' {
    if (-not (Test-HubUp)) { Warn "hub is not running - starting it"; Invoke-Setup | Out-Null }
    Start-Process $HubApi; Write-Host "  opened $HubApi" -ForegroundColor Green; exit 0
  }
  'login' {
    if (-not $Arg1) { Write-Host "  which runtime?  agents login claude   |   agents login codex" -ForegroundColor Yellow; exit 2 }
    $r = $Runtimes | Where-Object { $_.Name -eq $Arg1 }
    if (-not $r) { Write-Host "  unknown runtime: $Arg1 (have: $(($Runtimes.Name) -join ', '))" -ForegroundColor Red; exit 2 }
    if (-not (Test-Image $r.Image)) { Warn "$($r.Image) is not built yet"; Fix "agents setup"; exit 1 }
    if ($Arg1 -eq 'claude') {
      & (Join-Path $Here 'claude-login.ps1') -Start
      $code = Read-Host "  Paste the code from the browser here"
      if ($code -and $code.Trim()) { & (Join-Path $Here 'claude-login.ps1') -Code $code.Trim() }
      else { Write-Host "  Nothing pasted - cancelled." -ForegroundColor Yellow }
    }
    else { & (Join-Path $Here 'login.cmd') codex }
    Write-Host ""
    if (Test-SignedIn $r.Name $r.Base) { Ok "$Arg1 is signed in"; Note "next: agents setup" }
    else { Bad "$Arg1 is still not signed in"; Fix "agents login $Arg1" }
    exit 0
  }
  'run' {
    if (-not $Arg1 -or -not $Arg2) {
      Write-Host "  usage: agents run <member> ""<task>""" -ForegroundColor Yellow
      Write-Host "  members: $(($Members.Name) -join ', ')" -ForegroundColor DarkGray
      exit 2
    }
    if (-not (Test-HubUp)) { Bad "hub is not running"; Fix "agents setup"; exit 1 }
    & (Join-Path $Here 'hub\runner.ps1') -Agent $Arg1 -Prompt $Arg2 -Repo:$true
    exit $LASTEXITCODE
  }
  default {
    Write-Host ""
    Write-Host "  agents <command>" -ForegroundColor White
    Write-Host "    doctor                 check everything and say how to fix it" -ForegroundColor Gray
    Write-Host "    setup                  build and wire everything (safe to re-run)" -ForegroundColor Gray
    Write-Host "    status                 the team at a glance" -ForegroundColor Gray
    Write-Host "    login <claude|codex>   sign in a runtime" -ForegroundColor Gray
    Write-Host "    run <member> ""<task>""  give someone work" -ForegroundColor Gray
    Write-Host "    ui                     open the tracking panel" -ForegroundColor Gray
    Write-Host ""
    exit 0
  }
}
