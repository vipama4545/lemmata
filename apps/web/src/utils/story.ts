// Turning a story's prose back into clickable words, and resolving what each one means.
//
// The story records one entry per word *occurrence*, in reading order, so the reader has to
// cut a paragraph into exactly the tokens the server counted and then count to the same
// place. Those patterns are duplicated from apps/server/src/story/tokenise.ts rather than
// shared, because this one splits with a capturing group to keep the punctuation and that
// one only scans; if one changes the other has to follow. A drift between them would
// silently shift every meaning in a paragraph one word to the left, which is why `at`
// checks the recorded spelling before believing the position.

import type { Lang } from '@georgian/shared/grammar';
import type { Sense, Story, StoryToken, KaVerb, KaVerbMorphemes, Word } from '@georgian/shared/types';
import { derived, kaVerbsOf, lang, morphemeData } from '../content/store';
import { focusHref } from './scroll';

// No /g on any of them: these are handed to String.split and String.test, and a global flag
// on a shared regex is a standing invitation to the lastIndex bug.
//
// Hyphens are kept inside a word in both languages — ნიფ-ნიფმა is one word to decline, and
// so are кто-то and из-за — and Russian admits the combining acute after a letter, because
// prose written for learners marks its stresses and де́лать must not come apart.
const TOKEN_RE: Record<Lang, RegExp> = {
  ka: /([ა-ჿ]+(?:-[ა-ჿ]+)*)/,
  ru: /((?:[а-яёА-ЯЁ]́?)+(?:-(?:[а-яёА-ЯЁ]́?)+)*)/,
};

const WHOLE_TOKEN_RE: Record<Lang, RegExp> = {
  ka: /^[ა-ჿ]+(?:-[ა-ჿ]+)*$/,
  ru: /^(?:[а-яёА-ЯЁ]́?)+(?:-(?:[а-яёА-ЯЁ]́?)+)*$/,
};

const wordsById = derived(content => new Map(content.words.words.map(word => [word.id, word])));
const verbsById = derived(content => new Map(kaVerbsOf(content).map(verb => [verb.id, verb])));

/**
 * The Russian paradigms, as ids only.
 *
 * A Russian verb entry has a `verbId` exactly as a Georgian one does, but there is no
 * `RuVerb` on the card to show: the popover prints a screeve grid's worth of Georgian
 * morphology and nothing equivalent for Russian, which conjugates by rule on its own page.
 * So all this is asked for is whether the link would land anywhere.
 */
const ruVerbIds = derived(
  content => new Set(content.verbs.kind === 'ru' ? content.verbs.verbs.map(verb => verb.id) : []),
);

// What an inflected form means, keyed by the entry it belongs to and the spelling. Built
// once: a linear scan of every entry's forms per hovered word would be 2,095 entries for
// a card that has to appear within 140ms of the pointer stopping.
const formMeanings = derived(
  content =>
    new Map(
      content.words.words.flatMap(word =>
        (word.forms ?? [])
          .filter(entry => entry.english)
          .map(entry => [`${word.id}|${entry.form}`, entry.english as string]),
      ),
    ),
);

/**
 * Where a chapter lives.
 *
 * The first chapter has no number in its URL, so a story that never gains a second one has
 * exactly the address it has always had, and every link to it that exists still works. The
 * number shown is 1-based: a reader's third chapter is "3", and this is the only place that
 * translates between that and the 0-based position everything else counts in.
 */
export function chapterHref(storyId: string, position: number): string {
  const base = `/${lang()}/stories/${encodeURIComponent(storyId)}`;
  return position === 0 ? base : `${base}/${position + 1}`;
}

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
  const of = lang();
  let index = 0;
  return paragraph
    .split(TOKEN_RE[of])
    .filter(Boolean)
    .map(text => {
      const word = WHOLE_TOKEN_RE[of].test(text);
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
  verb?: KaVerb;
  /** The verb's morphemes, for colouring the form the way the verb pages do. */
  lex?: KaVerbMorphemes;
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

  const word = wordsById().get(token.word);
  if (!word) return base;

  const index = (token.sense ?? 1) - 1;
  const sense = word.senses[index] ?? word.senses[0] ?? null;
  const verb = word.verbId ? verbsById().get(word.verbId) : undefined;
  const paradigm = Boolean(verb) || Boolean(word.verbId && ruVerbIds().has(word.verbId));

  return {
    token,
    word,
    verb,
    lex: verb ? morphemeData().verbs[verb.id] ?? undefined : undefined,
    // The paradigm is the more useful page when there is one: it is where the form the
    // reader is looking at actually appears. Otherwise it is the word's category, opened
    // at the word rather than at the top of a list the word is somewhere inside. Checked
    // against the loaded paradigms either way — a `verbId` naming one the snapshot does not
    // have would be a link to a page that says "there is no verb with that id".
    href: paradigm ? `/${lang()}/verbs/${word.verbId}` : focusHref(`/category/${word.categoryId}`, word.id),
    pos: word.partOfSpeech || (verb?.transitivity ?? ''),
    sense,
    otherSenses: word.senses.filter((_, i) => i !== index).map(s => s.english),
    formMeaning: formMeanings().get(`${word.id}|${token.form}`) ?? '',
  };
}

/** The meaning to lead with. */
export function meaning(item: Reading): string {
  return item.sense?.english || item.token.name || '';
}

/** The headword to show the form under, if it differs from the form itself. */
export function headword(item: Reading): string {
  if (!item.word) return '';
  return item.word.headword.split('/')[0].trim().replace(/\*+$/, '').replace(/\d+$/, '');
}

/** True when the occurrence carries something worth offering — the rest stays plain text. */
export function isLinked(token: StoryToken | null): token is StoryToken {
  return Boolean(token && (token.word || token.name));
}
