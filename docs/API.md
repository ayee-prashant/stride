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
The UI syncs on focus and every 30 seconds while visible. No email/push delivery.

Inboxes are recipient-private even from workspace admins. Assignment events are
created for a change of responsible person and skip the actor. Trashed tasks or
archived projects hide their notifications; resolved or rescheduled overdue
reminders no longer appear. Mark-read operations accept only an empty object.
Offset pages may shift during concurrent updates; refresh from the newest page.
