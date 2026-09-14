# HTTP API contract

All endpoints require the trusted platform identity. Missing identity is 401.
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

Task filters: project_id, assignee_id (including `unassigned`), priority, status,
query (literal title substring), archived, include_done, limit (1–100), offset
(0–100000). The page returns tasks, hasMore, and nextOffset. Paging is offset-based;
concurrent additions/changes can shift page boundaries. Refresh resets the view.

Task create fields: title (1–200), description (0–8000), project_id, status
(todo/in_progress/done), priority (low/medium/high), assignee_id (nullable),
due_date (nullable YYYY-MM-DD). A patch cannot move a task between projects.
All patches reject unknown fields and require a positive integer version.

Errors return `{ error: { code, message, requestId } }`. Status codes include
400 validation, 401 sign-in, 403 role/origin, 404 missing or inaccessible,
409 stale edit or reference conflict, 413 oversized body, 415 content type,
429 write quota, and 503 unavailable storage. Responses are private/no-store.

The client must not automatically retry a create when a response is lost.
Preserve its draft and ask the user to refresh/check whether the write succeeded.

Initial operational caps: 100 projects/workspace, 200 members/workspace, and 50
workspace memberships/user. These are application safeguards, not capacity claims.
