// Cutting Georgian prose into words, and prose into paragraphs.
//
// This is the one thing in the whole story pipeline that three separate places have to agree
// about exactly, because a token's *position* is its identity: the third paragraph's fourth
// word is what an override pins and what the reader counts to. If any two of these disagreed
// about where a word starts, every meaning after the disagreement would be shifted along by
// one, silently, with nothing to show anything was wrong.
//
// The three are:
//
//   this file                      — the server, resolving and storing tokens
//   apps/web/src/utils/story.ts    — the browser, painting them back over the prose
//   scripts/buildStoryData.cjs     — the offline build, still there for the batch route
//
// The web app repeats the pattern rather than importing it, because it splits with a
// capturing group to keep the punctuation and this one only scans; the script repeats it
// because it is CommonJS. Change one and the others have to follow. `at()` on the web side
// checks the recorded spelling against the text before believing a position, which is what
// turns a drift from silent corruption into a word that simply does not light up.

/**
 * Mkhedruli runs, with internal hyphens kept so that reduplicated names survive whole:
 * ნიფ-ნიფმა is one word to decline, not ნიფ + ნიფმა.
 *
 * Two regexes for one pattern because /g carries `lastIndex` between calls, which makes a
 * shared global regex alternate true and false on identical input when it is also used to
 * test. Scanning and testing therefore get one each.
 */
const WORD_SCAN = /[ა-ჿ]+(?:-[ა-ჿ]+)*/g;
export const WORD_ONLY = /^[ა-ჿ]+(?:-[ა-ჿ]+)*$/;

/** The words of one paragraph, in reading order. */
export function tokenise(text: string): string[] {
  return text.match(WORD_SCAN) ?? [];
}

/**
 * The same for a whole story, which is what the tagger has to be sent.
 *
 * It exists so that the tokens the tagger is asked about and the tokens the resolver walks
 * are produced by one call and cannot drift apart — the tagger's reply is read back by
 * position, so it is subject to the same rule as everything else in this file.
 */
export function tokeniseAll(paragraphs: string[]): string[][] {
  return paragraphs.map(tokenise);
}

/**
 * A pasted story, cut up the way a `.txt` under data/stories/ has always been read: blank
 * lines separate paragraphs, the first non-blank line is the title, and a lone "-" under it
 * is a typographic rule rather than a paragraph.
 *
 * Applied identically to the Georgian and to its translation, which is what keeps the two
 * columns of the split view lined up — the reader pairs them by index and has no other way
 * to tell which English paragraph belongs to which Georgian one.
 */
export function readLines(text: string): { title: string; paragraphs: string[] } {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return { title: lines[0] ?? '', paragraphs: lines.slice(1).filter(line => line !== '-') };
}
