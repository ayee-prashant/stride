# Team productivity release

The user approved all recommended improvements on 2026-09-14. This explicitly
extends the previous first-sprint boundary; older deferred lists are historical.

## Ordered slices and acceptance

1. Task speed and clarity: inline assignee/priority/date edits; durable direct
   links through sign-in; versioned checklists and progress; blocked reason and
   waiting-for teammate; atomic bulk assign/reschedule/complete/Trash, up to 50.
2. Reuse and focus: workspace task templates with checklist items; daily/weekly/
   monthly repetition after completion, one successor per completed task;
   private named saved filters; create/search shortcuts; a compact member workload
   summary showing open, blocked, and overdue counts.
3. Team access: admin-created, email-bound, expiring and revocable invitation
   links; one-use acceptance; existing accounts must sign in and cannot have
   their password replaced by an invitation. Public registration stays closed.
   Better Auth owns password reset tokens and sessions.
4. Files and attention: private task/comment attachments, verified type/size,
   bounded quotas and authenticated downloads; notification preferences, task
   mute, due reminders, and opt-in daily email summaries. Invite links work by
   copy/share; outbound email requires a configured verified sending provider.
5. Release: domain/SQL/API and real-session/browser checks; generated additive
   PostgreSQL migration; dependency audit; isolated backup restoration and query
   performance measurements; post-build review; tested Railway release.

## Deliberate limits

Three statuses remain unchanged. Checklists contain at most 50 short items.
Waiting-for refers to one current teammate; a general dependency graph and
separately assigned nested subtasks are outside this release. Recurrence means
repeat after completion; it is clearly labelled and never rewrites task history.
Saved views are personal; templates are shared within the workspace. Bulk changes
are all-or-nothing and reject stale versions. Task content and files are private.
No epics, Gantt, time tracking, automation builder, or AI features are introduced.

## Configuration and evidence

Railway is connected. The existing web service has no email or object-storage
configuration. Resend is available to connect but is not connected. Implement and
test provider boundaries without invented credentials. Determine storage and
email provisioning access before declaring those live capabilities complete.
Do not treat a test double as evidence of production email/file delivery.
Record actual test, audit, restore, benchmark and deployment results in
RELEASE_REVIEW.md. Main-branch merge remains separately unauthorized.
