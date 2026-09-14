CREATE TABLE "repository_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_id" text NOT NULL,
	"generation" integer NOT NULL,
	"policy_hash" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"payload" text NOT NULL,
	"observed_at" text NOT NULL,
	CONSTRAINT "uq_repository_observation_scope" UNIQUE("workspace_id","project_id","source_id","id"),
	CONSTRAINT "uq_repository_observation_manifest" UNIQUE("source_id","policy_hash","manifest_hash"),
	CONSTRAINT "repository_observation_values" CHECK ("repository_observations"."generation">0 AND length("repository_observations"."policy_hash")=64 AND length("repository_observations"."manifest_hash")=64 AND octet_length("repository_observations"."payload") BETWEEN 1 AND 524288)
);
--> statement-breakpoint
CREATE TABLE "repository_source_events" (
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"source_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	CONSTRAINT "repository_source_events_workspace_id_project_id_sequence_pk" PRIMARY KEY("workspace_id","project_id","sequence"),
	CONSTRAINT "repository_event_values" CHECK ("repository_source_events"."sequence">0 AND "repository_source_events"."kind" IN ('connected','observed','unavailable','disconnected'))
);
--> statement-breakpoint
CREATE TABLE "repository_source_heads" (
	"source_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"observation_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_source_receipts" (
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"source_id" text NOT NULL,
	"operation" text NOT NULL,
	"input_hash" text NOT NULL,
	"source_version" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "repository_source_receipts_workspace_id_project_id_request_id_pk" PRIMARY KEY("workspace_id","project_id","request_id"),
	CONSTRAINT "repository_receipt_values" CHECK ("repository_source_receipts"."operation" IN ('connect','refresh','disconnect') AND length("repository_source_receipts"."input_hash")=64 AND "repository_source_receipts"."source_version">0)
);
--> statement-breakpoint
CREATE TABLE "repository_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"binding_key" text NOT NULL,
	"policy_hash" text NOT NULL,
	"repository" text NOT NULL,
	"branch" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"last_verified_at" text,
	"next_refresh_at" text NOT NULL,
	"last_started_at" text,
	"lease_id" text,
	"lease_until" text,
	"connected_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_repository_source_project" UNIQUE("workspace_id","project_id"),
	CONSTRAINT "uq_repository_source_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "repository_source_values" CHECK ("repository_sources"."state" IN ('pending','syncing','current','unavailable','disconnected') AND "repository_sources"."version">0 AND "repository_sources"."generation">=0 AND length("repository_sources"."policy_hash")=64 AND (("repository_sources"."lease_id" IS NULL AND "repository_sources"."lease_until" IS NULL) OR ("repository_sources"."lease_id" IS NOT NULL AND "repository_sources"."lease_until" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "repository_observations" ADD CONSTRAINT "fk_repository_observation_source" FOREIGN KEY ("workspace_id","project_id","source_id") REFERENCES "public"."repository_sources"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_source_events" ADD CONSTRAINT "repository_source_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_source_events" ADD CONSTRAINT "fk_repository_event_source" FOREIGN KEY ("workspace_id","project_id","source_id") REFERENCES "public"."repository_sources"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_source_heads" ADD CONSTRAINT "fk_repository_head_observation" FOREIGN KEY ("workspace_id","project_id","source_id","observation_id") REFERENCES "public"."repository_observations"("workspace_id","project_id","source_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_source_receipts" ADD CONSTRAINT "repository_source_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_source_receipts" ADD CONSTRAINT "fk_repository_receipt_source" FOREIGN KEY ("workspace_id","project_id","source_id") REFERENCES "public"."repository_sources"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_sources" ADD CONSTRAINT "repository_sources_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_sources" ADD CONSTRAINT "fk_repository_source_project" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_repository_source_refresh" ON "repository_sources" USING btree ("state","next_refresh_at","lease_until");