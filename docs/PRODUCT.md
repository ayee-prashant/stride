# Product contract: Stride 1.0

## Promise

Capture a task quickly, know what to work on, and finish it without opening a
complex form. A 10-second quick-create journey is a usability target, not an
unmeasured claim. Primary user: team contributor. Secondary user: team lead.

## Committed release scope

- Private email/password sign-in/sign-out with approved accounts; persistent private workspaces.
- Admin/member authorization; add existing signed-in users by exact email.
- Create, rename, archive, and restore projects.
- Title-only quick task creation inside a project. Optional description,
  one assignee, priority (low/medium/high), and date-only due date.
- To do / In progress / Done, with reopen and undo after completion.
- My Tasks grouped into Overdue, Today, Upcoming, and No due date.
- Project board, status actions, drag-and-drop with keyboard alternatives.
- Assignee/status/priority/due-date filtering, task title search, and priority/due-date sorting.
- A built-in My open tasks view, default on sign-in and available with one click.
- Persistent comments with explicit teammate mentions and task activity.
- A private in-app inbox for assignment, mention, and overdue notifications, with read controls.
- Task details, archive/restore, creator/editor metadata and activity records.
- Responsive, accessible states and recoverable network/conflict handling.

## Scope clarification

Only title and project are required. The server assigns quick-created tasks to
the creator by default. A task without an explicit assignee remains the creator’s
responsibility, including older tasks. Reassignment uses existing workspace members.
Deleting a task moves it to Trash using the existing recoverable archive model.
No hidden automatic due dates. Done tasks are not overdue. Date-only comparisons
use the viewer's local calendar date. Archiving a project hides, not deletes, its
tasks; restore the project to continue edits.

## Deferred

Outbound email/push delivery, attachments, checklists,
dependencies, labels, custom workflows, sprint planning, reports, time tracking,
automations, external integrations, and AI generation. Do not add these to v1.

## Release boundary

The initial deployment remains restricted to operator-approved accounts. Team membership features
are implemented, but other users must be explicitly approved in the server's
approved account allowlist and sign in once before an admin can add them. The
application never silently opens enrollment or sends invitations/email.

## Requirement correction

The user reaffirmed comments, mentions, notifications, and complete task filters
as first-sprint scope. Their earlier placement under Deferred was incorrect.
The requirement-by-requirement acceptance matrix is in REQUIREMENTS.md.
