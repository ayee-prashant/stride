# First-sprint requirement and acceptance matrix

The user’s reaffirmed Jira-lite list is the source of scope. Create with title
and project, see the next action, complete work, discuss it, and find it later.

| Requirement | Verified baseline | Completion acceptance |
|---|---|---|
| Login, workspace isolation, Admin/Member | Implemented | Real session; foreign workspace denied |
| Projects and member access | Implemented | Create project; add an approved existing user |
| Task fields and detail editor | Implemented | Title/project create; optional metadata edits persist |
| Responsible person | Incomplete defaults | Creator by default; reassignment and My Tasks agree |
| To do / In progress / Done | Implemented | Direct Start/Complete/Reopen and saved versions |
| Kanban and drag/drop | Implemented | Three columns with keyboard status alternatives |
| My Tasks and urgency | Implemented | Default view; overdue/today labels; completed excluded |
| Delete | Recoverable archive exists | Trash removes from active work; restore preserves context |
| Comments | Missing | Post and reload; preserve draft on errors |
| Mentions | Missing | Select workspace teammate; durable mention and private alert |
| Activity | Implemented for task changes | Include comment events; no events for failed writes |
| Notifications | Missing | Assignment, mention, overdue; unread count and read controls |
| Search and filters | Partial | Assignee, status, priority, due date; safe search |
| Sorting and saved view | Partial | Priority/due sort and one-click My open tasks |
| Always-visible Add task | Partial | Available from every main workspace view |

## Collaboration acceptance

Only workspace members can see comments or mention targets. Mention IDs must
belong to that workspace. Recipients see only their own notifications, and
archived/inaccessible work is excluded from the inbox. Notifications and comments
roll back with a failed mutation; stale task writes emit no assignment alert.
Overdue reminders are deduplicated, use server time with the viewer offset, and
stop displaying when the task is complete, deleted, rescheduled, or reassigned.

In-app notification delivery is included. External email/push delivery, epics,
roadmaps, sprint planning, story points, time tracking, custom workflows, reports,
automation rules, integrations, and AI task generation stay out of this sprint.

Status: completion work in progress; source checks are not deployment evidence.
