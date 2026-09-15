# FAQ feedback: adoption and collaboration

Reviewed against the current Stride source on 2026-09-15. Treat the supplied FAQ
as user feedback, not as an authority on deployed behavior, client capabilities
or the user's hardware. This increment keeps humans accountable and uses the
existing project context, role initialization and attended handoff contracts.

## Selected improvements

| Feedback | Decision and resulting behavior |
| --- | --- |
| Setup has too many manual steps | Add guarded local setup, doctor, start and stop commands. Generate private credentials, isolate checkout ports/volumes, preserve existing configuration and passwords. Validate with a real ephemeral Docker/PG18 CI job. |
| A newcomer needs to know where to start | Add optional **Getting started** navigation, an empty-view entry point, clear everyday-task and supervised-agent paths, and concise answers about hosted use, IDE enrollment and local development. Keep My Tasks as the landing page. |
| Teammates' changes should appear without refocusing | Revalidate task lists and newest comments while visible/online. Pause list replacement around edits, dialogs and selections. Cancel stale requests, back off failures and preserve unsent comments. |
| Multiple agents need isolated environments | Document reviewed worktrees, per-checkout development databases/ports and separate connections to one shared Stride server. Do not invent hardware capacity or copy connection credentials. |
| Local verification needs one entry point | Add `npm run verify` for tests, typecheck, lint and build, explicitly distinguishing the additional CI and deployed gates. |

## Keep existing mechanisms

Role initialization already records responsibilities, exclusions and file scope.
Assignments, operator starts, acceptance and release remain separate human actions.
Packets/checkpoints/reports provide shared handoffs; local chat is not authority.
The new guide explains these paths without duplicating or relaxing their gates.

## Follow-up product decisions

CSV migration, a planned-date calendar and richer task metrics remain separate
features. They add data contracts and ongoing UI cost without resolving the
onboarding friction addressed here. Prioritize them using observed pilot usage.

Verified email delivery needs a sender/domain decision and provider setup.
Production backup schedules/retention, external alert destinations and immutable
deployment artifact receipts require real provider configuration and separate
operational verification. Existing CI audit/restore coverage is not proof of those
production settings. This feedback increment does not claim to activate them.

Automatic worktree creation from a ticket needs a checked repository/base/scope
contract before execution. Automatic agent assignment or starts remain deferred.
Scheduled dependency PRs also introduce repository activity/notifications; the
current release retains the existing audit gate rather than silently enabling
another workflow.

## Verification record

- Native suite: 128 passing tests locally, including setup guards and refresh
  cancellation/concurrency/backoff. Full CI/build/browser status is recorded with
  the immutable GitHub candidate when it completes.
- Browser acceptance adds keyboard use of the guide, desktop/mobile layouts and
  real separate-client task/comment updates without a focus event, while an
  unsent comment remains intact.
- Second review checks environment precedence, credential separation, resource
  isolation, API authorization, cancellation and preservation of editing state.
  Production source-document byte limits remain a release gate.
