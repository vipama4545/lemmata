// Cutting a paragraph into the units that get spoken.
//
// A sentence rather than a paragraph is the unit for three reasons, and they all point the
// same way. It is what a learner repeats — the gesture is "say that line again", never "say
// those nine lines again". It is what makes the cache cheap to keep correct: an admin fixing
// a typo re-synthesises one line instead of the page. And it is short enough that the first
// one can be playing while the rest are still being made.
//
// The split is on terminal punctuation only. Both languages' stories are full of dialogue
// written with dashes — "- მალე ზამთარი მოვა - უთხრა ერთხელ ძმებს ნაფ-ნაფმა." is one
// paragraph and one speech — and treating a dash as a break would cut lines in half at the
// place they are least meant to be cut.
//
// What this file must not do is lose a character. `firstWord` is a count of the words that
// came before, so if a slice were dropped or reordered every timing after it would land on
// the wrong word — the same failure mode tokenise.ts opens by describing, reached a
// different way. Everything between two breaks is kept, in order, and only runs that hold no
// word at all are dropped at the end.

import type { Lang } from '@georgian/shared/grammar';
import { tokenise } from '../story/tokenise.ts';

/** Terminal punctuation, in runs, so an ellipsis is one break rather than three. */
const TERMINAL = /[.!?…]+/gu;

/** One spoken line, and where its words sit in the paragraph it came from. */
export interface Sentence {
  /** The prose to speak, its punctuation included — the pause at the end is part of it. */
  text: string;
  /**
   * The position of its first word among the words of the whole paragraph.
   *
   * This is the number that makes a timing usable: the speech service returns spans in
   * sentence order, and adding this to each gives the paragraph-level word index that
   * `story_tokens.position` uses and that the reader keys its spans on. Without it the
   * browser would have to re-derive the sentence split to know which word span nine of
   * sentence three refers to, which is one more thing that could drift.
   */
  firstWord: number;
  /** How many words it holds. `firstWord + words` is the next sentence's `firstWord`. */
  words: number;
}

/**
 * The sentences of one paragraph, in reading order.
 *
 * A break is terminal punctuation followed by whitespace or the end of the paragraph, so a
 * decimal point or an abbreviation mid-word does not open a new line. Whitespace between two
 * sentences stays on the front of the second, which costs nothing — it holds no words, and
 * the speech service ignores leading space.
 */
export function sentences(lang: Lang, paragraph: string): Sentence[] {
  const slices: string[] = [];
  let start = 0;

  TERMINAL.lastIndex = 0;
  for (let match = TERMINAL.exec(paragraph); match; match = TERMINAL.exec(paragraph)) {
    const after = match.index + match[0].length;
    if (after >= paragraph.length || /\s/u.test(paragraph[after] ?? '')) {
      slices.push(paragraph.slice(start, after));
      start = after;
    }
  }
  if (start < paragraph.length) slices.push(paragraph.slice(start));

  const out: Sentence[] = [];
  let firstWord = 0;
  for (const text of slices) {
    const count = tokenise(lang, text).length;
    // A run with no words in it is punctuation or spacing that belongs to nothing — the
    // stray "---------------" a story has in it, say. Dropping it cannot shift `firstWord`,
    // precisely because it contributes no words to shift it by.
    if (count === 0) continue;
    out.push({ text: text.trim(), firstWord, words: count });
    firstWord += count;
  }
  return out;
}
