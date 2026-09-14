CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"mentioned_user_ids" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "comment_body_length" CHECK (length("comments"."body") > 0 AND length("comments"."body") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"actor_id" text,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"created_at" text NOT NULL,
	"read_at" text,
	CONSTRAINT "uq_notification_event" UNIQUE("recipient_id","event_key"),
	CONSTRAINT "notification_kind" CHECK ("notifications"."kind" IN ('assignment','mention','overdue'))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_task_id_tasks_workspace_id_id_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_task_id_tasks_workspace_id_id_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_recipient_id_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","recipient_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_comments_task_created" ON "comments" USING btree ("workspace_id","task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_notifications_inbox" ON "notifications" USING btree ("workspace_id","recipient_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_notifications_unread" ON "notifications" USING btree ("workspace_id","recipient_id","read_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_creator_due" ON "tasks" USING btree ("workspace_id","created_by","archived_at","due_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_assignee_due" ON "tasks" USING btree ("workspace_id","assignee_id","archived_at","due_date");