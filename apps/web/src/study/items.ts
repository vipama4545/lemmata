// One list of things to learn, out of the two files that hold them.
//
// words.json and verbs.json are built from different sources and are shaped for different
// pages, but a review record does not care which file a word came from — and it must not,
// because the same verb can be reached from either. 165 of the 603 paradigms already have a
// headword in words.json (აბრუნებს carries `verbId: "return-vt"`), and those two ways of
// meeting the same verb have to be one card: a verb drilled from the verb list should come
// up as learned when it is met in a story, which resolves words by their words.json id.
//
// So the key is the *headword's* wherever there is one. `verbKey` does that resolution, and
// is the only thing the verb pages need to know about any of this.

import type { KaVerb, Word } from '@georgian/shared/types';
import { derived, kaVerbsOf, lang } from '../content/store';
import { focusHref } from '../utils/scroll';

/** Which file the item came from, which is only ever a display concern. */
export type ItemKind = 'word' | 'verb';

/** Everything a card, a story highlight or a deck filter needs about one thing to learn. */
export interface StudyItem {
  /** `w:6938` or `v:abandon-vt` — the id every review record is filed under. */
  key: string;
  kind: ItemKind;
  /** The id in the file it came from. */
  id: string;
  /** The Georgian face of the card. */
  headword: string;
  /**
   * A second Georgian line: for a verb, the third person singular present, because the
   * headword is the verbal noun and the 3sg is the form you actually meet in a sentence.
   */
  sub: string;
  /** The English face. */
  english: string;
  /** Every meaning, the first of which is `english`. */
  senses: string[];
  /** The Georgian-language definition, where the scrape had one. */
  definition: string;
  partOfSpeech: string;
  /** The CEFR level, empty for the verbs the spreadsheet never graded. */
  cefr: string;
  categoryId: string;
  category: string;
  /** True for anything with a paradigm behind it, however it is filed. */
  isVerb: boolean;
  /** The paradigm, for the items that have one. */
  verbId: string;
  /** The full entry for this item. */
  href: string;
  /**
   * The id images.json is keyed by, which is a words.json id — a bare paradigm has no
   * picture and this is empty for it.
   */
  imageId: string;
}

/** The category bare paradigms are filed under, mirroring the card on the category grid. */
export const VERB_CATEGORY_ID = 'verbs';

const verbsById = derived(content => new Map(kaVerbsOf(content).map(verb => [verb.id, verb])));

/** verbId → the lexicon id that claims it, for the 165 paradigms a headword covers. */
const claimedBy = derived(content => {
  const claims = new Map<string, string>();
  for (const word of content.words.words) {
    if (word.verbId && !claims.has(word.verbId)) claims.set(word.verbId, word.id);
  }
  return claims;
});

/** The key a words.json entry is studied under. */
export function wordKey(id: string): string {
  return `w:${id}`;
}

/**
 * The key a paradigm is studied under: its headword's where one claims it, so that drilling
 * აბრუნებს from the verb list and meeting it in a story are the same card.
 */
export function verbKey(verbId: string): string {
  const wordId = claimedBy().get(verbId);
  return wordId ? wordKey(wordId) : `v:${verbId}`;
}

function fromWord(word: Word): StudyItem {
  const verb = word.verbId ? verbsById().get(word.verbId) : undefined;
  const senses = word.senses.map(sense => sense.english).filter(Boolean);
  return {
    key: wordKey(word.id),
    kind: 'word',
    id: word.id,
    headword: word.headword,
    // Only worth a second line when it says something the headword does not.
    sub: verb && verb.present3sg && verb.present3sg !== word.headword ? verb.present3sg : '',
    english: word.english,
    senses: senses.length > 0 ? senses : word.englishFull,
    definition: word.definition,
    partOfSpeech: word.partOfSpeech,
    cefr: word.level,
    categoryId: word.categoryId,
    category: word.category,
    isVerb: Boolean(word.verbId) || word.partOfSpeech === 'Verb',
    verbId: word.verbId ?? '',
    href: word.verbId ? `/${lang()}/verbs/${word.verbId}` : focusHref(`/category/${word.categoryId}`, word.id),
    imageId: word.id,
  };
}

function fromVerb(verb: KaVerb): StudyItem {
  const headword = verb.verbalNoun || verb.present3sg;
  return {
    key: `v:${verb.id}`,
    kind: 'verb',
    id: verb.id,
    headword: headword,
    sub: verb.present3sg && verb.present3sg !== headword ? verb.present3sg : '',
    english: verb.english,
    senses: [verb.english, ...verb.senses].filter(Boolean),
    definition: '',
    partOfSpeech: verb.transitivity || 'Verb',
    cefr: '',
    categoryId: VERB_CATEGORY_ID,
    category: 'Verbs',
    isVerb: true,
    verbId: verb.id,
    href: `/${lang()}/verbs/${verb.id}`,
    imageId: '',
  };
}

/**
 * Every word, plus the paradigms no headword claims. A claimed paradigm is deliberately
 * absent: it is already here as its headword, and listing it twice would deal the same verb
 * as two cards with two separate levels.
 */
export const studyItems = derived<StudyItem[]>(content => [
  ...content.words.words.map(fromWord),
  ...kaVerbsOf(content).filter(verb => !claimedBy().has(verb.id)).map(fromVerb),
]);

export const itemsByKey = derived(() => new Map(studyItems().map(item => [item.key, item])));

export function studyItem(key: string): StudyItem | undefined {
  return itemsByKey().get(key);
}

/** The categories a deck can be narrowed to: the word list's, plus the bare paradigms. */
export const studyCategories = derived(content => [
  ...content.words.categories.map(cat => ({ id: cat.id, name: cat.name })),
  { id: VERB_CATEGORY_ID, name: 'Verbs (paradigms)' },
]);
