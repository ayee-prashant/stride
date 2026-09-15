# Project baseline artifact outlines

Template version: 1. These are linked artifacts with separate authority, not multiple writable copies of project truth.

## Product definition: PRODUCT_DEFINITION.md

- Problem and intended users: {{problem_and_actors}}
- Desired outcomes and how humans assess them: {{success_measures}}
- Main user journeys and business rules: {{journeys}}
- Included scope and explicit exclusions: {{scope_and_exclusions}}
- Priority recommendations and tradeoffs: {{priorities}}
- Security, privacy, accessibility, performance and operating constraints: {{constraints}}
- Assumptions, dependencies and unresolved decisions: {{open_questions}}
- Product owner, proposal revision and evidence sources: {{ownership_and_sources}}
- Accepted publication reference: {{human_decision_reference_or_proposed}}

The BA agent drafts this artifact and source-linked requirement proposals. The product human decides scope. An authorized context steward publishes accepted project context. One authorized person can fill both roles; preserve the decision and publication records.

## Requirement registry and generated REQUIREMENTS.md

For each requirement include:

| Field | Value |
| --- | --- |
| Stable requirement ID and revision | {{requirement_identity}} |
| Status and authoritative registry reference | {{proposed_or_accepted_and_reference}} |
| User/business need and rationale | {{need}} |
| Acceptance criteria with stable IDs | {{observable_criteria}} |
| Positive, negative and boundary examples | {{examples}} |
| Nonfunctional constraints and measurement conditions | {{constraints}} |
| Explicit exclusions and dependencies | {{boundaries}} |
| Source evidence and unresolved assumptions | {{sources}} |
| Human scope decision / publication reference | {{decision_or_pending}} |

REQUIREMENTS.md is a generated export of registry records. Include export version, authoritative record links and timestamp. Agents propose registry changes; editing the export is not a change to accepted requirements. Do not maintain a second independently editable acceptance baseline.

## Solution design: SOLUTION_DESIGN.md

- Accepted requirement revisions and exclusions: {{inputs}}
- Existing system and constraints: {{current_architecture}}
- Chosen approach, alternatives and tradeoffs: {{decision}}
- Component boundaries and interfaces: {{contracts}}
- Data model, isolation, consistency and migrations: {{data_design}}
- Authorization, abuse cases and secret handling: {{security}}
- Performance targets, workload assumptions and measurement plan: {{performance}}
- Failure handling, observability, recovery and rollback: {{operations}}
- QA/regression and UAT strategy with criterion traceability: {{validation}}
- Delivery slices, dependency order and integration/release owner: {{delivery}}
- Referenced ADRs and exact Git revisions: {{adopted_decision_refs}}
- Technical human decision and adoption reference: {{decision_or_pending}}

An architect proposal is not adopted architecture. A human adopts its exact revision after review. Source updates that affect active work trigger impact analysis; they cannot silently rewrite approved packets.

## Supporting records

The baseline links its accepted delivery plan, ticket proposals, [role/access configuration](../ROLE_CATALOG.md), test/UAT scenarios and release/recovery plan. Keep separate files only when their ownership or reuse justifies it. Unknown decisions remain visible blockers.

All draft artifacts use the packet's explicitly allowed proposal paths or proposal API. Accepted publications are created through human-authorized context services. Do not overwrite accepted project instructions as an ordinary documentation edit.
