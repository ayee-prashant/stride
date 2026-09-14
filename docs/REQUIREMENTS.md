# First-sprint requirement and acceptance matrix

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

In-app notification delivery is included. External email/push delivery, epics,
roadmaps, sprint planning, story points, time tracking, custom workflows, reports,
automation rules, integrations, and AI task generation stay out of this sprint.

Status: every listed feature is implemented. The full CI gate, including browser
acceptance, passed on d2e6c481a82d43e7da80e9fbd3e3220fd3c501a0. That source is
deployed on Railway, and all eight controlled private live checks passed.
Exact deployment evidence and remaining platform limitations are in RELEASE_REVIEW.md.
