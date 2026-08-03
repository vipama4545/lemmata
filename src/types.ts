// The shapes of the generated data files under src/data. They are written by hand rather
// than inferred, because the JSON is far too big for TypeScript to usefully infer from and
// because the inferred type would describe *this* build of the data rather than the
// contract the build scripts promise. src/data/data.d.ts binds the JSON modules to these.
//
// Anything asserted here was checked against the data: every screeve table holds all six
// persons, the imperative and prohibitive hold five (you cannot command yourself), and the
// only CEFR levels in words.json are A1 and A2.

/* ---------------------------------------------------------------- words.json */

/** The CEFR levels the scraped word list covers. */
export type Level = 'A1' | 'A2';

/** A level, or the "All" setting every level filter in the UI starts on. */
export type LevelFilter = Level | 'all';

/** One meaning of a word. The id is what a story token cites to say which one applies. */
export interface Sense {
  /** `<word id>.<1-based position>` — stable as long as senses are only appended. */
  id: string;
  english: string;
}

/** An inflected form known to belong to a headword, and how it differs from it. */
export interface WordForm {
  form: string;
  /** "erg", "dat.pl", "Aorist 3sg". Absent for the headword spelling itself. */
  gram?: string;
  /**
   * What this form means in English, where the headword's meaning does not say it: იყო is
   * "was", not "is". Absent for the case forms of a nominal, where the meaning is the
   * headword's and the grammatical label carries the rest.
   */
  english?: string;
}

export interface Category {
  id: string;
  name: string;
  nameGeorgian: string;
  wordCount: number;
}

export interface Word {
  id: string;
  georgian: string;
  english: string;
  /** Every sense as plain text — the same list as `senses`, for the older screens. */
  englishFull: string[];
  georgianDefinition: string;
  /** Empty for the vocabulary added by hand, which the scrape never graded. */
  level: Level | '';
  /** "Noun", "Verb", "Adjective"… — see the POS tagging convention in scripts/. */
  partOfSpeech: string;
  category: string;
  categoryId: string;
  /** "core" for the scraped A1–A2 dictionary, "added" for lemmas written by hand. */
  origin: 'core' | 'added';
  /** Always at least one. A story token names the one that applies where it stands. */
  senses: Sense[];
  /**
   * 1-based, and absent when it is 1. The sense to lead with where nothing pins one — a
   * fact about the word rather than about any story, for the entries whose commonest
   * meaning is not the one the scrape happened to list first.
   */
  defaultSense?: number;
  /** The verbs.json paradigm for this headword, for the ones that have one. */
  verbId?: string;
  /** Inflected forms confirmed to belong here — the story builder's first index. */
  forms?: WordForm[];
  /** Set when the meaning itself is a guess and wants verifying. */
  check?: boolean;
  note?: string;
}

export interface WordData {
  note: string;
  categories: Category[];
  words: Word[];
}

/* ---------------------------------------------------------------- verbs.json */

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

export interface VerbGroup {
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

export interface Verb {
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

export interface VerbData {
  source: string;
  persons: Person[];
  screeves: Screeve[];
  series: Series[];
  groups: VerbGroup[];
  verbs: Verb[];
}

/* ------------------------------------------------------- verbMorphemes.json */

/**
 * One verb's morpheme make-up, derived from its paradigm and safe to hand-correct.
 * Everything but the root is optional: plenty of verbs take no preverb, no version vowel
 * and no present/future stem formant.
 */
export interface VerbMorphemes {
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

export interface MorphemeData {
  note: string;
  source: string;
  verbs: Record<string, VerbMorphemes | undefined>;
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
 * It carries no meaning of its own. `word` and `sense` name an entry in words.json and one
 * of its senses, and the reader looks the text up there, so a corrected definition reaches
 * every story that cites it without any of them being rebuilt.
 */
export interface StoryToken {
  /** The surface form, exactly as it stands in `paragraphs`. */
  form: string;
  /** A words.json id. Absent when nothing matched the form, and for proper names. */
  word?: string;
  /** 1-based index into that entry's `senses`. */
  sense?: number;
  /** How this form differs from the headword: "erg", "dat.pl", "Aorist 3sg". */
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
   * The English, one entry per Georgian paragraph and in the same order, from the story's
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
