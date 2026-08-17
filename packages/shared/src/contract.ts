// The contract between the browser and the server: every call there is, and the shape of
// what goes each way. Both ends import this and neither imports the other, so the client
// gets its types without dragging Fastify and Drizzle into the web app's build.
//
// Inputs are Zod schemas because they arrive from the network and have to be checked.
// Outputs are `type<T>()`, which is a type with no runtime validator behind it: the
// snapshot is four megabytes of data this server generated itself, and re-parsing it on
// the way out would cost more than everything else the request does put together.

import { oc, type } from '@orpc/contract';
import { z } from 'zod';
import { LANGS } from './grammar/index.ts';
import type {
  ImageMap,
  KaMorphemeData,
  KaVerb,
  KaVerbGroup,
  Lang,
  Language,
  Lesson,
  LessonCategory,
  LessonImageMap,
  LessonSummary,
  Mastery,
  Quiz,
  QuizAnswer,
  QuizCategory,
  QuizResult,
  QuizSummary,
  RuVerb,
  Side,
  Story,
  StoryCategory,
  StorySummary,
  StudyCardWire,
  Category,
  Word,
  WordData,
} from './types.ts';

/* ---------------------------------------------------------------- content */

/** Every language id, as something the wire can validate against. */
export const LANG = z.enum(LANGS as unknown as [Lang, ...Lang[]]);

/**
 * The Georgian paradigms, as they cross the wire.
 *
 * `persons`, `screeves` and `series` are missing on purpose: they are fixed facts about
 * Georgian, they live as constants in ./grammar/ka.ts, and the client already has them
 * before it makes a single request. Sending them would be sending the client its own source
 * code. The web app puts the two halves back together.
 */
export interface KaVerbContent {
  kind: 'ka';
  source: string;
  groups: KaVerbGroup[];
  verbs: KaVerb[];
  /** Georgian-only, so it hangs off the Georgian payload rather than the snapshot. */
  morphemes: KaMorphemeData;
}

/**
 * The Russian verbs, as they cross the wire — which is to say the *rules*, not the forms.
 *
 * There is no field here holding twenty conjugated forms per verb, and that is the point:
 * `conjugate()` in grammar/ru.ts expands each rule in the browser, and the class definitions
 * it needs are already in the bundle. A dictionary of 500 verbs crosses as 500 short records
 * rather than 10,000 strings.
 */
export interface RuVerbContent {
  kind: 'ru';
  source: string;
  verbs: RuVerb[];
}

/**
 * A discriminated union rather than one shape with everything optional.
 *
 * It means a component that reads `verbs.groups` will not compile until it has established
 * that it is looking at Georgian — which is the guarantee worth having, because the failure
 * it prevents is a Russian verb page silently rendering an empty eleven-screeve grid.
 */
export type VerbContent = KaVerbContent | RuVerbContent;

/** Everything the app needs to render one language, minus the stories' own text. */
export interface ContentSnapshot {
  /** Opaque. The client stores it and sends it back; only equality is ever checked. */
  version: string;
  /** Which dictionary this is. Every id inside it belongs to this language. */
  lang: Lang;
  /**
   * Every language on offer, not just this one — the switcher has to list the others in
   * order to switch to them. The only field here that is not about `lang`.
   */
  languages: Language[];
  words: WordData;
  verbs: VerbContent;
  images: ImageMap;
  categoryImages: ImageMap;
  stories: StorySummary[];
  /**
   * The shelves, in the order they were put in. Sent whole even when empty, because the
   * story editor's category picker has to offer every one of them and the index has to be
   * able to say "there are none yet" rather than "this story has none".
   */
  storyCategories: StoryCategory[];
  /**
   * Every quiz there is, minus its questions — and so minus its answers.
   *
   * In the snapshot rather than behind a call of its own, for the reason the story summaries
   * are: the index has to be drawable, filterable and countable without a round trip, and a
   * few hundred bytes per quiz is nothing beside the dictionary they arrive with. The
   * questions are not here and must not be, which is what `quiz.get` is for.
   */
  quizzes: QuizSummary[];
  quizCategories: QuizCategory[];
  /**
   * Every lesson there is, minus its markup — both reading sections in one list.
   *
   * One field rather than `lessons` and `grammar`, because they are one table and the split is
   * a column on it: the index pages filter this by `section`, and so does the sidebar. Two
   * fields would mean every consumer choosing between them and the day somebody adds a third
   * section being the day a dozen call sites need editing.
   *
   * The bodies are not here, for the reason the quizzes' questions are not: a section of forty
   * lessons would put forty documents in a payload that draws a list of cards. `content.lesson`
   * is what fetches one.
   */
  lessons: LessonSummary[];
  lessonCategories: LessonCategory[];
  /**
   * The size and the alt text of every uploaded picture, keyed by id.
   *
   * Every one, not only the ones some lesson currently draws. Working out which are in use
   * would mean parsing every body twice over to save a few hundred bytes, and a picture pasted
   * into a lesson a second after this snapshot was built would then have no entry — which is
   * exactly the case that produces a layout jump nobody can reproduce.
   */
  lessonImages: LessonImageMap;
}

/**
 * What `content.snapshot` answers.
 *
 * The client sends the version it has cached and gets a few bytes back when nothing has
 * changed, which is the common case for every visit after the first. Versions are per
 * language, so a Russian edit never costs a Georgian learner a re-download.
 */
export type SnapshotResponse =
  | { upToDate: true; lang: Lang; version: string }
  | ({ upToDate: false } & ContentSnapshot);

const contentContract = {
  /** The current version of one language, for a cheap check without the payload. */
  version: oc
    .input(z.object({ lang: LANG }))
    .output(type<{ lang: Lang; version: string }>()),

  snapshot: oc
    .input(z.object({ lang: LANG, known: z.string().optional() }))
    .output(type<SnapshotResponse>()),

  /**
   * One chapter of one story, with its text and every token, and the list of the story's
   * other chapters to navigate by. Null when there is no such story.
   *
   * A chapter past the end is not an error — it answers with the last one. The reader's
   * URL carries a chapter number, and a stale bookmark to chapter 9 of a story now eight
   * long should land on a page rather than on "that story does not exist".
   */
  story: oc
    .input(
      z.object({
        id: z.string().min(1).max(128),
        /** 0-based. Absent is the first. */
        chapter: z.number().int().min(0).max(999).default(0),
      }),
    )
    .output(type<Story | null>()),

  /**
   * One lesson, with its markup. Null when there is no such lesson.
   *
   * Public, as `quiz.get` is and for the same reason: a lesson is content, and the dictionary
   * is readable signed out. A lesson with an empty body is returned rather than treated as
   * missing, so the admin can open the one they are half-way through writing and the page says
   * "nothing in this one yet" rather than "no such lesson" — an empty room, not a wrong address.
   */
  lesson: oc.input(z.object({ id: z.string().min(1).max(128) })).output(type<Lesson | null>()),

  /** The switcher's list, for the shell to draw before any dictionary has loaded. */
  languages: oc.output(type<{ languages: Language[] }>()),
};

/* ------------------------------------------------------------------ study */

/** Who you are, as far as the app is concerned. Null when signed out. */
export interface SessionUser {
  id: string;
  name: string;
  /**
   * Your own address, in full. This is the one place an address is sent to a browser, and it
   * is sent only to the person it belongs to — saying which account you are signed in as is
   * the whole job of the line that shows it. Other people's are masked; see `AdminUser`.
   */
  email: string;
  image: string | null;
  /**
   * May edit the dictionary. The web app hides the admin screens when this is false, which
   * is a courtesy and not the enforcement — every procedure under `admin` checks the
   * session for itself, because a hidden route is one URL away from being a visible one.
   */
  isAdmin: boolean;
}

const MASTERY = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]) satisfies z.ZodType<Mastery>;

const SIDE = z.enum(['target', 'en']) satisfies z.ZodType<Side>;

/**
 * One card on its way up.
 *
 * The bounds are not ceremony. `card` is a key the client makes up, and `interval`, `ease`
 * and `reps` are numbers a modified client could send as anything at all: a card with an
 * interval of 1e308 is a card that never comes round again, which is a quiet way to lose
 * your own vocabulary.
 */
export const studyCardInput = z.object({
  card: z.string().min(3).max(160),
  item: z.string().min(1).max(128),
  side: SIDE,
  lang: LANG,
  level: MASTERY,
  interval: z.number().min(0).max(365),
  ease: z.number().min(1).max(5),
  due: z.number().int(),
  reps: z.number().int().min(0).max(100_000),
  lapses: z.number().int().min(0).max(100_000),
  last: z.number().int(),
  created: z.number().int(),
  introduced: z.enum(['review', 'marked']),
  deleted: z.boolean(),
  updatedAt: z.number().int(),
}) satisfies z.ZodType<StudyCardWire>;

const studyContract = {
  /**
   * This account's cards. `since` asks only for what changed after that instant, which is
   * what every sync after the first one wants.
   */
  pull: oc
    .input(z.object({ since: z.number().int().optional() }))
    .output(type<{ cards: StudyCardWire[]; syncedAt: number }>()),

  /**
   * Cards on their way up. The server keeps whichever copy of a card has the later
   * `updatedAt`, so pushing something stale is a no-op rather than a regression — which is
   * what makes it safe to push the whole local store on first sign-in.
   */
  push: oc
    .input(z.object({ cards: z.array(studyCardInput).max(20_000) }))
    .output(type<{ accepted: number; syncedAt: number }>()),

  /** Forgets everything, on the server. Tombstones rather than deletes, so it syncs down. */
  reset: oc.output(type<{ cleared: number }>()),
};

/* ------------------------------------------------------------------ quizzes */

// Taking a quiz. Three calls, and the split between them is the answer to one question:
// **who may do this without an account?**
//
//   `get`     — anybody. A quiz is content, and the dictionary is readable signed out; a quiz
//               that demanded a sign-up before it would show you a question would be a
//               worse version of the app for the person most likely to be trying it out.
//               It is also what makes an embedded quiz on somebody else's page work at all,
//               since a third-party iframe has no cookie to send.
//   `finish`  — signed in only, and quietly. A signed-out run is marked, scored and explained
//               on screen exactly as any other; the only thing it does not do is leave a
//               record, because there is nobody to leave it against.
//   `results` — signed in only, for the ticks on the index.
//
// The answers travel with `get`. See the note on the `Quiz` type for why that is deliberate
// and what `finish` does about it.

/** One answer, on its way up. The bounds are what stops a run being a way to send us a novel. */
const quizAnswerInput = z.object({
  /** Option positions. A question cannot have more options than this many. */
  picked: z.array(z.number().int().min(0).max(200)).max(200).default([]),
  text: z.string().max(2000).default(''),
}) satisfies z.ZodType<QuizAnswer>;

const quizContract = {
  /**
   * One quiz, with every question and every answer. Null when there is no such quiz.
   *
   * Public, per the note above. A quiz with no questions is still returned rather than
   * treated as missing: the admin is entitled to open the one they are half-way through
   * writing, and the runner says "nothing in this one yet" rather than "no such quiz",
   * which is the difference between an empty room and a wrong address.
   */
  get: oc.input(z.object({ id: z.string().min(1).max(128) })).output(type<Quiz | null>()),

  /**
   * Records how a run went, and hands back what was stored.
   *
   * The answers go up, not the score. The server marks them again with the same `mark()` the
   * browser used — see quiz.ts — so what lands in `quiz_results` is the server's own reading
   * of what was answered rather than a number it was handed. That is not paranoia about
   * cheating so much as it is the only way the record can be trusted to mean anything.
   *
   * Keyed by question position, for the reason given on `mark()`: a shuffled run has no order
   * anything outside it knows.
   */
  finish: oc
    .input(
      z.object({
        quizId: z.string().min(1).max(128),
        answers: z.record(z.string().max(4), quizAnswerInput),
        /**
         * Which questions this run was dealt, by position. Empty means all of them.
         *
         * Only a quiz with an `askCount` deals a subset, and such a run has to say what it got:
         * the server marks the answers again rather than trusting a score, and marking ten
         * answers against a thirty-three question quiz would record a fail for a perfect run.
         * Empty rather than optional so an older client keeps the old meaning exactly.
         */
        asked: z.array(z.number().int().min(0).max(1000)).max(200).default([]),
      }),
    )
    .output(type<{ result: QuizResult }>()),

  /** Every quiz this account has taken, in one language. Empty when signed out. */
  results: oc.input(z.object({ lang: LANG })).output(type<{ results: QuizResult[] }>()),
};

/* ---------------------------------------------------------------- session */

const sessionContract = {
  me: oc.output(type<SessionUser | null>()),
};

/* ------------------------------------------------------------------ admin */

// Editing the dictionary from the browser.
//
// Every procedure below writes to the content tables, which used to be generated-only. Two
// consequences run through the whole block and are worth stating once rather than at each:
//
//   The database is now the source of truth. `npm run db:export` writes it back out to
//   data/*.json so the authoring scripts can still be re-run over it, and `npm run db:seed`
//   refuses to overwrite edited content without --force.
//
//   Every mutation bumps `content_version`. That is the existing cache key — the server's
//   in-memory snapshot is rebuilt on the next request and every browser re-downloads on its
//   next visit — so no invalidation had to be invented for this, and nothing can be edited
//   into a state where some readers see the old dictionary indefinitely.
//
// Nothing here is paginated or searchable, because nothing needs to be: the whole lexicon is
// already in the browser as part of the snapshot, so the admin screens filter the copy they
// have and these calls only ever carry a change.

/** A sense, as the editor sends it. Order is position: the first is sense 1. */
const senseInput = z.string().trim().min(1).max(500);

/** One inflected form under a headword. */
const wordFormInput = z.object({
  form: z.string().trim().min(1).max(120),
  /** "erg", "dat.pl", "gen.sg", "Aorist 3sg". Empty for the headword spelling itself. */
  gram: z.string().trim().max(80).default(''),
  /** What the form itself means, where the headword's meaning does not say it. */
  english: z.string().trim().max(300).default(''),
  /** The form with its stress written in, for Russian. */
  accented: z.string().trim().max(140).default(''),
});

export const wordInput = z.object({
  /**
   * Absent to create. A new lemma is given an id of `w:<headword>`, which is the same
   * convention scripts/lexicon.json has always used for a hand-written entry, so a word
   * added here and one added there are indistinguishable afterwards. A Russian one is
   * minted under `ru-`, which is what keeps the two languages' ids from ever colliding.
   */
  id: z.string().min(1).max(128).optional(),
  lang: LANG,
  /** Unaccented, always. This is what the story resolver and the search box match on. */
  headword: z.string().trim().min(1).max(200),
  /** The headword with its stress written in, for Russian. Display only. */
  accented: z.string().trim().max(200).default(''),
  /** The headline gloss. Filled from the first sense when left blank. */
  english: z.string().trim().max(500).default(''),
  /** The definition in the language being learned. */
  definition: z.string().trim().max(2000).default(''),
  level: z.enum(['A1', 'A2', 'B1', '']).default(''),
  partOfSpeech: z.string().trim().max(60).default(''),
  categoryId: z.string().trim().min(1).max(128),
  /** 1-based. Which sense to lead with where nothing pins one. */
  defaultSense: z.number().int().min(1).max(50).nullable().default(null),
  /** The paradigm this headword claims — a ka_verbs id or a ru_verbs id, per `lang`. */
  verbId: z.string().trim().max(128).nullable().default(null),
  /** The meaning itself is a guess and wants verifying. */
  check: z.boolean().default(false),
  note: z.string().trim().max(2000).nullable().default(null),
  senses: z.array(senseInput).min(1).max(50),
  forms: z.array(wordFormInput).max(400).default([]),
  /** Russian nominal grammar. Ignored, and expected absent, when `lang` is not 'ru'. */
  ru: z
    .object({
      gender: z.enum(['m', 'f', 'n', 'pl', '']).default(''),
      animacy: z.enum(['anim', 'inanim', '']).default(''),
      declension: z.enum(['1', '2', '3', 'indecl', 'adj', '']).default(''),
      stressPattern: z.string().trim().max(4).default(''),
      check: z.boolean().default(false),
    })
    .nullable()
    .default(null),
});

export type WordInput = z.infer<typeof wordInput>;

/**
 * A paradigm's cells: screeve → person → form.
 *
 * Loosely typed on the wire and checked against `SCREEVES`/`PERSONS` on the server rather
 * than pinned as a Zod union of eleven literals crossed with six. The union would be a
 * second copy of grammar.ts that could silently disagree with it, which is the exact thing
 * the note at the head of that file exists to prevent.
 */
const paradigmInput = z.record(z.string().max(40), z.record(z.string().max(10), z.string().trim().max(200)));

export const kaVerbInput = z.object({
  /** Absent to create. A new paradigm's id is slugged from its English. */
  id: z.string().min(1).max(128).optional(),
  english: z.string().trim().min(1).max(300),
  /** Extra senses, each already carrying its own preverb where they differ. */
  senses: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  /** "v.t.", "v.i.", "v.t.i." */
  transitivity: z.string().trim().max(40).default(''),
  verbalNoun: z.string().trim().max(200).default(''),
  groupId: z.string().trim().max(128).nullable().default(null),
  present3sg: z.string().trim().max(200).default(''),
  url: z.string().trim().max(500).default(''),
  synonymsEnglish: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  synonymsGeorgian: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  /** The eleven screeves. A defective paradigm is simply short. */
  forms: paradigmInput.default({}),
  /** Five persons each: you cannot command yourself. */
  imperative: z.record(z.string().max(10), z.string().trim().max(200)).default({}),
  prohibitive: z.record(z.string().max(10), z.string().trim().max(200)).default({}),
});

export type KaVerbInput = z.infer<typeof kaVerbInput>;

/**
 * A Russian verb, as the editor sends it — a rule, not a paradigm.
 *
 * Which is why this is so much shorter than its Georgian counterpart above despite covering
 * more cells: the editor picks a class and types two or three stems, and the twenty-odd
 * forms follow. `overrides` is the escape hatch, and for a regular verb it stays empty.
 *
 * `classId` and the two stress fields are loosely typed here and checked against
 * `RU_CLASSES` on the server rather than pinned as Zod unions, for the same reason
 * `paradigmInput` above is loose: a union of seventeen literals would be a second copy of
 * grammar/ru.ts that could silently disagree with it.
 */
export const ruVerbInput = z.object({
  /** Absent to create. A new verb's id is slugged from its infinitive and aspect. */
  id: z.string().min(1).max(128).optional(),
  infinitive: z.string().trim().min(1).max(120),
  accented: z.string().trim().max(140).default(''),
  english: z.string().trim().min(1).max(300),
  senses: z.array(z.string().trim().min(1).max(300)).max(20).default([]),

  aspect: z.enum(['impf', 'pf']),
  /** The other half of the pair. The server writes the reverse link on the partner too. */
  pairId: z.string().trim().max(128).nullable().default(null),

  classId: z.string().trim().min(1).max(8),
  stemPresent: z.string().trim().max(80).default(''),
  stemPresent1sg: z.string().trim().max(80).nullable().default(null),
  stemImperative: z.string().trim().max(80).nullable().default(null),
  stemPast: z.string().trim().max(80).nullable().default(null),
  stemPastM: z.string().trim().max(80).nullable().default(null),

  stressPresent: z.enum(['stem', 'ending', 'shift']).default('stem'),
  stressPast: z.enum(['stem', 'ending', 'fem']).default('stem'),
  /** Vowel indices, so bounded by the longest plausible word rather than left open. */
  stemStress: z.number().int().min(0).max(12).nullable().default(null),
  stressInfinitive: z.number().int().min(0).max(12).nullable().default(null),

  reflexive: z.boolean().default(false),
  transitivity: z.enum(['tr', 'intr', '']).default(''),
  government: z.array(z.string().trim().min(1).max(8)).max(4).default([]),
  motion: z.enum(['uni', 'multi', '']).default(''),
  level: z.enum(['A1', 'A2', 'B1', '']).default(''),

  /** Slot → form, for the cells the rule cannot reach. Empty for a regular verb. */
  overrides: z.record(z.string().max(30), z.string().trim().max(120)).default({}),
  check: z.boolean().default(false),
  note: z.string().trim().max(2000).nullable().default(null),
});

export type RuVerbInput = z.infer<typeof ruVerbInput>;

/**
 * A story, minus its prose.
 *
 * Everything true of the whole of it and nothing that belongs to a chapter — with one
 * exception, `text` and `translation`, which are accepted *only when creating*. A story of
 * one chapter is still the common case, and making it two round trips ("name it", then
 * "now paste it") to save one optional field would be paying for chapters in the case that
 * does not have any. Once the story exists the prose is edited on the chapter itself, and
 * sending it here is refused rather than quietly ignored.
 */
export const storyInput = z.object({
  /** Absent to create; slugged from the English title, or the one in the target language. */
  id: z.string().trim().max(128).optional(),
  lang: LANG,
  title: z.string().trim().max(300).default(''),
  titleEnglish: z.string().trim().max(300).default(''),
  level: z.string().trim().max(20).default(''),
  source: z.string().trim().max(500).default(''),
  note: z.string().trim().max(2000).default(''),
  /** The shelf to file it on. Null is "not filed", which is a state and not a mistake. */
  categoryId: z.string().trim().max(128).nullable().default(null),
  /** The first chapter's prose, on creation only. Empty to create a story with none yet. */
  text: z.string().max(1_000_000).default(''),
  translation: z.string().max(1_000_000).default(''),
});

export type StoryInput = z.infer<typeof storyInput>;

/**
 * One chapter's prose.
 *
 * The text goes up as one string and is cut into paragraphs on the server by the same rule
 * the build script uses on a .txt file — blank lines separate, a lone "-" is a rule and is
 * dropped. Sending pre-split paragraphs instead would let the browser and the server
 * disagree about where a paragraph ends, and the token positions are counted from that.
 *
 * The first line of `text` is the chapter's title, exactly as the first line of a story's
 * .txt has always been the story's. A story of one chapter usually wants no title at all,
 * which is what `titled` is for: without it there would be no way to say "this whole text
 * is prose", and the opening sentence would be eaten as a heading.
 */
export const storyChapterInput = z.object({
  storyId: z.string().min(1).max(128),
  /** Absent to append. 0-based, and an existing position is the chapter it replaces. */
  position: z.number().int().min(0).max(999).optional(),
  /** Whether to read the first line of the text as a heading. */
  titled: z.boolean().default(true),
  /** Overrides the first line where it is set. */
  title: z.string().trim().max(300).default(''),
  titleEnglish: z.string().trim().max(300).default(''),
  /** Up to a megabyte, which is a long chapter. */
  text: z.string().max(1_000_000),
  /** The English, one paragraph per paragraph of `text`. Empty when untranslated. */
  translation: z.string().max(1_000_000).default(''),
});

export type StoryChapterInput = z.infer<typeof storyChapterInput>;

/** A shelf to file stories on. Hand-made, unlike a word's category. */
export const storyCategoryInput = z.object({
  /** Absent to create; slugged from the name. */
  id: z.string().trim().max(128).optional(),
  lang: LANG,
  name: z.string().trim().min(1).max(120),
  nameNative: z.string().trim().max(120).default(''),
  note: z.string().trim().max(2000).default(''),
});

export type StoryCategoryInput = z.infer<typeof storyCategoryInput>;

/**
 * One hand-made decision about one occurrence in one story.
 *
 * There is no separate overrides table: `story_tokens.via` already tells a row a person
 * decided from a row the resolver worked out, and relinking keeps the first kind. So an
 * override *is* a token — this writes one, marked `name` or `override`, and the next relink
 * leaves it alone. See the note on that column.
 *
 * The three things this can say map onto the three the offline pipeline has always had in
 * scripts/storyOverrides.json:
 *
 *   a name          — `name` set. A proper noun, glossed here and deliberately kept out of
 *                     the dictionary. Scoped to this story, which is the whole point.
 *   a word          — `wordId` and `sense` set. This occurrence reads as that entry.
 *   plain text      — all three null. Deliberately not a dictionary word, which is a
 *                     different claim from the resolver having failed to find one.
 *
 * `everywhere` is the fourth: it applies the same decision to every occurrence of this
 * spelling in this story, which is the `forms` block of the overrides file. Without it the
 * decision pins this occurrence alone, which is the `at` block — და is the conjunction all
 * through this story, but აბა means something different in two different lines.
 */
export const storyTokenInput = z.object({
  storyId: z.string().min(1).max(128),
  /** 0-based index into the story's chapters. */
  chapter: z.number().int().min(0).max(999).default(0),
  /** 0-based index into that chapter's paragraphs. */
  paragraph: z.number().int().min(0).max(10_000),
  /** 0-based position among the words of that paragraph, in reading order. */
  position: z.number().int().min(0).max(10_000),
  /**
   * The spelling as the editor saw it. Checked against the stored token before anything is
   * written: if the prose has been edited since the screen was opened, the position now
   * names a different word, and pinning a meaning onto it would be worse than refusing.
   */
  form: z.string().trim().min(1).max(200),
  /** The lexicon entry this reads as, or null for a name or for plain text. */
  wordId: z.string().trim().max(128).nullable().default(null),
  /** 1-based index into that entry's senses. */
  sense: z.number().int().min(1).max(50).nullable().default(null),
  /** How the form differs from the headword: "erg", "dat.pl", "Aorist 3sg". */
  gram: z.string().trim().max(80).default(''),
  /** The gloss, when this is a proper noun rather than a dictionary word. */
  name: z.string().trim().max(300).nullable().default(null),
  /** Why, for whoever reads this in a year. Carried onto every occurrence it applies to. */
  comment: z.string().trim().max(1000).nullable().default(null),
  /**
   * Mark this as a guess worth a second look.
   *
   * The resolver sets the same flag on its own uncertain links, and a hand-made one can be
   * just as uncertain — pinning a word is often "this is probably it, come back to it". So
   * the flag is settable here rather than being cleared by the act of deciding: otherwise
   * the only way to record a doubt would be to leave the wrong link in place.
   */
  check: z.boolean().default(false),
  /**
   * Apply to every occurrence of this spelling in this story, not just this one.
   *
   * The whole story, every chapter — not the chapter it was decided in. და is the
   * conjunction from the first page to the last, and a decision that stopped at a chapter
   * boundary would have to be made again on the next one for no reason anybody could name.
   */
  everywhere: z.boolean().default(false),
});

export type StoryTokenInput = z.infer<typeof storyTokenInput>;

/**
 * What linking reports back: the story itself, and how well it went.
 *
 * `story` is opened at whichever chapter the edit touched, so the screen that asked for the
 * write can repaint from this one answer. The two lists are the chapters that were linked —
 * one of them for a chapter save, all of them for a relink.
 */
export interface StoryLinkResult {
  story: Story;
  /** Spellings nothing matched, commonest first — the work list for the lexicon. */
  unresolved: { form: string; count: number }[];
  /** Links reached by a guess, commonest first. These are what `check` marks. */
  flagged: { form: string; count: number }[];
}

/* -- the quizzes -- */

/** A shelf to file quizzes on. The same three fields a story category has. */
export const quizCategoryInput = z.object({
  /** Absent to create; slugged from the name. */
  id: z.string().trim().max(128).optional(),
  lang: LANG,
  name: z.string().trim().min(1).max(120),
  nameNative: z.string().trim().max(120).default(''),
  note: z.string().trim().max(2000).default(''),
});

export type QuizCategoryInput = z.infer<typeof quizCategoryInput>;

/** Where one prompt or one option gets its sound. Empty `say` and null `clipId` means silent. */
const quizAudioInput = z.object({
  /** What a voice should read out. Synthesised through the same cache the stories use. */
  say: z.string().trim().max(500).default(''),
  /** An uploaded clip, which wins over `say`. A `quiz_audio` id, from `admin.uploadQuizAudio`. */
  clipId: z.string().trim().max(64).nullable().default(null),
});

const quizChoiceInput = z.object({
  text: z.string().trim().max(500).default(''),
  /** For `order`, this also fixes where the word goes: the correct ones are in answer order. */
  correct: z.boolean().default(false),
  audio: quizAudioInput.default({ say: '', clipId: null }),
});

const quizQuestionInput = z.object({
  /**
   * Loose here and checked against `QUIZ_KINDS` on the server, for the reason `paradigmInput`
   * is loose: a Zod union of three literals would be a second copy of a set that already
   * exists in types.ts, and the two could drift.
   */
  kind: z.string().trim().min(1).max(20),
  prompt: z.string().trim().max(1000).default(''),
  promptNative: z.string().trim().max(1000).default(''),
  audio: quizAudioInput.default({ say: '', clipId: null }),
  multiple: z.boolean().default(false),
  answers: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  hint: z.string().trim().max(1000).default(''),
  explanation: z.string().trim().max(2000).default(''),
  /** The options, or the word bank. Position is order: the first entry is option 0. */
  choices: z.array(quizChoiceInput).max(50).default([]),
});

/**
 * A whole quiz, questions and all, in one call.
 *
 * Sent whole rather than a question at a time, and this is the one place these screens differ
 * from the story editor — which saves a chapter at a time because a chapter is a megabyte of
 * prose that has to be re-tokenised and re-linked against the lexicon. A quiz is a few
 * kilobytes and nothing downstream is derived from it, so the whole of it fits in one request
 * and one transaction. What that buys is worth more than the bytes: reordering questions,
 * deleting one from the middle and editing another are one save rather than three calls that
 * can half-succeed, and there is no state in which the questions and their options disagree
 * about how many there are.
 */
export const quizInput = z.object({
  /** Absent to create; slugged from the English title. */
  id: z.string().trim().max(128).optional(),
  lang: LANG,
  title: z.string().trim().min(1).max(300),
  titleNative: z.string().trim().max(300).default(''),
  description: z.string().trim().max(2000).default(''),
  level: z.string().trim().max(20).default(''),
  /** The shelf to file it on. Null is "not filed", which is a state and not a mistake. */
  categoryId: z.string().trim().max(128).nullable().default(null),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  /** 0 asks every question. Not bounded above by the pool — see `quizzes.ask_count`. */
  askCount: z.number().int().min(0).max(200).default(0),
  passMark: z.number().int().min(0).max(100).default(70),
  note: z.string().trim().max(2000).default(''),
  /** In order. A quiz may be saved with none, which is how one gets written over two sittings. */
  questions: z.array(quizQuestionInput).max(200).default([]),
});

export type QuizInput = z.infer<typeof quizInput>;

/* -- the lessons -- */

/** Which of the two sections a lesson or a shelf belongs to. See `LessonSection`. */
const SECTION = z.enum(['lessons', 'grammar']);

/**
 * A whole lesson, body and all, in one call.
 *
 * One request rather than a field at a time, and unlike the story editor — which saves a
 * chapter at a time because a chapter is a megabyte of prose that has to be re-tokenised and
 * re-linked against the lexicon. A lesson body is markup that nothing downstream is derived
 * from: it is parsed to draw a page and parsed again to answer "what does block four say", and
 * both happen on the way out rather than on the way in. So the whole of it fits in one request,
 * and there is no state in which the title and the body disagree about which lesson they are.
 *
 * A megabyte is the cap, as a chapter's is. That is a very long lesson and a very short novel.
 */
export const lessonInput = z.object({
  /** Absent to create; slugged from the English title. */
  id: z.string().trim().max(128).optional(),
  lang: LANG,
  section: SECTION,
  title: z.string().trim().min(1).max(300),
  titleNative: z.string().trim().max(300).default(''),
  /** One line for the card. The opening paragraph stands in when it is empty. */
  summary: z.string().trim().max(1000).default(''),
  level: z.string().trim().max(20).default(''),
  /** The shelf to file it on. Null is "not filed", which is a state and not a mistake. */
  categoryId: z.string().trim().max(128).nullable().default(null),
  /**
   * The markup. Not trimmed and not validated beyond its length: the parser accepts anything
   * and reports what it could not make sense of, so a body saved half-written is an ordinary
   * state rather than a rejected save. See `LessonWarning`.
   */
  body: z.string().max(1_000_000).default(''),
  note: z.string().trim().max(2000).default(''),
});

export type LessonInput = z.infer<typeof lessonInput>;

/** A shelf to file lessons on. A quiz shelf's three fields, and the section it belongs to. */
export const lessonCategoryInput = z.object({
  /** Absent to create; slugged from the name. */
  id: z.string().trim().max(128).optional(),
  lang: LANG,
  section: SECTION,
  name: z.string().trim().min(1).max(120),
  nameNative: z.string().trim().max(120).default(''),
  note: z.string().trim().max(2000).default(''),
});

export type LessonCategoryInput = z.infer<typeof lessonCategoryInput>;

/**
 * An uploaded picture or recording, as the editor lists it.
 *
 * The bytes never cross oRPC: an upload is a plain POST of the file to /api/lesson/media and
 * drawing one is an ordinary URL, for the same reasons the quiz audio is plain Fastify. This is
 * the index over them, so the editor can offer something already uploaded rather than uploading
 * it twice.
 */
export interface LessonMediaFile {
  id: string;
  lang: Lang;
  /** 'image' | 'audio'. */
  kind: string;
  mime: string;
  bytes: number;
  name: string;
  /** Pixels. Zero for a recording, and for a picture whose header could not be read. */
  width: number;
  height: number;
  alt: string;
  /** Epoch ms. */
  createdAt: number;
  /**
   * How many lesson bodies mention this id. Zero means nothing would miss it.
   *
   * Counted by looking in the *text* of every body rather than by following a foreign key,
   * because a lesson names what it uses in its markup and there is no key to follow. See the
   * note on the `lesson_media` table.
   */
  uses: number;
}

/** An uploaded clip, as the editor lists it. The bytes never cross this wire; see `uploadUrl`. */
export interface QuizAudioClip {
  id: string;
  lang: Lang;
  mime: string;
  bytes: number;
  name: string;
  /** Epoch ms. */
  createdAt: number;
  /** How many questions and options play it. Zero means nothing would miss it. */
  uses: number;
}

/**
 * One account, for the admin user list — the only place in this app where you see anybody
 * but yourself.
 *
 * **There is no email field, not even a masked one.** Somebody else's address is not
 * something this app shows, and the way to guarantee that is for the server never to put it
 * in the response: a field that is absent cannot be leaked by a screen that forgets to hide
 * it, read out of the network tab, or logged by something downstream. `listUsers` does not
 * select the column.
 *
 * Which leaves the username to tell accounts apart, and `createdAt` behind it for the case
 * where two people picked the same one — names are not unique here, only addresses are, and
 * addresses are exactly what is not on offer.
 */
export interface AdminUser {
  id: string;
  name: string;
  image: string | null;
  isAdmin: boolean;
  /** Epoch ms. Shown as a join date, which is what distinguishes two identical usernames. */
  createdAt: number;
}

const adminContract = {
  /* -- the lexicon -- */

  saveWord: oc.input(wordInput).output(type<{ id: string; version: string }>()),
  deleteWord: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),

  /* -- the paradigms -- */

  // Two procedures rather than one taking a `lang`, because the two carry genuinely
  // different payloads: one is 66 cells and the other is a rule. A single procedure would
  // have to accept a union and re-narrow it server-side, which is the same work with the
  // type safety taken out.

  saveKaVerb: oc.input(kaVerbInput).output(type<{ id: string; version: string }>()),
  saveRuVerb: oc.input(ruVerbInput).output(type<{ id: string; version: string }>()),
  deleteVerb: oc
    .input(z.object({ lang: LANG, id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),

  /* -- the stories -- */

  /**
   * Writes the story's own fields, and its first chapter where prose was sent with them.
   *
   * `report` is null when none was — creating a story and uploading its chapters are two
   * jobs, and only the second has anything to report about linking.
   */
  saveStory: oc
    .input(storyInput)
    .output(type<{ id: string; version: string; report: StoryLinkResult | null }>()),
  deleteStory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),
  /**
   * Runs the resolver over an existing story again, keeping every override.
   *
   * Every chapter of it: the lexicon changed, and it changed for all of them. Worth doing
   * after that happens — a word added today is a link the story could not have made
   * yesterday. It is not automatic, because editing one word would otherwise relink every
   * story that might mention it.
   */
  relinkStory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<StoryLinkResult>()),

  /* -- the chapters -- */

  /**
   * Writes one chapter's prose and links every word in it, leaving the others alone.
   *
   * Appends when `position` is absent and replaces the chapter standing there when it is
   * not. Replacing keeps the hand-made tokens the new prose still agrees with, by the same
   * rule that has always governed re-saving a story's text: a pin is matched back by
   * position *and* spelling, so an edit that moves the words drops the pins it moved
   * rather than sliding them onto whatever now stands there.
   */
  saveChapter: oc.input(storyChapterInput).output(type<StoryLinkResult>()),
  /** Removes a chapter and closes the gap, so the ones after it move up by one. */
  deleteChapter: oc
    .input(z.object({ storyId: z.string().min(1).max(128), position: z.number().int().min(0).max(999) }))
    .output(type<{ version: string }>()),
  /**
   * Swaps a chapter with its neighbour.
   *
   * Up and down rather than "move to index n": reordering a book is done a step at a time by
   * somebody looking at the list, and a position taken from a stale list is a chapter landing
   * somewhere nobody pointed at.
   */
  moveChapter: oc
    .input(
      z.object({
        storyId: z.string().min(1).max(128),
        position: z.number().int().min(0).max(999),
        direction: z.enum(['up', 'down']),
      }),
    )
    .output(type<{ version: string }>()),

  /* -- the shelves stories are filed on -- */

  saveStoryCategory: oc.input(storyCategoryInput).output(type<{ id: string; version: string }>()),
  /**
   * Deletes a category. The stories in it are not deleted — they come off the shelf and go
   * back to being unfiled, which is why this needs no "are you sure it is empty" check.
   */
  deleteStoryCategory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),

  /**
   * Pins one occurrence — to a word and sense, to a name, or to plain text — and hands the
   * whole story back so the reader repaints from one answer rather than patching in place.
   */
  setStoryToken: oc.input(storyTokenInput).output(type<StoryLinkResult>()),
  /**
   * Undoes a pin: the occurrence goes back to whatever the resolver makes of it, which may
   * well be nothing. Distinct from pinning it to plain text, which is a decision.
   */
  resetStoryToken: oc
    .input(
      z.object({
        storyId: z.string().min(1).max(128),
        chapter: z.number().int().min(0).max(999).default(0),
        paragraph: z.number().int().min(0).max(10_000),
        position: z.number().int().min(0).max(10_000),
        form: z.string().trim().min(1).max(200),
        /** Undo it for every occurrence of this spelling in the story. */
        everywhere: z.boolean().default(false),
      }),
    )
    .output(type<StoryLinkResult>()),

  /* -- the quizzes -- */

  /** Writes a quiz and every question in it, replacing whatever it held before. */
  saveQuiz: oc.input(quizInput).output(type<{ id: string; version: string }>()),
  /**
   * Deletes a quiz, its questions and everybody's record of having taken it.
   *
   * The results go because they are about *this* quiz — a pass at a quiz that no longer
   * exists is not a fact anybody can act on — which is why `quiz_results` cascades from it
   * rather than being protected the way a story's tokens are. Uploaded clips do not go: they
   * are content in their own right and may be used by another quiz. See `quizAudio`.
   */
  deleteQuiz: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),

  saveQuizCategory: oc.input(quizCategoryInput).output(type<{ id: string; version: string }>()),
  /** Deletes a shelf. The quizzes on it are unfiled, not deleted — as a story shelf's are. */
  deleteQuizCategory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),

  /**
   * Every uploaded clip, with a count of what plays it.
   *
   * The bytes are not here and never cross oRPC: an upload is a plain POST of the file to
   * /api/quiz/audio and playback is an ordinary URL, for the same reasons the story audio is
   * plain Fastify. This is only the index over them, so the editor can offer a clip that has
   * already been uploaded instead of uploading it twice.
   */
  quizAudio: oc.output(type<{ clips: QuizAudioClip[] }>()),
  /**
   * Deletes a clip and its file.
   *
   * Refused while anything still plays it, with a count — the foreign key is `set null`, so
   * this would otherwise succeed and quietly leave a listening question with nothing to hear
   * and no indication that there ever was.
   */
  deleteQuizAudio: oc
    .input(z.object({ id: z.string().min(1).max(64) }))
    .output(type<{ clips: QuizAudioClip[] }>()),

  /* -- the lessons -- */

  /**
   * Writes a lesson and its markup, replacing whatever it held before.
   *
   * The two lists coming back are what a foreign key would otherwise have said. A body names
   * the quizzes and the pictures it uses in its text — see the note on the `lessons` table — so
   * nothing can refuse a save that names one which is not there, and a mistyped id would
   * otherwise become a hole in the page nobody notices until a reader reports it. The save
   * still succeeds: writing a lesson around a quiz you have not made yet is an ordinary way to
   * work, and this is the editor being told, not the server declining.
   */
  saveLesson: oc.input(lessonInput).output(
    type<{
      id: string;
      version: string;
      /** Quiz ids the body embeds that no quiz answers to. */
      unknownQuizzes: string[];
      /** Picture and recording ids the body names that no upload answers to. */
      unknownMedia: string[];
    }>(),
  ),
  /**
   * Deletes a lesson.
   *
   * Nothing is refused, and nothing cascades: a lesson owns no rows. What it *names* — an
   * embedded quiz, an uploaded picture — belongs to somebody else and stays exactly where it
   * was, which is why deleting the last lesson that used a picture does not delete the picture.
   */
  deleteLesson: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),
  /**
   * Swaps a lesson with its neighbour on the same shelf.
   *
   * Up and down rather than "move to index n", for the reason `moveChapter` is: a course is
   * reordered a step at a time by somebody looking at the list, and a position taken from a
   * stale list is a lesson landing somewhere nobody pointed at. Its neighbour is the next
   * lesson in the same section *and* the same category, because that is the list on screen —
   * swapping with something on another shelf would move it out of sight.
   */
  moveLesson: oc
    .input(z.object({ id: z.string().min(1).max(128), direction: z.enum(['up', 'down']) }))
    .output(type<{ version: string }>()),

  saveLessonCategory: oc.input(lessonCategoryInput).output(type<{ id: string; version: string }>()),
  /** Deletes a shelf. The lessons on it are unfiled, not deleted — as a quiz shelf's are. */
  deleteLessonCategory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),

  /** Every uploaded picture and recording, with a count of the lessons that name each. */
  lessonMedia: oc.output(type<{ files: LessonMediaFile[] }>()),
  /**
   * Renames a file or gives it alt text. The bytes are untouched and cannot be replaced —
   * a different picture is a different upload, which is what keeps a URL meaning one thing.
   */
  updateLessonMedia: oc
    .input(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().trim().max(200),
        alt: z.string().trim().max(500),
      }),
    )
    .output(type<{ files: LessonMediaFile[] }>()),
  /**
   * Deletes a file and its bytes.
   *
   * Refused while any lesson body still mentions it, with a count — nothing would stop this
   * otherwise, because the reference is text rather than a key, and the result would be a
   * lesson with a broken picture in it and no indication of when that happened.
   */
  deleteLessonMedia: oc
    .input(z.object({ id: z.string().min(1).max(64) }))
    .output(type<{ files: LessonMediaFile[] }>()),

  /* -- who else may do all this -- */

  users: oc.output(type<{ users: AdminUser[] }>()),
  /**
   * Grants or revokes admin.
   *
   * The server refuses to let an admin revoke themselves, and refuses to remove the last
   * one — an installation with no admins can only be repaired from a shell on the host.
   */
  setAdmin: oc
    .input(z.object({ userId: z.string().min(1).max(128), isAdmin: z.boolean() }))
    .output(type<{ users: AdminUser[] }>()),
};

/* ------------------------------------------------------------------ library */

// A reader's own content: stories they pasted in and words they added, private to them.
//
// This namespace is `admin` with the authority taken out and the ownership put in. The two
// look alike because a story has the same shape either way; what differs is who the write is
// for, and that has to be visible at the call site. `admin.saveStory` publishes. This one does
// not and cannot be made to: every procedure below is scoped to the caller's own rows by the
// server, never by anything sent from the browser.
//
// Three things follow from "private":
//
//   **None of it is in the snapshot.** That object is assembled once per language and shared
//   by every visitor and every cache. A row that varied per person would make the whole of it
//   vary per person, and cost every reader the dictionary again on every sign-in. So `mine` is
//   a second, small payload the browser lays over the first.
//
//   **Every mutation answers with the whole overlay**, not with the row that changed. It is a
//   few kilobytes, the browser's copy cannot drift from the server's, and adding a word
//   updates the search index, the category card and the deck in one assignment. The snapshot
//   works the same way; see `refreshContent`.
//
//   **Nothing here bumps the content version.** An edit to your own library must not
//   invalidate the shared snapshot, or one person adding a word would make every other reader
//   re-download the dictionary.

/**
 * One person's private content in one language: the whole overlay.
 *
 * `words` carries full entries rather than summaries, unlike the stories. A private vocabulary
 * is tens of entries where the dictionary has tens of thousands, and everything that reads the
 * lexicon (the search box, the deck, the category grid) wants whole `Word` objects. Splitting
 * them would buy nothing and leave two ways of holding a word.
 */
export interface PrivateContent {
  lang: Lang;
  /** Your own stories, in the order they were made. Prose is fetched per chapter as ever. */
  stories: StorySummary[];
  words: Word[];
  /** Shelves of your own. Made on demand, so there are none until you have added a word. */
  categories: Category[];
}

/**
 * A story of your own.
 *
 * `storyInput` minus the shelf. The shelves belong to the dictionary, and one person's own
 * story appearing on "Folk tales" for them alone would make that shelf mean two things to two
 * people. See the note on `stories.owner_id`.
 */
export const myStoryInput = storyInput.omit({ categoryId: true });

export type MyStoryInput = z.infer<typeof myStoryInput>;

/**
 * A word of your own.
 *
 * `wordInput` with the category made optional, which is the only field that changes meaning:
 * an admin files a word on a shelf that already exists, and a reader adding their first word
 * has no shelf at all. Empty means "my words", which the server makes on demand.
 */
export const myWordInput = wordInput.extend({
  /** A shelf of your own or one of the dictionary's. Empty for "My words", made on demand. */
  categoryId: z.string().trim().max(128).default(''),
});

export type MyWordInput = z.infer<typeof myWordInput>;

const libraryContract = {
  /**
   * Everything of yours in one language. Empty for a signed-out visitor rather than a refusal:
   * the app asks once at boot, before it knows whether anybody is signed in, and "you have no
   * private content" is the true answer for somebody who has no account.
   */
  mine: oc.input(z.object({ lang: LANG })).output(type<PrivateContent>()),

  /**
   * Writes a story of your own, and its first chapter where prose came with it.
   *
   * The same one-shot creation `admin.saveStory` allows, for the same reason: pasting a text in
   * is the ordinary way one of these begins, and making it two screens would charge every short
   * story for a feature only a book uses.
   */
  saveStory: oc
    .input(myStoryInput)
    .output(type<{ id: string; report: StoryLinkResult | null; content: PrivateContent }>()),

  /** Deletes a story of yours, with its chapters and every link in them. */
  deleteStory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ content: PrivateContent }>()),

  /**
   * Takes a copy of a published story into your own library.
   *
   * This is the answer to "why can I not edit this one". The copy carries the prose, the
   * translation and every link already worked out for it, hand-made ones included, so it opens
   * as good as the original instead of as an unlinked wall of text. It is a copy rather than a
   * reference: corrections to the original afterwards do not reach it, which is the point of
   * having taken one.
   */
  copyStory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ id: string; content: PrivateContent }>()),

  /**
   * Runs the resolver over one of your stories again, keeping the decisions you pinned.
   *
   * Worth doing after adding words. A word added today is a link the story could not have made
   * yesterday, and this is what goes back and makes it.
   */
  relinkStory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ result: StoryLinkResult; content: PrivateContent }>()),

  saveChapter: oc
    .input(storyChapterInput)
    .output(type<{ result: StoryLinkResult; content: PrivateContent }>()),
  deleteChapter: oc
    .input(z.object({ storyId: z.string().min(1).max(128), position: z.number().int().min(0).max(999) }))
    .output(type<{ content: PrivateContent }>()),
  moveChapter: oc
    .input(
      z.object({
        storyId: z.string().min(1).max(128),
        position: z.number().int().min(0).max(999),
        direction: z.enum(['up', 'down']),
      }),
    )
    .output(type<{ content: PrivateContent }>()),

  /**
   * One occurrence in one of your stories, decided by hand.
   *
   * The reader's own version of `admin.setStoryToken`, making the same three claims: this is
   * that entry, this is a name, this is not a dictionary word at all. It is here because the
   * resolver works against a dictionary that does not have your vocabulary in it yet, so a
   * private story shows far more guesses than a published one.
   */
  setStoryToken: oc
    .input(storyTokenInput)
    .output(type<{ result: StoryLinkResult; content: PrivateContent }>()),
  /** Undoes one, and works the token out again from the lexicon as it now stands. */
  resetStoryToken: oc
    .input(
      z.object({
        storyId: z.string().min(1).max(128),
        chapter: z.number().int().min(0).max(999).default(0),
        paragraph: z.number().int().min(0).max(10_000),
        position: z.number().int().min(0).max(10_000),
        form: z.string().trim().min(1).max(200),
        everywhere: z.boolean().default(false),
      }),
    )
    .output(type<{ result: StoryLinkResult; content: PrivateContent }>()),

  /**
   * Writes an entry of your own, with its senses and its inflected forms.
   *
   * The forms are the half that earns its keep. An entry with `მგელს` listed under it is one
   * the resolver will find in your own prose, which is the reason for adding it: you met a
   * word, you wrote it down, and the next text you paste in finds it.
   */
  saveWord: oc.input(myWordInput).output(type<{ id: string; content: PrivateContent }>()),
  /**
   * Deletes one of your entries.
   *
   * Unlike `admin.deleteWord` this is never refused. Your stories' tokens point at it through a
   * key that clears itself, so those words go back to being plain text, which is where they
   * came from. Adding the entry again and relinking brings them back.
   */
  deleteWord: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ content: PrivateContent }>()),

  /** Renames a shelf of yours, or makes one. */
  saveCategory: oc
    .input(
      z.object({
        id: z.string().trim().max(128).optional(),
        lang: LANG,
        name: z.string().trim().min(1).max(120),
        nameNative: z.string().trim().max(120).default(''),
      }),
    )
    .output(type<{ id: string; content: PrivateContent }>()),
  /**
   * Deletes a shelf of yours. Refused while it still holds words, which is the opposite of what
   * deleting a story shelf does. A word must be filed somewhere, so there is nowhere for them
   * to fall back to. Move them first.
   */
  deleteCategory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ content: PrivateContent }>()),
};

export const contract = {
  content: contentContract,
  study: studyContract,
  quiz: quizContract,
  session: sessionContract,
  library: libraryContract,
  admin: adminContract,
};

export type Contract = typeof contract;
