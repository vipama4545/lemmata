// The shapes of the generated data files under data/. They are written by hand rather than
// inferred, because the JSON is far too big for TypeScript to usefully infer from and
// because the inferred type would describe *this* build of the data rather than the contract
// the build scripts promise.
//
// The file is in three parts, and the division is the same one the schema makes:
//
//   the spine      — words, senses, forms, categories, images, stories. One shape for every
//                    language, distinguished by `lang`. A Russian noun's six cases go in
//                    `WordForm.gram` exactly as a Georgian one's cases do.
//   Georgian only  — `Ka*`. Eleven screeves by six persons, and every cell stored.
//   Russian only   — `Ru*`. An aspect pair, a Zaliznyak class, and a *rule* rather than a
//                    stored paradigm. See the head of grammar/ru.ts for why the two verb
//                    models are not made to share anything.
//
// Anything asserted here was checked against the data: every Georgian screeve table holds all
// six persons, the imperative and prohibitive hold five (you cannot command yourself), and
// the only CEFR levels in the Georgian word list are A1 and A2.

import type { Lang } from './grammar/index.ts';

export type { Lang };

/* ==================================================================== spine */

/** The CEFR levels the scraped Georgian word list covers. Russian is graded A1–B1. */
export type Level = 'A1' | 'A2' | 'B1';

/** A level, or the "All" setting every level filter in the UI starts on. */
export type LevelFilter = Level | 'all';

/** One meaning of a word. The id is what a story token cites to say which one applies. */
export interface Sense {
  /** `<word id>.<1-based position>` — stable as long as senses are only appended. */
  id: string;
  english: string;
}

/**
 * An inflected form known to belong to a headword, and how it differs from it.
 *
 * This is the one shape that carries the whole of both languages' nominal morphology without
 * being told which it is looking at. `gram` is "erg" or "dat.pl" for Georgian and "gen.sg"
 * or "pre.pl" for Russian, and the form index the story resolver builds does not care.
 */
export interface WordForm {
  form: string;
  /** "erg", "dat.pl", "gen.sg", "Aorist 3sg". Absent for the headword spelling itself. */
  gram?: string;
  /**
   * What this form means in English, where the headword's meaning does not say it: იყო is
   * "was", not "is". Absent for the case forms of a nominal, where the meaning is the
   * headword's and the grammatical label carries the rest.
   */
  english?: string;
  /**
   * The form with its stress written in, for Russian. `form` itself stays unaccented,
   * because that is what a reader types and what stands in a story — see the note on
   * `Word.accented`.
   */
  accented?: string;
}

/** One of the languages this dictionary covers, as the switcher lists it. */
export interface Language {
  id: Lang;
  name: string;
  /** What the language calls itself: ქართული, Русский. */
  nativeName: string;
  /** 'geor' | 'cyrl'. Picks the font stack, and nothing else. */
  script: string;
  enabled: boolean;
}

export interface Category {
  id: string;
  lang: Lang;
  name: string;
  /** The category's name in the language being learned. */
  nameNative: string;
  wordCount: number;
  /**
   * Set on a shelf of your own, absent on the dictionary's. See `Word.mine` for why it is
   * optional rather than a boolean that is always present.
   */
  mine?: boolean;
}

export interface Word {
  id: string;
  lang: Lang;
  /**
   * The headword, in the language being learned. Unaccented for Russian: this is the string
   * the story resolver matches against and the one a reader would type into the search box,
   * and де́лать matches neither.
   */
  headword: string;
  /** The headword with its stress marked, for Russian. Display only. */
  accented?: string;
  english: string;
  /** Every sense as plain text — the same list as `senses`, for the older screens. */
  englishFull: string[];
  /** The definition in the language being learned, where the source had one. */
  definition: string;
  /** Empty for the vocabulary added by hand, which was never graded. */
  level: Level | '';
  /** "Noun", "Verb", "Adjective"… — see the POS tagging convention in scripts/. */
  partOfSpeech: string;
  category: string;
  categoryId: string;
  /**
   * "core" for the scraped A1–A2 dictionary, "wiktionary" for the common words imported
   * from English Wiktionary, "added" for lemmas written by hand.
   */
  origin: 'core' | 'wiktionary' | 'added';
  /** Always at least one. A story token names the one that applies where it stands. */
  senses: Sense[];
  /**
   * 1-based, and absent when it is 1. The sense to lead with where nothing pins one — a
   * fact about the word rather than about any story, for the entries whose commonest
   * meaning is not the one the scrape happened to list first.
   */
  defaultSense?: number;
  /**
   * The paradigm this headword claims: a `ka_verbs` id for a Georgian entry and a `ru_verbs`
   * id for a Russian one. Deliberately not a foreign key — which table it points into
   * follows from `lang`, and a single column cannot reference two.
   */
  verbId?: string;
  /** Inflected forms confirmed to belong here — the story builder's first index. */
  forms?: WordForm[];
  /** Set when the meaning itself is a guess and wants verifying. */
  check?: boolean;
  note?: string;
  /** Russian nominal grammar. Absent for every Georgian entry and for Russian verbs. */
  ru?: RuWordGrammar;
  /**
   * An entry of your own rather than the dictionary's: yours to edit, and nobody else's to see.
   *
   * Optional, and absent rather than false on a published entry. The snapshot is cached in the
   * browser between visits, so a field that had to be present on all 30,000 published words
   * would have made every cached copy wrong the day it was added. Absent reads as "not mine"
   * everywhere, including in a browser holding a snapshot from before this existed.
   */
  mine?: boolean;
}

export interface WordData {
  note: string;
  lang: Lang;
  categories: Category[];
  words: Word[];
}

/* ============================================================ Georgian verbs */

export type PersonKey = '1sg' | '2sg' | '3sg' | '1pl' | '2pl' | '3pl';

export type ScreeveKey =
  | 'present'
  | 'imperfect'
  | 'presentSubjunctive'
  | 'future'
  | 'conditional'
  | 'futureSubjunctive'
  | 'aorist'
  | 'optative'
  | 'perfect'
  | 'pluperfect'
  | 'perfectSubjunctive';

export type SeriesId = 'I' | 'II' | 'III';

export interface Person {
  key: PersonKey;
  label: string;
  pronoun: string;
  english: string;
}

export interface Screeve {
  key: ScreeveKey;
  label: string;
  series: SeriesId;
  gloss: string;
}

export interface Series {
  id: SeriesId;
  label: string;
  screeves: ScreeveKey[];
}

export interface KaVerbGroup {
  id: string;
  label: string;
  name: string;
  notes: string[];
  verbCount: number;
}

/** A screeve's six forms. Every screeve a verb has is filled in for all six persons. */
export type ScreeveForms = Record<PersonKey, string>;

/** The imperative and prohibitive, which have no first person singular. */
export type ImperativeForms = Partial<Record<PersonKey, string>>;

export interface KaVerb {
  id: string;
  english: string;
  /** Extra senses, each already carrying its own preverb where they differ. */
  senses: string[];
  /** "v.t.", "v.i.", "v.t.i." — empty when the source left it blank. */
  transitivity: string;
  verbalNoun: string;
  /** Display form of the conjugation group, e.g. "(1, A)". */
  group: string;
  groupId: string;
  present3sg: string;
  /** Only the screeves the spreadsheet fills in; a defective paradigm is simply short. */
  forms: Partial<Record<ScreeveKey, ScreeveForms>>;
  imperative: ImperativeForms | null;
  prohibitive: ImperativeForms | null;
  url: string;
  synonymsEnglish: string[];
  synonymsGeorgian: string[];
}

export interface KaVerbData {
  source: string;
  persons: Person[];
  screeves: Screeve[];
  series: Series[];
  groups: KaVerbGroup[];
  verbs: KaVerb[];
}

/**
 * One Georgian verb's morpheme make-up, derived from its paradigm and safe to hand-correct.
 * Everything but the root is optional: plenty of verbs take no preverb, no version vowel
 * and no present/future stem formant.
 */
export interface KaVerbMorphemes {
  /** The lexical core. */
  root: string;
  /** Stem variants — aorist ablaut and the like. */
  roots?: string[];
  /** Present/future stem formant. */
  pfsf?: string;
  /** The preverbs this verb takes. Absent or empty for the many verbs that take none. */
  preverbs?: string[];
  /** Which screeves carry the preverb. Absent when the segmenter could not tell. */
  preverbScreeves?: string[];
  /** The usual preradical vowel. */
  version?: string;
  /** Share of this verb's forms the segmenter split cleanly, 0–100. */
  parsed: number;
  /** Set when the entry is worth a human eye. */
  check?: boolean;
}

export interface KaMorphemeData {
  note: string;
  source: string;
  verbs: Record<string, KaVerbMorphemes | undefined>;
}

/* ============================================================= Russian verbs */

/**
 * The distinction the entire Russian verb system is built on.
 *
 * A perfective verb has no present tense. Not "rarely uses one" — cannot have one, because
 * the aspect means the action is viewed as complete, and a completed action cannot be going
 * on now. This is why `pres.*` cells mean two different things depending on this field, and
 * why the two members of a pair are two rows rather than one row with two paradigms.
 */
export type RuAspect = 'impf' | 'pf';

/** Zaliznyak's sixteen, plus the irregulars no rule reaches. See RU_CLASSES. */
export type RuClassId =
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8'
  | '9' | '10' | '11' | '12' | '13' | '14' | '15' | '16'
  | 'irr';

/** The two groups a first-year course teaches. Every class belongs to one of them. */
export type RuConjugation = '1' | '2' | 'mixed';

export type RuSlotKey =
  | 'infinitive'
  | 'pres.1sg' | 'pres.2sg' | 'pres.3sg' | 'pres.1pl' | 'pres.2pl' | 'pres.3pl'
  | 'fut.1sg' | 'fut.2sg' | 'fut.3sg' | 'fut.1pl' | 'fut.2pl' | 'fut.3pl'
  | 'past.m' | 'past.f' | 'past.n' | 'past.pl'
  | 'imp.2sg' | 'imp.2pl'
  | 'part.pres.act' | 'part.pres.pass'
  | 'part.past.act' | 'part.past.pass' | 'part.past.pass.short'
  | 'ger.pres' | 'ger.past';

export interface RuSlot {
  key: RuSlotKey;
  /** The pronoun or the participle's name — what stands in the left column of the table. */
  label: string;
  group: 'principal' | 'present' | 'future' | 'past' | 'imperative' | 'participle' | 'gerund';
  person?: PersonKey;
}

/**
 * Where the stress sits in the present tense. Three patterns cover all but a handful of verbs.
 *
 *   'stem'   — fixed on the stem: чита́ю, чита́ешь, чита́ют.
 *   'ending' — fixed on the ending: несу́, несёшь, несу́т. This is also what writes the ё.
 *   'shift'  — on the ending in the first person and on the stem everywhere else: пишу́ but
 *              пи́шешь. Much the commonest thing to get wrong, so it is modelled rather than
 *              left to an accent typed onto each cell.
 */
export type RuStressPresent = 'stem' | 'ending' | 'shift';

/**
 * Where the stress sits in the past.
 *
 *   'stem'   — де́лал, де́лала.
 *   'ending' — throughout.
 *   'fem'    — on the ending in the feminine alone: был, была́, бы́ло, бы́ли. A closed group of
 *              common verbs, and the classic giveaway when it is wrong.
 */
export type RuStressPast = 'stem' | 'ending' | 'fem';

/** How one Zaliznyak class behaves — the rule, as opposed to any verb that follows it. */
export interface RuClass {
  id: RuClassId;
  conjugation: RuConjugation;
  /** Short shape of the rule, e.g. "-овать → -ую". */
  label: string;
  description: string;
  /** The verb every textbook uses to teach this class. */
  example: string;
  exampleEnglish: string;
  /**
   * Which stem each present cell takes.
   *
   *   'plain'  — one stem for all six.
   *   'mut1sg' — the first person mutates and nothing else does: любл|ю, люб|ишь, люб|ят.
   *   'velar'  — the first person *and* the third plural keep the velar, and the four cells
   *              between mutate: пек|у, печ|ёшь, … пек|ут. Class 8 alone.
   */
  stemPattern: 'plain' | 'mut1sg' | 'velar';
  /** Stems that are soft without the spelling showing it — колоть → колю, not *колу. */
  softStem: boolean;
  /** The masculine past has no -л: нести → нёс, печь → пёк, тереть → тёр. */
  pastNoL: boolean;
  /** How the past passive participle is built, and off which stem. Null where none forms. */
  passive: { type: 'nn' | 'enn' | 't'; base: 'stemPast' | 'stem1sg' | 'stemPresent' } | null;
}

/**
 * Everything `conjugate` needs to expand one verb — the rule and its inputs.
 *
 * This is deliberately small. Twenty-odd forms come out of it, and the reason ru_verbs holds
 * this rather than those forms is that a stem plus a class is correctable in one place: fix
 * `stemPresent` and every cell that used it moves with it.
 */
export interface RuVerbRule {
  infinitive: string;
  aspect: RuAspect;
  classId: RuClassId;
  /** The stem the middle four present cells take: дела|ешь, пиш|ешь, говор|ишь. */
  stemPresent: string;
  /** The first person's stem where it differs: любл|ю against люб|ишь. */
  stemPresent1sg?: string | null;
  /** Where the imperative is built off something other than the present stem — class 13. */
  stemImperative?: string | null;
  /** The past stem. Defaults to the infinitive with its -ть/-ти/-чь taken off. */
  stemPast?: string | null;
  /** The masculine past where the vowel changes: нес → нёс, пек → пёк. */
  stemPastM?: string | null;
  stressPresent: RuStressPresent;
  stressPast: RuStressPast;
  /** Which vowel of the stem is stressed, 0-based, when the stem is what carries it. */
  stemStress?: number | null;
  /** Which vowel of the infinitive is stressed, 0-based. */
  stressInfinitive?: number | null;
  /**
   * Which vowel of the past stem is stressed, where that is not the infinitive's.
   * умере́ть but у́мер: the infinitive's index names a syllable the past does not have.
   */
  stemPastStress?: number | null;
  reflexive: boolean;
  /** 'tr' | 'intr'. Only a transitive verb forms a passive participle. */
  transitivity: string;
}

/** One cell of an expanded paradigm. */
export interface RuForm {
  slot: RuSlotKey;
  /** Unaccented, and the string the form index is built from. */
  form: string;
  /** Which vowel carries the stress, 0-based. -1 where the rule could not say. */
  stress: number;
  /**
   * Whether the rule produced this cell or a person had to write it down.
   *
   * Worth surfacing rather than hiding: a paradigm that is all 'rule' is one the class
   * describes completely, and a stored cell is a standing note that something here is not
   * regular. быть is 'stored' throughout, which is exactly what быть is.
   */
  source: 'rule' | 'stored';
  /** Two words — the compound future. Left out of the form index for that reason. */
  analytic?: boolean;
}

export interface RuParadigm {
  aspect: RuAspect;
  classId: RuClassId;
  conjugation: RuConjugation;
  forms: RuForm[];
  /** Share of the cells the rule produced, 0–100. 100 for a regular verb, 0 for быть. */
  derivedShare: number;
}

/** A Russian verb as it is stored: the rule, what it means, and the cells the rule misses. */
export interface RuVerb extends RuVerbRule {
  id: string;
  /** The infinitive with its stress marked. Display only. */
  accented: string;
  english: string;
  senses: string[];
  /**
   * The other half of the aspect pair — делать ⇄ сделать.
   *
   * A link rather than a shared row, because the two have genuinely different paradigms: the
   * perfective has no present tense and no present participle, and folding them into one
   * record would mean a record half of whose cells are meaningless. Null for the verbs that
   * are aspectually on their own.
   */
  pairId: string | null;
  /** The cases the complement takes: ['dat'], ['ins']. Empty where it takes none. */
  government: string[];
  /** 'uni' | 'multi' | '' — идти against ходить, which is its own small system. */
  motion: string;
  level: Level | '';
  /** The cells the rule cannot reach, by slot. Empty for a regular verb. */
  overrides: Partial<Record<RuSlotKey, string>>;
  check?: boolean;
  note?: string;
}

export interface RuVerbData {
  source: string;
  verbs: RuVerb[];
}

/**
 * A Russian noun's or adjective's grammar.
 *
 * Real fields rather than a jsonb blob, because "show me the animate masculines" is a
 * question a learner asks and a `WHERE` clause answers. The declined forms themselves are
 * not here — they are `WordForm`s with `gram` set to "gen.sg" and so on, in the same table
 * that holds the Georgian case forms.
 */
export interface RuWordGrammar {
  /** 'm' | 'f' | 'n' | 'pl' — the last for the nouns that have no singular. */
  gender?: string;
  /** 'anim' | 'inanim'. Decides which form the accusative borrows. */
  animacy?: string;
  /** '1' | '2' | '3' | 'indecl' | 'adj'. */
  declension?: string;
  /** Zaliznyak's stress pattern letter for the paradigm: 'a', 'b', 'c', 'd', 'e', 'f'. */
  stressPattern?: string;
  check?: boolean;
}

/* ----------------------------------------- images.json, categoryImages.json */

/** A Wikimedia Commons image, with the attribution its licence requires. */
export interface ImageInfo {
  url: string;
  width: number;
  height: number;
  title: string;
  page: string;
  author: string;
  license: string;
  licenseUrl: string;
}

/** Word id → image. Only words that survived the build script's checks appear. */
export type ImageMap = Record<string, ImageInfo | undefined>;

/* ------------------------------------------------------ stories/<id>.json */

/** Another entry that could have claimed the same spelling — the shortlist for an editor. */
export interface StoryAlt {
  /** A words.json id. */
  word: string;
  english: string;
}

/**
 * One *occurrence* of a word, not one spelling: the fourth word of the third paragraph is
 * its own record, so აბა can be "let's" in one line and "just try" in another.
 *
 * It carries no meaning of its own. `word` and `sense` name an entry in the lexicon and one
 * of its senses, and the reader looks the text up there, so a corrected definition reaches
 * every story that cites it without any of them being rebuilt.
 */
export interface StoryToken {
  /** The surface form, exactly as it stands in `paragraphs`. */
  form: string;
  /** A lexicon id. Absent when nothing matched the form, and for proper names. */
  word?: string;
  /** 1-based index into that entry's `senses`. */
  sense?: number;
  /** How this form differs from the headword: "erg", "gen.sg", "Aorist 3sg". */
  gram?: string;
  /** A proper noun, glossed here rather than added to the dictionary. */
  name?: string;
  /** How the link was reached: "override", "form index", "paradigm", "-dat -pl". */
  via: string;
  /** Set when the link was a guess rather than something confirmed by hand. */
  check?: boolean;
  /** Other entries that claim this spelling, best guess first in `word`. */
  alts?: StoryAlt[];
  /** Free note carried over from scripts/storyOverrides.json. */
  comment?: string;
}

/**
 * How much of a text linked back to the dictionary. Held per chapter and per story.
 *
 * A type alias rather than an interface, which is not a stylistic choice: only an alias gets
 * an implicit index signature, and without one this stops being assignable to the
 * `Record<string, number>` the `stats` jsonb columns are typed as.
 */
export type StoryStats = {
  tokens: number;
  distinctForms: number;
  /** Occurrences that resolved to a dictionary entry or a name. */
  covered: number;
  /** `covered` as a percentage of `tokens`, to one decimal place. */
  coverage: number;
  names: number;
  unresolved: number;
  /** Occurrences reached by a guess rather than confirmed by hand. */
  flagged: number;
};

/** A shelf stories are filed on — hand-made, unlike a word's category. */
export interface StoryCategory {
  id: string;
  lang: Lang;
  name: string;
  /** The category's name in the language being learned. Often empty. */
  nameNative: string;
  note: string;
  storyCount: number;
}

/**
 * One chapter as the navigation knows it: enough to list it and link to it, and no prose.
 *
 * Every payload that carries a story carries all of these, because the chapter list is
 * navigation and has to be drawable before the chapter being navigated to has loaded.
 */
export interface StoryChapterSummary {
  /**
   * 0-based, and the whole of a chapter's identity — the URL shows this plus one. A chapter
   * has no id of its own; see the note on the `story_chapters` table.
   */
  position: number;
  /** Empty for a story that is one text and names no chapters. */
  title: string;
  titleEnglish: string;
  paragraphs: number;
  translated: boolean;
  stats: StoryStats;
}

/**
 * A story, opened at one chapter.
 *
 * `paragraphs`, `translation` and `tokens` are that one chapter's — not the whole book's.
 * A story is unbounded in length now that it has chapters, and sending every chapter to
 * render one of them would put a novel on the wire to show a page of it. `chapters` is the
 * list to navigate by and `chapter` says which of them this payload is.
 */
export interface Story {
  note: string;
  id: string;
  lang: Lang;
  title: string;
  titleEnglish: string;
  /** A CEFR level as a plain string: stories are not confined to the A1/A2 word list. */
  level: string;
  source: string;
  /** Null when the story has not been filed on any shelf. */
  categoryId: string | null;
  /** That category's English name, for a card that would otherwise have to look it up. */
  category: string;
  /** Every chapter, every word — what the index card and the story editor report. */
  stats: StoryStats;
  /** In reading order. Always at least one: a story with no chapters has no prose. */
  chapters: StoryChapterSummary[];
  /** Which chapter the three fields below carry. A 0-based index into `chapters`. */
  chapter: number;
  chapterTitle: string;
  chapterTitleEnglish: string;
  paragraphs: string[];
  /**
   * The English, one entry per paragraph and in the same order. Empty when there is no
   * translation, which is what the reader checks before offering the split view.
   */
  translation: string[];
  /**
   * One array per paragraph, in reading order, so a record's position in it is the
   * position of the word in the text. Paired with `paragraphs` by index, and produced by
   * the same tokeniser src/utils/story.ts re-runs to render them.
   */
  tokens: StoryToken[][];
  /**
   * A story of your own rather than one the dictionary publishes.
   *
   * It decides whether the Edit button is drawn, and nothing more. The server does not trust
   * it: `library.saveStory` reads the owner off the row every time. See `Word.mine` for why it
   * is optional rather than a boolean that is always present.
   */
  mine?: boolean;
}

/**
 * A story without any prose — what the index page lists, at a fraction of the weight.
 *
 * `chapters` stays. It is the one part of a story's shape that the index has to know before
 * anything is fetched: a card says how many chapters there are, and the reader's chapter
 * menu is drawn from it while the first chapter is still in flight.
 */
export type StorySummary = Omit<
  Story,
  'paragraphs' | 'translation' | 'tokens' | 'chapter' | 'chapterTitle' | 'chapterTitleEnglish'
> & {
  /** Whether an English translation exists for any chapter, which is what the index badges. */
  translated: boolean;
  /** The opening paragraph of the first chapter — the only prose the index card shows. */
  excerpt: string;
};

/**
 * A whole story as one file — every chapter, its prose and every token in it.
 *
 * Distinct from `Story`, which is one chapter of one, because the two answer different
 * questions. `Story` is what crosses the wire to paint a page, and carrying forty chapters
 * to show one of them is the thing chapters exist to avoid. A file is not read a page at a
 * time: `npm run db:seed` loads the lot and `npm run db:export` writes the lot, and a story
 * split across forty files would be a directory listing pretending to be a table.
 */
export interface StoryFileChapter {
  title: string;
  titleEnglish: string;
  stats: StoryStats;
  paragraphs: string[];
  translation: string[];
  /** One array per paragraph, in reading order. See `Story.tokens`. */
  tokens: StoryToken[][];
}

export interface StoryFile {
  note: string;
  id: string;
  lang: Lang;
  title: string;
  titleEnglish: string;
  level: string;
  source: string;
  categoryId: string | null;
  category: string;
  stats: StoryStats;
  chapters: StoryFileChapter[];
}

/* ----------------------------------------------------------------- quizzes */

/**
 * What answering a question looks like. Three, and the note on `quiz_questions` in schema.ts
 * says why three covers the six things a question was wanted for.
 *
 *   'choice' — pick one of the options, or several of them.
 *   'order'  — take the right words out of a bank and put them in the right order.
 *   'type'   — write it out.
 */
export type QuizKind = 'choice' | 'order' | 'type';

export const QUIZ_KINDS: readonly QuizKind[] = ['choice', 'order', 'type'];

export function isQuizKind(value: string): value is QuizKind {
  return value === 'choice' || value === 'order' || value === 'type';
}

/** A shelf to file quizzes on. The same shape as a `StoryCategory`, and hand-made as one is. */
export interface QuizCategory {
  id: string;
  lang: Lang;
  name: string;
  /** The category's name in the language being learned. Often empty. */
  nameNative: string;
  note: string;
  quizCount: number;
}

/**
 * Where a question's sound comes from, if it has any.
 *
 * A shape rather than two loose fields because the same choice is offered in three places —
 * a question's prompt, each of its options, and nothing else in the app — and writing it once
 * means the player has one function to point at all of them.
 */
export interface QuizAudio {
  /**
   * What a voice should read out. Empty for a question with nothing to hear.
   *
   * Not the same text as the prompt, necessarily: "choose the word you heard" is a `say` with
   * an empty `promptNative` beside it, which is the whole of how that question is built.
   */
  say: string;
  /** An uploaded clip, which is played instead of synthesising `say`. Null for most. */
  clipId: string | null;
}

/**
 * One option of a `choice` question, or one word of an `order` question's bank.
 *
 * `correct` means something slightly different in each and the difference is the point — for
 * a choice it marks an answer, and for an ordering it marks a word that belongs *and* fixes
 * where it belongs, since the correct entries are in order among themselves. See the note on
 * the `quiz_choices` table.
 */
export interface QuizChoice {
  /** 0-based, and its place in the answer for an `order` question. */
  position: number;
  text: string;
  correct: boolean;
  audio: QuizAudio;
}

export interface QuizQuestion {
  /** 0-based. The runner shows this plus one. */
  position: number;
  kind: QuizKind;
  /** The instruction, in English. */
  prompt: string;
  /** The material being asked about, in the language being learned. Set larger on screen. */
  promptNative: string;
  audio: QuizAudio;
  /** More than one option is right, and all of them are wanted. `choice` only. */
  multiple: boolean;
  /** Every spelling that counts. `type` only, and empty for the other two. */
  answers: string[];
  hint: string;
  /** Shown after answering, right or wrong. Where a quiz does its teaching. */
  explanation: string;
  /** The options, or the word bank. Empty for a `type` question. */
  choices: QuizChoice[];
}

/**
 * A quiz with its questions — what the runner is handed, and the only payload that carries
 * the answers.
 *
 * The answers are in it, and that is deliberate rather than an oversight to be fixed later.
 * A question is marked the instant it is answered, with the explanation underneath, and that
 * is what makes a quiz teach rather than test; doing it over the network would put a round
 * trip between an answer and the reaction to it. The same rule the study deck already lives
 * by — the browser scores its own cards — and the recorded result is still the server's own
 * work: `quiz.finish` re-marks the submitted answers against these same rows rather than
 * believing a score it is told. See `mark()` in quiz.ts.
 */
export interface Quiz {
  id: string;
  lang: Lang;
  title: string;
  titleNative: string;
  description: string;
  level: string;
  /** Null when the quiz has not been filed on any shelf. */
  categoryId: string | null;
  /** That category's English name, for a card that would otherwise have to look it up. */
  category: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  /**
   * How many of `questions` one run asks, drawn at random, or 0 for all of them.
   *
   * The whole pool is still sent. The draw happens in the runner, where `shuffleQuestions` and
   * `shuffleOptions` already happen, and for the same reason: a run is a thing the browser
   * deals, and moving one of the three to the server would mean two places decide what a run
   * looks like. See `quizzes.ask_count`.
   */
  askCount: number;
  /** The share of the questions a run has to get right to pass, 0–100. */
  passMark: number;
  note: string;
  questions: QuizQuestion[];
}

/**
 * A quiz as the index knows it: enough to draw a card and decide whether to open it.
 *
 * No questions, for the reason a `StorySummary` carries no prose — the index would otherwise
 * download every answer of every quiz to show a list of titles. `kinds` and `hasAudio` are
 * summarised up from the questions here so a card can say "listening, 8 questions" without
 * any of them crossing the wire.
 */
export interface QuizSummary {
  id: string;
  lang: Lang;
  title: string;
  titleNative: string;
  description: string;
  level: string;
  categoryId: string | null;
  category: string;
  passMark: number;
  questionCount: number;
  /** Which kinds of question it holds, in a fixed order. Empty for a quiz not written yet. */
  kinds: QuizKind[];
  /** Whether anything in it is meant to be heard, which is what the index badges. */
  hasAudio: boolean;
}

/**
 * One question's answer, in the one shape all three kinds fit.
 *
 * A flat record rather than a union of three, because this is what crosses the wire when a run
 * is submitted and a union costs a discriminant on every entry to say something the question's
 * own `kind` already says. Which field carries the answer follows from that kind:
 *
 *   'choice' — `picked`, as a set. The order they were clicked in means nothing.
 *   'order'  — `picked`, as a sequence. The order is the entire answer.
 *   'type'   — `text`, compared forgivingly. See `normalise` in quiz.ts.
 *
 * The unused field is empty rather than absent, so nothing has to check for undefined.
 */
export interface QuizAnswer {
  /** Option positions, in the order they were placed for an `order` question. */
  picked: number[];
  /** What was typed, for a `type` question. */
  text: string;
}

/**
 * How one person last got on with one quiz.
 *
 * Only ever the last run. Re-taking replaces it, including replacing a pass with a fail; see
 * the note on the `quiz_results` table for why that is the useful thing to keep rather than
 * a best-ever that can only go up.
 */
export interface QuizResult {
  quizId: string;
  passed: boolean;
  score: number;
  total: number;
  /** Epoch ms, as every instant that crosses this wire is. See `StudyCardWire`. */
  finishedAt: number;
}

/* ----------------------------------------------------------------- lessons */

/**
 * Which of the two reading sections a lesson belongs to.
 *
 * They are the same thing wearing two labels, and that is the point rather than a compromise:
 * a lesson and a grammar topic are both a title, a shelf and a body of markup, and building
 * them out of one table means a table written for a lesson works in a grammar topic, an
 * embedded quiz works in both, and there is one editor to learn rather than two.
 *
 * What the section actually decides is which sidebar link a lesson appears under and which of
 * the two index pages lists it. A category carries one too, so "Verbs" as a grammar shelf and
 * "Verbs" as a lesson shelf are two shelves — which is what stops the grammar reference from
 * being reorganised every time somebody files a lesson.
 */
export type LessonSection = 'lessons' | 'grammar';

export const LESSON_SECTIONS: readonly LessonSection[] = ['lessons', 'grammar'];

export function isLessonSection(value: string): value is LessonSection {
  return value === 'lessons' || value === 'grammar';
}

/** A shelf to file lessons on. The same shape as a `QuizCategory`, plus the section it is in. */
export interface LessonCategory {
  id: string;
  lang: Lang;
  section: LessonSection;
  name: string;
  /** The category's name in the language being learned. Often empty. */
  nameNative: string;
  note: string;
  lessonCount: number;
}

/**
 * A lesson as the index knows it: enough to draw a card and decide whether to open it.
 *
 * No body, for the reason a `QuizSummary` carries no questions — a section of forty lessons
 * would otherwise put forty bodies in the snapshot to show a list of titles. The three facts
 * that need the body to work out are summarised up at assembly time, so a card can say "8
 * minutes, has audio, two quizzes" without any of it crossing the wire.
 */
export interface LessonSummary {
  id: string;
  lang: Lang;
  section: LessonSection;
  title: string;
  /** The title in the language being learned. Display only. */
  titleNative: string;
  /** The author's own one-line description. `excerpt` is what shows when this is empty. */
  summary: string;
  level: string;
  /** Null when the lesson has not been filed on any shelf. */
  categoryId: string | null;
  /** That category's English name, for a card that would otherwise have to look it up. */
  category: string;
  /** The opening paragraph, cut short. Derived from the body; see `lessonExcerpt`. */
  excerpt: string;
  /**
   * How many blocks the body parses to.
   *
   * Zero means a lesson with nothing in it yet, and that is the whole of what stands in for a
   * draft flag — the reader's index drops it, the admin list shows it and says so. Exactly the
   * bargain a quiz with no questions strikes; see the note on the `quizzes` table.
   */
  blocks: number;
  /** Whether anything in it can be played, which is what the index badges. */
  hasAudio: boolean;
  /**
   * The quizzes it embeds, in the order they are written and without repeats.
   *
   * The list rather than a count of it, because this is what a lesson's progress is measured
   * against: a lesson is done when every quiz named here has been passed, and the index cannot
   * work that out from a number. The count is `quizIds.length` wherever one is wanted.
   */
  quizIds: string[];
  /** How many YouTube videos it embeds. */
  videos: number;
}

/**
 * What the page needs to know about an uploaded picture before its bytes arrive.
 *
 * Three fields rather than the whole `lesson_media` row, and public rather than admin-only,
 * because the page cannot draw the picture properly without them: the size reserves the space
 * so a paragraph is not shoved down the screen when the image lands, and the alt text is what a
 * screen reader is given. Both are facts about a file this server already serves to anyone.
 *
 * Not on the block that draws it, which was the alternative — `::image <id> "alt"` in the
 * markup. A picture means the same thing wherever it is used, so describing it belongs to the
 * upload; putting it in the markup means describing it again at every use, which is the version
 * that does not get done.
 */
export interface LessonImage {
  /** Pixels. Zero where the header could not be read; the page then simply has no hint. */
  width: number;
  height: number;
  alt: string;
}

/** Keyed by media id. Only pictures are in here — a recording has nothing to lay out. */
export type LessonImageMap = Record<string, LessonImage>;

/** A lesson with its markup — what the page is drawn from, and what the editor edits. */
export interface Lesson extends LessonSummary {
  /** The markup itself. The language is described at the head of shared/lesson.ts. */
  body: string;
  /** For whoever edits it next. Never shown to a reader. */
  note: string;
}

/* ----------------------------------------------------------------- study */

// The scale and the card key, shared because both ends of the sync speak them. The
// *scheduler* — what an answer does to an interval — is not here: it is arithmetic the
// browser does, and the server only ever stores the result.

/**
 * How well one side of one item is known, 6 down to 1.
 *
 * A word never met has *no record at all* rather than a level of 0. That absence is a state
 * in its own right, and keeping it out of the scale means it can never be confused with 1,
 * "I have seen this and it keeps slipping away".
 */
export type Mastery = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Which direction of a card a record scores. The two are learned separately — recognising
 * მგელი and producing it from "wolf" are different skills — so each carries its own level
 * and its own due date.
 *
 * 'target' was called 'ka' while there was only one language to be the target of. The stored
 * value is unchanged and the migration rewrites it; see the note on `study_cards.side`.
 */
export type Side = 'target' | 'en';

/**
 * What first created the record. Only a card actually sat down and answered counts against
 * the day's allowance of new cards; retiring a word by hand writes a record too.
 */
export type Introduced = 'review' | 'marked';

/**
 * One side of one item as it crosses the wire.
 *
 * Every instant is epoch milliseconds, which is what the browser's scheduler deals in. The
 * server stores them as timestamptz and converts at the edge — the conversion belongs in
 * one place, and this is the side that has the arithmetic.
 */
export interface StudyCardWire {
  /** `${item}|${side}` — `w:6938|target`. The primary key at both ends. */
  card: string;
  /** `w:6938` for a word, `v:abandon-vt` for a bare paradigm. */
  item: string;
  side: Side;
  /**
   * Which language this card belongs to.
   *
   * Derivable from `item`, since ids are minted per language and never collide — but stored,
   * because the review queue filters on it and a deck must never mix scripts. The same
   * reasoning as `item` and `side` themselves, which are also derivable from `card`.
   */
  lang: Lang;
  level: Mastery;
  /** Days until the next review. 0 while the card is still being learned today. */
  interval: number;
  /** SM-2's difficulty multiplier. */
  ease: number;
  due: number;
  reps: number;
  lapses: number;
  last: number;
  created: number;
  introduced: Introduced;
  /**
   * A tombstone rather than a missing row. Forgetting a card on one device has to survive
   * the next sync from a device that still holds it, and only an explicit "this is gone"
   * can say that — an absence is indistinguishable from "not yet uploaded".
   */
  deleted: boolean;
  /** Epoch ms. The whole of the merge rule: for one card id, the newer of the two wins. */
  updatedAt: number;
}
