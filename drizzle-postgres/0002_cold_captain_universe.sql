CREATE TABLE "account_admissions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"invitation_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"comment_id" text,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "attachments_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "attachment_values" CHECK ("attachments"."byte_size" BETWEEN 1 AND 5242880 AND "attachments"."status" IN ('pending','ready','removed'))
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"title" text NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "checklist_values" CHECK (length("checklist_items"."title") BETWEEN 1 AND 200 AND "checklist_items"."completed" IN (0,1) AND "checklist_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"workspace_id" text,
	"user_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"lease_id" text,
	"sent_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_email_dedupe" UNIQUE("dedupe_key"),
	CONSTRAINT "email_values" CHECK ("email_outbox"."kind" IN ('reset','digest') AND "email_outbox"."status" IN ('pending','sending','sent','failed') AND "email_outbox"."attempts" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" text NOT NULL,
	"accepted_at" text,
	"accepted_by" text,
	"revoked_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitation_role" CHECK ("invitations"."role" IN ('admin','member'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"assignments" integer DEFAULT 1 NOT NULL,
	"mentions" integer DEFAULT 1 NOT NULL,
	"due_reminders" integer DEFAULT 1 NOT NULL,
	"daily_digest" integer DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"reminder_hour" integer DEFAULT 9 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_preferences_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "preference_values" CHECK ("notification_preferences"."assignments" IN (0,1) AND "notification_preferences"."mentions" IN (0,1) AND "notification_preferences"."due_reminders" IN (0,1) AND "notification_preferences"."daily_digest" IN (0,1) AND "notification_preferences"."reminder_hour" BETWEEN 0 AND 23 AND "notification_preferences"."version">0)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "saved_view_version" CHECK ("saved_views"."version">0)
);
--> statement-breakpoint
CREATE TABLE "task_notification_settings" (
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"muted" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "task_notification_settings_workspace_id_task_id_user_id_pk" PRIMARY KEY("workspace_id","task_id","user_id"),
	CONSTRAINT "task_mute_value" CHECK ("task_notification_settings"."muted" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"task" text NOT NULL,
	"checklist" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "template_version" CHECK ("task_templates"."version">0)
);
--> statement-breakpoint
CREATE TABLE "worker_state" (
	"name" text PRIMARY KEY NOT NULL,
	"lease_until" text NOT NULL,
	"lease_id" text,
	"cursor_workspace" text DEFAULT '' NOT NULL,
	"cursor_user" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "waiting_on_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_parent_id" text;--> statement-breakpoint
ALTER TABLE "account_admissions" ADD CONSTRAINT "account_admissions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_admissions" ADD CONSTRAINT "account_admissions_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_task_id_tasks_workspace_id_id_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_workspace_id_task_id_tasks_workspace_id_id_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_auth_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_user_id_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspace_id_user_id_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notification_settings" ADD CONSTRAINT "task_notification_settings_workspace_id_task_id_tasks_workspace_id_id_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_notification_settings" ADD CONSTRAINT "task_notification_settings_workspace_id_user_id_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_attachments_task" ON "attachments" USING btree ("workspace_id","task_id");--> statement-breakpoint
CREATE INDEX "idx_attachments_cleanup" ON "attachments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_checklist_task" ON "checklist_items" USING btree ("workspace_id","task_id","position");--> statement-breakpoint
CREATE INDEX "idx_email_delivery" ON "email_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "idx_invitations_workspace" ON "invitations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_saved_views_owner" ON "saved_views" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_templates_workspace" ON "task_templates" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_waiting_on_id_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","waiting_on_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "task_recurrence_parent_fk" FOREIGN KEY ("workspace_id","recurrence_parent_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_parent_id_unique" UNIQUE("recurrence_parent_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notification_kind" CHECK ("notifications"."kind" IN ('assignment','mention','overdue','reminder'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "task_recurrence" CHECK ("tasks"."recurrence" IN ('none','daily','weekly','monthly'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "task_blocker" CHECK (length("tasks"."blocked_reason") <= 500 AND ("tasks"."waiting_on_id" IS NULL OR length("tasks"."blocked_reason") > 0));