// Turning a story's prose back into clickable words, and resolving what each one means.
//
// The glossary in stories/<id>.json is keyed by surface form, so the reader has to cut a
// paragraph into exactly the tokens the build script counted. That regex is duplicated
// from scripts/buildStoryData.cjs rather than shared, because the script is CommonJS and
// gitignored; if one changes the other has to follow, or lookups start missing.

import type { Story, StoryGloss, Verb, VerbMorphemes, Word } from '../types';
import wordData from '../data/words.json';
import verbData from '../data/verbs.json';
import morphemeData from '../data/verbMorphemes.json';

// No /g on either: these are handed to String.split and String.test, and a global flag on
// a shared regex is a standing invitation to the lastIndex bug.
const TOKEN_RE = /([ა-ჿ]+(?:-[ა-ჿ]+)*)/;
const WHOLE_TOKEN_RE = /^[ა-ჿ]+(?:-[ა-ჿ]+)*$/;

const wordsById = new Map(wordData.words.map(word => [word.id, word]));
const verbsById = new Map(verbData.verbs.map(verb => [verb.id, verb]));

/** A run of prose: either one dictionary-sized word, or the punctuation between two. */
export interface Piece {
  text: string;
  word: boolean;
}

/**
 * Splits a paragraph into words and the gaps between them. The capturing group makes
 * String.split hand back both, alternating, so the original text can be reassembled
 * exactly — spacing and punctuation included.
 */
export function pieces(paragraph: string): Piece[] {
  return paragraph
    .split(TOKEN_RE)
    .filter(Boolean)
    .map(text => ({ text, word: WHOLE_TOKEN_RE.test(text) }));
}

/** Everything the popover needs about one word, gathered from the three data files. */
export interface Reading {
  form: string;
  entry: StoryGloss;
  /** The full dictionary entry, when the glossary points at one. */
  word?: Word;
  verb?: Verb;
  /** The verb's morphemes, for colouring the form the way the verb pages do. */
  lex?: VerbMorphemes;
  /** Where "full entry" goes, when there is one to go to. */
  href?: string;
  /** The part of speech, from whichever source knows it. */
  pos: string;
  /** Extra senses worth showing under the headline meaning. */
  senses: string[];
}

/**
 * What to show for a form. A glossary record carries its own `gloss` so that supplement
 * words — the function words and proper names words.json never had — still say something;
 * where it also carries a `ref`, the live dictionary entry is preferred, so the reader
 * never drifts out of step with a corrected words.json.
 */
export function reading(story: Story, form: string): Reading | null {
  const entry = story.glossary[form];
  if (!entry) return null;

  const base: Reading = { form, entry, pos: '', senses: [] };

  if (entry.ref?.kind === 'word') {
    const word = wordsById.get(entry.ref.id);
    if (word) {
      return {
        ...base,
        word,
        href: `/category/${word.categoryId}`,
        pos: word.partOfSpeech,
        senses: word.englishFull.slice(1),
      };
    }
  }

  if (entry.ref?.kind === 'verb') {
    const verb = verbsById.get(entry.ref.id);
    if (verb) {
      return {
        ...base,
        verb,
        lex: morphemeData.verbs[verb.id] ?? undefined,
        href: `/verbs/${verb.id}`,
        pos: verb.transitivity || 'Verb',
        senses: verb.senses,
      };
    }
  }

  return base;
}

/** The meaning to lead with: the dictionary's, or the glossary's own for supplement words. */
export function meaning(item: Reading): string {
  return item.word?.english || item.verb?.english || item.entry.gloss;
}

/** The headword to show the form under, if it differs from the form itself. */
export function headword(item: Reading): string {
  if (item.word) return item.word.georgian.split('/')[0].trim().replace(/\*+$/, '').replace(/\d+$/, '');
  if (item.verb) return item.verb.verbalNoun || item.verb.present3sg;
  return item.entry.lemma || '';
}

/** True when the form carries a meaning worth offering — the rest stays plain text. */
export function isLinked(story: Story, form: string): boolean {
  const entry = story.glossary[form];
  return Boolean(entry && (entry.ref || entry.gloss));
}
