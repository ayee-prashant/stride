# Human-owned agent role registry

Status: implementation increment under verification on feature/agent-role-registry. This is the human configuration portion of AW-101, not a connected-agent execution release.

## Human flow

1. Open Team and agents and choose a project.
2. A workspace admin creates a stable profile or reuses an existing one, selects its role, and proposes readable/writable paths. The named operator must already be a workspace member.
3. Review the actual prompt, responsibilities and Outside my role section. The prompt comes from the reviewed role Markdown and its SHA-256 digest is saved with the configuration.
4. The proposal appears as Awaiting operator review. Only the named operator can accept responsibility, even when another person is an admin.
5. Revised scope or template adoption returns the role to pending and clears the previous operator approval. A revoked role requires an admin proposal and new operator decision before initialization.
6. History retains human authorship, timestamp, reason and the original prompt/scope for every decision. Registration and role approval do not start a task.

Profiles have server-issued UUIDs. One profile can hold separately approved roles in several projects without creating another identity. Alias, operator and reported tool label are immutable in this first increment; profile transfer and rename remain future guarded operations. A tool/model label is reported metadata, never verification of a provider or connection.

## Boundaries

- Human routes use the existing verified session, membership, same-origin JSON, quotas and private caching. There is no agent bearer credential or human impersonation adapter.
- Role states are pending, initialized and revoked. Initialized means the human operator accepted this configuration. Connection state remains not_connected and execution_ready remains false.
- Path lists record a proposed ceiling for future task packets. They grant no filesystem, GitHub, network, command, deployment or execution access in this increment. A future attempt must enforce the intersection of live grants, role, packet and runtime restrictions.
- No operator availability or productivity is inferred from registration. A removed member is shown unavailable; an admin can still revoke the role after operator removal or project archival.
- There is no current membership-generation model. Rejoining members can still have historical role decisions. Connection enrollment must add explicit revocation/permission epochs and renewed validation before any attempt authority is enabled.
- Agent initialization acknowledgements, connection credentials, start grants, task-state guards, BA/SA ticket planning, QA/UAT/release gates and IDE notifications remain pending. The role approval list is available in-app; no external notification delivery is claimed.

## Source and persistence

Reviewed role Markdown is the editable authority for built-in templates. Run node scripts/generate-agent-roles.mjs after a reviewed template change. The generated server module is a bundled copy; the native test command checks exact source parity. Historical decisions retain original bodies and hashes after the bundled template changes.

Three additive tables store immutable profiles, current project-role bindings and append-only role events. Profile identity and role events deny runtime UPDATE/DELETE after provisioning. Each configuration/decision and its event commit together. Idempotency keys bind operation, input and human actor; retries return current role state and the original receipt, so an old response cannot revive revoked approval.

Membership locks, a workspace quota lock, project locking and expected versions serialize competing decisions. Pilot limits: 20 profiles/workspace, 200 role bindings/project, 1,000 ordinary role revisions plus a final revocation; 50 bindings and 20 history events per page. Each role scope has at most 20 readable and 20 writable paths. Empty lists mean no repository file scope. A writable path must be inside the readable scope.

Apply reviewed generated migrations through the provisioning job before deploying the application; rerun provisioning to restrict profile/event mutation privileges. Do not drop registry data when rolling back application code.

## Verification

Local native suite: 111 tests passing at initial implementation, including operator-only decisions, tenant/admin checks, scope validation, stale templates/versions, historical evidence, retries after revocation and atomic audit rollback. PostgreSQL concurrency, restricted-runtime session, restore-content, type/lint/build and browser flows are authored; their actual results must be recorded after CI completes. No deployment is claimed here.
