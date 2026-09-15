CREATE TABLE "context_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"current_version" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_context_document_project" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "context_document_values" CHECK ("context_documents"."kind" IN ('requirement','decision','constraint') AND "context_documents"."current_version" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "context_events" (
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"document_id" text NOT NULL,
	"document_version" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "context_events_workspace_id_project_id_sequence_pk" PRIMARY KEY("workspace_id","project_id","sequence"),
	CONSTRAINT "context_event_sequence" CHECK ("context_events"."sequence">0)
);
--> statement-breakpoint
CREATE TABLE "context_revisions" (
	"document_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"state" text NOT NULL,
	"change_note" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	CONSTRAINT "context_revisions_document_id_version_pk" PRIMARY KEY("document_id","version"),
	CONSTRAINT "uq_context_revision_project" UNIQUE("workspace_id","project_id","document_id","version"),
	CONSTRAINT "uq_context_revision_request" UNIQUE("workspace_id","project_id","request_id"),
	CONSTRAINT "context_revision_values" CHECK ("context_revisions"."version" BETWEEN 1 AND 500 AND length("context_revisions"."title") BETWEEN 1 AND 200 AND length("context_revisions"."body") BETWEEN 1 AND 6000 AND length("context_revisions"."change_note") BETWEEN 1 AND 500 AND "context_revisions"."state" IN ('active','retired') AND length("context_revisions"."input_hash")=64)
);
--> statement-breakpoint
CREATE TABLE "project_context_heads" (
	"project_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "context_sequence_nonnegative" CHECK ("project_context_heads"."sequence">=0)
);
--> statement-breakpoint
CREATE TABLE "task_context_bindings" (
	"task_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"brief_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_context_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"context_sequence" integer NOT NULL,
	"task_version" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"payload" text NOT NULL,
	"task_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	CONSTRAINT "uq_task_context_brief_scope" UNIQUE("workspace_id","project_id","task_id","id"),
	CONSTRAINT "uq_task_context_brief_request" UNIQUE("workspace_id","task_id","request_id"),
	CONSTRAINT "task_context_brief_values" CHECK ("task_context_briefs"."context_sequence">=0 AND "task_context_briefs"."task_version">0 AND length("task_context_briefs"."fingerprint")=64 AND length("task_context_briefs"."task_hash")=64 AND length("task_context_briefs"."input_hash")=64 AND octet_length("task_context_briefs"."payload") BETWEEN 1 AND 131072)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "uq_tasks_context_project" UNIQUE("workspace_id","project_id","id");
--> statement-breakpoint
ALTER TABLE "context_documents" ADD CONSTRAINT "context_documents_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_events" ADD CONSTRAINT "context_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_events" ADD CONSTRAINT "context_events_workspace_id_project_id_document_id_document_version_context_revisions_workspace_id_project_id_document_id_version_fk" FOREIGN KEY ("workspace_id","project_id","document_id","document_version") REFERENCES "public"."context_revisions"("workspace_id","project_id","document_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_revisions" ADD CONSTRAINT "context_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_revisions" ADD CONSTRAINT "context_revisions_workspace_id_project_id_document_id_context_documents_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","document_id") REFERENCES "public"."context_documents"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_heads" ADD CONSTRAINT "project_context_heads_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_context_bindings" ADD CONSTRAINT "task_context_bindings_workspace_id_project_id_task_id_brief_id_task_context_briefs_workspace_id_project_id_task_id_id_fk" FOREIGN KEY ("workspace_id","project_id","task_id","brief_id") REFERENCES "public"."task_context_briefs"("workspace_id","project_id","task_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_context_briefs" ADD CONSTRAINT "task_context_briefs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_context_briefs" ADD CONSTRAINT "task_context_briefs_workspace_id_project_id_task_id_tasks_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","task_id") REFERENCES "public"."tasks"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_task_context_brief_history" ON "task_context_briefs" USING btree ("workspace_id","task_id","created_at","id");
