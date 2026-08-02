// The shapes of the generated data files under src/data. They are written by hand rather
// than inferred, because the JSON is far too big for TypeScript to usefully infer from and
// because the inferred type would describe *this* build of the data rather than the
// contract the build scripts promise. src/data/data.d.ts binds the JSON modules to these.
//
// Anything asserted here was checked against the data: every screeve table holds all six
// persons, the imperative and prohibitive hold five (you cannot command yourself), and the
// only CEFR levels in words.json are A1 and A2.

/* ---------------------------------------------------------------- words.json */

/** The CEFR levels the word list covers. */
export type Level = 'A1' | 'A2';

/** A level, or the "All" setting every level filter in the UI starts on. */
export type LevelFilter = Level | 'all';

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
  /** Every sense, of which `english` is the first. Empty for one word in the set. */
  englishFull: string[];
  georgianDefinition: string;
  level: Level;
  /** "Noun", "Verb", "Adjective"… — see the POS tagging convention in scripts/. */
  partOfSpeech: string;
  category: string;
  categoryId: string;
}

export interface WordData {
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
