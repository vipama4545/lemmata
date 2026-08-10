// The database, in Drizzle.
//
// Four things live here and they are worth telling apart, because they have different
// owners and completely different write patterns:
//
//   content — the lexicon, the paradigms, the stories. Seeded from data/<lang>/*.json and,
//     since the admin screens, *also written by the app*. The database is the source of
//     truth for content rather than a copy of the generated files: `npm run db:export`
//     writes it back out to data/, and `npm run db:seed` refuses to overwrite edited
//     content without --force. See `contentVersion.source`.
//
//   morphology — one set of tables per language, because this is the one place the two do
//     not have the same shape. See the block comment above `kaVerbs`.
//
//   auth — Better Auth's four tables. Their column names are fixed by the library rather
//     than chosen here; see the note above them before renaming anything.
//
//   study — one row per side of one item per user. This is the only table that holds
//     something a user would miss.
//
// The content tables are normalised where the shape is a real relation (a word's senses, a
// verb's 66 forms) and left as jsonb where it is a closed record the app only ever reads
// whole (a story's stats). The rule of thumb: if a row would ever be worth a WHERE clause,
// it is a row.
//
/* --------------------------------------------------------------------------
 * On `lang`
 *
 * Every content table carries it, and it defaults to 'ka'. That default is not a guess about
 * future rows — it is what made the migration free: every row that existed before there was
 * such a thing as a language is Georgian, and `ALTER TABLE ... ADD COLUMN` filled them all in
 * correctly without touching a byte of data.
 *
 * Ids stay single-column and globally unique rather than becoming (lang, id) pairs. Georgian
 * keeps the ids it has — `6938`, `food-drink` — because those are cited by `study_cards.item`
 * on every user's records, by scripts/storyOverrides.json and by scripts/lexicon.json, and
 * renaming them would reach into all three. Russian mints its own in a `ru-` namespace. So
 * `lang` is what you filter on, and the id is what you join on, and neither has to do the
 * other's job.
 *
 * The real separation is not enforced here at all — it is enforced one level up, in
 * router/content.ts, which assembles one snapshot per language. A Russian page is handed an
 * object with no Georgian rows in it, so there is no query it could write to reach them.
 * That is a stronger guarantee than a WHERE clause somebody has to remember.
 * -------------------------------------------------------------------------- */

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Lang } from './grammar/index.ts';
import type { RuSlotKey } from './types.ts';

/* ==================================================================== content */

/**
 * The languages this dictionary covers, and the switcher's source.
 *
 * A row here is only half of what it takes: `Lang` in grammar/index.ts is a compile-time
 * union of the languages there is code to *render*, and the seed refuses a row whose id is
 * not one of them. A language cannot be switched on by inserting a row, because a row cannot
 * supply a verb page.
 */
export const languages = pgTable('languages', {
  /** 'ka' | 'ru' — a `Lang`. */
  id: text('id').primaryKey().$type<Lang>(),
  position: integer('position').notNull().default(0),
  name: text('name').notNull(),
  /** What the language calls itself. */
  nativeName: text('native_name').notNull().default(''),
  /** 'geor' | 'cyrl'. Picks the font stack, and nothing else. */
  script: text('script').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
});

/**
 * One row per language. The seed bumps `version` every time it writes, and the client sends
 * the version it already has: an unchanged version means the multi-megabyte snapshot is not
 * sent again.
 *
 * Per language rather than one row for the lot, and this matters more than it looks. The
 * snapshot is the whole dictionary in one response; if the version were global, adding
 * Russian would mean every Georgian learner re-downloads everything whenever a Russian word
 * is corrected, and downloads the Russian dictionary they will never open. Keyed this way,
 * the two are entirely independent.
 */
export const contentVersion = pgTable('content_version', {
  lang: text('lang')
    .primaryKey()
    .$type<Lang>()
    .references(() => languages.id, { onDelete: 'cascade' }),
  /** Opaque to the client — it only ever compares it for equality. */
  version: text('version').notNull(),
  builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * Where the content standing in these tables came from: 'seed' for a straight load of
   * data/<lang>/*.json, 'admin' the moment anything is edited through the admin screens.
   *
   * It exists so the seed can tell "reload the files over a copy of themselves", which is
   * free, from "reload the files over work somebody did in the browser", which is data
   * loss. `npm run db:seed` stops at the second unless told --force, and `npm run db:export`
   * is the way out: it writes these tables back to data/ so the two agree again.
   */
  source: text('source').notNull().default('seed'),
  /**
   * The provenance lines the generated files carry at their head: which script writes the
   * lexicon, which spreadsheet the paradigms came out of, where corrections go. They belong
   * to no single row, and losing them would leave the tables with no record of where any of
   * this came from.
   */
  meta: jsonb('meta').$type<Record<string, string>>().notNull().default({}),
});

/**
 * `position` on this and the tables below preserves the order the generated file had.
 *
 * That order is not alphabetical and is not incidental — categories come out largest-first,
 * and the word list is in the order the scrape produced. A table has no inherent order, so
 * without this column the grid would re-arrange itself the first time Postgres felt like
 * returning rows in a different sequence.
 */
export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    /** The category's name in the language being learned. */
    nameNative: text('name_native').notNull().default(''),
    wordCount: integer('word_count').notNull().default(0),
  },
  table => [index('categories_lang_idx').on(table.lang)],
);

export const words = pgTable(
  'words',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    /** Its place in the generated list. See the note on `categories`. */
    position: integer('position').notNull().default(0),
    /**
     * The headword, in the language being learned.
     *
     * Unaccented for Russian, deliberately. This is the column the story resolver's form
     * index is built on and the one the search box matches against, and де́лать matches
     * neither what a reader types nor what stands in a text. The accent goes in `accented`,
     * which nothing ever searches.
     */
    headword: text('headword').notNull(),
    /** The headword with its stress written in, for Russian. Display only. */
    accented: text('accented').notNull().default(''),
    english: text('english').notNull().default(''),
    /** The definition in the language being learned, where the source had one. */
    definition: text('definition').notNull().default(''),
    /** 'A1' | 'A2' | 'B1' | '' — empty for vocabulary added by hand, which was never graded. */
    level: text('level').notNull().default(''),
    partOfSpeech: text('part_of_speech').notNull().default(''),
    category: text('category').notNull().default(''),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /**
     * 'core' for the scraped A1–A2 dictionary, 'wiktionary' for the imported common words,
     * 'added' for lemmas written by hand. Text rather than an enum so a new source needs no
     * migration.
     */
    origin: text('origin').notNull().default('core'),
    /** 1-based; null where it is 1. The sense to lead with when nothing pins one. */
    defaultSense: smallint('default_sense'),
    /**
     * The paradigm this headword claims.
     *
     * A `ka_verbs` id on a Georgian row and a `ru_verbs` id on a Russian one, which is why
     * it has an index but no foreign key: which table it points into follows from `lang`,
     * and one column cannot reference two. It was already keyless before Russian existed,
     * so nothing was given up to get this.
     */
    verbId: text('verb_id'),
    /** Set when the meaning itself is a guess and wants verifying. */
    needsCheck: boolean('needs_check').notNull().default(false),
    note: text('note'),
  },
  table => [
    index('words_category_idx').on(table.categoryId),
    // Lang first: every lookup that matters is "this spelling, in this language".
    index('words_headword_idx').on(table.lang, table.headword),
    index('words_verb_idx').on(table.verbId),
    index('words_lang_idx').on(table.lang),
  ],
);

/**
 * A word's meanings, in the order they are listed. `position` is 1-based and is what a
 * story token cites, so the pair (word_id, position) is the sense id `6938.2` split in two.
 */
export const wordSenses = pgTable(
  'word_senses',
  {
    wordId: text('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    english: text('english').notNull(),
  },
  table => [primaryKey({ columns: [table.wordId, table.position] })],
);

/**
 * An inflected form known to belong to a headword, and how it differs from it.
 *
 * The one table that carries both languages' nominal morphology without being told which it
 * is looking at: `gram` holds "erg" and "dat.pl" for Georgian and "gen.sg" and "pre.pl" for
 * Russian, and nothing downstream has to care. A Russian noun's twelve case forms are twelve
 * rows here, exactly as a Georgian noun's are.
 */
export const wordForms = pgTable(
  'word_forms',
  {
    wordId: text('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    form: text('form').notNull(),
    /** "erg", "dat.pl", "gen.sg", "Aorist 3sg". Null for the headword spelling itself. */
    gram: text('gram'),
    /** What this form means where the headword's meaning does not say it: იყო is "was". */
    english: text('english'),
    /** The form with its stress written in, for Russian. Display only. */
    accented: text('accented').notNull().default(''),
  },
  table => [
    primaryKey({ columns: [table.wordId, table.position] }),
    // The story builder's first index: spelling → the headword it belongs to.
    index('word_forms_form_idx').on(table.form),
  ],
);

/* =============================================================== morphology */

/* ------------------------------------------------------------ Georgian verbs */

// There are no `persons`, `series` or `screeves` tables. Those are the fixed grammar of the
// language rather than data about this dictionary, and they live as constants in
// @georgian/shared/grammar/ka — see the note at the head of that file. `ka_verb_groups` stays
// a table because it is not like them: the conjugation groups come out of the spreadsheet
// with editorial notes attached, and `verb_count` changes whenever the paradigms do.
//
// These four tables are prefixed `ka_` and their Russian counterparts `ru_`, rather than the
// Georgian ones keeping the bare names they had. The two are peers, and leaving one
// unprefixed would read as "verbs, and also Russian verbs" — which is exactly the wrong
// mental model for a schema where the verb systems share nothing at all.

export const kaVerbGroups = pgTable('ka_verb_groups', {
  id: text('id').primaryKey(),
  /** Its place in the generated list. See the note on `categories`. */
  position: integer('position').notNull().default(0),
  label: text('label').notNull(),
  name: text('name').notNull().default(''),
  notes: jsonb('notes').$type<string[]>().notNull().default([]),
  verbCount: integer('verb_count').notNull().default(0),
});

export const kaVerbs = pgTable(
  'ka_verbs',
  {
    id: text('id').primaryKey(),
    /** Its place in the generated list. See the note on `categories`. */
    position: integer('position').notNull().default(0),
    english: text('english').notNull().default(''),
    /** Extra senses, each already carrying its own preverb where they differ. */
    senses: jsonb('senses').$type<string[]>().notNull().default([]),
    /** "v.t.", "v.i.", "v.t.i." — empty where the source left it blank. */
    transitivity: text('transitivity').notNull().default(''),
    verbalNoun: text('verbal_noun').notNull().default(''),
    /** Display form of the conjugation group, e.g. "(1, A)". */
    group: text('group').notNull().default(''),
    groupId: text('group_id').references(() => kaVerbGroups.id, { onDelete: 'set null' }),
    present3sg: text('present_3sg').notNull().default(''),
    url: text('url').notNull().default(''),
    synonymsEnglish: jsonb('synonyms_english').$type<string[]>().notNull().default([]),
    synonymsGeorgian: jsonb('synonyms_georgian').$type<string[]>().notNull().default([]),
  },
  table => [index('ka_verbs_group_idx').on(table.groupId)],
);

/**
 * Every cell of every Georgian paradigm — 603 verbs × up to 66 cells, around 44k rows.
 *
 * Every cell, and there is no alternative: a Georgian paradigm cannot be worked out from
 * anything shorter than itself. Its Russian counterpart `ruVerbForms` holds only the
 * exceptions, because a Russian one can. That difference is the whole reason the two
 * languages have separate tables rather than one with a `lang` column — see the head of
 * grammar/ru.ts.
 *
 * `screeve` holds a `ScreeveKey` for the eleven proper screeves, plus the literal
 * 'imperative' or 'prohibitive' for the two that are not screeves and have no first person
 * singular. It is plain text with nothing to reference: the set of screeves is a compile-time
 * union in types.ts, not a table.
 */
export const kaVerbForms = pgTable(
  'ka_verb_forms',
  {
    verbId: text('verb_id')
      .notNull()
      .references(() => kaVerbs.id, { onDelete: 'cascade' }),
    screeve: text('screeve').notNull(),
    person: text('person').notNull(),
    form: text('form').notNull(),
  },
  table => [
    primaryKey({ columns: [table.verbId, table.screeve, table.person] }),
    // What makes an inflected form findable: which paradigm does ავაშენებ come from?
    index('ka_verb_forms_form_idx').on(table.form),
  ],
);

/** One Georgian verb's morpheme make-up, derived from its paradigm and safe to hand-correct. */
export const kaVerbMorphemes = pgTable('ka_verb_morphemes', {
  verbId: text('verb_id')
    .primaryKey()
    .references(() => kaVerbs.id, { onDelete: 'cascade' }),
  root: text('root').notNull(),
  /** Stem variants — aorist ablaut and the like. */
  roots: jsonb('roots').$type<string[]>().notNull().default([]),
  /** Present/future stem formant. */
  pfsf: text('pfsf'),
  preverbs: jsonb('preverbs').$type<string[]>().notNull().default([]),
  /** Which screeves carry the preverb. Empty when the segmenter could not tell. */
  preverbScreeves: jsonb('preverb_screeves').$type<string[]>().notNull().default([]),
  /** The usual preradical vowel. */
  version: text('version'),
  /** Share of this verb's forms the segmenter split cleanly, 0–100. */
  parsed: real('parsed').notNull().default(0),
  needsCheck: boolean('needs_check').notNull().default(false),
});

/* ------------------------------------------------------------- Russian verbs */

/**
 * A Russian verb: one row per *lemma*, and the rule for building its paradigm.
 *
 * Two decisions are worth stating outright, because both look like something is missing.
 *
 * **One row per lemma, not per aspect pair.** делать and сделать are two rows linked by
 * `pairId`. A pair row was the obvious alternative and it is wrong: the perfective has no
 * present tense and no present participle, so half of one side of that record would always be
 * meaningless, and a NULL that can never be filled is a modelling error rather than missing
 * data. The pages that want to show the pair — and most of them do, because a learner meets
 * делать/сделать as one item — follow the link.
 *
 * **There is no `ru_verb_classes` table.** Zaliznyak's sixteen live in grammar/ru.ts as
 * `RU_CLASSES`, for the same reason the Georgian screeves are not a table: they are a
 * published classification of the language rather than data about this dictionary, and
 * `RuClassId` already pins them as a compile-time union. `ka_verb_groups` *is* a table
 * because those came out of the spreadsheet carrying editorial notes; these did not.
 *
 * What is stored here is a *rule and its inputs* — a class, two or three stems and a stress
 * pattern — from which `conjugate()` produces the twenty-odd forms. Storing the forms would
 * have been storing the same information at twenty times the size, in a shape where fixing a
 * stem means fixing twenty rows and hoping you found them all.
 */
export const ruVerbs = pgTable(
  'ru_verbs',
  {
    id: text('id').primaryKey(),
    /** Its place in the generated list. See the note on `categories`. */
    position: integer('position').notNull().default(0),
    /** Unaccented — the form index is built on this. See `words.headword`. */
    infinitive: text('infinitive').notNull(),
    /** The infinitive with its stress written in. Display only. */
    accented: text('accented').notNull().default(''),
    english: text('english').notNull().default(''),
    senses: jsonb('senses').$type<string[]>().notNull().default([]),

    /** 'impf' | 'pf'. The distinction the whole verb system is built on. */
    aspect: text('aspect').notNull(),
    /** The other half of the pair. Null for the aspectually unpaired — быть, стоить. */
    pairId: text('pair_id'),

    /** A `RuClassId`: '1'–'16', or 'irr'. Never empty — every verb has a rule. */
    classId: text('class_id').notNull(),

    /** The stem the middle four present cells take: дела|ешь, пиш|ешь, говор|ишь. */
    stemPresent: text('stem_present').notNull().default(''),
    /** The first person's stem where it differs: любл|ю against люб|ишь. */
    stemPresent1sg: text('stem_present_1sg'),
    /** Where the imperative is built off something else — class 13's дава|й. */
    stemImperative: text('stem_imperative'),
    /** The past stem. Null means "the infinitive with its -ть/-ти/-чь taken off". */
    stemPast: text('stem_past'),
    /** The masculine past where the vowel changes: нес → нёс, пек → пёк. */
    stemPastM: text('stem_past_m'),

    /** 'stem' | 'ending' | 'shift'. Also what decides -ешь against -ёшь. */
    stressPresent: text('stress_present').notNull().default('stem'),
    /** 'stem' | 'ending' | 'fem'. The last is был / была́ / бы́ло / бы́ли. */
    stressPast: text('stress_past').notNull().default('stem'),
    /** Which vowel of the stem carries the stress, 0-based, where the stem carries it. */
    stemStress: smallint('stem_stress'),
    /** Which vowel of the infinitive carries the stress, 0-based. */
    stressInfinitive: smallint('stress_infinitive'),

    /** Ends in -ся/-сь. A column rather than a LIKE, and it suppresses the passive. */
    reflexive: boolean('reflexive').notNull().default(false),
    /** 'tr' | 'intr'. Only a transitive verb forms a past passive participle. */
    transitivity: text('transitivity').notNull().default(''),
    /** The cases the complement takes: ['dat'], ['ins']. */
    government: jsonb('government').$type<string[]>().notNull().default([]),
    /** 'uni' | 'multi' | '' — идти against ходить, which is its own small system. */
    motion: text('motion').notNull().default(''),

    level: text('level').notNull().default(''),
    /**
     * Set when the rule has not been checked against a reference for this verb. The paradigm
     * still renders — it is generated either way — but the page says so, which is the same
     * bargain `ka_verb_morphemes.parsed` strikes for the Georgian segmenter.
     */
    needsCheck: boolean('needs_check').notNull().default(false),
    note: text('note'),
  },
  table => [
    index('ru_verbs_infinitive_idx').on(table.infinitive),
    index('ru_verbs_class_idx').on(table.classId),
    index('ru_verbs_pair_idx').on(table.pairId),
  ],
);

/**
 * The cells the rule gets wrong — and *only* those.
 *
 * For a regular verb this table holds nothing at all. For быть it holds every cell, and the
 * derivation is computed and then thrown away. Both go through the same code path in
 * `conjugate()`, which is what keeps the irregulars from turning into a special case that
 * quietly rots while nobody is looking at it.
 *
 * `slot` is a `RuSlotKey` — 'pres.1sg', 'past.f', 'part.past.pass'. Plain text with nothing
 * to reference, because the set of slots is a compile-time union in types.ts and a table
 * whose rows had to match one would be a second copy of the same closed set.
 */
export const ruVerbForms = pgTable(
  'ru_verb_forms',
  {
    verbId: text('verb_id')
      .notNull()
      .references(() => ruVerbs.id, { onDelete: 'cascade' }),
    slot: text('slot').notNull().$type<RuSlotKey>(),
    /** Unaccented. Whatever the rule would have produced for this slot is discarded. */
    form: text('form').notNull(),
    /** With the stress written in, since a stored cell cannot have one computed for it. */
    accented: text('accented').notNull().default(''),
    /** Why the rule misses this cell, for whoever reads it in a year. */
    note: text('note'),
  },
  table => [
    primaryKey({ columns: [table.verbId, table.slot] }),
    index('ru_verb_forms_form_idx').on(table.form),
  ],
);

/**
 * A Russian noun's or adjective's grammar, hanging off the shared `words` row.
 *
 * Real columns rather than a jsonb blob because "show me the animate masculines" is a
 * question a learner asks and a WHERE clause answers — the rule of thumb at the head of this
 * file, applied. The declined forms themselves are not here: they are `word_forms` rows with
 * `gram` set to 'gen.sg' and the rest, in the same table that holds Georgian's case forms.
 */
export const ruWordGrammar = pgTable(
  'ru_word_grammar',
  {
    wordId: text('word_id')
      .primaryKey()
      .references(() => words.id, { onDelete: 'cascade' }),
    /** 'm' | 'f' | 'n' | 'pl' — the last for the nouns with no singular. */
    gender: text('gender'),
    /** 'anim' | 'inanim'. Decides which form the accusative borrows. */
    animacy: text('animacy'),
    /** '1' | '2' | '3' | 'indecl' | 'adj'. */
    declension: text('declension'),
    /** Zaliznyak's stress pattern letter for the paradigm: 'a'–'f'. */
    stressPattern: text('stress_pattern'),
    needsCheck: boolean('needs_check').notNull().default(false),
  },
  table => [index('ru_word_grammar_gender_idx').on(table.gender)],
);

/* ------------------------------------------------------------------ images */

/**
 * A Wikimedia Commons picture with the attribution its licence requires.
 *
 * `kind` says what `subject_id` names — a words id or a category id — so the two generated
 * files share one table rather than being two tables with identical columns. No `lang`
 * column: `subject_id` is a content id, and those are already unique across languages.
 */
export const images = pgTable(
  'images',
  {
    kind: text('kind').notNull(),
    subjectId: text('subject_id').notNull(),
    url: text('url').notNull(),
    width: integer('width').notNull().default(0),
    height: integer('height').notNull().default(0),
    title: text('title').notNull().default(''),
    page: text('page').notNull().default(''),
    author: text('author').notNull().default(''),
    license: text('license').notNull().default(''),
    licenseUrl: text('license_url').notNull().default(''),
  },
  table => [primaryKey({ columns: [table.kind, table.subjectId] })],
);

/* ----------------------------------------------------------------- stories */

export const stories = pgTable(
  'stories',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    titleEnglish: text('title_english').notNull().default(''),
    /** A CEFR level as plain text: stories are not confined to the A1/A2 word list. */
    level: text('level').notNull().default(''),
    source: text('source').notNull().default(''),
    note: text('note').notNull().default(''),
    /** tokens, distinctForms, covered, coverage, names, unresolved, flagged. */
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    paragraphs: jsonb('paragraphs').$type<string[]>().notNull().default([]),
    /** One entry per paragraph, in the same order. Empty when untranslated. */
    translation: jsonb('translation').$type<string[]>().notNull().default([]),
  },
  table => [index('stories_lang_idx').on(table.lang)],
);

/**
 * One *occurrence* of a word, not one spelling: the fourth word of the third paragraph is
 * its own row, so აბა can be "let's" in one line and "just try" in another.
 *
 * It carries no meaning of its own — `word_id` and `sense` point into the lexicon, so a
 * corrected definition reaches every story that cites it without any of them being rebuilt.
 * No `lang` column for the same reason: the story it belongs to has one, and the word it
 * cites has one, and a third copy could only ever disagree with them.
 *
 * Most of these rows are *derived*: the resolver works them out from the lexicon, and
 * relinking a story throws them away and works them out again. A few are not, and `via` is
 * what tells the two apart — see the note on that column. That distinction is the story
 * override mechanism, and it is why relinking after a lexicon change is safe.
 */
export const storyTokens = pgTable(
  'story_tokens',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    /** 0-based index into `stories.paragraphs`. */
    paragraph: smallint('paragraph').notNull(),
    /** 0-based position within that paragraph, in reading order. */
    position: smallint('position').notNull(),
    /** The surface form, exactly as it stands in the paragraph. */
    form: text('form').notNull(),
    /** Null when nothing matched the form, and for proper names. */
    wordId: text('word_id').references(() => words.id, { onDelete: 'set null' }),
    /** 1-based index into that entry's senses. */
    sense: smallint('sense'),
    gram: text('gram'),
    /**
     * A proper noun, glossed here rather than added to the dictionary.
     *
     * Scoped to the occurrence on purpose, and this is the point of it: ნიფ-ნიფი is a pig
     * in this story and nothing at all in the next one. Naming it here keeps a character
     * out of the word list, which is where promoting it to a lemma would put it forever.
     */
    name: text('name'),
    /**
     * How the link was reached — and, since the admin screens, whether it may be recomputed.
     *
     * Two of its values mean "a person decided this", and relinking keeps those rows instead
     * of resolving them again:
     *
     *   "name"                — glossed as a proper noun, in this story only
     *   "override"…           — pinned by hand, including "override: unlinked" for a token
     *                           deliberately left as plain text
     *
     * Everything else is the resolver's own reasoning and is disposable: "form index",
     * "headword", "paradigm", "-dat -pl". Relinking after the lexicon changes therefore
     * picks up every new word without touching a single hand-made decision.
     *
     * A preserved row is matched back by (paragraph, position) *and* `form`. If the prose is
     * edited and the words shift, the spelling no longer agrees and the pin is dropped
     * rather than silently re-applied to whatever word now stands in that position.
     */
    via: text('via').notNull().default(''),
    /** Set when the link was a guess rather than something confirmed by hand. */
    needsCheck: boolean('needs_check').notNull().default(false),
    /** Other entries that claim this spelling, best guess first. */
    alts: jsonb('alts').$type<{ word: string; english: string }[]>().notNull().default([]),
    comment: text('comment'),
  },
  table => [primaryKey({ columns: [table.storyId, table.paragraph, table.position] })],
);

/* ======================================================================= auth */

// Better Auth owns the shape of the next four tables: it queries them by these exact table
// and column names through the Drizzle adapter. Do not rename anything here to match the
// house style — regenerate with `npx @better-auth/cli generate` instead, and re-apply the
// four additions below, which are ours:
//
//   user.locale — which language to send mail in.
//   user.marketingOptIn — whether we may send anything that is not transactional.
//   user.isAdmin — may edit the dictionary. See the note on the column.
//   user.lang — which dictionary they were last in. See the note on the column.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),

  locale: text('locale').notNull().default('en'),
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false),

  /**
   * Which dictionary this account was last reading.
   *
   * The switcher's memory across devices, and nothing more — the URL is what actually decides
   * which language a page shows, so this only ever supplies a default for a visit that names
   * none. A signed-out visitor gets the same thing out of localStorage.
   */
  lang: text('lang').notNull().$type<Lang>().default('ka'),

  /**
   * May edit the lexicon, the paradigms and the stories.
   *
   * This column is the only thing that grants it — there is no list of addresses in the
   * environment and no second rule anywhere that can disagree with this one. It is declared
   * to Better Auth with `input: false`, so no sign-up body, profile update or OAuth profile
   * can ever set it; it moves only by `npm run admin -- grant <email>` on the host, or by an
   * admin promoting somebody from the admin screens.
   *
   * A fresh database therefore has no admins at all, which is the right default: the CLI is
   * reachable only by whoever can already reach the database.
   */
  isAdmin: boolean('is_admin').notNull().default(false),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  table => [index('session_user_idx').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [index('account_user_idx').on(table.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  table => [index('verification_identifier_idx').on(table.identifier)],
);

/* ====================================================================== study */

/**
 * One side of one item, for one user — the server's copy of what the browser keeps in
 * IndexedDB. Signed out, the browser copy is the only one there is; signing in merges it
 * up and this becomes the copy that outlives the device.
 *
 * `card` is the same `${item}|${side}` key the client uses, kept verbatim so the two stores
 * can be diffed without translating keys. `item`, `side` and `lang` are stored alongside it
 * rather than derived, because the review queue filters on all three.
 */
export const studyCards = pgTable(
  'study_cards',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** `${item}|${side}` — `w:6938|target`. */
    card: text('card').notNull(),
    /** `w:6938` for a word, `v:abandon-vt` for a bare paradigm. */
    item: text('item').notNull(),
    /**
     * 'target' | 'en' — recognising მგელი and producing it are two cards off one word.
     *
     * This held 'ka' until there was a second language, at which point a value naming the
     * language and a value naming a *direction* could no longer be the same thing. The
     * migration rewrites it; the meaning never changed.
     */
    side: text('side').notNull(),
    /**
     * Which dictionary this card belongs to.
     *
     * Derivable from `item` — ids are minted per language and never collide — but stored,
     * because the review queue filters on it and a deck must never mix scripts. Exactly the
     * bargain `item` and `side` already strike, both of which are derivable from `card`.
     */
    lang: text('lang').notNull().$type<Lang>().default('ka'),

    /** 1–6. There is no 0: a word never met has no row at all. */
    level: smallint('level').notNull(),
    /** Days until the next review; 0 while the card is still being learned today. */
    interval: real('interval').notNull().default(0),
    /** SM-2's difficulty multiplier. */
    ease: real('ease').notNull().default(2.5),
    /**
     * When it is next wanted. The client deals in epoch ms and these are timestamptz, which
     * is a conversion at the boundary and nowhere else — worth it because "what is due" then
     * has an answer in SQL rather than only after a full download.
     */
    due: timestamp('due', { withTimezone: true }).notNull(),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    last: timestamp('last', { withTimezone: true }).notNull(),

    /** When the row was first written. Never rewritten by a later answer. */
    created: timestamp('created', { withTimezone: true }).notNull(),
    /** 'review' | 'marked' — only 'review' counts against the day's new-card allowance. */
    introduced: text('introduced').notNull().default('review'),

    /**
     * A forgotten card is kept as a tombstone rather than deleted, so that "I forgot this
     * on my phone" survives the next sync from a laptop that still has the row. The seed of
     * truth for both stores is `updatedAt`, newest wins.
     */
    deleted: boolean('deleted').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.userId, table.card] }),
    // The sync's only query: everything this user changed since they last pulled.
    index('study_cards_user_updated_idx').on(table.userId, table.updatedAt),
    // The deck query: what is due, in the language currently on screen.
    index('study_cards_user_lang_due_idx').on(table.userId, table.lang, table.due),
    uniqueIndex('study_cards_user_item_side_idx').on(table.userId, table.item, table.side),
  ],
);

/* =================================================================== relations */

export const languagesRelations = relations(languages, ({ many }) => ({
  categories: many(categories),
  words: many(words),
  stories: many(stories),
}));

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  language: one(languages, { fields: [categories.lang], references: [languages.id] }),
  words: many(words),
}));

export const wordsRelations = relations(words, ({ many, one }) => ({
  language: one(languages, { fields: [words.lang], references: [languages.id] }),
  category: one(categories, { fields: [words.categoryId], references: [categories.id] }),
  senses: many(wordSenses),
  forms: many(wordForms),
  ruGrammar: one(ruWordGrammar),
}));

export const wordSensesRelations = relations(wordSenses, ({ one }) => ({
  word: one(words, { fields: [wordSenses.wordId], references: [words.id] }),
}));

export const wordFormsRelations = relations(wordForms, ({ one }) => ({
  word: one(words, { fields: [wordForms.wordId], references: [words.id] }),
}));

export const kaVerbsRelations = relations(kaVerbs, ({ many, one }) => ({
  group: one(kaVerbGroups, { fields: [kaVerbs.groupId], references: [kaVerbGroups.id] }),
  forms: many(kaVerbForms),
  morphemes: one(kaVerbMorphemes),
}));

export const kaVerbFormsRelations = relations(kaVerbForms, ({ one }) => ({
  verb: one(kaVerbs, { fields: [kaVerbForms.verbId], references: [kaVerbs.id] }),
}));

export const kaVerbMorphemesRelations = relations(kaVerbMorphemes, ({ one }) => ({
  verb: one(kaVerbs, { fields: [kaVerbMorphemes.verbId], references: [kaVerbs.id] }),
}));

export const ruVerbsRelations = relations(ruVerbs, ({ many }) => ({
  /** The overrides, which for most verbs is an empty list. */
  overrides: many(ruVerbForms),
}));

export const ruVerbFormsRelations = relations(ruVerbForms, ({ one }) => ({
  verb: one(ruVerbs, { fields: [ruVerbForms.verbId], references: [ruVerbs.id] }),
}));

export const ruWordGrammarRelations = relations(ruWordGrammar, ({ one }) => ({
  word: one(words, { fields: [ruWordGrammar.wordId], references: [words.id] }),
}));

export const storiesRelations = relations(stories, ({ many, one }) => ({
  language: one(languages, { fields: [stories.lang], references: [languages.id] }),
  tokens: many(storyTokens),
}));

export const storyTokensRelations = relations(storyTokens, ({ one }) => ({
  story: one(stories, { fields: [storyTokens.storyId], references: [stories.id] }),
  word: one(words, { fields: [storyTokens.wordId], references: [words.id] }),
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  cards: many(studyCards),
}));

export const studyCardsRelations = relations(studyCards, ({ one }) => ({
  user: one(user, { fields: [studyCards.userId], references: [user.id] }),
}));
