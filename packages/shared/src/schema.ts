// The database, in Drizzle.
//
// Five things live here and they are worth telling apart, because they have different
// owners and completely different write patterns:
//
//   content — the lexicon, the paradigms, the stories. Seeded from data/<lang>/*.json and,
//     since the admin screens, *also written by the app*. The database is the source of
//     truth for content rather than a copy of the generated files: `npm run db:export`
//     writes it back out to data/, and `npm run db:seed` refuses to overwrite edited
//     content without --force. See `contentVersion.source`.
//
//   quizzes — content too, and versioned with it, but the one group with no generated file
//     behind it. There was never a build script that produced a quiz: they are written in
//     the admin screens and nowhere else, so the seed has nothing to load and the export has
//     no file to keep in step. The seed deletes nothing, so this is safe rather than merely
//     unhandled — see the head of db/seed.ts.
//
//   morphology — one set of tables per language, because this is the one place the two do
//     not have the same shape. See the block comment above `kaVerbs`.
//
//   auth — Better Auth's four tables. Their column names are fixed by the library rather
//     than chosen here; see the note above them before renaming anything.
//
//   study — one row per side of one item per user, and one row per quiz somebody has taken.
//     `study_cards` is the only table that holds something a user would badly miss;
//     `quiz_results` is the same shape of ownership and a far smaller loss. See both.
//
//   private content — not a group of tables but a column, `owner_id`, on three of the content
//     ones. A reader may write their own stories and their own vocabulary, and those rows sit
//     in the same tables the dictionary's own do. See the note on `owner_id` below.
//
//   speech — an index over the synthesised audio cached on disk. The only group here that is
//     wholly disposable: every row can be deleted at any moment and is simply made again the
//     next time someone presses play. See `ttsCache`.
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

/* --------------------------------------------------------------------------
 * On `owner_id`
 *
 * Three content tables carry it: `stories`, `words` and `categories`. On all three, null
 * means the row is the dictionary's own, which covers everything that existed before readers
 * could write anything. A row with an owner is one person's private content. They may edit
 * it, nobody else can see it, and it is deleted with the account.
 *
 * A column rather than parallel `user_stories` tables, because a private story has to be the
 * same kind of thing as a published one. It is cut into tokens by the same tokeniser, linked
 * against the same lexicon by the same resolver, read by the same reader and spoken by the
 * same voice. A second set of tables would mean a second copy of all of that, and the two
 * would drift apart one fix at a time.
 *
 * The cost is that every read has to say which rows it wants. There are two answers:
 *
 *   the snapshot: `owner_id is null`, always. router/content.ts assembles one object per
 *     language, shared by every visitor and cached in every browser, so a row that varies per
 *     person cannot be in it. See `assemble`.
 *
 *   the private overlay: `owner_id = :viewer`, and nothing else. router/library.ts answers
 *     with one person's rows and the client lays them over the snapshot.
 *
 * The resolver is the one place that wants both at once. Linking somebody's own story has to
 * see the public lexicon as well as their own words, or a word they added would not be found
 * in the text they added it for. That is `loadLexicon`'s `owner` argument, and it is the only
 * query here that reads across the line.
 * -------------------------------------------------------------------------- */

import { relations } from 'drizzle-orm';
import {
  boolean,
  customType,
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

/**
 * Raw bytes. Hand-rolled because drizzle-orm's pg-core has no `bytea` of its own.
 *
 * postgres-js already hands a `bytea` back as a Buffer and takes one on the way in, so both
 * directions here are the identity function and the type is the whole point of the wrapper:
 * without it a column of bytes is `unknown` at every call site.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

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
    /**
     * How many words are in it, of the same ownership as the category itself.
     *
     * A public category counts the public words filed under it and nothing else, because this
     * number rides in the shared snapshot and has to mean the same thing to everybody. A
     * reader who files one of their own words under "Food & drink" does not move it; the
     * browser adds their own in when it lays the overlay over the snapshot. An owned category
     * counts its owner's words, which is the only kind it can hold.
     */
    wordCount: integer('word_count').notNull().default(0),
    /**
     * Whose shelf this is, or null for the dictionary's own. See the note at the head of this
     * file.
     *
     * One is made for a reader, called "My words", the first time they add a word:
     * `words.category_id` is not null, so something has to stand there. They may make more.
     */
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
  },
  table => [index('categories_lang_idx').on(table.lang), index('categories_owner_idx').on(table.ownerId, table.lang)],
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
    /**
     * Whose entry this is, or null for the dictionary's own. See the note at the head of this
     * file.
     *
     * A private entry is a full lemma as far as its owner is concerned: searched, studied,
     * carrying senses and inflected forms, and linked into their stories by the resolver. No
     * snapshot carries it, and `loadLexicon` will not show it to a story it does not belong to.
     */
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
  },
  table => [
    index('words_category_idx').on(table.categoryId),
    // The overlay's only query: this person's vocabulary, in the language on screen.
    index('words_owner_idx').on(table.ownerId, table.lang),
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

/**
 * A shelf to file stories under — "Folk tales", "News", "Children's".
 *
 * A separate table from `categories` rather than a `kind` column on it, because the two are
 * not the same thing wearing different labels. A word's category is *generated*: the scrape
 * produced it, `word_count` follows the lexicon, and nobody sits down and invents one. A
 * story's is the opposite — hand-made, named by whoever is filing, and empty until somebody
 * fills it. Sharing a table would mean one of `word_count` or `story_count` being null on
 * every row in it, and the word grid listing "Folk tales" as a category with no words in it.
 */
export const storyCategories = pgTable(
  'story_categories',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    /** Where it sits in the list, which is chosen rather than alphabetical. */
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    /** The category's name in the language being learned. Optional, unlike a word's. */
    nameNative: text('name_native').notNull().default(''),
    note: text('note').notNull().default(''),
    /** Maintained by the writers, the way `categories.word_count` is. */
    storyCount: integer('story_count').notNull().default(0),
  },
  table => [index('story_categories_lang_idx').on(table.lang)],
);

/**
 * A story: everything true of the whole of it, and none of its prose.
 *
 * The prose moved to `story_chapters` when stories stopped being one text each. What stays
 * here is what a chapter cannot answer on its own — the title on the cover, the level, the
 * shelf it is filed on — and `stats`, which is the sum over every chapter and is what the
 * index card shows. A story with one chapter is the ordinary case and is not marked as
 * anything special: it simply has one row in `story_chapters`.
 */
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
    /**
     * Null is a state of its own — "not filed yet" — rather than a category called
     * "Uncategorised", so deleting a category can empty it without deleting what was in it.
     * `set null` for the same reason: a shelf is thrown away far more readily than a book.
     */
    categoryId: text('category_id').references(() => storyCategories.id, { onDelete: 'set null' }),
    /** tokens, distinctForms, covered, coverage, names, unresolved, flagged — every chapter. */
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    /**
     * Whose story this is, or null for one the dictionary publishes.
     *
     * This is the column a reader's own library is built on, and the reason there is no
     * `user_stories` table: a private story is chaptered, tokenised, linked, coloured by what
     * you know and read aloud by the same code as a published one. See the note at the head of
     * this file.
     *
     * `on delete cascade` rather than `set null`: a private story orphaned by a closed account
     * would become a published story nobody wrote and nobody can delete. The chapters and
     * tokens follow through their own keys.
     *
     * A private story is never filed on a shelf, so `category_id` stays null on all of them.
     * The shelves belong to the dictionary, and one person's own story appearing on "Folk
     * tales" for them alone would make that shelf mean two things to two people.
     */
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
  },
  table => [
    index('stories_lang_idx').on(table.lang),
    index('stories_category_idx').on(table.categoryId),
    // The overlay's only query: this person's own stories, in the language on screen.
    index('stories_owner_idx').on(table.ownerId, table.lang),
  ],
);

/**
 * One chapter's prose, and the unit everything about reading is counted in.
 *
 * Keyed by `(story_id, position)` rather than by an id of its own. A chapter has no identity
 * apart from where it stands in its story — nothing outside the story ever cites one, and
 * the URL says "chapter 3", not a slug — so a surrogate key would be a second name for the
 * same fact and a chance for the two to disagree. The cost is that reordering rewrites the
 * positions, which is what `moveChapter` does, in one transaction.
 *
 * `stats` is this chapter's alone. The story's is not their sum in every field: two chapters
 * can share a spelling, so `distinctForms` is recounted across the whole story rather than
 * added up. See `recountStory`.
 */
export const storyChapters = pgTable(
  'story_chapters',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    /** 0-based. The reader's URL shows this plus one. */
    position: smallint('position').notNull(),
    /**
     * Empty for a story that is one text and has no chapters worth naming — which is what
     * the reader checks before drawing any chapter furniture at all.
     */
    title: text('title').notNull().default(''),
    titleEnglish: text('title_english').notNull().default(''),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    paragraphs: jsonb('paragraphs').$type<string[]>().notNull().default([]),
    /** One entry per paragraph, in the same order. Empty when untranslated. */
    translation: jsonb('translation').$type<string[]>().notNull().default([]),
  },
  table => [primaryKey({ columns: [table.storyId, table.position] })],
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
    /**
     * Which chapter, 0-based. Part of the key rather than derived from anything: two
     * chapters both have a paragraph 0 with a word 0 in it.
     */
    chapter: smallint('chapter').notNull().default(0),
    /** 0-based index into that chapter's `paragraphs`. */
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
  table => [primaryKey({ columns: [table.storyId, table.chapter, table.paragraph, table.position] })],
);

// There is deliberately no foreign key from `(story_id, chapter)` to `story_chapters`, and
// it is the one relation in this file that is enforced in code instead. A chapter's position
// *is* its identity, so reordering a book means writing new positions — and a non-deferrable
// key cannot be satisfied part-way through a swap in either order: move the chapter row
// first and its tokens are orphans, move the tokens first and they name a chapter that does
// not exist yet. The alternatives were a deferrable constraint, which Drizzle cannot declare
// and so would drift silently from this file, or parking rows to swap through, which is nine
// statements of ceremony to reorder two chapters. So `deleteChapter` deletes the tokens
// itself and `moveChapter` carries them along. The key on `story_id` still stands: deleting
// a story takes everything with it, which is the case that would actually lose data.

/* ----------------------------------------------------------------- quizzes */

/**
 * A shelf to file quizzes under — "Verbs", "Listening", "Week 3".
 *
 * The same shape as `story_categories` and, like it, a separate table rather than a `kind`
 * column on one shared one. The reason is the one given there: these are hand-made and named
 * by whoever is filing, and a shared table would mean two of `word_count`, `story_count` and
 * `quiz_count` being null on every row in it.
 */
export const quizCategories = pgTable(
  'quiz_categories',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    /** Where it sits in the list, which is chosen rather than alphabetical. */
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    /** The category's name in the language being learned. Optional, as a story's is. */
    nameNative: text('name_native').notNull().default(''),
    note: text('note').notNull().default(''),
    /** Maintained by the writers, the way `story_categories.story_count` is. */
    quizCount: integer('quiz_count').notNull().default(0),
  },
  table => [index('quiz_categories_lang_idx').on(table.lang)],
);

/**
 * A quiz: everything true of the whole of it, and none of its questions.
 *
 * There is no `published` column, and its absence is a decision rather than an oversight. A
 * quiz with no questions in it is not offered to anybody — there is nothing to answer — so
 * "started and not finished" is already a state the data has, and it needs no flag to say so.
 * Adding one would mean every read in the app growing a filter that the snapshot cache, which
 * is one object shared by every visitor, cannot vary per person anyway.
 */
export const quizzes = pgTable(
  'quizzes',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    /** The title in the language being learned. Display only. */
    titleNative: text('title_native').notNull().default(''),
    /** What this quiz is for, shown on its card and above the first question. */
    description: text('description').notNull().default(''),
    /** A CEFR level as plain text, on the same terms as a story's. */
    level: text('level').notNull().default(''),
    /**
     * Null is "not filed yet" rather than a category called "Uncategorised", and the key is
     * `set null` for the reason the stories' is: a shelf is thrown away far more readily than
     * what stands on it. See `stories.category_id`.
     */
    categoryId: text('category_id').references(() => quizCategories.id, { onDelete: 'set null' }),
    /**
     * Ask the questions in a different order each run.
     *
     * On by default, on the same reasoning as `shuffle_options` below: questions are written in
     * the order they occurred to whoever wrote them, and a run that always asked them in that
     * order lets a second attempt be answered from the shape of the list rather than the
     * language. It is settable because a quiz whose questions build on each other — one that
     * walks through a conjugation a person at a time — wants the order it was written in.
     */
    shuffleQuestions: boolean('shuffle_questions').notNull().default(true),
    /**
     * Shuffle the options within a question.
     *
     * On by default, and it is doing real work: the answer to a `choice` question is stored
     * first in `quiz_choices` more often than not, simply because that is the order it was
     * typed in, and a run that always rewarded the top option would be a quiz about typing
     * habits. It is settable because one kind of question genuinely wants a fixed order —
     * options that read "1985 / 1995 / 2005".
     */
    shuffleOptions: boolean('shuffle_options').notNull().default(true),
    /**
     * How many questions one run asks, drawn at random, or 0 to ask them all.
     *
     * For the quiz that is a drill rather than a test: thirty-three letters is the whole
     * alphabet and nobody sits thirty-three questions twice, but ten of them drawn fresh is a
     * thing somebody will do every morning. The questions that were not drawn are not hidden —
     * they are the rest of the pool, and the next run deals from the same deck.
     *
     * Held as "how many to ask" rather than "how many to leave out" because the number a writer
     * has in mind is the length of the run, and because a pool that grows should lengthen the
     * odds rather than the quiz: adding a question to a 33-of-10 quiz still asks ten.
     *
     * A value larger than the pool asks the pool. That is deliberate rather than a validation
     * error — a quiz being written towards twenty questions should work at question five — and
     * it is why the drawing clamps instead of the editor refusing.
     */
    askCount: integer('ask_count').notNull().default(0),
    /** The share of the marks a run has to reach to count as passed, 0–100. */
    passMark: smallint('pass_mark').notNull().default(70),
    /** Maintained by the writers, so a card can say how long the quiz is without loading it. */
    questionCount: integer('question_count').notNull().default(0),
    note: text('note').notNull().default(''),
  },
  table => [index('quizzes_lang_idx').on(table.lang), index('quizzes_category_idx').on(table.categoryId)],
);

/**
 * An uploaded audio clip, bytes and all.
 *
 * Unlike `tts_cache`, which is an index over files on disk, the recording itself is a column
 * here. The two are the same shape and the opposite lifetime, and the lifetime is what decides
 * where the bytes go: **this is content and that is a cache.** A synthesised line can be
 * deleted at any moment and made again from the text, so it can live in a directory that is not
 * backed up. An uploaded recording cannot be made again from anything, so it belongs where
 * everything else that cannot be made again already is — in the database, inside the same dump
 * and the same restore as the question that plays it.
 *
 * That is a change from how this started. The clips were files under MEDIA_DIR, and the cost
 * showed up the first time the database moved without them: 417 rows arrived on a host whose
 * volume was empty, every one of them a play button that 503s. A row and its bytes travelling
 * separately is a bug waiting for the next migration, and at the size these actually are — a
 * few hundred kilobytes each, a handful of megabytes in total — there is nothing to be bought
 * by keeping them apart. Postgres is a poor place to stream gigabytes from; this is not that.
 *
 * `id` stays a random name rather than a hash of the contents: two uploads of the same
 * recording are two clips, because one of them may be deleted while the other is still wanted.
 *
 * Declared above the two tables that point at it, as every referenced table in this file is:
 * Drizzle resolves an inline `references()` while the referring table is being built, so a
 * forward reference is a TDZ error at import time rather than a later one.
 */
export const quizAudio = pgTable('quiz_audio', {
  /** A random 16-character name. Once the file's on disk too; now only a key. */
  id: text('id').primaryKey(),
  lang: text('lang').notNull().$type<Lang>().default('ka'),
  /** 'audio/mpeg', 'audio/ogg', 'audio/wav'. What the serving route sends back. */
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  /**
   * The recording.
   *
   * Nullable only because the rows existed before the column did: a clip uploaded under the
   * old scheme whose file had already gone missing has nothing to backfill from, and a null
   * says so honestly. Everything written since is non-null, and the serving route treats a
   * null exactly as it treated an unreadable file — 410, the row outlived its bytes.
   */
  data: bytea('data'),
  /** What it was called when it was uploaded, so the editor can show something recognisable. */
  name: text('name').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One question, keyed by where it stands in its quiz.
 *
 * Keyed by `(quiz_id, position)` rather than by an id of its own, for the reason a chapter is:
 * a question has no identity apart from its place in the quiz it belongs to, nothing outside
 * that quiz ever cites one, and a surrogate key would be a second name for the same fact.
 *
 * **Three kinds, not six.** The list this was built from named six things a question could
 * be — pick an option, pick the word you heard, order some words, type a form, type what you
 * heard, choose a reply — and they are three shapes with two ways of being asked. What varies
 * between "choose the correct option" and "choose the word you heard" is not the question, it
 * is whether the prompt is written or spoken. So `kind` says what *answering* looks like:
 *
 *   'choice'  — pick from `quiz_choices`. One right answer, or several when `multiple`.
 *   'order'   — put the right words in the right order, from a bank that holds wrong ones too.
 *   'type'    — write it, and `answers` holds every spelling that counts.
 *
 * and `say`/`audio_id` say whether it is heard as well as read. Every one of the six falls out
 * of that pair, and so does the seventh nobody has asked for yet.
 */
export const quizQuestions = pgTable(
  'quiz_questions',
  {
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    /** 0-based. The runner shows this plus one. */
    position: smallint('position').notNull(),
    /** 'choice' | 'order' | 'type'. See the note above. */
    kind: text('kind').notNull().default('choice'),
    /** The instruction, in English: "Which of these means 'wolf'?" */
    prompt: text('prompt').notNull().default(''),
    /** The material being asked about, in the language being learned. Set larger on screen. */
    promptNative: text('prompt_native').notNull().default(''),
    /**
     * What a voice should read out, or empty for a question with nothing to hear.
     *
     * Held rather than derived from `prompt_native`, because the two are not always the same
     * text: "choose the word you heard" wants the word spoken and *nothing* written, which is
     * exactly a `say` with an empty `prompt_native` beside it. Synthesis is by the same cache
     * the stories use — see `tts_cache` — so an unchanged question is only ever spoken once.
     */
    say: text('say').notNull().default(''),
    /**
     * An uploaded clip to play instead of synthesising `say`.
     *
     * Both exist because the voices are not good at everything. A recording of a real speaker,
     * or a line lifted from something, is worth more than any synthesis for a listening
     * question — and typing the text is worth more than hunting for a recording for the other
     * forty. Whichever is set wins; when both are, the clip does.
     */
    audioId: text('audio_id').references(() => quizAudio.id, { onDelete: 'set null' }),
    /** More than one option is right, and all of them must be picked. `choice` only. */
    multiple: boolean('multiple').notNull().default(false),
    /**
     * Every spelling that counts as correct, for a `type` question. Empty for the others.
     *
     * A list rather than one string because a form often has more than one right answer —
     * ჩემი and ჩემი კი, был and бы́л — and because the comparison is deliberately forgiving
     * about case, spacing, punctuation and Russian stress marks. See `packages/shared/quiz.ts`,
     * which is the one place that rule lives and is imported by both the browser and the
     * server, so a run cannot be marked one way on screen and another in the record.
     */
    answers: jsonb('answers').$type<string[]>().notNull().default([]),
    /** Shown on request during the question. Empty for one that needs no help. */
    hint: text('hint').notNull().default(''),
    /** Shown after answering, right or wrong. This is where a quiz does its teaching. */
    explanation: text('explanation').notNull().default(''),
  },
  table => [primaryKey({ columns: [table.quizId, table.position] })],
);

/**
 * One option of one question — and, for an `order` question, one word of the bank.
 *
 * The two are one table because they are one thing wearing two labels: a row that is part of
 * the answer, or a row that is not. What differs is only how the runner draws them, and
 * `correct` is read the same way by both:
 *
 *   'choice' — the rows with `correct` set are the answers. The rest are distractors.
 *   'order'  — the rows with `correct` set are the answer *in `position` order*, and the rest
 *              are words that belong to no part of it. That is what makes "choose the correct
 *              words and put them in the correct order" one question rather than two.
 *
 * Keyed by `(quiz_id, question, position)`, so a question's options are ordered the way its
 * questions are, and for the same reason.
 */
export const quizChoices = pgTable(
  'quiz_choices',
  {
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    /** Which question, 0-based. Part of the key: every question has an option 0. */
    question: smallint('question').notNull(),
    /** 0-based. For `order`, the correct rows' relative order *is* the answer. */
    position: smallint('position').notNull(),
    text: text('text').notNull().default(''),
    /** Part of the answer. See the note above for what that means per kind. */
    correct: boolean('correct').notNull().default(false),
    /** What a voice should read out for this option. Empty for one that is only read. */
    say: text('say').notNull().default(''),
    /** An uploaded clip for this option, which wins over `say`. See `quiz_questions.audio_id`. */
    audioId: text('audio_id').references(() => quizAudio.id, { onDelete: 'set null' }),
  },
  table => [primaryKey({ columns: [table.quizId, table.question, table.position] })],
);

// As with `story_tokens` and `story_chapters`, there is deliberately no foreign key from
// `(quiz_id, question)` to `quiz_questions`, and for the same reason: a question's position is
// its identity, so reordering the quiz means writing new positions, and a non-deferrable key
// cannot be satisfied part-way through a swap in either order. `writeQuiz` sidesteps the
// problem rather than working around it — it deletes every question and option of the quiz and
// writes the submitted set back in one transaction, so no row is ever half-moved. The key on
// `quiz_id` still stands, which is the one that would actually lose data.

/* ----------------------------------------------------------------- lessons */

/**
 * A shelf to file lessons on — "The alphabet", "Week 1", "Verbs".
 *
 * A third table with the same shape as `story_categories` and `quiz_categories`, for the reason
 * given on the first of them, and one column more: `section`. A shelf belongs to the lessons
 * section or to the grammar section, never to both, so "Verbs" as a grammar heading and "Verbs"
 * as a lesson heading are two rows. That is what keeps the reference from being reorganised
 * every time somebody files a lesson.
 */
export const lessonCategories = pgTable(
  'lesson_categories',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    /** 'lessons' | 'grammar'. A `LessonSection`; see the note on that type. */
    section: text('section').notNull().default('lessons'),
    /** Where it sits in the list, which is chosen rather than alphabetical. */
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    /** The category's name in the language being learned. Optional, as a quiz shelf's is. */
    nameNative: text('name_native').notNull().default(''),
    note: text('note').notNull().default(''),
    /** Maintained by the writers, the way `quiz_categories.quiz_count` is. */
    lessonCount: integer('lesson_count').notNull().default(0),
  },
  table => [index('lesson_categories_lang_idx').on(table.lang, table.section)],
);

/**
 * A lesson: its own fields, and its whole body as one string of markup.
 *
 * **The body is text, not a tree.** That is the decision this table turns on, and the
 * alternative — a `lesson_blocks` table, or jsonb holding a parsed document — was rejected for
 * one reason: the author writes markup. Storing anything else would mean the thing in the
 * database is a *rendering* of what was typed, so the editor could no longer show back exactly
 * what was written, a round trip through the parser could quietly lose a stray character, and
 * fixing a typo in a table would be an update to a row nobody can see. Held as text, the column
 * is the document, and every reading of it — the page, the excerpt, the speech route — comes
 * from one parser in shared/lesson.ts.
 *
 * What that gives up is referential integrity with what the body names. A `::quiz` naming a
 * deleted quiz and a `::image` naming a deleted upload are both text pointing at nothing, and
 * no foreign key can say so. The remedy is at the other end: deleting an upload is refused
 * while any body still mentions it, and an embedded quiz that has gone renders as a line saying
 * so rather than as a hole.
 *
 * Both reading sections are this one table — see `LessonSection`. There is no `published`
 * column, for the reason the quizzes have none: a lesson with an empty body has nothing to
 * read, so "started and not finished" is already a state the data has.
 */
export const lessons = pgTable(
  'lessons',
  {
    id: text('id').primaryKey(),
    lang: text('lang')
      .notNull()
      .$type<Lang>()
      .default('ka')
      .references(() => languages.id, { onDelete: 'cascade' }),
    /** 'lessons' | 'grammar'. Which of the two indexes lists it. */
    section: text('section').notNull().default('lessons'),
    position: integer('position').notNull().default(0),
    title: text('title').notNull(),
    /** The title in the language being learned. Display only. */
    titleNative: text('title_native').notNull().default(''),
    /** One line for the card. The opening paragraph stands in when it is empty. */
    summary: text('summary').notNull().default(''),
    /** A CEFR level as plain text, on the same terms as a story's. */
    level: text('level').notNull().default(''),
    /**
     * Null is "not filed yet" rather than a category called "Uncategorised", and the key is
     * `set null` for the reason the quizzes' is. See `quizzes.category_id`.
     */
    categoryId: text('category_id').references(() => lessonCategories.id, { onDelete: 'set null' }),
    /** The markup. See the note above, and the head of shared/lesson.ts for the language. */
    body: text('body').notNull().default(''),
    note: text('note').notNull().default(''),
  },
  table => [
    index('lessons_lang_idx').on(table.lang, table.section),
    index('lessons_category_idx').on(table.categoryId),
  ],
);

/**
 * A picture or a recording somebody uploaded for a lesson, bytes and all.
 *
 * The same division of labour as `quiz_audio` — the upload in a column, the facts about it
 * alongside — and a separate table rather than more rows in that one, which is worth defending
 * because "an upload is an upload" is a fair objection.
 *
 * Three things make them different. This one holds pictures, and a picture has a width, a
 * height and a line of alt text that mean nothing whatever to a quiz clip. What counts as "in
 * use" is a different question in each: a quiz clip is used when a `quiz_questions` row cites
 * its id in a column, and one of these is used when the *text* of some lesson body mentions it,
 * which is a different query and a different guard. And a quiz clip is reached at a URL under
 * /api/quiz, which is where a listening question's sound has always come from.
 *
 * What they share is the lifetime, and it is the opposite of the speech cache's: a synthesised
 * line is disposable because the text can make it again, and a photograph somebody scanned
 * cannot be made again by anything. So nothing here is ever evicted, and `id` is a random name
 * rather than a hash of the contents — two uploads of one picture are two rows, deliberately,
 * because one of them may be deleted while the other is still on a page.
 */
export const lessonMedia = pgTable(
  'lesson_media',
  {
    /** A random 16-character name. Once the file's on disk too; now only a key. */
    id: text('id').primaryKey(),
    lang: text('lang').notNull().$type<Lang>().default('ka'),
    /** 'image' | 'audio'. What the editor lists it under and what a body may name it in. */
    kind: text('kind').notNull(),
    /** 'image/png', 'audio/mpeg'. What the serving route sends back. See `quiz_audio.mime`. */
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    /** The picture or the recording. Nullable for the reason `quiz_audio.data` is. */
    data: bytea('data'),
    /** What it was called when it was uploaded, so the picker can show something recognisable. */
    name: text('name').notNull().default(''),
    /**
     * The picture's size in pixels; zero for a recording, and zero for a picture whose header
     * this server could not read. Held so the page can reserve the space before the bytes
     * arrive — an image that pops in and shoves the paragraph below it down the screen is the
     * one layout fault a reader notices every time.
     */
    width: integer('width').notNull().default(0),
    height: integer('height').notNull().default(0),
    /**
     * What a screen reader says instead of showing it.
     *
     * On the upload rather than on the `::image` that draws it, because a picture means the same
     * thing wherever it is used and describing it once is the version that actually gets done.
     */
    alt: text('alt').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('lesson_media_kind_idx').on(table.kind)],
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
//
// The three `owner_id` columns above reference `user.id` from before it is declared. That is
// safe for a plain `references()` on a column: the argument is a thunk Drizzle calls after
// this module has finished evaluating, and only the table-level helpers need their target
// already built. Moving this block to the top of the file to avoid the question would put the
// auth library's tables in front of the ones this app actually models.

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

/**
 * How one person last got on with one quiz.
 *
 * **One row per person per quiz, overwritten every time.** Not an attempt log: what is worth
 * keeping is whether this quiz is behind you, and a table that grew a row per run would be a
 * history nothing reads, on one of the two tables here that grow with use rather than with
 * content. Re-taking a quiz replaces what it says, including replacing a pass with a fail —
 * the record is "how it went last time", and a "best ever" that could never be lost would
 * stop meaning anything after the first lucky run.
 *
 * Signed-in only, and unlike `study_cards` there is no browser-side copy to merge up. That
 * asymmetry is deliberate: a deck is months of work and must survive a cleared cache, and
 * this is a fact about one afternoon. A signed-out visitor takes the quiz, is told how they
 * did, and nothing is written anywhere — which is why nothing in the runner needs an account
 * to work.
 */
export const quizResults = pgTable(
  'quiz_results',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    /** Stored rather than joined, because the index filters on it. See `study_cards.lang`. */
    lang: text('lang').notNull().$type<Lang>().default('ka'),
    /** Whether `score` reached the quiz's pass mark, as it stood at the time. */
    passed: boolean('passed').notNull().default(false),
    /** Questions answered correctly, and how many there were. */
    score: smallint('score').notNull().default(0),
    total: smallint('total').notNull().default(0),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.userId, table.quizId] }),
    // The index's only query: everything this person has taken, in the language on screen.
    index('quiz_results_user_lang_idx').on(table.userId, table.lang),
  ],
);

/* ===================================================================== speech */

/**
 * What has been synthesised, and where it is on disk.
 *
 * An index, not a store: the audio itself is a file under TTS_CACHE_DIR, because a browser
 * fetches these and Postgres is the wrong thing to stream bytes out of or to grow a backup
 * by two gigabytes. This table is what makes the directory answerable — how big it is, what
 * can be dropped first, and what the word timings for a file are without decoding it.
 *
 * Every row is disposable and that is the point. `key` is a hash of the exact text that was
 * spoken, so a row and its file can be deleted at any moment and the next request for that
 * text simply makes it again, identically. Nothing here is content and nothing here is worth
 * backing up; `npm run db:export` does not write it out and the seed does not fill it.
 */
export const ttsCache = pgTable(
  'tts_cache',
  {
    /**
     * sha256 of the language, the voice and the text, hex, truncated to 32 characters.
     *
     * The voice is in there because changing which voice a language uses has to invalidate
     * everything said in it — otherwise a story reads in two voices, the old sentences and
     * the re-synthesised ones, which is the one bug this cache could plausibly cause.
     */
    key: text('key').primaryKey(),
    lang: text('lang').notNull().$type<Lang>().default('ka'),
    /** Size of the file on disk. Summed to decide whether anything needs evicting. */
    bytes: integer('bytes').notNull(),
    /** Seconds. What the player builds its timeline from, without loading the audio. */
    duration: real('duration').notNull(),
    /**
     * When each word of the line is said, in seconds from the start of the audio. One entry
     * per word, in reading order, so an entry's position in the array is the word's position
     * in the *sentence*.
     *
     * Sentence-relative and not paragraph-relative, deliberately. Where a line sits in a
     * paragraph is a fact about that paragraph, not about the sound, and the key here is a
     * hash of the text alone — so the same sentence occurring in two places is one row and
     * one file, and it is the caller that adds the offset to get the word index the reader
     * keys on. Storing the absolute index would make the audio and its position share a
     * cache entry, and the second occurrence would light up the wrong words.
     *
     * Empty where the speech service could not group its phonemes into the same number of
     * words our tokeniser found. The audio is still good; the reader falls back to
     * highlighting the whole sentence. See apps/tts/main.py.
     */
    words: jsonb('words').$type<{ start: number; end: number }[]>().notNull().default([]),
    /**
     * When it was last played, not when it was made. This is the whole eviction policy: the
     * least recently *wanted* files go first, so a story someone is working through stays
     * warm and a word looked up once in March does not.
     */
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('tts_cache_used_idx').on(table.usedAt)],
);

/* =================================================================== relations */

export const languagesRelations = relations(languages, ({ many }) => ({
  categories: many(categories),
  words: many(words),
  stories: many(stories),
  storyCategories: many(storyCategories),
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

export const storyCategoriesRelations = relations(storyCategories, ({ many, one }) => ({
  language: one(languages, { fields: [storyCategories.lang], references: [languages.id] }),
  stories: many(stories),
}));

export const storiesRelations = relations(stories, ({ many, one }) => ({
  language: one(languages, { fields: [stories.lang], references: [languages.id] }),
  category: one(storyCategories, { fields: [stories.categoryId], references: [storyCategories.id] }),
  chapters: many(storyChapters),
  tokens: many(storyTokens),
}));

export const storyChaptersRelations = relations(storyChapters, ({ many, one }) => ({
  story: one(stories, { fields: [storyChapters.storyId], references: [stories.id] }),
  tokens: many(storyTokens),
}));

export const storyTokensRelations = relations(storyTokens, ({ one }) => ({
  story: one(stories, { fields: [storyTokens.storyId], references: [stories.id] }),
  chapter: one(storyChapters, {
    fields: [storyTokens.storyId, storyTokens.chapter],
    references: [storyChapters.storyId, storyChapters.position],
  }),
  word: one(words, { fields: [storyTokens.wordId], references: [words.id] }),
}));

export const quizCategoriesRelations = relations(quizCategories, ({ many, one }) => ({
  language: one(languages, { fields: [quizCategories.lang], references: [languages.id] }),
  quizzes: many(quizzes),
}));

export const quizzesRelations = relations(quizzes, ({ many, one }) => ({
  language: one(languages, { fields: [quizzes.lang], references: [languages.id] }),
  category: one(quizCategories, { fields: [quizzes.categoryId], references: [quizCategories.id] }),
  questions: many(quizQuestions),
  choices: many(quizChoices),
  results: many(quizResults),
}));

export const quizQuestionsRelations = relations(quizQuestions, ({ many, one }) => ({
  quiz: one(quizzes, { fields: [quizQuestions.quizId], references: [quizzes.id] }),
  clip: one(quizAudio, { fields: [quizQuestions.audioId], references: [quizAudio.id] }),
  choices: many(quizChoices),
}));

export const quizChoicesRelations = relations(quizChoices, ({ one }) => ({
  quiz: one(quizzes, { fields: [quizChoices.quizId], references: [quizzes.id] }),
  question: one(quizQuestions, {
    fields: [quizChoices.quizId, quizChoices.question],
    references: [quizQuestions.quizId, quizQuestions.position],
  }),
  clip: one(quizAudio, { fields: [quizChoices.audioId], references: [quizAudio.id] }),
}));

export const quizResultsRelations = relations(quizResults, ({ one }) => ({
  user: one(user, { fields: [quizResults.userId], references: [user.id] }),
  quiz: one(quizzes, { fields: [quizResults.quizId], references: [quizzes.id] }),
}));

export const lessonCategoriesRelations = relations(lessonCategories, ({ many, one }) => ({
  language: one(languages, { fields: [lessonCategories.lang], references: [languages.id] }),
  lessons: many(lessons),
}));

export const lessonsRelations = relations(lessons, ({ one }) => ({
  language: one(languages, { fields: [lessons.lang], references: [languages.id] }),
  category: one(lessonCategories, { fields: [lessons.categoryId], references: [lessonCategories.id] }),
  // No relation to `lesson_media`: what a lesson uses is named in its body as text, and there
  // is nothing for Drizzle to join on. See the note on the `lessons` table.
}));

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  cards: many(studyCards),
  quizResults: many(quizResults),
}));

export const studyCardsRelations = relations(studyCards, ({ one }) => ({
  user: one(user, { fields: [studyCards.userId], references: [user.id] }),
}));
