# GitHub project context: source configuration

For the delivery release, also follow [ATTENDED_SETUP.md](ATTENDED_SETUP.md).
It adds PR/check/deployment evidence and an attended execution worker to the
source observation contract below. The historical first-slice exclusions are not
a description of the later delivery engine.

The context worker reads a single approved repository and branch per project.
Humans still publish accepted requirements, decisions and constraints. A GitHub
observation is a code fact, never an approval or an instruction to execute code.
No model API is required.

## Deployment configuration

1. Apply the committed PostgreSQL migrations with the privileged provisioning
   job. Provisioning grants the runtime read/insert access to immutable source
   observations, source events and request receipts, and denies their update or
   deletion. Existing migrations and human task data are preserved.
2. Create a private GitHub App with repository **Contents: read**, **Metadata: read**,
   **Pull requests: read**, **Checks: read**, **Commit statuses: read** and
   **Deployments: read** for the attended delivery release. The source reader alone
   uses Contents and Metadata; the delivery verifier uses all six. Install it only
   on the repository to be enrolled. No write, Actions, organization or account
   permissions are required. Polling does not require an active webhook or user OAuth.
   Keep the private key in the host secret manager, never in a repository file.
3. Set `STRIDE_GITHUB_CONTEXT_BINDINGS` on the web service and context worker to
   the same JSON array of explicit project grants. The IDs must refer to existing
   Stride workspace/project records and the installed GitHub repository:

   ```json
   [{
     "key": "product_repository",
     "workspace_id": "existing_workspace_id",
     "project_id": "existing_project_id",
     "repository_id": 123456,
     "installation_id": 654321,
     "owner": "your-github-owner",
     "repository": "your-repository",
     "branch": "main",
     "paths": ["README.md", "docs/ARCHITECTURE.md"]
   }]
   ```

4. On the **worker only**, also set `STRIDE_GITHUB_APP_CLIENT_ID` and
   `STRIDE_GITHUB_APP_PRIVATE_KEY`. The web service does not need the signing key.
   A PEM value may contain actual newlines or escaped `\n` characters. The worker
   refuses partial settings, invalid keys, duplicate grants and unsupported paths.
5. Start one persistent service with `npm run worker:agents`, the same immutable
   source version as the web app, its runtime database URL and verified database
   TLS configuration. The existing scheduled email/reminder job remains separate.
   The coordinator performs both source reconciliation and delivery evidence reads;
   an additional source-only worker is unnecessary.
   Allow at least 45 seconds for graceful termination of an in-flight read.
6. The project grant delegates read access to current members of its Stride
   workspace. Review that audience and the configured files before enrollment.
   A workspace admin opens **Project brief → GitHub context**, reviews the included
   paths and selects **Connect repository**. This explicit enrollment queues a
   read. The interface shows waiting, checking, verified or unavailable states.
   Members can request a sync; only admins can connect or disconnect.

There are no bundled credentials or automatically borrowed personal GitHub tokens.
The development GitHub connector is separate from this application's GitHub App.
An unconfigured project remains a usable human context workspace and reports that
no repository source is connected.

## Reading and synchronization guarantees

- Each installation token is restricted to the approved repository ID and read
  permissions. Repository ID and owner/name are checked again on every sync.
- The provider reads one branch head, its exact commit/tree and every configured
  regular file. It verifies the Git blob SHA-1 and records a SHA-256 content hash.
  It rereads the branch head before publishing. A moved branch, missing file,
  symlink, truncated tree or partial response produces an unavailable result.
- Source text is plain UTF-8 reference material. No commands, links, markdown
  scripts or instructions from it are executed. Credentials, environment files,
  private keys and common private agent-state directories cannot be enrolled.
  Path checks are a guardrail, not a scanner for secrets embedded in ordinary files;
  the administrator must approve the file set before enrollment.
- Reads use the fixed GitHub API origin, no redirects, bounded response streams,
  a 35-second overall deadline and at most three simultaneous blob reads. Tokens
  and provider response bodies are not logged or persisted.
- The worker processes one source at a time, normally revisiting it after 120
  seconds. Verified content expires after 180 seconds without a successful check.
  The UI polls status while visible. This is periodic reconciliation; it does not
  depend on an agent reporting an external push. A change immediately after a
  check may be detected on the next poll, not instantly.
- PostgreSQL stores due time, a 60-second job lease, a monotonically increasing
  generation and an opaque claim ID. A restarted worker can replace an expired
  claim. Old or disconnected claims cannot publish results. A disconnect and a
  completed observation serialize on the same project context lock.
- Identical manifests reuse the original immutable observation and update the
  separate verification time. Error transitions and recovery produce source
  events in the same commit-ordered cursor as human context publications.
- Retries use immutable human request receipts. Replaying an old Connect request
  after Disconnect acknowledges the old operation without reconnecting. Responses
  contain that original receipt and a freshly authorized current view.
- Provider outages, lost access, missing worker activity and expired checks block
  new source-aware task briefs. Previously saved source files are withheld while
  current access cannot be verified. The immutable database snapshot is preserved.
  Changing a server grant withholds the old grant's historical files immediately
  after the new configuration reaches the web replicas. Restart/update **all** web
  and worker replicas when changing or removing a grant.

## Source component scope and limits

The source component observes configured files at the enrolled branch. It does
not index the entire repository, discover all requirements, protect branches,
implement webhook delivery, or authorize agent work. `repository_mode` is `observed`
and source coverage is `configured_files`. Context-only briefs keep
`execution_ready: false`; attended execution uses separately approved delivery packets.
PR/CI evidence, stable agent profiles and execution gates belong to the delivery
service described in ATTENDED_SETUP.md.
Any branch head change conservatively invalidates a source-aware task brief;
component-specific code impact rules are not implemented yet.

Current bounds: five configured projects per process; one repository per project;
1–12 required files; 32 KiB per file and 64 KiB across source files; 5,000 tree
entries/2 MiB tree response; 1,000 distinct source observations; 2,000 human source
request receipts per project. The complete task brief still has its 128 KiB limit.
Required inputs are never silently truncated. At a history limit synchronization
becomes unavailable until an explicit retention policy is implemented. Monitor
that state before limits are reached; no destructive cleanup is automatic.

Source lease deadlines currently use synchronized application clocks plus database
serialization and generation fencing. These are read-reconciliation jobs. The
future execution claim service must implement the stronger database-clock,
start-grant and contribution fencing contracts before any coding run is enabled.

## Verification and next gates

The native contract suite covers grants, tenant access, idempotency after later
mutations, claim expiry, late results, outage/recovery, mixed context cursors,
immutable briefs, source removal and provider cooldowns. The same contract runs
against PostgreSQL, with competing worker and source/brief publication tests.
Provider tests use signed synthetic App JWTs and mocked GitHub responses. Browser
verification uses genuine local test sessions and a fixture observation through
the real queue and database service; it does not contact GitHub or add an auth bypass.
An installed App, an external push and worker restart are separate live-integration
checks. Current installation and verification records are in ../RELEASE_REVIEW.md.
The guarded production source check receives no GitHub signing key and operates
through an authenticated human session on the private application network.

Follow IMPLEMENTATION_STATUS.md and DELIVERY_PLAN.md for source indexing, PR/CI
reconciliation, actor identities, proposals, MCP/OAuth, start approvals and the
cross-machine handoff gates. This increment contributes to AW-006/106/107; it does
not close all of those tickets.
