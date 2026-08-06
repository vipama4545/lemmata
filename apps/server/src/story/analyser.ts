// Asking the tagger what part of speech a word is, here.
//
// The resolver matches spellings, and a spelling cannot tell two entries apart: და is the
// conjunction "and" almost everywhere and the noun "sister" occasionally, and until now the
// winner was whichever sat earlier in the words table. This is the second opinion — one
// UPOS tag and one lemma per token — that lets it choose on something other than list order.
//
// Everything here is optional by construction. ANALYSER_URL unset, container down, request
// slow, reply the wrong shape: all of them return null, and linkStory falls back to exactly
// the behaviour it had before any of this existed. A tagger that is merely absent must never
// be the reason an admin cannot save a story.
//
// See apps/analyser/ for the service, and the README for why it is pretokenised.

import { env } from '../env.ts';

/** What the tagger says about one token. `upos` is the only field the resolver acts on. */
export interface Tag {
  /** A Universal POS tag: NOUN, VERB, CCONJ, ADV... */
  upos: string;
  /** The citation form. Nominative for nominals, 3sg present for verbs — as words.json spells them. */
  lemma: string;
  feats?: string | null;
}

/** One tag per token, per paragraph, positionally identical to what was sent. */
export type Tags = Tag[][];

/**
 * Which of our `partOfSpeech` values a UPOS tag is compatible with.
 *
 * Deliberately many-to-many and generous. The job is to *narrow* a collision, not to
 * adjudicate one: a tag that rules out every candidate has told us nothing useful and is
 * discarded rather than obeyed, so a mapping that is too tight costs coverage while one
 * that is too loose only costs the tiebreak. Georgian UD uses 16 of the 17 UPOS tags.
 */
const COMPATIBLE: Record<string, string[]> = {
  NOUN: ['Noun', 'Verbal Noun'],
  // The lexicon has no proper-noun category — those are story `name` tokens. Mapping this
  // to Noun anyway means a tagged name still matches a common noun that spells the same.
  PROPN: ['Noun'],
  VERB: ['Verb'],
  AUX: ['Verb'],
  ADJ: ['Adjective'],
  ADV: ['Adverb'],
  NUM: ['Numeral'],
  PRON: ['Pronoun'],
  // Georgian determiners are the demonstratives, which words.json files under Pronoun; a
  // few are adjectival.
  DET: ['Pronoun', 'Adjective'],
  ADP: ['Postposition'],
  CCONJ: ['Conjunction'],
  SCONJ: ['Conjunction'],
  PART: ['Particle'],
  INTJ: ['Interjection'],
};

/**
 * Whether a tag and a lexicon entry can be the same word.
 *
 * True when the tag carries no opinion — X, SYM, PUNCT, or anything Georgian UD grows
 * later that we have not mapped — and true for the one entry whose partOfSpeech is blank.
 * Both are "no evidence", and no evidence must not read as evidence against.
 */
export function posAgrees(upos: string | undefined, partOfSpeech: string): boolean {
  if (!upos) return true;
  const allowed = COMPATIBLE[upos];
  if (!allowed) return true;
  if (!partOfSpeech) return true;
  return allowed.includes(partOfSpeech);
}

/** True where the tagger positively contradicts a verb reading — the გვიან case. */
export function contradictsVerb(upos: string | undefined): boolean {
  if (!upos) return false;
  const allowed = COMPATIBLE[upos];
  return Boolean(allowed) && !allowed.includes('Verb');
}

/** How long to wait. A thousand tokens is well under a second once the models are warm. */
const TIMEOUT_MS = 20_000;

/**
 * Tags for every token of every paragraph, or null if the tagger could not be reached.
 *
 * The reply is checked against what was sent before it is believed. The resolver keys tags
 * by position, so a reply of the wrong length would not fail — it would silently tag every
 * word after the discrepancy as its neighbour, which is the same class of bug the three
 * tokenisers are written the way they are to avoid.
 */
export async function analyse(paragraphs: string[][]): Promise<Tags | null> {
  if (!env.ANALYSER_URL) return null;
  if (!paragraphs.some(tokens => tokens.length)) return null;

  try {
    const response = await fetch(new URL('/analyse', env.ANALYSER_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paragraphs }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`analyser: ${response.status} ${response.statusText}; linking without tags`);
      return null;
    }

    const body = (await response.json()) as { paragraphs?: Tags };
    const tags = body.paragraphs;

    if (!Array.isArray(tags) || tags.length !== paragraphs.length) {
      console.warn('analyser: reply did not match the request; linking without tags');
      return null;
    }
    for (const [index, tokens] of paragraphs.entries()) {
      if (!Array.isArray(tags[index]) || tags[index].length !== tokens.length) {
        console.warn(`analyser: paragraph ${index} came back the wrong length; linking without tags`);
        return null;
      }
    }

    return tags;
  } catch (error) {
    // Includes the timeout, DNS failure and connection refused — the ordinary states of a
    // sidecar that is starting, restarting or simply not deployed.
    console.warn(`analyser unavailable (${(error as Error).message}); linking without tags`);
    return null;
  }
}
