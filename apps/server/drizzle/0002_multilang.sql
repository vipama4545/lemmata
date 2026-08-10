-- Makes room for a second language.
--
-- Hand-written rather than generated, because almost every statement below is a RENAME and
-- drizzle-kit cannot tell a rename from a drop-and-create without being asked interactively.
-- Left to itself it would have written DROP COLUMN "georgian" / ADD COLUMN "headword", which
-- runs perfectly well and throws away the dictionary.
--
-- Nothing here loses a row. The Georgian content is not migrated so much as *relabelled*:
-- every existing row is Georgian, so `lang` takes a default of 'ka' and the ALTER fills it in
-- correctly without a single UPDATE. The two UPDATEs at the end are for study_cards, where
-- 'ka' meant a direction rather than a language and now has to say so.

CREATE TABLE "languages" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"native_name" text DEFAULT '' NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
-- Inserted here rather than by the seed, because every `lang` column below points at this
-- table and a foreign key cannot be added to rows whose parent does not exist yet.
INSERT INTO "languages" ("id", "position", "name", "native_name", "script", "enabled") VALUES
	('ka', 0, 'Georgian', 'ქართული', 'geor', true),
	('ru', 1, 'Russian', 'Русский', 'cyrl', true);
--> statement-breakpoint

-- The Georgian verb tables take a prefix, so that they and ru_verbs read as peers. See the
-- note above `kaVerbGroups` in schema.ts. Renaming the table does not rename its constraints
-- or indexes, so each is renamed by hand — otherwise the next generated migration would find
-- a constraint called `verbs_group_id_verb_groups_id_fk` on a table called `ka_verbs` and
-- try to reconcile the two.
ALTER TABLE "verbs" RENAME TO "ka_verbs";--> statement-breakpoint
ALTER TABLE "verb_forms" RENAME TO "ka_verb_forms";--> statement-breakpoint
ALTER TABLE "verb_groups" RENAME TO "ka_verb_groups";--> statement-breakpoint
ALTER TABLE "verb_morphemes" RENAME TO "ka_verb_morphemes";--> statement-breakpoint

ALTER TABLE "ka_verbs" RENAME CONSTRAINT "verbs_pkey" TO "ka_verbs_pkey";--> statement-breakpoint
ALTER TABLE "ka_verb_groups" RENAME CONSTRAINT "verb_groups_pkey" TO "ka_verb_groups_pkey";--> statement-breakpoint
ALTER TABLE "ka_verb_morphemes" RENAME CONSTRAINT "verb_morphemes_pkey" TO "ka_verb_morphemes_pkey";--> statement-breakpoint
ALTER TABLE "ka_verb_forms" RENAME CONSTRAINT "verb_forms_verb_id_screeve_person_pk" TO "ka_verb_forms_verb_id_screeve_person_pk";--> statement-breakpoint
ALTER TABLE "ka_verbs" RENAME CONSTRAINT "verbs_group_id_verb_groups_id_fk" TO "ka_verbs_group_id_ka_verb_groups_id_fk";--> statement-breakpoint
ALTER TABLE "ka_verb_forms" RENAME CONSTRAINT "verb_forms_verb_id_verbs_id_fk" TO "ka_verb_forms_verb_id_ka_verbs_id_fk";--> statement-breakpoint
ALTER TABLE "ka_verb_morphemes" RENAME CONSTRAINT "verb_morphemes_verb_id_verbs_id_fk" TO "ka_verb_morphemes_verb_id_ka_verbs_id_fk";--> statement-breakpoint
ALTER INDEX "verbs_group_idx" RENAME TO "ka_verbs_group_idx";--> statement-breakpoint
ALTER INDEX "verb_forms_form_idx" RENAME TO "ka_verb_forms_form_idx";--> statement-breakpoint

-- The columns that named a language in their own name. Their contents do not change.
ALTER TABLE "words" RENAME COLUMN "georgian" TO "headword";--> statement-breakpoint
ALTER TABLE "words" RENAME COLUMN "georgian_definition" TO "definition";--> statement-breakpoint
ALTER TABLE "categories" RENAME COLUMN "name_georgian" TO "name_native";--> statement-breakpoint

-- `lang` everywhere it belongs. The default is what makes this free: every row that exists
-- was written when there was only one language, and that language was Georgian.
ALTER TABLE "categories" ADD COLUMN "lang" text DEFAULT 'ka' NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "lang" text DEFAULT 'ka' NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "lang" text DEFAULT 'ka' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_cards" ADD COLUMN "lang" text DEFAULT 'ka' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "lang" text DEFAULT 'ka' NOT NULL;--> statement-breakpoint

-- Where a Russian headword keeps its stress mark. Unused by Georgian, and empty there.
ALTER TABLE "words" ADD COLUMN "accented" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "word_forms" ADD COLUMN "accented" text DEFAULT '' NOT NULL;--> statement-breakpoint

ALTER TABLE "categories" ADD CONSTRAINT "categories_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The headword index gains the language in front of it: every lookup that matters is "this
-- spelling, in this language", and делать and დელატ have no business being in one B-tree
-- neighbourhood.
DROP INDEX "words_georgian_idx";--> statement-breakpoint
CREATE INDEX "words_headword_idx" ON "words" USING btree ("lang","headword");--> statement-breakpoint
CREATE INDEX "words_lang_idx" ON "words" USING btree ("lang");--> statement-breakpoint
CREATE INDEX "categories_lang_idx" ON "categories" USING btree ("lang");--> statement-breakpoint
CREATE INDEX "stories_lang_idx" ON "stories" USING btree ("lang");--> statement-breakpoint
CREATE INDEX "study_cards_user_lang_due_idx" ON "study_cards" USING btree ("user_id","lang","due");--> statement-breakpoint

-- content_version goes from one row to one row per language, so that correcting a Russian
-- word does not invalidate every Georgian learner's cached snapshot. The existing row is the
-- Georgian one.
ALTER TABLE "content_version" ADD COLUMN "lang" text;--> statement-breakpoint
UPDATE "content_version" SET "lang" = 'ka';--> statement-breakpoint
ALTER TABLE "content_version" DROP CONSTRAINT "content_version_pkey";--> statement-breakpoint
ALTER TABLE "content_version" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "content_version" ALTER COLUMN "lang" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_pkey" PRIMARY KEY ("lang");--> statement-breakpoint
ALTER TABLE "content_version" ADD CONSTRAINT "content_version_lang_languages_id_fk" FOREIGN KEY ("lang") REFERENCES "public"."languages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- `side` said 'ka' when 'ka' could only mean "the side of the card that is not English".
-- With a second language that reading is no longer available, so the value says what it
-- always meant. `card` is `${item}|${side}` and is rebuilt from its two parts rather than
-- string-replaced, which is the same rule the client uses to mint it.
UPDATE "study_cards" SET "side" = 'target' WHERE "side" = 'ka';--> statement-breakpoint
UPDATE "study_cards" SET "card" = "item" || '|' || "side";--> statement-breakpoint

-- Russian. One row per lemma; the paradigm is a *rule* rather than stored cells, so there is
-- nothing here resembling ka_verb_forms' 44,000 rows. See the note above `ruVerbs`.
CREATE TABLE "ru_verbs" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"infinitive" text NOT NULL,
	"accented" text DEFAULT '' NOT NULL,
	"english" text DEFAULT '' NOT NULL,
	"senses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aspect" text NOT NULL,
	"pair_id" text,
	"class_id" text NOT NULL,
	"stem_present" text DEFAULT '' NOT NULL,
	"stem_present_1sg" text,
	"stem_imperative" text,
	"stem_past" text,
	"stem_past_m" text,
	"stress_present" text DEFAULT 'stem' NOT NULL,
	"stress_past" text DEFAULT 'stem' NOT NULL,
	"stem_stress" smallint,
	"stress_infinitive" smallint,
	"reflexive" boolean DEFAULT false NOT NULL,
	"transitivity" text DEFAULT '' NOT NULL,
	"government" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"motion" text DEFAULT '' NOT NULL,
	"level" text DEFAULT '' NOT NULL,
	"needs_check" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "ru_verb_forms" (
	"verb_id" text NOT NULL,
	"slot" text NOT NULL,
	"form" text NOT NULL,
	"accented" text DEFAULT '' NOT NULL,
	"note" text,
	CONSTRAINT "ru_verb_forms_verb_id_slot_pk" PRIMARY KEY("verb_id","slot")
);
--> statement-breakpoint
CREATE TABLE "ru_word_grammar" (
	"word_id" text PRIMARY KEY NOT NULL,
	"gender" text,
	"animacy" text,
	"declension" text,
	"stress_pattern" text,
	"needs_check" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ru_verb_forms" ADD CONSTRAINT "ru_verb_forms_verb_id_ru_verbs_id_fk" FOREIGN KEY ("verb_id") REFERENCES "public"."ru_verbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ru_word_grammar" ADD CONSTRAINT "ru_word_grammar_word_id_words_id_fk" FOREIGN KEY ("word_id") REFERENCES "public"."words"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ru_verbs_infinitive_idx" ON "ru_verbs" USING btree ("infinitive");--> statement-breakpoint
CREATE INDEX "ru_verbs_class_idx" ON "ru_verbs" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "ru_verbs_pair_idx" ON "ru_verbs" USING btree ("pair_id");--> statement-breakpoint
CREATE INDEX "ru_verb_forms_form_idx" ON "ru_verb_forms" USING btree ("form");--> statement-breakpoint
CREATE INDEX "ru_word_grammar_gender_idx" ON "ru_word_grammar" USING btree ("gender");
