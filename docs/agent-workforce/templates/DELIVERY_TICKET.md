# Delivery ticket proposal

Template version: 1. Proposal until human scope/plan acceptance. One ticket represents one human outcome; role work items belong underneath it.

## Why this work exists

- Proposed title and outcome: {{title_and_outcome}}
- Human outcome owner: {{owner}}
- Initiative / accepted plan revision: {{plan_reference}}
- Requirement IDs and accepted revisions: {{requirement_references}}
- Acceptance criteria and evidence expected: {{criterion_table}}
- Relevant baseline and adopted decisions: {{context_references}}
- In scope: {{scope}}
- Explicit exclusions: {{exclusions}}
- Related tickets, active branches/PRs and duplicate-check evidence: {{related_work}}
- Priority/risk recommendation with rationale: {{recommendation}}
- Open questions / missing authority: {{blockers}}

A proposed requirement is labelled proposed and cannot justify execution as accepted scope. Do not invent identifiers, approvals or source evidence.

## Delivery policy

- Selected workflow/version: {{workflow}}
- Completion policy: {{production_verified_and_human_closed_or_explicit_artifact_policy}}
- Mandatory engineering, QA, UAT, security and release gates: {{gates}}
- Accountable engineering / QA / business / release humans: {{human_roles}}
- Independence policy: {{independence}}
- Required test environment and candidate identity policy: {{environment_policy}}
- Integration owner and shared release candidate, when applicable: {{integration_policy}}
- Rework/replanning bound: {{bound}}
- Risk exceptions allowed by policy and designated authority: {{exception_policy}}

## Proposed role contributions

| Work item | Active role | Bounded TODOs | Required input/dependency type | Output/evidence | Human reviewer |
| --- | --- | --- | --- | --- | --- |
| {{work_ref}} | {{role}} | {{todos}} | {{submitted_artifact_verified_candidate_or_human_accepted_input}} | {{output}} | {{reviewer}} |

A dependency must specify the condition it needs. Review may depend on submitted development and verified CI; it must not require the development acceptance that the review itself enables. Validate cycles and plan bounds before acceptance.

For each contribution attach a [work packet](WORK_PACKET.md), one [role template](../ROLE_CATALOG.md), scoped read/write/execute allowlists and draft handoff instructions. Profile recommendations are advisory. Human assignment and the operator's start decision are separate server records.

## Candidate and finding records

- Repository, base SHA, submitted/integrated candidate and artifact digest: {{source_identity}}
- CI/check identities and exact result references: {{check_evidence}}
- QA/UAT environment and candidate manifest: {{environment_manifest}}
- Findings with criterion links, reproduction, disposition and regression evidence: {{finding_references}}
- Human decisions with exact input/candidate revisions: {{decision_references}}
- Deployment and production verification references, if required: {{release_evidence}}

Never fill empty evidence fields with hypothetical success. Unknown or not run is a valid, visible result and blocks any mandatory gate it cannot satisfy.

## Human review

Review outcome, criteria, exclusions, dependencies, risk, human ownership and role packets together. Accepted plan records freeze the approved revisions; they do not assign profiles or grant future execution. New scope remains a separate proposal. The human UI records decisions; this template cannot self-approve.
