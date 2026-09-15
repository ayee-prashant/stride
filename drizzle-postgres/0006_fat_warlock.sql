CREATE TABLE "agent_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"binding_version" integer NOT NULL,
	"operator_id" text NOT NULL,
	"membership_epoch" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text,
	"companion_client_id" text,
	"state" text NOT NULL,
	"initialized_at" text,
	"lease_until" text,
	"prepared" text,
	"version" integer NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text,
	CONSTRAINT "agent_connections_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "agent_connections_companion_client_id_unique" UNIQUE("companion_client_id"),
	CONSTRAINT "uq_agent_connection_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "agent_connection_values" CHECK ("agent_connections"."version">0 AND "agent_connections"."binding_version">0 AND "agent_connections"."state" IN ('pending','active','revoked') AND length("agent_connections"."name") BETWEEN 1 AND 80 AND octet_length("agent_connections"."prepared")<=4096)
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"packet_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"grant_expires" text NOT NULL,
	"lease_until" text,
	"authorized_by" text NOT NULL,
	"authorized_at" text NOT NULL,
	"started_at" text,
	"ended_at" text,
	"checkpoint" text,
	CONSTRAINT "uq_delivery_attempt_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "delivery_attempt_values" CHECK ("delivery_attempts"."version">0 AND "delivery_attempts"."state" IN ('authorized','running','submitted','cancelled','lease_lost','expired') AND octet_length("delivery_attempts"."checkpoint")<=16384)
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"ticket_id" text,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"operator_id" text,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"payload" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_delivery_event_sequence" UNIQUE("workspace_id","project_id","sequence"),
	CONSTRAINT "uq_delivery_request" UNIQUE("workspace_id","project_id","request_id"),
	CONSTRAINT "delivery_event_values" CHECK ("delivery_events"."sequence">0 AND "delivery_events"."actor_kind" IN ('human','agent','system') AND length("delivery_events"."input_hash")=64 AND octet_length("delivery_events"."payload")<=131072 AND length("delivery_events"."reason")<=3000)
);
--> statement-breakpoint
CREATE TABLE "delivery_notices" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"event_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"ticket_id" text,
	"sequence" integer NOT NULL,
	"title" text NOT NULL,
	"created_at" text NOT NULL,
	"read_at" text,
	CONSTRAINT "uq_delivery_notice_recipient" UNIQUE("event_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "delivery_packets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"hash" text NOT NULL,
	"payload" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_delivery_packet_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "delivery_packet_values" CHECK (length("delivery_packets"."hash")=64 AND octet_length("delivery_packets"."payload")<=131072)
);
--> statement-breakpoint
CREATE TABLE "delivery_projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"reviewers" text NOT NULL,
	"baseline" text,
	"plan_revision" integer DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_delivery_project_scope" UNIQUE("workspace_id","project_id"),
	CONSTRAINT "delivery_project_values" CHECK ("delivery_projects"."version">0 AND "delivery_projects"."plan_revision">=0 AND octet_length("delivery_projects"."reviewers")<=4096 AND octet_length("delivery_projects"."baseline")<=16384)
);
--> statement-breakpoint
CREATE TABLE "delivery_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"phase" text NOT NULL,
	"role_id" text NOT NULL,
	"binding_id" text,
	"packet_id" text,
	"attempt_id" text,
	"plan_revision" integer DEFAULT 0 NOT NULL,
	"payload" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_delivery_ticket_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "uq_delivery_task" UNIQUE("workspace_id","task_id"),
	CONSTRAINT "delivery_ticket_values" CHECK ("delivery_tickets"."version" BETWEEN 1 AND 10000 AND "delivery_tickets"."kind" IN ('requirements','architecture','delivery') AND "delivery_tickets"."phase" IN ('created','assigned','start_approved','in_progress','in_review','uat_authorization','release_authorization','accepted','cancelled','replan_required') AND length("delivery_tickets"."title") BETWEEN 1 AND 200 AND octet_length("delivery_tickets"."payload")<=131072)
);
--> statement-breakpoint
CREATE TABLE "auth_jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "auth_oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[],
	"user_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_p_k_c_e" boolean,
	"dpop_bound_access_tokens" boolean,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "auth_oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "auth_oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean,
	"disabled" boolean,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"policy_version" integer,
	"metadata" jsonb,
	CONSTRAINT "auth_oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "epoch" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_workspace_id_profile_id_agent_profiles_workspace_id_id_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."agent_profiles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_workspace_id_project_id_binding_id_agent_role_bindings_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","binding_id") REFERENCES "public"."agent_role_bindings"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_workspace_id_project_id_ticket_id_delivery_tickets_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","ticket_id") REFERENCES "public"."delivery_tickets"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_workspace_id_project_id_packet_id_delivery_packets_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","packet_id") REFERENCES "public"."delivery_packets"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_workspace_id_project_id_connection_id_agent_connections_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","connection_id") REFERENCES "public"."agent_connections"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_workspace_id_profile_id_agent_profiles_workspace_id_id_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."agent_profiles"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_workspace_id_project_id_delivery_projects_workspace_id_project_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."delivery_projects"("workspace_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notices" ADD CONSTRAINT "delivery_notices_event_id_delivery_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."delivery_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notices" ADD CONSTRAINT "delivery_notices_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notices" ADD CONSTRAINT "delivery_notices_workspace_id_project_id_delivery_projects_workspace_id_project_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."delivery_projects"("workspace_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_packets" ADD CONSTRAINT "delivery_packets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_packets" ADD CONSTRAINT "delivery_packets_workspace_id_project_id_ticket_id_delivery_tickets_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","ticket_id") REFERENCES "public"."delivery_tickets"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_packets" ADD CONSTRAINT "delivery_packets_workspace_id_project_id_binding_id_agent_role_bindings_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","binding_id") REFERENCES "public"."agent_role_bindings"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_projects" ADD CONSTRAINT "delivery_projects_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tickets" ADD CONSTRAINT "delivery_tickets_workspace_id_project_id_delivery_projects_workspace_id_project_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."delivery_projects"("workspace_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tickets" ADD CONSTRAINT "delivery_tickets_workspace_id_task_id_tasks_workspace_id_id_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tickets" ADD CONSTRAINT "delivery_tickets_workspace_id_project_id_binding_id_agent_role_bindings_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","binding_id") REFERENCES "public"."agent_role_bindings"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_refresh_id_auth_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."auth_oauth_refresh_token"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_client" ADD CONSTRAINT "auth_oauth_client_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_client_resource" ADD CONSTRAINT "auth_oauth_client_resource_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_client_resource" ADD CONSTRAINT "auth_oauth_client_resource_resource_id_auth_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."auth_oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_consent" ADD CONSTRAINT "auth_oauth_consent_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_consent" ADD CONSTRAINT "auth_oauth_consent_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_client_id_auth_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."auth_oauth_client"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_connection_profile" ON "agent_connections" USING btree ("workspace_id","profile_id","state");--> statement-breakpoint
CREATE INDEX "idx_delivery_active_attempts" ON "delivery_attempts" USING btree ("workspace_id","profile_id","state","lease_until");--> statement-breakpoint
CREATE INDEX "idx_delivery_ticket_events" ON "delivery_events" USING btree ("workspace_id","ticket_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_delivery_notice_cursor" ON "delivery_notices" USING btree ("workspace_id","project_id","recipient_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_delivery_packet_ticket" ON "delivery_packets" USING btree ("workspace_id","ticket_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_tickets_page" ON "delivery_tickets" USING btree ("workspace_id","project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_delivery_binding" ON "delivery_tickets" USING btree ("workspace_id","binding_id","phase");--> statement-breakpoint
CREATE INDEX "idx_oauth_access_token_client_id" ON "auth_oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_access_token_session_id" ON "auth_oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_access_token_user_id" ON "auth_oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_access_token_authorization_code_id" ON "auth_oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_access_token_refresh_id" ON "auth_oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_client_user_id" ON "auth_oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_client_resource_client_id" ON "auth_oauth_client_resource" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_client_resource_resource_id" ON "auth_oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_consent_client_id" ON "auth_oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_consent_user_id" ON "auth_oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_refresh_token_client_id" ON "auth_oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_refresh_token_session_id" ON "auth_oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_refresh_token_user_id" ON "auth_oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_refresh_token_authorization_code_id" ON "auth_oauth_refresh_token" USING btree ("authorization_code_id");
--> statement-breakpoint
-- Membership identity survives no-op locks but rotates on a real authority change.
-- New memberships already receive a fresh epoch from the column default.
CREATE FUNCTION stride_rotate_membership_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN NEW.epoch := gen_random_uuid()::text; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stride_membership_epoch BEFORE UPDATE OF role ON memberships
FOR EACH ROW EXECUTE FUNCTION stride_rotate_membership_epoch();
--> statement-breakpoint
REVOKE ALL ON FUNCTION stride_rotate_membership_epoch() FROM PUBLIC;
