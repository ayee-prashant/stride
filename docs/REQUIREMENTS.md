# Requirement and acceptance matrix

The user’s reaffirmed Jira-lite list is the source of scope. Create with title
and project, see the next action, complete work, discuss it, and find it later.

| Requirement | Delivery | Completion acceptance |
|---|---|---|
| Login, workspace isolation, Admin/Member | Implemented | Real session; foreign workspace denied |
| Projects and member access | Implemented | Create project; add an approved existing user |
| Task fields and detail editor | Implemented | Title/project create; optional metadata edits persist |
| Responsible person | Implemented | Creator by default; reassignment and My Tasks agree |
| To do / In progress / Done | Implemented | Direct Start/Complete/Reopen and saved versions |
| Kanban and drag/drop | Implemented | Three columns with keyboard status alternatives |
| My Tasks and urgency | Implemented | Default view; overdue/today labels; completed excluded |
| Delete | Implemented | Trash removes from active work; restore preserves context |
| Comments | Implemented | Post and reload; preserve draft on errors |
| Mentions | Implemented | Select workspace teammate; durable mention and private alert |
| Activity | Implemented | Include comment events; no events for failed writes |
| Notifications | Implemented | Assignment, mention, overdue; unread count and read controls |
| Search and filters | Implemented | Assignee, status, priority, due date; safe search |
| Sorting and saved view | Implemented | Priority/due sort and one-click My open tasks |
| Always-visible Add task | Implemented | Available from every main workspace view |

## Collaboration acceptance

Only workspace members can see comments or mention targets. Mention IDs must
belong to that workspace. Recipients see only their own notifications, and
archived/inaccessible work is excluded from the inbox. Notifications and comments
roll back with a failed mutation; stale task writes emit no assignment alert.
Overdue reminders are deduplicated, use server time with the viewer offset, and
stop displaying when the task is complete, deleted, rescheduled, or reassigned.

The following exclusions describe the original first sprint. Epics,
roadmaps, sprint planning, story points, time tracking, custom workflows, reports,
automation rules, integrations, and AI task generation remain outside this release.
The approved productivity expansion below supersedes the original email exclusion.

Status: every listed feature is implemented. The full CI gate, including browser
acceptance, passed on d2e6c481a82d43e7da80e9fbd3e3220fd3c501a0. That source is
deployed on Railway, and all eight controlled private live checks passed.
Exact deployment evidence and remaining platform limitations are in RELEASE_REVIEW.md.

## Approved productivity expansion

| Improvement | Implemented behavior | Verification |
|---|---|---|
| Inline editing | Assignee, priority and due date without opening details | Browser priority editing; API version checks |
| Task links | Workspace/task URL survives sign-in and reload | Browser reload; safe-return validation |
| Team invitations and recovery | Expiring revocable invite links; Better Auth reset flow | Real hash/session/reset/reuse CI; email sender configuration required |
| Checklists | Add/check/remove items with progress | Browser, native and PostgreSQL |
| Blockers | Reason and waiting-for teammate within three statuses | Browser and membership validation |
| Bulk changes | Up to 50 versioned tasks, atomic rollback | Browser completion; PostgreSQL conflict rollback |
| Attachments | Private task/comment files with limits and forced download | Storage contracts; production S3 verification recorded in release review |
| Templates and repetition | Shared defaults/checklists; one next occurrence after completion | Real PostgreSQL concurrent completion and template use |
| Notification control | Preferences, task mute, scheduled reminders, opt-in digest | Deduplication, timezone, encrypted outbox and concurrent lease tests |
| Saved filters | Named personal views | Browser and ownership/version tests |
| Speed and workload | C/create, /search, member open/blocked/overdue summary | Browser and PostgreSQL |

Implementation and CI are complete; release 919d0d8 is deployed and all 12
controlled live checks passed. Provider activation status is recorded in
RELEASE_REVIEW.md; configured email
and real external delivery must not be inferred from a passing fake-provider test.
