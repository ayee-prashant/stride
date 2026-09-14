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
CREATE TABLE notifications(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,task_id TEXT NOT NULL,recipient_id TEXT NOT NULL,actor_id TEXT REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('assignment','mention','overdue')),event_key TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT,FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id),FOREIGN KEY(workspace_id,recipient_id) REFERENCES memberships(workspace_id,user_id),UNIQUE(recipient_id,event_key));
CREATE INDEX idx_notifications_inbox ON notifications(workspace_id,recipient_id,created_at,id);
CREATE INDEX idx_notifications_unread ON notifications(workspace_id,recipient_id,read_at);
