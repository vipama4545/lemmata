CREATE TABLE "tts_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"bytes" integer NOT NULL,
	"duration" real NOT NULL,
	"words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tts_cache_used_idx" ON "tts_cache" USING btree ("used_at");