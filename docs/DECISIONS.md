# Architecture decisions

## ADR-001: modular monolith

Accepted. A single deployable app keeps the first release operable. Separate
domain, request boundary, repository, and UI modules; do not add microservices,
CQRS, event sourcing, or generic dependency injection without concrete need.

## ADR-002: platform identity and D1

Accepted. Use the supported host's identity and durable SQL capabilities. Keep
provider access behind small server helpers. No browser-only source of truth,
password storage, or ad-hoc auth framework. Private deployment is the default.

## ADR-003: prepared SQL and generated schema migrations

Accepted. Drizzle owns schema definitions/migrations; application SQL is explicit,
parameterized, bounded, and reviewable. The repository accepts a small database
interface for real-SQL integration tests without production access.

## ADR-004: recoverable edits

Accepted. Compare-and-swap integer versions prevent overwrite conflicts.
Archive/restore replaces hard-delete. UI only confirms server-accepted results;
optimistic visual feedback never becomes unconfirmed authoritative data.

## ADR-005: fixed workflow

Accepted. Three statuses and three priorities. Due dates are optional calendar
dates; task ownership is optional. A visible status action remains available
where drag-and-drop is supported so keyboard/touch use is not blocked.

## ADR-006: small-team release, explicit scale limits

Accepted. Indexed, bounded SQL and stateless compute are a growth foundation,
not evidence of unlimited scale. Measure before sharding or adding a cache.
