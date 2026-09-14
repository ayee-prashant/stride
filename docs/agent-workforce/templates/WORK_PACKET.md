# Work packet template

Status: proposed future immutable packet contract. Fill and version it before requesting start authorization. Do not include credentials.

## Work and responsibility

- Ticket / work-item ID / packet revision:
- Objective in one sentence:
- Ticket owner / operator / result reviewer:
- Assigned role and version / selected agent profile:
- Why this work is needed:

## Scope and context

- Acceptance criteria with stable IDs:
- Permitted changes and explicit scope limits:
- Approved repository identity / base commit:
- Output branch or isolated workspace assignment:
- Dependencies and accepted artifact versions:
- Relevant interfaces, design decisions and test fixtures:
- Trusted role brief and instruction-manifest versions:
- Untrusted task/repository context, clearly separated:

## Authority and limits

- Allowed actions, tool categories and network destinations:
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

The server validates the packet, computes its canonical material-field hash and binds the start decision to it. Display changes do not alter authority. Material changes create a new revision and require renewed decisions. A submitted report is a contribution awaiting review, not a human acceptance.
