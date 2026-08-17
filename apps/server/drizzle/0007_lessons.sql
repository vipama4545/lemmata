-- Lessons: the shelf, the lesson itself with its markup in one column, and the pictures and
-- recordings uploaded for them.
--
-- Purely additive, exactly as 0006 was. Nothing above it is touched and no existing row
-- changes, so this is safe to apply to a live database with people reading it — there is no
-- window during which the dictionary is half-migrated, because the dictionary is not being
-- migrated at all.
--
-- What *is* replaced by these tables is not in the database and never was: the ten grammar
-- topics were a TypeScript module in the web app. scripts/lessonsToDb.ts loads them, converted
-- to markup, into `lessons` — see `npm run db:lessons`. Running this migration leaves both
-- sections empty, which is the right state for a database nobody has imported them into yet.
--
-- Left exactly as drizzle-kit wrote it below this line, as 0006 is.

CREATE TABLE "lesson_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"section" text DEFAULT 'lessons' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"name_native" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"lesson_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_media" (
	"id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"section" text DEFAULT 'lessons' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"title_native" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"category_id" text,
	"body" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_categories" ADD CONSTRAINT "lesson_categories_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_category_id_lesson_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lesson_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_categories_lang_idx" ON "lesson_categories" USING btree ("lang","section");--> statement-breakpoint
CREATE INDEX "lesson_media_kind_idx" ON "lesson_media" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "lessons_lang_idx" ON "lessons" USING btree ("lang","section");--> statement-breakpoint
CREATE INDEX "lessons_category_idx" ON "lessons" USING btree ("category_id");