# CLI agents in containers

Three coding agents — Claude Code, Codex, Gemini — each in its own container,
each signed in with **your own subscription**. No API keys.

## Use this

```
ui.cmd
```

Opens a control panel in your browser: who is signed in, one click to sign in,
one click to run work, and the full output of each agent side by side.

It runs a small local server (Node, no dependencies) because every button
shells out to docker on this machine — a hosted page could not do that.

### Or from the terminal

```
agents.cmd
```

Shows who is signed in and gives you a menu.

```
  CLI AGENTS
  ---------------------------------------------
  claude   READY   Claude pro subscription
  codex    READY   ChatGPT sign-in
  gemini   SIGN IN not signed in
  ---------------------------------------------

  What would you like to do?
   1) Sign in to gemini
   2) Run the test task on every signed-in agent
   3) Ask every signed-in agent to do something
   4) Re-check who is signed in
   q) Quit
```

Non-interactive forms, if you prefer:

| Command | Does |
|---|---|
| `agents.cmd check` | who is signed in |
| `agents.cmd login gemini` | sign one agent in, start to finish |
| `agents.cmd run` | graded task on every signed-in agent |
| `agents.cmd ask "write a haiku"` | one prompt to every signed-in agent |

## Signing in

Pick the agent from the menu and follow what it prints. Each agent differs,
and the menu handles the differences for you:

- **Claude** — a browser page gives you a code; paste it when asked. You paste
  into PowerShell, not into the container, because a container terminal on
  Windows cannot receive a paste.
- **Codex** — run `codex login --device-auth` in the shell it opens.
- **Gemini** — choose **Login with Google**, *not* "Gemini API key". The
  callback completes by itself, so there is nothing to paste.

Credentials persist in a docker volume per agent (`agent-<name>-home`), so you
sign in once, not every time.

## What the test task proves

`workspace/TASK.md` asks for a Roman-numeral converter; `workspace/verify.js`
checks it with 31 assertions (21 value cases, 10 `RangeError` cases). Every
agent gets an identical copy in its own folder, so they cannot see each other's
work, and the result is graded in a clean `node:24-slim` container rather than
in the agent's own — an agent cannot mark its own homework.

Results land in `runs/<agent>/<timestamp>/`, including the agent's full output.

## Files

| File | What it is |
|---|---|
| `ui.cmd` / `ui.mjs` / `ui.html` | **the control panel** — browser UI, start here |
| `agents.cmd` / `agents.ps1` | the same thing in a terminal menu |
| `claude-login.ps1` | Claude's login, which needs special handling (see below) |
| `login.cmd`, `agent.ps1`, `run-task.sh` | older single-purpose drivers, still work |
| `Dockerfile`, `Dockerfile.codex` | the images |
| `workspace/` | the graded task |

## Things that caused real bugs here

Worth knowing before changing any of this.

- **PowerShell 5.1 splits a native command's argument on embedded double
  quotes.** `bash -lc "script -qfc \"claude auth login\" ..."` reaches docker
  as several separate arguments. Pass shell code with single quotes only, or
  mount it as a file.
- **Piping a string into `docker exec -i bash` prepends a UTF-8 BOM**, which
  bash reports as a syntax error on line 1.
- **Docker needs a Windows path.** Under Git Bash `$PWD` is `/tmp/...`, and
  docker will silently mount an *empty* directory rather than failing. Use
  `cygpath -m`.
- **`--name` does not set the container hostname**, only `--hostname` does.
  Gemini's credential store cannot be read in a container other than the one
  that wrote it, so its hostname is pinned to `stride-agent-gemini`. Login and
  task runs must use the same value.
- **A login shell left running keeps holding the OAuth callback ports.** The
  next attempt then fails with "port is already allocated", which names the
  port but not the container. The login helper has a fixed name and is
  reclaimed automatically.
- **A Windows directory name must not end in `.`** — Win32 strips the trailing
  dot, so the folder you create is not the folder you can list afterwards.
  `toISOString().slice(0, 15)` lands exactly on one.
- **Gemini's login cannot be automated.** Driven through a pipe its TUI only
  redraws its banner, and `--prompt` mode refuses manual auth outright
  ("Manual authorization is required but the current session is
  non-interactive"), even with `GOOGLE_GENAI_USE_GCA=true` and a real pty.
  The UI opens a terminal window for it rather than pretending otherwise.
- **Never set `ANTHROPIC_API_KEY`.** It takes precedence over the signed-in
  account, so a stray key silently bills the API instead of the subscription
  and makes auth failures look like key failures.
