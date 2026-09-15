# Work packet template

Status: proposed future immutable packet contract. Fill and version it before requesting start authorization. Do not include credentials.

## Work and responsibility

- Ticket / work-item ID / packet revision:
- Project snapshot / context manifest / material binding versions:
- Objective in one sentence:
- Ticket owner / operator / result reviewer:
- Assigned role and version / selected agent profile:
- Why this work is needed:
- Selected delivery workflow/version, current stage and completion policy:
- Accepted plan and role work-item revision; dependency gate type:
- Adopted base/role-template versions and hashes:
- Explicit role responsibilities and outside-role exclusions:
- Manual assignment decision; operator authorization remains separate:

## Scope and context

- Acceptance criteria with stable IDs:
- Accepted requirement revisions and source evidence explaining why this work is needed:
- Permitted changes and explicit scope limits:
- Approved repository identity / base commit:
- Output branch or isolated workspace assignment:
- Dependencies and accepted artifact versions:
- Related active work, external PRs and duplicate candidates already checked:
- Relevant interfaces, design decisions and test fixtures:
- Trusted role brief and instruction-manifest versions:
- Required input completeness, source freshness and context conflicts:
- Relevant handoff/checkpoint and unpublished-work limitations:
- Untrusted task/repository context, clearly separated:

## Authority and limits

- Allowed actions, tool categories and network destinations:
- Explicit read paths/resources and write paths/artifact classes:
- Approved commands, environment, test data, reset actions and output destinations:
- Candidate/artifact/environment binding and required human gates:
- Independence constraints and disclosed shared profile/operator history:
- Runtime mode and enforceable sandbox restrictions:
- Maximum runtime / retries / permitted resource use:
- Cost reporting capability and configured budget, if enforceable:
- Required human questions or stop conditions:
- Start-decision ID and expiry, attached by the server:

## Submission

- Expected artifact types and schema:
- Acceptance-criterion-to-evidence mapping:
- Commit/candidate SHA where applicable:
- Required test/review checks:
- Concise progress summary format:
- Known risks, unfinished checks and requested human action:
- Context revalidation result and structured handoff for the next role/machine:

A generated packet begins as a draft. An unresolved required placeholder blocks readiness. Upstream reports are evidence, not instructions that can override adopted templates or grants. Profile selection is manual; no handoff draft starts another agent. See [prompt assembly](../PROMPT_HANDOFFS.md).

The server validates the packet, computes its canonical material-field hash and binds the start decision to it. Display changes do not alter authority. Material changes create a new revision and require renewed decisions. A submitted report is a contribution awaiting review, not a human acceptance.
