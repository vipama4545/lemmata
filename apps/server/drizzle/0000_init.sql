CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"name_georgian" text DEFAULT '' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_version" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" text NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "images" (
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"url" text NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"license" text DEFAULT '' NOT NULL,
	"license_url" text DEFAULT '' NOT NULL,
	CONSTRAINT "images_kind_subject_id_pk" PRIMARY KEY("kind","subject_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_english" text DEFAULT '' NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paragraphs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"translation" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_tokens" (
	"story_id" text NOT NULL,
	"paragraph" smallint NOT NULL,
	"position" smallint NOT NULL,
	"form" text NOT NULL,
	"word_id" text,
	"sense" smallint,
	"gram" text,
	"name" text,
	"via" text DEFAULT '' NOT NULL,
	"needs_check" boolean DEFAULT false NOT NULL,
	"alts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text,
	CONSTRAINT "story_tokens_story_id_paragraph_position_pk" PRIMARY KEY("story_id","paragraph","position")
);
--> statement-breakpoint
CREATE TABLE "study_cards" (
	"user_id" text NOT NULL,
	"card" text NOT NULL,
	"item" text NOT NULL,
	"side" text NOT NULL,
	"level" smallint NOT NULL,
	"interval" real DEFAULT 0 NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last" timestamp with time zone NOT NULL,
	"created" timestamp with time zone NOT NULL,
	"introduced" text DEFAULT 'review' NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_cards_user_id_card_pk" PRIMARY KEY("user_id","card")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verb_forms" (
	"verb_id" text NOT NULL,
	"screeve" text NOT NULL,
	"person" text NOT NULL,
	"form" text NOT NULL,
	CONSTRAINT "verb_forms_verb_id_screeve_person_pk" PRIMARY KEY("verb_id","screeve","person")
);
--> statement-breakpoint
CREATE TABLE "verb_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verb_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verb_morphemes" (
	"verb_id" text PRIMARY KEY NOT NULL,
	"root" text NOT NULL,
	"roots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pfsf" text,
	"preverbs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preverb_screeves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" text,
	"parsed" real DEFAULT 0 NOT NULL,
	"needs_check" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verbs" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"english" text DEFAULT '' NOT NULL,
	"senses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transitivity" text DEFAULT '' NOT NULL,
	"verbal_noun" text DEFAULT '' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"group_id" text,
	"present_3sg" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"synonyms_english" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synonyms_georgian" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_forms" (
	"word_id" text NOT NULL,
	"position" smallint NOT NULL,
	"form" text NOT NULL,
	"gram" text,
	"english" text,
	CONSTRAINT "word_forms_word_id_position_pk" PRIMARY KEY("word_id","position")
);
--> statement-breakpoint
CREATE TABLE "word_senses" (
	"word_id" text NOT NULL,
	"position" smallint NOT NULL,
	"english" text NOT NULL,
	CONSTRAINT "word_senses_word_id_position_pk" PRIMARY KEY("word_id","position")
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"georgian" text NOT NULL,
	"english" text DEFAULT '' NOT NULL,
	"georgian_definition" text DEFAULT '' NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"part_of_speech" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"category_id" text NOT NULL,
	"origin" text DEFAULT 'core' NOT NULL,
	"default_sense" smallint,
	"verb_id" text,
	"needs_check" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_tokens" ADD CONSTRAINT "story_tokens_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_tokens" ADD CONSTRAINT "story_tokens_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verb_forms" ADD CONSTRAINT "verb_forms_verb_id_verbs_id_fk" FOREIGN KEY ("verb_id") REFERENCES "public"."verbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verb_morphemes" ADD CONSTRAINT "verb_morphemes_verb_id_verbs_id_fk" FOREIGN KEY ("verb_id") REFERENCES "public"."verbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verbs" ADD CONSTRAINT "verbs_group_id_verb_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."verb_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_forms" ADD CONSTRAINT "word_forms_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_senses" ADD CONSTRAINT "word_senses_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "study_cards_user_updated_idx" ON "study_cards" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "study_cards_user_item_side_idx" ON "study_cards" USING btree ("user_id","item","side");--> statement-breakpoint
CREATE INDEX "verb_forms_form_idx" ON "verb_forms" USING btree ("form");--> statement-breakpoint
CREATE INDEX "verbs_group_idx" ON "verbs" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "word_forms_form_idx" ON "word_forms" USING btree ("form");--> statement-breakpoint
CREATE INDEX "words_category_idx" ON "words" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "words_georgian_idx" ON "words" USING btree ("georgian");--> statement-breakpoint
CREATE INDEX "words_verb_idx" ON "words" USING btree ("verb_id");