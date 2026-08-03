// Turning a story's prose back into clickable words, and resolving what each one means.
//
// The story file records one entry per word *occurrence*, in reading order, so the reader
// has to cut a paragraph into exactly the tokens the build script counted and then count
// to the same place. That regex is duplicated from scripts/buildStoryData.cjs rather than
// shared, because the script is CommonJS; if one changes the other has to follow. A drift
// between them would silently shift every meaning in a paragraph one word to the left,
// which is why `at` checks the recorded spelling before believing the position.

import type { Sense, Story, StoryToken, Verb, VerbMorphemes, Word } from '../types';
import wordData from '../data/words.json';
import verbData from '../data/verbs.json';
import morphemeData from '../data/verbMorphemes.json';

// No /g on either: these are handed to String.split and String.test, and a global flag on
// a shared regex is a standing invitation to the lastIndex bug.
const TOKEN_RE = /([ა-ჿ]+(?:-[ა-ჿ]+)*)/;
const WHOLE_TOKEN_RE = /^[ა-ჿ]+(?:-[ა-ჿ]+)*$/;

const wordsById = new Map(wordData.words.map(word => [word.id, word]));
const verbsById = new Map(verbData.verbs.map(verb => [verb.id, verb]));

// What an inflected form means, keyed by the entry it belongs to and the spelling. Built
// once: a linear scan of every entry's forms per hovered word would be 2,095 entries for
// a card that has to appear within 140ms of the pointer stopping.
const formMeanings = new Map(
  wordData.words.flatMap(word =>
    (word.forms ?? [])
      .filter(entry => entry.english)
      .map(entry => [`${word.id}|${entry.form}`, entry.english as string]),
  ),
);

/** A run of prose: either one dictionary-sized word, or the punctuation between two. */
export interface Piece {
  text: string;
  word: boolean;
  /** Its position among the words of the paragraph, which is how the story file keys it. */
  index: number;
}

/**
 * Splits a paragraph into words and the gaps between them. The capturing group makes
 * String.split hand back both, alternating, so the original text can be reassembled
 * exactly — spacing and punctuation included. Only the words are numbered.
 */
export function pieces(paragraph: string): Piece[] {
  let index = 0;
  return paragraph
    .split(TOKEN_RE)
    .filter(Boolean)
    .map(text => {
      const word = WHOLE_TOKEN_RE.test(text);
      return { text, word, index: word ? index++ : -1 };
    });
}

/**
 * The record for one occurrence. The recorded spelling has to agree with the text: if the
 * two tokenisers ever disagree the count is off, and showing the wrong word's meaning with
 * no sign anything is wrong would be worse than showing none.
 */
export function at(story: Story, paragraph: number, index: number, form: string): StoryToken | null {
  const token = story.tokens[paragraph]?.[index];
  return token && token.form === form ? token : null;
}

/** Everything the popover needs about one word, gathered from the three data files. */
export interface Reading {
  token: StoryToken;
  /** The dictionary entry, when the occurrence is bound to one. */
  word?: Word;
  /** The paradigm behind that entry, for the verbs that have one. */
  verb?: Verb;
  /** The verb's morphemes, for colouring the form the way the verb pages do. */
  lex?: VerbMorphemes;
  /** Where "full entry" goes, when there is one to go to. */
  href?: string;
  /** The part of speech, from whichever source knows it. */
  pos: string;
  /** The meaning that applies here — the point of recording occurrences separately. */
  sense: Sense | null;
  /** The entry's other meanings, which do not apply here. */
  otherSenses: string[];
  /**
   * What this inflected form means, where that is not what the headword means: იყო reads
   * as "was", under a headword that means "is". Empty where the form and the headword mean
   * the same thing and only the grammar differs, as with the case forms of a noun.
   */
  formMeaning: string;
}

/**
 * What to show for an occurrence. Everything but the proper names comes out of the
 * lexicon, so a corrected definition reaches every story that cites it without any of
 * them being rebuilt.
 */
export function reading(token: StoryToken): Reading {
  const base: Reading = { token, pos: '', sense: null, otherSenses: [], formMeaning: '' };
  if (!token.word) return base;

  const word = wordsById.get(token.word);
  if (!word) return base;

  const index = (token.sense ?? 1) - 1;
  const sense = word.senses[index] ?? word.senses[0] ?? null;
  const verb = word.verbId ? verbsById.get(word.verbId) : undefined;

  return {
    token,
    word,
    verb,
    lex: verb ? morphemeData.verbs[verb.id] ?? undefined : undefined,
    // The paradigm is the more useful page when there is one: it is where the form the
    // reader is looking at actually appears.
    href: verb ? `/verbs/${verb.id}` : `/category/${word.categoryId}`,
    pos: word.partOfSpeech || (verb?.transitivity ?? ''),
    sense,
    otherSenses: word.senses.filter((_, i) => i !== index).map(s => s.english),
    formMeaning: formMeanings.get(`${word.id}|${token.form}`) ?? '',
  };
}

/** The meaning to lead with. */
export function meaning(item: Reading): string {
  return item.sense?.english || item.token.name || '';
}

/** The headword to show the form under, if it differs from the form itself. */
export function headword(item: Reading): string {
  if (!item.word) return '';
  return item.word.georgian.split('/')[0].trim().replace(/\*+$/, '').replace(/\d+$/, '');
}

/** True when the occurrence carries something worth offering — the rest stays plain text. */
export function isLinked(token: StoryToken | null): token is StoryToken {
  return Boolean(token && (token.word || token.name));
}
