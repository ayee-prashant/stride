CREATE TABLE "delivery_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"policy_hash" text NOT NULL,
	"input" text NOT NULL,
	"state" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"lease_id" text,
	"lease_until" text,
	"requested_at" text NOT NULL,
	"next_refresh" text NOT NULL,
	"observed_at" text,
	"payload" text,
	"reason" text,
	CONSTRAINT "delivery_evidence_values" CHECK ("delivery_evidence"."state" IN ('pending','syncing','current','unavailable') AND "delivery_evidence"."generation">0 AND length("delivery_evidence"."policy_hash")=64 AND octet_length("delivery_evidence"."input")<=4096 AND octet_length("delivery_evidence"."payload")<=65536)
);
--> statement-breakpoint
ALTER TABLE "delivery_evidence" ADD CONSTRAINT "delivery_evidence_workspace_id_project_id_delivery_projects_workspace_id_project_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."delivery_projects"("workspace_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_delivery_evidence_due" ON "delivery_evidence" USING btree ("state","next_refresh","lease_until");