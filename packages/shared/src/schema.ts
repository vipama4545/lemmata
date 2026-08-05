// The database, in Drizzle.
//
// Three things live here and they are worth telling apart, because they have different
// owners and completely different write patterns:
//
//   content — the lexicon, the paradigms, the stories. Seeded from data/*.json and, since
//     the admin screens, *also written by the app*. The database is now the source of
//     truth for content rather than a copy of the generated files: `npm run db:export`
//     writes it back out to data/, and `npm run db:seed` refuses to overwrite edited
//     content without --force. See `contentVersion.source`.
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
// it is a row. A verb's forms passed that test — `where form = 'ავაშენებ'` is how you look
// up an inflected form, which the story builder currently does with an index it rebuilds
// from scratch on every run.

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

/* ==================================================================== content */

/**
 * One row, id 1. The seed bumps `version` every time it writes, and the client sends the
 * version it already has: an unchanged version means the 4 MB snapshot is not sent again.
 */
export const contentVersion = pgTable('content_version', {
  id: smallint('id').primaryKey().default(1),
  /** Opaque to the client — it only ever compares it for equality. */
  version: text('version').notNull(),
  builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * Where the content standing in these tables came from: 'seed' for a straight load of
   * data/*.json, 'admin' the moment anything is edited through the admin screens.
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
 * `position` on this and the three tables below preserves the order the generated file had.
 *
 * That order is not alphabetical and is not incidental — categories come out largest-first,
 * and the word list is in the order the scrape produced. A table has no inherent order, so
 * without this column the grid would re-arrange itself the first time Postgres felt like
 * returning rows in a different sequence.
 */
export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  position: integer('position').notNull().default(0),
  name: text('name').notNull(),
  nameGeorgian: text('name_georgian').notNull().default(''),
  wordCount: integer('word_count').notNull().default(0),
});

export const words = pgTable(
  'words',
  {
    id: text('id').primaryKey(),
    /** Its place in the generated list. See the note on `categories`. */
    position: integer('position').notNull().default(0),
    georgian: text('georgian').notNull(),
    english: text('english').notNull().default(''),
    georgianDefinition: text('georgian_definition').notNull().default(''),
    /** 'A1' | 'A2' | '' — empty for the vocabulary added by hand, which was never graded. */
    level: text('level').notNull().default(''),
    partOfSpeech: text('part_of_speech').notNull().default(''),
    category: text('category').notNull().default(''),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** 'core' for the scraped A1–A2 dictionary, 'added' for lemmas written by hand. */
    origin: text('origin').notNull().default('core'),
    /** 1-based; null where it is 1. The sense to lead with when nothing pins one. */
    defaultSense: smallint('default_sense'),
    /** The paradigm this headword claims, for the 165 that claim one. */
    verbId: text('verb_id'),
    /** Set when the meaning itself is a guess and wants verifying. */
    needsCheck: boolean('needs_check').notNull().default(false),
    note: text('note'),
  },
  table => [
    index('words_category_idx').on(table.categoryId),
    index('words_georgian_idx').on(table.georgian),
    index('words_verb_idx').on(table.verbId),
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

/** An inflected form known to belong to a headword, and how it differs from it. */
export const wordForms = pgTable(
  'word_forms',
  {
    wordId: text('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    form: text('form').notNull(),
    /** "erg", "dat.pl", "Aorist 3sg". Null for the headword spelling itself. */
    gram: text('gram'),
    /** What this form means where the headword's meaning does not say it: იყო is "was". */
    english: text('english'),
  },
  table => [
    primaryKey({ columns: [table.wordId, table.position] }),
    // The story builder's first index: spelling → the headword it belongs to.
    index('word_forms_form_idx').on(table.form),
  ],
);

/* ------------------------------------------------------------ verb metadata */

// There are no `persons`, `series` or `screeves` tables. Those are the fixed grammar of the
// language rather than data about this dictionary, and they live as constants in
// @georgian/shared/grammar — see the note at the head of that file. `verb_groups` stays a
// table because it is not like them: the conjugation groups come out of the spreadsheet
// with editorial notes attached, and `verb_count` changes whenever the paradigms do.

export const verbGroups = pgTable('verb_groups', {
  id: text('id').primaryKey(),
  /** Its place in the generated list. See the note on `categories`. */
  position: integer('position').notNull().default(0),
  label: text('label').notNull(),
  name: text('name').notNull().default(''),
  notes: jsonb('notes').$type<string[]>().notNull().default([]),
  verbCount: integer('verb_count').notNull().default(0),
});

export const verbs = pgTable(
  'verbs',
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
    groupId: text('group_id').references(() => verbGroups.id, { onDelete: 'set null' }),
    present3sg: text('present_3sg').notNull().default(''),
    url: text('url').notNull().default(''),
    synonymsEnglish: jsonb('synonyms_english').$type<string[]>().notNull().default([]),
    synonymsGeorgian: jsonb('synonyms_georgian').$type<string[]>().notNull().default([]),
  },
  table => [index('verbs_group_idx').on(table.groupId)],
);

/**
 * Every cell of every paradigm — 603 verbs × up to 66 cells, around 44k rows.
 *
 * `screeve` holds a `ScreeveKey` for the eleven proper screeves, plus the literal
 * 'imperative' or 'prohibitive' for the two that are not screeves and have no first person
 * singular. It is plain text with nothing to reference: the set of screeves is a compile-time
 * union in types.ts, not a table.
 */
export const verbForms = pgTable(
  'verb_forms',
  {
    verbId: text('verb_id')
      .notNull()
      .references(() => verbs.id, { onDelete: 'cascade' }),
    screeve: text('screeve').notNull(),
    person: text('person').notNull(),
    form: text('form').notNull(),
  },
  table => [
    primaryKey({ columns: [table.verbId, table.screeve, table.person] }),
    // What makes an inflected form findable: which paradigm does ავაშენებ come from?
    index('verb_forms_form_idx').on(table.form),
  ],
);

/** One verb's morpheme make-up, derived from its paradigm and safe to hand-correct. */
export const verbMorphemes = pgTable('verb_morphemes', {
  verbId: text('verb_id')
    .primaryKey()
    .references(() => verbs.id, { onDelete: 'cascade' }),
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

/* ------------------------------------------------------------------ images */

/**
 * A Wikimedia Commons picture with the attribution its licence requires.
 *
 * `kind` says what `subject_id` names — a words.json id or a category id — so the two
 * generated files share one table rather than being two tables with identical columns.
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

export const stories = pgTable('stories', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  titleEnglish: text('title_english').notNull().default(''),
  /** A CEFR level as plain text: stories are not confined to the A1/A2 word list. */
  level: text('level').notNull().default(''),
  source: text('source').notNull().default(''),
  note: text('note').notNull().default(''),
  /** tokens, distinctForms, covered, coverage, names, unresolved, flagged. */
  stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
  paragraphs: jsonb('paragraphs').$type<string[]>().notNull().default([]),
  /** One entry per Georgian paragraph, in the same order. Empty when untranslated. */
  translation: jsonb('translation').$type<string[]>().notNull().default([]),
});

/**
 * One *occurrence* of a word, not one spelling: the fourth word of the third paragraph is
 * its own row, so აბა can be "let's" in one line and "just try" in another.
 *
 * It carries no meaning of its own — `word_id` and `sense` point into the lexicon, so a
 * corrected definition reaches every story that cites it without any of them being rebuilt.
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
// three additions below, which are ours:
//
//   user.locale — which language to send mail in.
//   user.marketingOptIn — whether we may send anything that is not transactional.
//   user.isAdmin — may edit the dictionary. See the note on the column.

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
 * can be diffed without translating keys. `item` and `side` are stored alongside it rather
 * than derived, because the review queue filters on them.
 */
export const studyCards = pgTable(
  'study_cards',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** `${item}|${side}` — `w:6938|ka`. */
    card: text('card').notNull(),
    /** `w:6938` for a word, `v:abandon-vt` for a bare paradigm. */
    item: text('item').notNull(),
    /** 'ka' | 'en' — recognising მგელი and producing it are two cards off one word. */
    side: text('side').notNull(),

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
    uniqueIndex('study_cards_user_item_side_idx').on(table.userId, table.item, table.side),
  ],
);

/* =================================================================== relations */

export const categoriesRelations = relations(categories, ({ many }) => ({
  words: many(words),
}));

export const wordsRelations = relations(words, ({ many, one }) => ({
  category: one(categories, { fields: [words.categoryId], references: [categories.id] }),
  senses: many(wordSenses),
  forms: many(wordForms),
}));

export const wordSensesRelations = relations(wordSenses, ({ one }) => ({
  word: one(words, { fields: [wordSenses.wordId], references: [words.id] }),
}));

export const wordFormsRelations = relations(wordForms, ({ one }) => ({
  word: one(words, { fields: [wordForms.wordId], references: [words.id] }),
}));

export const verbsRelations = relations(verbs, ({ many, one }) => ({
  group: one(verbGroups, { fields: [verbs.groupId], references: [verbGroups.id] }),
  forms: many(verbForms),
  morphemes: one(verbMorphemes),
}));

export const verbFormsRelations = relations(verbForms, ({ one }) => ({
  verb: one(verbs, { fields: [verbForms.verbId], references: [verbs.id] }),
}));

export const verbMorphemesRelations = relations(verbMorphemes, ({ one }) => ({
  verb: one(verbs, { fields: [verbMorphemes.verbId], references: [verbs.id] }),
}));

export const storiesRelations = relations(stories, ({ many }) => ({
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
