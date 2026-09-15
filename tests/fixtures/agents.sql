CREATE TABLE agent_profiles (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), alias TEXT NOT NULL, alias_key TEXT NOT NULL,
 operator_id TEXT NOT NULL REFERENCES users(id), tool_label TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,alias_key),
 CHECK(length(alias) BETWEEN 1 AND 60 AND length(alias_key) BETWEEN 1 AND 60 AND length(tool_label)<=80)
);
CREATE INDEX idx_agent_operator ON agent_profiles(workspace_id,operator_id);
CREATE TABLE agent_role_bindings (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, profile_id TEXT NOT NULL, role_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1001), state TEXT NOT NULL CHECK(state IN ('pending','initialized','revoked')),
 read_paths TEXT NOT NULL, write_paths TEXT NOT NULL, template_hash TEXT NOT NULL CHECK(length(template_hash)=64), template_body TEXT NOT NULL,
 approved_by TEXT REFERENCES users(id), approved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id), FOREIGN KEY(workspace_id,profile_id) REFERENCES agent_profiles(workspace_id,id),
 UNIQUE(workspace_id,project_id,id), UNIQUE(workspace_id,project_id,profile_id,role_id),
 CHECK(role_id IN ('business_analysis','solution_architecture','development','peer_review','quality_assurance','user_acceptance_testing','release_operations','security_review','ux_accessibility','performance_data','documentation')),
 CHECK(length(CAST(template_body AS BLOB)) BETWEEN 1 AND 24576 AND length(CAST(read_paths AS BLOB))<=16384 AND length(CAST(write_paths AS BLOB))<=16384),
 CHECK((state='initialized' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR (state<>'initialized' AND approved_by IS NULL AND approved_at IS NULL))
);
CREATE INDEX idx_agent_project_page ON agent_role_bindings(workspace_id,project_id,created_at,id);
CREATE TABLE agent_role_events (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, binding_id TEXT NOT NULL, version INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('registered','configured','initialized','revoked')), actor_kind TEXT NOT NULL CHECK(actor_kind='human'),
 actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 request_id TEXT NOT NULL, input_hash TEXT NOT NULL CHECK(length(input_hash)=64), snapshot TEXT NOT NULL,
 FOREIGN KEY(workspace_id,project_id,binding_id) REFERENCES agent_role_bindings(workspace_id,project_id,id),
 UNIQUE(binding_id,version), UNIQUE(workspace_id,project_id,request_id),
 CHECK(version BETWEEN 1 AND 1001 AND length(CAST(snapshot AS BLOB)) BETWEEN 1 AND 65536)
);
