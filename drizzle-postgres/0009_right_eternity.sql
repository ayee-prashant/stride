CREATE TABLE "task_imports" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"project_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"task_ids" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "task_imports_workspace_id_user_id_request_id_pk" PRIMARY KEY("workspace_id","user_id","request_id"),
	CONSTRAINT "uq_task_import_content" UNIQUE("workspace_id","user_id","input_hash"),
	CONSTRAINT "task_import_bounds" CHECK ("task_imports"."row_count" BETWEEN 1 AND 100 AND length("task_imports"."input_hash")=64 AND length("task_imports"."task_ids")<=4000)
);
--> statement-breakpoint
ALTER TABLE "task_imports" ADD CONSTRAINT "task_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_imports" ADD CONSTRAINT "task_imports_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_task_import_actor_time" ON "task_imports" USING btree ("workspace_id","user_id","created_at");