// Finding a word in the list this browser already has.
//
// The whole lexicon rides along in the content snapshot, so every admin search is a scan over
// an array in memory rather than a request. 2,096 entries filtered per keystroke is well
// under a frame, and it keeps working when the network does not.

import type { Word } from '@georgian/shared/types';

/**
 * Ranked matches for a search term.
 *
 * A prefix match is almost always the one wanted — typing მგელ means მგელი — so those are
 * collected separately and put in front, rather than sorted for afterwards. Georgian and
 * English are searched together because the person typing knows which one they typed.
 */
export function searchWords(words: Word[], term: string, limit = 40): Word[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];

  const starts: Word[] = [];
  const contains: Word[] = [];

  for (const word of words) {
    const georgian = word.georgian.toLowerCase();
    const english = word.english.toLowerCase();

    if (georgian.startsWith(needle) || english.startsWith(needle)) starts.push(word);
    else if (georgian.includes(needle) || english.includes(needle)) contains.push(word);

    if (starts.length >= limit) break;
  }

  return [...starts, ...contains].slice(0, limit);
}
