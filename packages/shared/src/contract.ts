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
  Mastery,
  RuVerb,
  Side,
  Story,
  StorySummary,
  StudyCardWire,
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

  /** One story with its text and every token. Null when there is no such story. */
  story: oc.input(z.object({ id: z.string().min(1).max(128) })).output(type<Story | null>()),

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
 * A story, as prose.
 *
 * The text goes up as one string and is cut into paragraphs on the server by the same rule
 * the build script uses on a .txt file — blank lines separate, a lone "-" is a rule and is
 * dropped. Sending pre-split paragraphs instead would let the browser and the server
 * disagree about where a paragraph ends, and the token positions are counted from that.
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
  /** The Georgian, first line the title. Up to a megabyte, which is a long book. */
  text: z.string().max(1_000_000),
  /** The English, one paragraph per Georgian paragraph. Empty when untranslated. */
  translation: z.string().max(1_000_000).default(''),
});

export type StoryInput = z.infer<typeof storyInput>;

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
  /** 0-based index into the story's paragraphs. */
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
  /** Apply to every occurrence of this spelling in this story, not just this one. */
  everywhere: z.boolean().default(false),
});

export type StoryTokenInput = z.infer<typeof storyTokenInput>;

/** What relinking a story reports back: the story itself, and how well it went. */
export interface StoryLinkResult {
  story: Story;
  /** Spellings nothing matched, commonest first — the work list for the lexicon. */
  unresolved: { form: string; count: number }[];
  /** Links reached by a guess, commonest first. These are what `check` marks. */
  flagged: { form: string; count: number }[];
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

  /** Writes the story, then links every word in it. The result says how much it managed. */
  saveStory: oc.input(storyInput).output(type<StoryLinkResult>()),
  deleteStory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<{ version: string }>()),
  /**
   * Runs the resolver over an existing story again, keeping every override.
   *
   * Worth doing after the lexicon changes: a word added today is a link the story could not
   * have made yesterday. It is not automatic, because editing one word would otherwise
   * relink every story that might mention it.
   */
  relinkStory: oc
    .input(z.object({ id: z.string().min(1).max(128) }))
    .output(type<StoryLinkResult>()),

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
        paragraph: z.number().int().min(0).max(10_000),
        position: z.number().int().min(0).max(10_000),
        form: z.string().trim().min(1).max(200),
        /** Undo it for every occurrence of this spelling in the story. */
        everywhere: z.boolean().default(false),
      }),
    )
    .output(type<StoryLinkResult>()),

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

export const contract = {
  content: contentContract,
  study: studyContract,
  session: sessionContract,
  admin: adminContract,
};

export type Contract = typeof contract;
