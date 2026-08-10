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

export interface Story {
  note: string;
  id: string;
  lang: Lang;
  title: string;
  titleEnglish: string;
  /** A CEFR level as a plain string: stories are not confined to the A1/A2 word list. */
  level: string;
  source: string;
  stats: {
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
  paragraphs: string[];
  /**
   * The English, one entry per paragraph and in the same order, from the story's
   * <id>.en.txt. Empty when there is no translation, which is what the reader checks
   * before offering the split view.
   */
  translation: string[];
  /**
   * One array per paragraph, in reading order, so a record's position in it is the
   * position of the word in the text. Paired with `paragraphs` by index, and produced by
   * the same tokeniser src/utils/story.ts re-runs to render them.
   */
  tokens: StoryToken[][];
}

/** A story without its text — what the index page lists, at a fraction of the weight. */
export type StorySummary = Omit<Story, 'paragraphs' | 'translation' | 'tokens'> & {
  /** Whether an English translation exists, which is what the index badges. */
  translated: boolean;
  /** The opening paragraph, which is the only prose the index card shows. */
  excerpt: string;
};

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
