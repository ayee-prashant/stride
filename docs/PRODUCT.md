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
- My Work grouped into Overdue, Today, Upcoming, and No due date.
- Project board, status actions, drag-and-drop with keyboard alternatives.
- Assignee/priority filtering, task title search, completed toggle.
- Task details, archive/restore, creator/editor metadata and activity records.
- Responsive, accessible states and recoverable network/conflict handling.

## Scope clarification

No mandatory assignee: unassigned work is visible on the board. In My Work,
quick-create defaults to the current user; on the team board it can be unassigned.
No hidden automatic due dates. Done tasks are not overdue. Date-only comparisons
use the viewer's local calendar date. Archiving a project hides, not deletes, its
tasks; restore the project to continue edits.

## Deferred

Comments, mentions, email/in-app notifications, attachments, checklists,
dependencies, labels, custom workflows, sprint planning, reports, time tracking,
automations, external integrations, and AI generation. Do not add these to v1.

## Release boundary

The initial deployment remains private to its owner. Team membership features
are implemented, but other users must be explicitly approved in the server's
approved account allowlist and sign in once before an admin can add them. The
application never silently opens enrollment or sends invitations/email.
