<#
Point all three CLI agents at a shared context MCP server.

  .\connect.ps1                     connect every agent to the local hub
  .\connect.ps1 -Agent gemini       just one
  .\connect.ps1 -Url https://... -Name stride    connect to STRIDE instead
  .\connect.ps1 -Show               what each agent currently has

Each CLI takes a different shape of the same idea, which is the whole reason
this script exists:

  claude   mcp add --transport http <name> <url> --header "Authorization: ..."
  codex    mcp add <name> --url <url> --bearer-token-env-var <VAR>
  gemini   mcp add -t http -s user <name> <url> -H "Authorization: ..." --trust

Codex is the odd one: it stores the name of an environment variable rather than
the token, so the runner has to pass the token in at run time. runner.ps1 does.
#>
[CmdletBinding()]
param(
  # Valid names come from the roster in agents.json; see the check below.
  [string]$Agent = 'all',
  [string]$Url = 'http://host.docker.internal:7400/mcp',
  [string]$HubApi = 'http://localhost:7400',
  [string]$Name = 'hub',
  [switch]$Show
)

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

$Config = Get-AgentConfig (Split-Path -Parent $Here)
$Agents = if ($Agent -eq 'all') { $Config.Enabled } else { @($Agent) }
foreach ($a in $Agents) {
  if ($Config.Disabled.ContainsKey($a)) {
    Write-Host "$a is disabled in agents.json:" -ForegroundColor Yellow
    Write-Host "  $($Config.Disabled[$a])" -ForegroundColor DarkGray
    exit 1
  }
}

function Get-Image([string]$a) {
  if ($a -eq 'codex') { return 'stride-agent-codex-official' }
  return "stride-agent-$a"
}
function Get-RunArgs([string]$a) {
  $d = @('run', '--rm', '-v', "agent-$a-home:/home/agent")
  # Gemini's credential store cannot be read in a container other than the one
  # that wrote it, so its hostname is pinned. --name does not do this.
  if ($a -eq 'gemini') { $d += @('--hostname', 'stride-agent-gemini') }
  return $d
}

if ($Show) {
  foreach ($a in $Agents) {
    Write-Host ""
    Write-Host "=== $a ===" -ForegroundColor Cyan
    $probe = switch ($a) {
      'claude' { @('claude', 'mcp', 'list') }
      'codex'  { @('codex', 'mcp', 'list') }
      'gemini' { @('gemini', 'mcp', 'list') }
    }
    & docker @((Get-RunArgs $a) + @((Get-Image $a)) + $probe)
  }
  exit 0
}

# Each agent gets its own token, so the hub can tell them apart. It stamps the
# actor from the token - an agent never declares who it is.
function Get-Token([string]$a) {
  try {
    $body = @{ name = $a } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Uri "$HubApi/api/token" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
    return $r.token
  }
  catch {
    Write-Host "  Could not reach the hub at $HubApi - is it running? (node server.mjs)" -ForegroundColor Red
    return $null
  }
}

$tokens = @{}
foreach ($a in $Agents) {
  Write-Host ""
  Write-Host "=== $a ===" -ForegroundColor Cyan

  $token = Get-Token $a
  if (-not $token) { continue }
  $tokens[$a] = $token

  # Replace any previous registration so re-running this is safe.
  $remove = switch ($a) {
    'claude' { @('claude', 'mcp', 'remove', '-s', 'user', $Name) }
    'codex'  { @('codex', 'mcp', 'remove', $Name) }
    'gemini' { @('gemini', 'mcp', 'remove', $Name) }
  }
  & docker @((Get-RunArgs $a) + @((Get-Image $a)) + $remove) 2>&1 | Out-Null

  # NOTE: no embedded double quotes anywhere below. PowerShell 5.1 splits a
  # native command's argument on them, which silently tears the command apart.
  $add = switch ($a) {
    # -s user, not the default 'local': local scope is per-directory, so a server
    # registered while in /work is invisible in /repo and the agent silently loses
    # every hub tool.
    'claude' { @('claude', 'mcp', 'add', '-s', 'user', '--transport', 'http', $Name, $Url, '--header', "Authorization: Bearer $token") }
    'codex'  { @('codex', 'mcp', 'add', $Name, '--url', $Url, '--bearer-token-env-var', 'HUB_TOKEN') }
    'gemini' { @('gemini', 'mcp', 'add', '-t', 'http', '-s', 'user', $Name, $Url, '-H', "Authorization: Bearer $token", '--trust') }
  }
  & docker @((Get-RunArgs $a) + @((Get-Image $a)) + $add)
  if ($LASTEXITCODE -eq 0) { Write-Host "  registered" -ForegroundColor Green }
  else { Write-Host "  registration failed (exit $LASTEXITCODE)" -ForegroundColor Red }
}

# Codex resolves its token from HUB_TOKEN at run time. runner.ps1 asks the hub for
# it on each run rather than reading a cached copy, so nothing is written to disk
# here - a stale token file produced a 401 that looked like a login problem.
if ($tokens.ContainsKey('codex')) {
  Write-Host ""
  Write-Host "Codex reads its token from HUB_TOKEN; runner.ps1 supplies it per run." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Connected. Check with:  .\connect.ps1 -Show" -ForegroundColor Green
