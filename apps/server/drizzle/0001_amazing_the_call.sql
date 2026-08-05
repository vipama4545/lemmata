ALTER TABLE "content_version" ADD COLUMN "source" text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;