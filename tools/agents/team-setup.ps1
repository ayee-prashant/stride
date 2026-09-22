<#
Stand up the team described in agents.json.

  .\team-setup.ps1            build every roster member
  .\team-setup.ps1 -Status    show what exists
  .\team-setup.ps1 -Reset     remove the cloned volumes and start over

WHY EACH MEMBER NEEDS ITS OWN VOLUME

A member's identity is its NAME, not its runtime. manager and tester both run the
claude CLI; agent1 and agent2 both run codex. If they shared a home volume they
would share one MCP registration and therefore one hub token, and the hub could
not tell them apart - every action would be attributed to whichever name was
registered last.

So each member gets a clone of its runtime's base volume. The clone carries the
same sign-in (same subscription, already authenticated) but its own config, its
own token and its own git branch.

  agent-claude-home  --clone-->  agent-manager-home   (claude-opus-5,  manager)
                     --clone-->  agent-tester-home    (claude-sonnet-5, tester)
  agent-codex-home   --clone-->  agent-agent1-home    (gpt-5.6-terra,  implementer)
                     --clone-->  agent-agent2-home    (gpt-5.6-sol,    implementer)

The base volumes are never modified, so the sign-in you did by hand stays intact.
#>
[CmdletBinding()]
param(
  [switch]$Status,
  [switch]$Reset,
  [string]$HubApi = 'http://localhost:7400',
  [string]$McpUrl = 'http://host.docker.internal:7400/mcp'
)

$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cfg = Get-Content (Join-Path $Here 'agents.json') -Raw | ConvertFrom-Json

$Members = @()
$Cfg.roster.PSObject.Properties | ForEach-Object {
  $Members += [pscustomobject]@{
    Name = $_.Name; Runtime = $_.Value.runtime; Model = $_.Value.model
    Role = $_.Value.role; Purpose = $_.Value.purpose
    Image = $Cfg.runtimes.($_.Value.runtime).image
    Base  = $Cfg.runtimes.($_.Value.runtime).baseVolume
    Vol   = "agent-$($_.Name)-home"
  }
}

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

if ($Status) {
  Say ""
  Say "  TEAM" 'White'
  Say ("  {0,-9} {1,-8} {2,-17} {3,-16} {4}" -f 'member', 'runtime', 'model', 'role', 'volume') 'DarkGray'
  foreach ($m in $Members) {
    $have = (& docker volume ls -q -f "name=^$($m.Vol)$")
    Say ("  {0,-9} {1,-8} {2,-17} {3,-16} {4}" -f $m.Name, $m.Runtime, $m.Model, $m.Role, $(if ($have) { 'ready' } else { 'MISSING' }))
  }
  Say ""
  exit 0
}

if ($Reset) {
  foreach ($m in $Members) { & docker volume rm -f $m.Vol 2>&1 | Out-Null }
  Say "Cloned volumes removed. The base sign-ins were not touched." 'Yellow'
  exit 0
}

# ---- 1. clone each member's home volume from its runtime's base --------------
foreach ($m in $Members) {
  Say ""
  Say "=== $($m.Name)  ($($m.Runtime), $($m.Model), $($m.Role)) ===" 'Cyan'

  $base = (& docker volume ls -q -f "name=^$($m.Base)$")
  if (-not $base) { Say "  base volume $($m.Base) is missing - sign that runtime in first" 'Red'; continue }

  $have = (& docker volume ls -q -f "name=^$($m.Vol)$")
  if ($have) { Say "  volume already exists" 'DarkGray' }
  else {
    & docker volume create $m.Vol 2>&1 | Out-Null
    # --user root: a freshly created volume is owned by root, and the image runs
    # as uid 1001, so the copy fails with permission denied on every file.
    # cp -a then restores agent:agent ownership and the 0600 modes that the CLIs
    # require on credential files.
    & docker run --rm --user root -v "$($m.Base):/from:ro" -v "$($m.Vol):/to" $m.Image `
      bash -lc 'cp -a /from/. /to/ && chown -R 1001:1001 /to && echo cloned' 2>&1 |
      ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { if ($null -ne $_.Exception) { $_.Exception.Message } else { $_.ToString() } } else { $_ } } |
      ForEach-Object { Say "  $_" 'Green' }
  }

  # A half-copied volume must not be registered: the member would get a token and
  # an MCP entry while having no credentials, and the failure would surface later
  # as a puzzling auth error instead of here.
  $probe = (& docker run --rm -v "$($m.Vol):/home/agent" $m.Image bash -lc 'ls -A /home/agent 2>/dev/null | wc -l') | Select-Object -Last 1
  if ([int]$probe -lt 3) {
    Say "  clone looks empty ($probe entries) - skipping $($m.Name)" 'Red'
    continue
  }

  # ---- 2. give the member its own hub identity and token --------------------
  try {
    $body = @{ name = $m.Name; model = $m.Model; approval_mode = 'auto'; runtime = $m.Runtime; role = $m.Role } | ConvertTo-Json -Compress
    $token = (Invoke-RestMethod -Uri "$HubApi/api/token" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10).token
  }
  catch { Say "  hub is not reachable at $HubApi - start it first (node hub\server.mjs)" 'Red'; continue }

  # ---- 3. register the hub as an MCP server inside that member's volume ------
  # No embedded double quotes below: PowerShell 5.1 splits a native argument on
  # them and the command reaches docker already torn apart.
  $run = @('run', '--rm', '-v', "$($m.Vol):/home/agent", $m.Image)
  if ($m.Runtime -eq 'claude') {
    # -s user, not the default per-directory scope: registered from one working
    # directory it would be invisible from another, and the member would silently
    # have no hub tools at all.
    & docker @($run + @('claude', 'mcp', 'remove', '-s', 'user', 'hub')) 2>&1 | Out-Null
    & docker @($run + @('claude', 'mcp', 'add', '-s', 'user', '--transport', 'http', 'hub', $McpUrl, '--header', "Authorization: Bearer $token")) 2>&1 | Out-Null
  }
  else {
    # Codex stores the NAME of an env var; runner.ps1 supplies HUB_TOKEN per run.
    & docker @($run + @('codex', 'mcp', 'remove', 'hub')) 2>&1 | Out-Null
    & docker @($run + @('codex', 'mcp', 'add', 'hub', '--url', $McpUrl, '--bearer-token-env-var', 'HUB_TOKEN')) 2>&1 | Out-Null
  }
  Say "  hub registered, token issued" 'Green'

  # ---- 4. git identity, so commits say which member made them ---------------
  & docker @($run + @('bash', '-lc', "for d in /repo /shared; do git config --global --get-all safe.directory | grep -qx `$d || git config --global --add safe.directory `$d; done; git config --global user.name '$($m.Name)'; git config --global user.email '$($m.Name)@agents.local'")) 2>&1 | Out-Null
}

Say ""
Say "Team ready. Next:" 'Green'
Say "  .\git\git-setup.ps1        give each member its own checkout" 'DarkGray'
Say "  .\team-setup.ps1 -Status   see the roster" 'DarkGray'
