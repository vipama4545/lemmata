-- Stories gain chapters, and a shelf to be filed on.
--
-- Generated, then re-ordered by hand, because drizzle-kit writes its statements grouped by
-- kind rather than by what depends on what: left as it wrote them, the new primary key names
-- "chapter" one statement before the column is added, and fails. The INSERT is ours, and has
-- to stand between the CREATE and the DROP COLUMN in 0004 that follows it.
--
-- Nothing here loses a paragraph. A story that was one text becomes a story of one chapter:
-- its prose and its stats move across to `story_chapters` position 0, and every token it
-- already had takes `chapter` 0 by the column default. So the stories that exist read exactly
-- as they did, keep every hand-made pin, and need no relink.

CREATE TABLE "story_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"name_native" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"story_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_categories" ADD CONSTRAINT "story_categories_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_categories_lang_idx" ON "story_categories" USING btree ("lang");--> statement-breakpoint

CREATE TABLE "story_chapters" (
	"story_id" text NOT NULL,
	"position" smallint NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"title_english" text DEFAULT '' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paragraphs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"translation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "story_chapters_story_id_position_pk" PRIMARY KEY("story_id","position")
);
--> statement-breakpoint
ALTER TABLE "story_chapters" ADD CONSTRAINT "story_chapters_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Every story becomes a story of one chapter. The titles are left empty on purpose: an
-- unnamed chapter is what tells the reader there is a story here and no chapter furniture to
-- draw, and the story's own title has not moved.
INSERT INTO "story_chapters" ("story_id", "position", "title", "title_english", "stats", "paragraphs", "translation")
SELECT "id", 0, '', '', "stats", "paragraphs", "translation" FROM "stories";--> statement-breakpoint

-- The default is the whole of the token migration: every row that exists was written when a
-- story was one text, and that text is now chapter 0.
ALTER TABLE "story_tokens" ADD COLUMN "chapter" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "story_tokens" DROP CONSTRAINT "story_tokens_story_id_paragraph_position_pk";--> statement-breakpoint
ALTER TABLE "story_tokens" ADD CONSTRAINT "story_tokens_story_id_chapter_paragraph_position_pk" PRIMARY KEY("story_id","chapter","paragraph","position");--> statement-breakpoint

ALTER TABLE "stories" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_category_id_story_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."story_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stories_category_idx" ON "stories" USING btree ("category_id");
