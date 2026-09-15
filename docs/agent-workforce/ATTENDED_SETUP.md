# Human-supervised agent delivery

This guide describes the implemented attended workflow. Consult
IMPLEMENTATION_STATUS.md and ../RELEASE_REVIEW.md for the latest verification
and deployment evidence. An implementation is not a claim that every third-party
IDE or a production GitHub installation has been tested.

## Prepare a project

1. Sign in and open **Agent delivery → Human responsibilities**. An administrator
   names the requirements, architecture, engineering, QA, UAT and release humans.
   Requirements and architecture reviewers need admin membership because their
   acceptance publishes authoritative project documents. A small team can assign
   the same human to several gates.
2. Open **Team and agents**. Register profiles such as BA 1, SA 1, DEV 1 and QA 1,
   each with a real operator. Select a role and narrow its repository read/write
   paths. The named operator reviews and initializes the exact prompt and exclusions.
   Profiles can have multiple roles. Reviews by the candidate's own profile are
   explicitly labeled self-review; they still require the named human's acceptance.
3. The requirements human creates a BA discovery task. Assign the initialized
   BA role. Task creation and assignment do not authorize execution.
4. After the BA report is accepted, create and assign architecture discovery.
   The architect receives the approved baseline, proposes design documents and
   at most 25 dependency-ordered tickets with requirements, prompts, scope,
   acceptance criteria, to-dos and optional specialist reviews. Human acceptance
   publishes the design and creates the tickets. Assign profiles manually.

## Connect a machine

The companion requires Node 24 and Git on Linux, macOS or WSL. Native Windows
credential storage is not supported in this release. Use a reviewed Stride
checkout containing `scripts/stride-agent.mjs` and install its locked dependencies
with `npm ci`. The deployed release branch is `deploy/vercel-railway`; an unmerged
default branch may not contain this release yet.

In **Agent delivery → Connections**, the role's operator enrolls a named machine.
Run the exact login command shown there. It contains public client identifiers,
not passwords or API tokens. Approve both browser requests as that operator:
one for agent work and one for the local companion. The loopback callback is
`http://127.0.0.1:43871/callback`; that port must be free during login.

Add this local MCP entry using your IDE's documented configuration mechanism:

```json
{
  "mcpServers": {
    "stride": {
      "command": "node",
      "args": [
        "/absolute/path/to/stride/scripts/stride-agent.mjs",
        "mcp", "--connection", "YOUR_CONNECTION_ID"
      ]
    }
  }
}
```

This is a generic JSON example, not a claim that every vendor uses the same
configuration file. The local bridge uses stdio; its remote side pins MCP
2026-07-28. Direct remote clients can use `/mcp` only with their enrolled public
client, exact resource audience and OAuth PKCE. Anonymous dynamic registration,
shared API keys and browser cookies are not agent credentials.

Start the notification companion in your IDE's integrated terminal:

```sh
node /absolute/path/to/stride/scripts/stride-agent.mjs watch --connection YOUR_CONNECTION_ID
```

It shows private notices and review links. To prepare a specific task, stop that
watcher and run it in the task's own clean Git checkout with `--ticket TICKET_ID`.
Only one watcher and one MCP bridge may use a connection concurrently. Give
another machine its own enrollment; do not copy credential files.

The agent first calls `stride_get_role` and acknowledges the exact template with
`stride_initialize`. It reads `stride_inbox` and `stride_work_packet`. The operator
reviews that packet, picks the prepared connection and selects **Authorize this
start**. Then ask the IDE agent to call `stride_claim` and do the work. Stride does
not wake arbitrary idle models or accept IDE permission prompts for you.

## Work, review and recovery

- Each start is for one connection, packet and attempt. An unused grant expires
  in five minutes. The attended companion renews a 90-second lease every 15 seconds.
  Execution decisions use the database clock; monotonic elapsed time advances the
  local clock anchor between checks.
- Checkpoints save only this task's summary, changed paths, next steps and blockers.
  Personal chat history is not project authority. A new machine receives approved
  documents, repository facts, scoped instructions and the last shared checkpoint.
- `stride_submit` records an agent report. It never accepts the result. Read
  `stride://report-schema` for the bounded report contract. Reports distinguish
  checks actually run from failed or unrun checks and include reproducible findings.
- Human acceptance advances Dev → selected specialists → peer review → QA →
  UAT authorization/testing → release authorization/verification → closure.
  Failed or blocked reports return for rework. A changed candidate repeats reviews;
  a changed artifact repeats UAT. Repeated failures require replanning.
- The architecture human can withdraw a candidate outside a submitted-report gate
  and return it to development. Submitted reports return through their assigned
  review gate. Accepted outcomes are immutable; use follow-up tickets for new work.
- Signing in again cannot resume an older execution attempt. Role/membership/context
  changes, revocation and lease expiry stop Stride accepting further work. A new
  assignment and human start are required. Physical process termination remains
  the operator's responsibility; an offline machine is never reported as stopped
  merely because Stride withdrew its authority.

Tokens are stored in private, owner-only local files under `~/.stride/connections`.
These permissions separate OS users; they are not a sandbox against software
running as the same OS user. Keep that directory outside the agent's permitted
filesystem scope. Stride enforces its own APIs; the human controls independently
supplied GitHub/host credentials and the IDE's command/file permissions.

## GitHub evidence and hosting

Before implementation/review starts, configure and enroll the project's GitHub
source following GITHUB_CONTEXT_SETUP.md. The application uses its own installed
GitHub App. The development connector used to build Stride is a separate identity
and does not supply the deployed application's credentials.

For delivery evidence, add repository read permissions for Pull requests, Checks,
Commit statuses and Deployments to Contents and Metadata. The persistent
`npm run worker:agents` service uses the same approved bindings, restricted database
connection and verified TLS settings as the web app. It performs both source
synchronization and candidate verification, so a separate context worker is optional.
Only workers receive
the GitHub App signing key. The web process queues bounded evidence requests.

Before human acceptance, the worker verifies the repository ID, target branch,
PR head, exact commit, complete changed-file list and successful GitHub checks/statuses.
Every changed and renamed path must fit the approved ticket scope. Pull requests
with more than 100 changed files must be split before this release can accept them. UAT and production
verification additionally require a successful GitHub Deployment for the exact
commit and environment with an immutable `payload.artifact` identifier. A host
success message alone is not sufficient. Configure the deployment pipeline to
publish these records; Stride does not mint deployment success from an agent report.

Release authorization records the tested artifact, environment, configuration,
migration and recovery plan. Deployment itself stays under the human's existing
host workflow. Stride independently verifies its outcome before human closure.

The first release conservatively invalidates active source-aware packets whenever
the tracked baseline branch moves, including changes outside this ticket's files.
Deploy the reviewed immutable candidate while keeping that baseline stable through
closure. Merging into the tracked branch during an active workflow requires a fresh
context review and assignment; it is not silently treated as the old packet. This
release does not claim semantic impact analysis or automatic reconciliation of a
moving integration branch.

No OpenRouter or model API is required. The IDE agent uses its own model access;
Stride supplies coordination, context, evidence and approval boundaries.
