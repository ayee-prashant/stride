CREATE TABLE "agent_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"alias" text NOT NULL,
	"alias_key" text NOT NULL,
	"operator_id" text NOT NULL,
	"tool_label" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_agent_profile_workspace" UNIQUE("workspace_id","id"),
	CONSTRAINT "uq_agent_alias_workspace" UNIQUE("workspace_id","alias_key"),
	CONSTRAINT "agent_profile_values" CHECK (length("agent_profiles"."alias") BETWEEN 1 AND 60 AND length("agent_profiles"."alias_key") BETWEEN 1 AND 60 AND length("agent_profiles"."tool_label")<=80)
);
--> statement-breakpoint
CREATE TABLE "agent_role_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"role_id" text NOT NULL,
	"version" integer NOT NULL,
	"state" text NOT NULL,
	"read_paths" text NOT NULL,
	"write_paths" text NOT NULL,
	"template_hash" text NOT NULL,
	"template_body" text NOT NULL,
	"approved_by" text,
	"approved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_agent_role_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "uq_agent_project_role" UNIQUE("workspace_id","project_id","profile_id","role_id"),
	CONSTRAINT "agent_role_values" CHECK ("agent_role_bindings"."version" BETWEEN 1 AND 1001 AND "agent_role_bindings"."state" IN ('pending','initialized','revoked') AND "agent_role_bindings"."role_id" IN ('business_analysis','solution_architecture','development','peer_review','quality_assurance','user_acceptance_testing','release_operations','security_review','ux_accessibility','performance_data','documentation') AND length("agent_role_bindings"."template_hash")=64 AND octet_length("agent_role_bindings"."template_body") BETWEEN 1 AND 24576 AND octet_length("agent_role_bindings"."read_paths")<=16384 AND octet_length("agent_role_bindings"."write_paths")<=16384),
	CONSTRAINT "agent_role_approval" CHECK (("agent_role_bindings"."state"='initialized' AND "agent_role_bindings"."approved_by" IS NOT NULL AND "agent_role_bindings"."approved_at" IS NOT NULL) OR ("agent_role_bindings"."state"<>'initialized' AND "agent_role_bindings"."approved_by" IS NULL AND "agent_role_bindings"."approved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "agent_role_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" text NOT NULL,
	"reason" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"snapshot" text NOT NULL,
	CONSTRAINT "uq_agent_role_event_version" UNIQUE("binding_id","version"),
	CONSTRAINT "uq_agent_role_request" UNIQUE("workspace_id","project_id","request_id"),
	CONSTRAINT "agent_event_values" CHECK ("agent_role_events"."version" BETWEEN 1 AND 1001 AND "agent_role_events"."action" IN ('registered','configured','initialized','revoked') AND "agent_role_events"."actor_kind"='human' AND length("agent_role_events"."input_hash")=64 AND length("agent_role_events"."reason") BETWEEN 1 AND 500 AND octet_length("agent_role_events"."snapshot") BETWEEN 1 AND 65536)
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_bindings" ADD CONSTRAINT "agent_role_bindings_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_bindings" ADD CONSTRAINT "agent_role_bindings_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_bindings" ADD CONSTRAINT "agent_role_bindings_workspace_id_profile_id_agent_profiles_workspace_id_id_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."agent_profiles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_events" ADD CONSTRAINT "agent_role_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_events" ADD CONSTRAINT "agent_role_events_workspace_id_project_id_binding_id_agent_role_bindings_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","binding_id") REFERENCES "public"."agent_role_bindings"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_operator" ON "agent_profiles" USING btree ("workspace_id","operator_id");--> statement-breakpoint
CREATE INDEX "idx_agent_project_page" ON "agent_role_bindings" USING btree ("workspace_id","project_id","created_at","id");