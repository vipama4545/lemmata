-- Quizzes: a shelf to file them on, the quiz, its questions, their options, the uploaded
-- clips some of them play, and one row per person per quiz saying how it last went.
--
-- Purely additive. Nothing above 0005 is touched and no existing row changes, so this is safe
-- to apply to a live database with people reading it — there is no window during which the
-- dictionary is half-migrated, because the dictionary is not being migrated at all.
--
-- Left exactly as drizzle-kit wrote it, unlike 0003: every CREATE TABLE here stands before
-- the ALTER TABLE that gives it a foreign key, so the order it generated already works.

CREATE TABLE "quiz_audio" (
	"id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"name_native" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"quiz_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_choices" (
	"quiz_id" text NOT NULL,
	"question" smallint NOT NULL,
	"position" smallint NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"correct" boolean DEFAULT false NOT NULL,
	"say" text DEFAULT '' NOT NULL,
	"audio_id" text,
	CONSTRAINT "quiz_choices_quiz_id_question_position_pk" PRIMARY KEY("quiz_id","question","position")
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"quiz_id" text NOT NULL,
	"position" smallint NOT NULL,
	"kind" text DEFAULT 'choice' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"prompt_native" text DEFAULT '' NOT NULL,
	"say" text DEFAULT '' NOT NULL,
	"audio_id" text,
	"multiple" boolean DEFAULT false NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	CONSTRAINT "quiz_questions_quiz_id_position_pk" PRIMARY KEY("quiz_id","position")
);
--> statement-breakpoint
CREATE TABLE "quiz_results" (
	"user_id" text NOT NULL,
	"quiz_id" text NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"score" smallint DEFAULT 0 NOT NULL,
	"total" smallint DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_results_user_id_quiz_id_pk" PRIMARY KEY("user_id","quiz_id")
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'ka' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"title_native" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"category_id" text,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"shuffle_options" boolean DEFAULT true NOT NULL,
	"pass_mark" smallint DEFAULT 70 NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_categories" ADD CONSTRAINT "quiz_categories_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_choices" ADD CONSTRAINT "quiz_choices_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_choices" ADD CONSTRAINT "quiz_choices_audio_id_quiz_audio_id_fk" FOREIGN KEY ("audio_id") REFERENCES "public"."quiz_audio"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_audio_id_quiz_audio_id_fk" FOREIGN KEY ("audio_id") REFERENCES "public"."quiz_audio"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_results" ADD CONSTRAINT "quiz_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_results" ADD CONSTRAINT "quiz_results_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_category_id_quiz_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."quiz_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_categories_lang_idx" ON "quiz_categories" USING btree ("lang");--> statement-breakpoint
CREATE INDEX "quiz_results_user_lang_idx" ON "quiz_results" USING btree ("user_id","lang");--> statement-breakpoint
CREATE INDEX "quizzes_lang_idx" ON "quizzes" USING btree ("lang");--> statement-breakpoint
CREATE INDEX "quizzes_category_idx" ON "quizzes" USING btree ("category_id");