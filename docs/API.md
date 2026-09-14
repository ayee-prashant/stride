# HTTP API contract

All endpoints require the verified Better Auth database session. Missing identity is 401.
All endpoints except bootstrap require `?workspace_id=<id>` and server-checked
membership. Mutations require same-origin `Origin`, JSON content type, a body
no larger than 32 KiB, and a per-user limit of 120 mutations per minute.

| Method | Path | Purpose |
|---|---|---|
| POST | /api/bootstrap | Idempotently provision own workspace; body `{}` |
| GET | /api/workspace | Authorized projects, members, current role |
| POST | /api/projects | Admin creates project: name, optional description |
| PATCH | /api/projects/:id | Admin edits/archives/restores; version required |
| POST | /api/members | Admin adds/updates an existing user's role by exact email |
| GET | /api/tasks | Bounded filtered task page |
| POST | /api/tasks | Create with project_id and title; other fields optional |
| GET | /api/tasks/:id | Task details within authorized workspace |
| PATCH | /api/tasks/:id | Edit, status change, archive/restore; version required |
| GET | /api/tasks/:id/activity | Latest 50 audit entries |
| GET | /api/tasks/:id/comments | Bounded newest-first comment page |
| POST | /api/tasks/:id/comments | Add plain-text comment and selected member mentions |
| POST | /api/notifications/sync | Catch up overdue reminders and read own inbox |
| PATCH | /api/notifications/:id | Mark own notification read; body `{}` |
| POST | /api/notifications/read | Mark own workspace notifications read; body `{}` |

Task filters: project_id, assignee_id (including `unassigned`), priority, status,
query (literal title substring), due (all/overdue/today/upcoming/none), sort
(due_date/priority), tz_offset (integer minutes from UTC, -840–840), archived,
include_done, limit (1–100), offset
(0–100000). The page returns tasks, hasMore, and nextOffset. Paging is offset-based;
concurrent additions/changes can shift page boundaries. Refresh resets the view.

Task create fields: title (1–200), description (0–8000), project_id, status
(todo/in_progress/done), priority (low/medium/high), assignee_id (nullable),
due_date (nullable YYYY-MM-DD). A patch cannot move a task between projects.
New tasks default to the creator when no assignee is selected. Null assignees
on existing tasks retain the creator as responsible; filtering by a user includes
these tasks. Results include responsible_id and responsible_name.
All patches reject unknown fields and require a positive integer version.

Errors return `{ error: { code, message, requestId } }`. Status codes include
400 validation, 401 sign-in, 403 role/origin, 404 missing or inaccessible,
409 stale edit or reference conflict, 413 oversized body, 415 content type,
429 write quota, and 503 unavailable storage. Responses are private/no-store.

The client must not automatically retry a create when a response is lost.
Preserve its draft and ask the user to refresh/check whether the write succeeded.

Initial operational caps: 100 projects/workspace, 200 members/workspace, and 50
workspace memberships/user. These are application safeguards, not capacity claims.

## Collaboration

Comments accept `{body, mentioned_user_ids?}`: 1–4000 text characters and up to
10 unique current workspace member IDs. Author identity comes from the session.
Comment, audit event and mention notifications commit atomically. Self mentions
do not notify; another member is required to test recipient delivery. Comments
are append-only in this sprint and remain readable after moving a task to Trash.
Archived tasks/projects reject new comments. Comment GET accepts limit (1–50,
default 30) and offset (0–100000); returns comments, hasMore and nextOffset.

Inbox sync accepts JSON `{limit?, offset?, tz_offset?}` (default 20, maximum 50).
It returns notifications, unreadCount, hasMore and nextOffset. Each item includes
id, task_id, task_title, project_name, kind, actor_name, created_at and read_at.
The server derives today from its clock and the bounded viewer offset. Sync
creates at most 100 missing overdue reminders per call, deduplicated per task,
due date and recipient. It is idempotent and requires the mutation origin guard.
The UI syncs on focus and every 30 seconds while visible. Optional scheduled email delivery is described below.

Inboxes are recipient-private even from workspace admins. Assignment events are
created for a change of responsible person and skip the actor. Trashed tasks or
archived projects hide their notifications; resolved or rescheduled overdue
reminders no longer appear. Mark-read operations accept only an empty object.
Offset pages may shift during concurrent updates; refresh from the newest page.

## Productivity API

All private routes require a real session and workspace_id; mutations require
same-origin JSON. Missing/foreign resources do not disclose tenant data.

| Methods | Route | Contract |
|---|---|---|
| GET | /api/capabilities | Availability of configured email and private storage |
| POST | /api/tasks/bulk | tasks: 1–50 unique id/version pairs; changes: assignee_id, priority, due_date, status or archived=true; returns tasks atomically |
| GET, POST | /api/tasks/:id/checklist | List; create with title; create returns item and removed=false |
| PATCH | /api/tasks/:id/checklist/:item | version and title/completed/remove; returns item and removed |
| GET, PATCH | /api/tasks/:id/mute | Personal muted boolean |
| GET, POST | /api/views | Personal list; create name and filters |
| PATCH, DELETE | /api/views/:id | Versioned owner-only update/removal |
| GET, POST | /api/templates | Shared list; create name, task defaults and checklist text array |
| PATCH, DELETE | /api/templates/:id | Versioned creator/admin operation |
| POST | /api/templates/:id/use | project_id and optional title; creates task/checklist, HTTP 201 |
| GET, PATCH | /api/preferences | assignments, mentions, due_reminders, daily_digest, timezone, reminder_hour, version |
| GET | /api/workload | Up to 200 current members: open, blocked and overdue counts |
| GET, POST | /api/invitations | Admin list/create with email and role; returns invitation and one-time path |
| DELETE | /api/invitations/:id | Admin revocation; empty JSON |
| POST | /api/invitations/preview | Public capability check with token; valid invite only |
| POST | /api/invitations/accept | token, optional new name/password; existing account requires matching session |
| GET | /api/tasks/:id/files | Up to 20 authorized attachment metadata records |
| POST | /api/files | Raw application/octet-stream, task_id, optional comment_id, percent-encoded X-File-Name; HTTP 201 |
| GET | /api/files | id; authenticated forced download with private no-store |
| DELETE | /api/files/:id | Uploader/current admin only; empty JSON; durable cleanup on provider failure |

Task create accepts optional recurrence (none/daily/weekly/monthly). Task PATCH
adds blocked_reason, waiting_on_id and recurrence. Waiting-for requires a reason
and a current workspace teammate. Completion creates one successor and copies
unchecked checklist items; reopening/recompleting cannot create a second copy.
Task responses expose recurrence_parent_id and checklist progress counts.

Invitations last seven days and are single-use; the returned /join#token fragment
is never stored in access logs. Limits: 50 active invites/workspace, 20 saved
views/person/workspace, 50 templates/workspace and 50 checklist items/task.
Files are restricted to PNG/JPEG/WebP/PDF/TXT/CSV, 5 MB each, 20/task and 200 MB
per workspace. Bytes pending deletion still count toward the quota.

Better Auth handles /api/auth/request-password-reset and /api/auth/reset-password.
The application queues encrypted reset bodies with a 30-minute expiry and a
worker sends through Resend only when both credentials and sender are configured.
Missing email configuration produces a uniform unavailable response. The worker
also creates deduplicated in-app due reminders and optional daily count digests;
digests are disabled by default and muted tasks are excluded.
