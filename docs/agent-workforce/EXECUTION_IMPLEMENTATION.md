# Complete attended agent delivery

This implementation continues the approved design through connections, execution,
human review, cold-start handoffs, verification and deployment. A green registry
increment is not completion of the tool.

## Protocol and identity decision

Use the maintained TypeScript MCP 2.0.0 server/client for the 2026-07-28 protocol
and its explicit legacy stateless adapter. Use Better Auth OAuth Provider 1.7.4
with the existing Better Auth 1.7.4 identity store, authorization code + PKCE,
short access tokens, rotating refresh tokens and exact resource audiences.
Do not implement an authorization server or JSON-RPC transport from scratch.

A registered native OAuth client belongs to one persisted connection, profile,
project and human operator. Client metadata is controlled by the server. Every
agent request rechecks that binding, human membership, role revision, connection
revocation and the underlying session. Token validity never authorizes a start.
The companion and MCP resource have distinct audiences and permissions.

The first supported mode is attended execution: a human manually assigns and
authorizes a specific work packet, then instructs their IDE/CLI agent to claim it.
MCP does not wake arbitrary idle models. The companion maintains a lease and
shows durable notifications; reported host facts remain labeled reported.

## Required completion evidence

- Real OAuth code/PKCE, issuer/audience and wrong-profile tests.
- Modern and legacy SDK round trips, origin and malformed metadata rejection.
- BA baseline and architect plan approval; manually assigned, operator-started
  work; development, review, QA, UAT, release and closure gates.
- Context and role changes fence stale work; concurrent claims and retries are
  safe; revocation is immediate; private notices and audit history are durable.
- SQLite and PostgreSQL contracts, runtime auth, desktop/mobile browser flow,
  migration parity, restricted database permissions and backup restoration.
- Exact verified source deployed with live smoke checks and operator setup docs.

Dependency preparation uses read-only GitHub CI and publishes reviewed lock/schema
artifacts. The temporary preparation workflow is removed once they are committed.
