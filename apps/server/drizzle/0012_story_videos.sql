CREATE TABLE "story_videos" (
	"story_id" text PRIMARY KEY NOT NULL,
	"youtube_id" text NOT NULL,
	"cues" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_videos" ADD CONSTRAINT "story_videos_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;