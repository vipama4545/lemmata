// Cutting prose into words, and prose into paragraphs.
//
// This is the one thing in the whole story pipeline that four separate places have to agree
// about exactly, because a token's *position* is its identity: the third paragraph's fourth
// word is what an override pins and what the reader counts to. If any two of these disagreed
// about where a word starts, every meaning after the disagreement would be shifted along by
// one, silently, with nothing to show anything was wrong.
//
// The four are:
//
//   this file                      — the server, resolving and storing tokens
//   apps/web/src/utils/story.ts    — the browser, painting them back over the prose
//   apps/analyser/main.py          — the tagger, aligning its own tokenisation onto ours
//   scripts/buildStoryData.cjs     — the offline Georgian build, still there for the batch route
//
// The web app repeats the pattern rather than importing it, because it splits with a
// capturing group to keep the punctuation and this one only scans; the tagger repeats it
// because it is Python; the script repeats it because it is CommonJS and Georgian-only.
// Change one and the others have to follow. `at()` on the web side checks the recorded
// spelling against the text before believing a position, which is what turns a drift from
// silent corruption into a word that simply does not light up.

import type { Lang } from '@georgian/shared/grammar';

/**
 * Mkhedruli runs, with internal hyphens kept so that reduplicated names survive whole:
 * ნიფ-ნიფმა is one word to decline, not ნიფ + ნიფმა.
 */
const KA_WORD = '[ა-ჿ]+(?:-[ა-ჿ]+)*';

/**
 * Cyrillic runs, on the same hyphen rule — Russian needs it more than Georgian does, because
 * кто-то, из-за and по-русски are single words that a split on the hyphen would turn into
 * four fragments the lexicon has never heard of.
 *
 * The combining acute is part of a letter rather than a separator. Russian written for
 * learners marks its stresses — де́лать — and the dictionary stores the same marks in
 * `accented`; excluding U+0301 here would cut де́лать into "де" and "лать" and resolve
 * neither. It is admitted only *after* a letter, so a stray mark cannot be a word by itself.
 * The mark stays in the stored spelling, which is what keeps the browser's own split of the
 * same prose agreeing with this one; the resolver strips it when it looks a word up.
 */
const RU_LETTER = '[а-яёА-ЯЁ]\\u0301?';
const RU_WORD = `(?:${RU_LETTER})+(?:-(?:${RU_LETTER})+)*`;

const WORD_SOURCE: Record<Lang, string> = { ka: KA_WORD, ru: RU_WORD };

/**
 * One scanner per language, built once.
 *
 * /g is safe here only because these are handed to String.match, which resets `lastIndex`
 * before it iterates. A shared global regex given to .test() alternates true and false on
 * identical input, which is why the anchored patterns below are separate objects.
 */
const SCAN: Record<Lang, RegExp> = {
  ka: new RegExp(KA_WORD, 'g'),
  ru: new RegExp(RU_WORD, 'g'),
};

/** Whether the whole of a string is one word of this language, for the callers that ask. */
const WHOLE: Record<Lang, RegExp> = {
  ka: new RegExp(`^${KA_WORD}$`),
  ru: new RegExp(`^${RU_WORD}$`),
};

/** The pattern this language's words are scanned with, for the places that build their own. */
export function wordPattern(lang: Lang): string {
  return WORD_SOURCE[lang];
}

export function isWord(lang: Lang, text: string): boolean {
  return WHOLE[lang].test(text);
}

/** The words of one paragraph, in reading order. */
export function tokenise(lang: Lang, text: string): string[] {
  return text.match(SCAN[lang]) ?? [];
}

/**
 * The same for a whole story, which is what the tagger has to be sent.
 *
 * It exists so that the tokens the tagger is asked about and the tokens the resolver walks
 * are produced by one call and cannot drift apart — the tagger's reply is read back by
 * position, so it is subject to the same rule as everything else in this file.
 */
export function tokeniseAll(lang: Lang, paragraphs: string[]): string[][] {
  return paragraphs.map(paragraph => tokenise(lang, paragraph));
}

/**
 * A pasted text, cut up the way a `.txt` under data/<lang>/stories/ has always been read:
 * blank lines separate paragraphs, the first non-blank line is the title, and a lone "-"
 * under it is a typographic rule rather than a paragraph.
 *
 * Applied identically to the text and to its translation, which is what keeps the two
 * columns of the split view lined up — the reader pairs them by index and has no other way
 * to tell which English paragraph belongs to which foreign one.
 *
 * `titled` is what chapters added. A story's text has always opened with its title, but a
 * chapter of one often has no heading of its own, and reading the first line as one would
 * silently eat the opening sentence — a paragraph lost with nothing on screen to say so.
 */
export function readLines(text: string, titled = true): { title: string; paragraphs: string[] } {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (!titled) return { title: '', paragraphs: lines.filter(line => line !== '-') };
  return { title: lines[0] ?? '', paragraphs: lines.slice(1).filter(line => line !== '-') };
}
