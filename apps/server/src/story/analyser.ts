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
// See apps/analyser/ for the service, and the README for how prose becomes one tag per token.

import { env } from '../env.ts';
import { tokeniseAll } from './tokenise.ts';

/** One piece of a token the tagger split — the noun and the postposition of სახლში. */
export interface Part {
  upos: string;
  lemma: string;
}

/** What the tagger says about one token. `upos` is the only field the resolver acts on. */
export interface Tag {
  /** A Universal POS tag: NOUN, VERB, CCONJ, ADV... Describes the token's head. */
  upos: string;
  /** The citation form. Nominative for nominals, 3sg present for verbs — as words.json spells them. */
  lemma: string;
  feats?: string | null;
  /**
   * Present only where the tagger split the token, and then every piece in order, head
   * included. Georgian glues its postpositions on: სახლში comes back tagged NOUN/სახლი —
   * which is a headword — with parts [NOUN სახლი, ADP ში]. Without the split the lemma is
   * the whole spelling, which is a headword nowhere.
   */
  parts?: Part[] | null;
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
 * Takes the prose, not the tokens: Stanza has to tokenise for itself or its MWT layer —
 * the thing that splits სახლში into სახლ + ში — cannot run. It re-cuts the same prose with
 * the same regex on its side and aligns by character offset, so the reply is still one tag
 * per token of `tokeniseAll(paragraphs)`, in order.
 *
 * That alignment is an agreement between two regexes in two languages, so it is checked
 * here rather than assumed. The resolver keys tags by position: a reply of the wrong length
 * would not fail, it would silently tag every word after the discrepancy as its neighbour.
 */
export async function analyse(paragraphs: string[]): Promise<Tags | null> {
  if (!env.ANALYSER_URL) return null;

  const expected = tokeniseAll(paragraphs);
  if (!expected.some(tokens => tokens.length)) return null;

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
    for (const [index, tokens] of expected.entries()) {
      if (!Array.isArray(tags[index]) || tags[index].length !== tokens.length) {
        console.warn(
          `analyser: paragraph ${index} came back ${tags[index]?.length} tags for ${tokens.length} ` +
            'tokens — the two tokenisers disagree; linking without tags',
        );
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
