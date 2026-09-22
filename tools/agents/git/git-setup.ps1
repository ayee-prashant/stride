<#
Give each agent its own git checkout that stays in sync with the others.

  .\git-setup.ps1                     build it from D:\STRIDE
  .\git-setup.ps1 -Source <path>      from somewhere else
  .\git-setup.ps1 -Status             who is ahead of whom
  .\git-setup.ps1 -Reset              tear it down and rebuild

WHY IT IS SHAPED THIS WAY

The obvious version - mount the real repo into all three containers - destroys
work. Three agents would share one .git, one index and one working tree:
concurrent operations fight over index.lock, and one agent running checkout
throws away another's uncommitted changes. They would also inherit your GitHub
credentials, so three autonomous processes could push to the real remote.

So instead, git's own answer: isolated checkouts with a shared sync point.

    D:\STRIDE                  your working repo - agents never touch it
        |  (one-way seed)
        v
    git\stride.git             bare repo, the shared sync point
        |
        +-- clones\<agent>  -> branch agent/<name>  -> mounted in that container

One clone per agent listed in agents.json. A disabled agent keeps its branch and
its history in the shared repo; it simply stops being set up and run.

Each agent commits on its own branch and pushes to the bare repo; each fetches
to see the others. That is what "in sync" means here - they converge through a
shared repo rather than editing the same files.

WHAT AGENTS DELIBERATELY CANNOT DO

  - reach github.com: the bare repo is local and no credentials are mounted.
    You push to the real remote, after reading the diff.
  - rewrite each other's history: the bare repo refuses non-fast-forward pushes
    and branch deletes.
  - touch your working tree: they work in their own clones.
  - commit anonymously: each clone has its own identity, so every commit says
    which agent made it.
#>
[CmdletBinding()]
param(
  [string]$Source = 'D:\STRIDE',
  [switch]$Status,
  [switch]$Reset
)

$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bare = Join-Path $Here 'stride.git'
$Clones = Join-Path $Here 'clones'

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
$Agents = $Config.Enabled

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

# Resolve the real git binary once. PowerShell function names are CASE-INSENSITIVE
# and functions take precedence over external commands, so a helper named `Git`
# silently shadows `git` - `& git ...` then calls the helper recursively and every
# call appears to fail. Hence GitIn, and an explicit path to the executable.
$GitExe = (Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $GitExe) { Write-Host 'git was not found on PATH.' -ForegroundColor Red; exit 1 }

# git writes ordinary progress to stderr, which PowerShell turns into ErrorRecord
# objects. Flatten them to strings and judge success by the exit code alone.
function RunGit([string[]]$gitArgs) {
  $out = & $GitExe @gitArgs 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ } }
  return @{ Code = $LASTEXITCODE; Out = ($out -join "`n") }
}
function GitIn([string]$dir, [string[]]$gitArgs) { return RunGit (@('-C', $dir) + $gitArgs) }

if ($Status) {
  if (-not (Test-Path $Bare)) { Say "Not set up yet. Run .\git-setup.ps1" 'Yellow'; exit 1 }
  Say ""
  Say "  Shared repo: $Bare" 'White'
  $branches = (GitIn $Bare @('for-each-ref', '--format=%(refname:short) %(objectname:short) %(committerdate:relative)', 'refs/heads')).Out
  Say "  branches in the shared repo:" 'Cyan'
  foreach ($line in ($branches -split "`n" | Where-Object { $_ })) { Say "    $line" }
  Say ""
  Say "  each agent's clone:" 'Cyan'
  foreach ($a in $Agents) {
    $c = Join-Path $Clones $a
    if (-not (Test-Path $c)) { Say ("    {0,-8} not created" -f $a) 'DarkGray'; continue }
    $branch = (GitIn $c @('rev-parse', '--abbrev-ref', 'HEAD')).Out.Trim()
    $dirty = (GitIn $c @('status', '--porcelain')).Out.Trim()
    # How far this clone is from the shared repo, in both directions.
    GitIn $c @('fetch', '--quiet', 'host') | Out-Null
    $counts = (GitIn $c @('rev-list', '--left-right', '--count', "host/main...$branch")).Out.Trim()
    Say ("    {0,-8} branch={1,-16} behind/ahead of main: {2,-8} {3}" -f $a, $branch, $counts, $(if ($dirty) { 'UNCOMMITTED CHANGES' } else { 'clean' }))
  }
  Say ""
  exit 0
}

if ($Reset -and (Test-Path $Here)) {
  Say "Removing the shared repo and every agent clone..." 'Yellow'
  foreach ($p in @($Bare, $Clones)) { if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
  Say "Removed. Your repo at $Source was not touched." 'Green'
}

if (-not (Test-Path (Join-Path $Source '.git'))) {
  Say "$Source is not a git repository." 'Red'; exit 1
}

# ---- the shared sync point -------------------------------------------------
if (-not (Test-Path $Bare)) {
  Say ""
  Say "Creating the shared repo from $Source ..." 'Cyan'
  $r = RunGit @('clone', '--bare', '--', $Source, $Bare)
  if ($r.Code -ne 0) { Say "  clone failed:" 'Red'; Say $r.Out 'Red'; exit 1 }

  # An agent must not be able to erase or rewrite another agent's work.
  GitIn $Bare @('config', 'receive.denyNonFastForwards', 'true') | Out-Null
  GitIn $Bare @('config', 'receive.denyDeletes', 'true') | Out-Null
  # A bare repo cannot be pushed to on its checked-out branch; there is none, but
  # be explicit so a later change of mind does not silently break pushes.
  GitIn $Bare @('config', 'receive.denyCurrentBranch', 'refuse') | Out-Null

  # The seed carried your origin. Remove it: agents must not be able to reach
  # github.com even by accident, and no credentials are mounted for it anyway.
  GitIn $Bare @('remote', 'remove', 'origin') | Out-Null
  Say "  created, force-push and branch deletion disabled, github remote removed" 'Green'
}
else { Say "Shared repo already exists at $Bare" 'DarkGray' }

# ---- one isolated clone per agent ------------------------------------------
New-Item -ItemType Directory -Path $Clones -Force | Out-Null
foreach ($a in $Agents) {
  $c = Join-Path $Clones $a
  $branch = "agent/$a"
  Say ""
  Say "=== $a ===" 'Cyan'

  if (-not (Test-Path $c)) {
    # Check out LF, not CRLF. Windows git defaults to core.autocrlf=true, but these
    # clones are only ever opened inside Linux containers - with CRLF on disk and LF
    # in the index, git reports every tracked file as modified (326 of them here) and
    # an agent will happily commit line-ending churn across the whole repository.
    $r = RunGit @('-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--quiet', '--', $Bare, $c)
    if ($r.Code -ne 0) { Say "  clone failed:" 'Red'; Say $r.Out 'Red'; continue }
    Say "  cloned" 'Green'
  }
  else { Say "  clone already exists" 'DarkGray' }

  # Real attribution: every commit says which agent made it. This is the point -
  # an agent's work must be traceable to that agent, not to you.
  GitIn $c @('config', 'user.name', "$a-agent") | Out-Null
  GitIn $c @('config', 'user.email', "$a@agents.local") | Out-Null
  # The clone is a Windows path bind-mounted into a container running as uid 1001,
  # so git sees an owner it does not recognise and refuses to operate without this.
  GitIn $c @('config', '--add', 'safe.directory', '/repo') | Out-Null
  GitIn $c @('config', 'pull.rebase', 'false') | Out-Null
  GitIn $c @('config', 'core.autocrlf', 'false') | Out-Null
  GitIn $c @('config', 'core.eol', 'lf') | Out-Null

  $exists = (GitIn $c @('rev-parse', '--verify', '--quiet', $branch)).Code -eq 0
  if (-not $exists) {
    GitIn $c @('checkout', '-q', '-b', $branch) | Out-Null
    GitIn $c @('push', '-q', '--set-upstream', 'origin', $branch) | Out-Null
    Say "  branch $branch created and published" 'Green'
  }
  else {
    GitIn $c @('checkout', '-q', $branch) | Out-Null
    Say "  on $branch" 'DarkGray'
  }

  # The clone was made from a Windows path, which does not exist inside a
  # container - an agent could never push or fetch through it. Point origin at
  # the path the container sees, and keep the host path as a second remote so
  # host-side tooling (-Status) still works.
  # origin is the gateway, NOT a mounted path. A writable bind mount of the bare
  # repo let an agent delete another agent's branch with update-ref, bypassing
  # receive.denyDeletes entirely - those hooks only run inside git-receive-pack.
  # Verified: the attack succeeded through the mount and is refused through this.
  GitIn $c @('remote', 'set-url', 'origin', 'git://stride-git-gateway/stride.git') | Out-Null
  GitIn $c @('remote', 'remove', 'host') | Out-Null
  GitIn $c @('remote', 'add', 'host', $Bare) | Out-Null
  GitIn $c @('branch', "--set-upstream-to=origin/$branch", $branch) | Out-Null

  # safe.directory has to be GLOBAL. git refuses to read a distrusted repo's own
  # config, so setting it inside the clone cannot take effect - the container
  # needs it in /home/agent/.gitconfig, which lives in the agent's home volume.
  # A member's image comes from its runtime, not its name: manager and tester
  # both run the claude image, agent1 and agent2 both run the codex one.
  $img = $Config.Members[$a].Image
  # --add appends unconditionally, so re-running this script accumulates duplicate
  # safe.directory entries. Add each only if it is not already there.
  $inner = "for d in /repo /shared; do git config --global --get-all safe.directory | grep -qx `$d || git config --global --add safe.directory `$d; done; " +
           "git config --global user.name '$a-agent'; git config --global user.email '$a@agents.local'; " +
           "echo safe.directory=`$(git config --global --get-all safe.directory | tr '
' ' ')"
  & docker run --rm -v "agent-$a-home:/home/agent" $img bash -lc $inner 2>&1 | ForEach-Object { Say "    $_" 'DarkGray' }
}

Say ""
Say "Done. Each agent has its own checkout; they sync through $Bare" 'Green'
Say "Your repo at $Source was not modified." 'Green'
Say ""
Say "  see who is where:   .\git-setup.ps1 -Status" 'DarkGray'
Say "  run agents on it:   ..\hub\runner.ps1 -Prompt ..." 'DarkGray'
