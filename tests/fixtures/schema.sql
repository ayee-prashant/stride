-- TEST FIXTURE ONLY. Mirrors db/schema.ts; never used for deployment.
-- Once Drizzle can run, tests prefer generated migrations and parity must be checked.
PRAGMA foreign_keys = ON;
CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id TEXT NOT NULL UNIQUE REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE memberships(workspace_id TEXT NOT NULL REFERENCES workspaces(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('admin','member')),PRIMARY KEY(workspace_id,user_id));
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',archived_at TEXT,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX uq_project_workspace ON projects(workspace_id,id);
CREATE INDEX idx_projects_workspace_archive ON projects(workspace_id,archived_at);
CREATE TABLE tasks(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,project_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),assignee_id TEXT,due_date TEXT,completed_at TEXT,archived_at TEXT,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),last_mutation_id TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),updated_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),FOREIGN KEY(workspace_id,assignee_id) REFERENCES memberships(workspace_id,user_id),CHECK((status='done' AND completed_at IS NOT NULL) OR (status!='done' AND completed_at IS NULL)));
CREATE UNIQUE INDEX uq_task_workspace ON tasks(workspace_id,id);
CREATE INDEX idx_tasks_workspace_project_archive ON tasks(workspace_id,project_id,archived_at);
CREATE INDEX idx_tasks_workspace_assignee_archive ON tasks(workspace_id,assignee_id,archived_at);
CREATE TABLE activity(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id));
CREATE INDEX idx_activity_task ON activity(workspace_id,task_id,created_at);
CREATE TABLE mutation_limits(user_id TEXT PRIMARY KEY,window_start INTEGER NOT NULL,hits INTEGER NOT NULL);
CREATE INDEX idx_tasks_creator_due ON tasks(workspace_id,created_by,archived_at,due_date);
CREATE INDEX idx_tasks_assignee_due ON tasks(workspace_id,assignee_id,archived_at,due_date);
CREATE TABLE comments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,author_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL CHECK(length(body)>0 AND length(body)<=4000),mentioned_user_ids TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id));
CREATE INDEX idx_comments_task_created ON comments(workspace_id,task_id,created_at,id);
CREATE TABLE notifications(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,recipient_id TEXT NOT NULL,actor_id TEXT REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('assignment','mention','overdue','reminder')),event_key TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),FOREIGN KEY(workspace_id,recipient_id) REFERENCES memberships(workspace_id,user_id),UNIQUE(recipient_id,event_key));
CREATE INDEX idx_notifications_inbox ON notifications(workspace_id,recipient_id,created_at,id);
CREATE INDEX idx_notifications_unread ON notifications(workspace_id,recipient_id,read_at);

-- Approved productivity release: isolated portable SQL contract.
ALTER TABLE tasks ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '' CHECK(length(blocked_reason)<=500);
ALTER TABLE tasks ADD COLUMN waiting_on_id TEXT;
ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','daily','weekly','monthly'));
ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT REFERENCES tasks(id);
CREATE UNIQUE INDEX uq_recurrence_parent ON tasks(recurrence_parent_id);
CREATE TABLE checklist_items(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),position INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id));
CREATE INDEX idx_checklist_task ON checklist_items(workspace_id,task_id,position);
CREATE TABLE saved_views(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL,filters TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id));
CREATE INDEX idx_saved_views_owner ON saved_views(workspace_id,user_id);
CREATE TABLE task_templates(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),created_by TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,task TEXT NOT NULL,checklist TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE INDEX idx_templates_workspace ON task_templates(workspace_id);
CREATE TABLE notification_preferences(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,assignments INTEGER NOT NULL DEFAULT 1,mentions INTEGER NOT NULL DEFAULT 1,due_reminders INTEGER NOT NULL DEFAULT 1,daily_digest INTEGER NOT NULL DEFAULT 0,timezone TEXT NOT NULL DEFAULT 'UTC',reminder_hour INTEGER NOT NULL DEFAULT 9,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(workspace_id,user_id),FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id));
CREATE TABLE task_notification_settings(workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,user_id TEXT NOT NULL,muted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace_id,task_id,user_id),FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),FOREIGN KEY(workspace_id,user_id) REFERENCES memberships(workspace_id,user_id));
CREATE TABLE invitations(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),token_hash TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,accepted_at TEXT,accepted_by TEXT,revoked_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX idx_invitations_workspace ON invitations(workspace_id,created_at);
CREATE TABLE account_admissions(user_id TEXT PRIMARY KEY,invitation_id TEXT NOT NULL REFERENCES invitations(id),email TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE attachments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,comment_id TEXT REFERENCES comments(id),object_key TEXT NOT NULL UNIQUE,filename TEXT NOT NULL,media_type TEXT NOT NULL,byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),uploaded_by TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('pending','ready','removed')),created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id));
CREATE INDEX idx_attachments_task ON attachments(workspace_id,task_id);
CREATE TABLE email_outbox(id TEXT PRIMARY KEY,dedupe_key TEXT NOT NULL UNIQUE,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,workspace_id TEXT,user_id TEXT,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available_at TEXT NOT NULL,expires_at TEXT NOT NULL,lease_id TEXT,sent_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX idx_email_delivery ON email_outbox(status,available_at);

CREATE TABLE worker_state(name TEXT PRIMARY KEY,lease_until TEXT NOT NULL,lease_id TEXT,cursor_workspace TEXT NOT NULL DEFAULT '',cursor_user TEXT NOT NULL DEFAULT '');
