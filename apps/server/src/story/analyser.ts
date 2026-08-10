// Asking the tagger what part of speech a word is, here.
//
// The resolver matches spellings, and a spelling cannot tell two entries apart: და is the
// conjunction "and" almost everywhere and the noun "sister" occasionally, Russian стали is
// the past of "become" and the genitive of "steel", and until now the winner was whichever
// sat earlier in the words table. This is the second opinion — one UPOS tag and one lemma
// per token — that lets the resolver choose on something other than list order.
//
// Everything here is optional by construction. ANALYSER_URL unset, container down, request
// slow, reply the wrong shape, a language the deployed image has no models for: all of them
// return null, and linkStory falls back to exactly the behaviour it had before any of this
// existed. A tagger that is merely absent must never be the reason an admin cannot save a
// story.
//
// See apps/analyser/ for the service, and the README for how prose becomes one tag per token.

import type { Lang } from '@georgian/shared/grammar';
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
  /** The citation form. Nominative for nominals, and for verbs whatever that language's
   * treebank lemmatises to — 3sg present in Georgian, the infinitive in Russian. Both are
   * how words.json spells its verb headwords, which is the whole reason this step works. */
  lemma: string;
  feats?: string | null;
  /**
   * Present only where the tagger split the token, and then every piece in order, head
   * included. Georgian glues its postpositions on: სახლში comes back tagged NOUN/სახლი —
   * which is a headword — with parts [NOUN სახლი, ADP ში]. Without the split the lemma is
   * the whole spelling, which is a headword nowhere. Russian glues nothing on and never
   * fills this in.
   */
  parts?: Part[] | null;
}

/** One tag per token, per paragraph, positionally identical to what was sent. */
export type Tags = Tag[][];

/**
 * Which of our `partOfSpeech` values a UPOS tag is compatible with, per language.
 *
 * Deliberately many-to-many and generous. The job is to *narrow* a collision, not to
 * adjudicate one: a tag that rules out every candidate has told us nothing useful and is
 * discarded rather than obeyed, so a mapping that is too tight costs coverage while one
 * that is too loose only costs the tiebreak.
 *
 * The two tables differ because the two lexicons do. Georgian UD uses 16 of the 17 UPOS
 * tags and words.json files its adpositions under "Postposition"; Russian writes them in
 * front of the noun and the Russian import calls them "Preposition", and it has a
 * "Determiner" bucket that Georgian has no use for.
 */
const COMPATIBLE: Record<Lang, Record<string, string[]>> = {
  ka: {
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
  },
  ru: {
    NOUN: ['Noun'],
    PROPN: ['Noun'],
    // SynTagRus tags participles and gerunds VERB with a VerbForm feature, and `conjugate`
    // produces both as cells of the paradigm — so a tagged VERB landing on a verb entry is
    // right for читающий as much as for читает.
    VERB: ['Verb'],
    AUX: ['Verb'],
    // Short-form adjectives are ADJ too (красив), and the lexicon files them under the long
    // form they belong to, which the adjective peeler is what reaches.
    ADJ: ['Adjective'],
    ADV: ['Adverb'],
    NUM: ['Numeral'],
    PRON: ['Pronoun'],
    // Russian DET is мой, этот, каждый, весь — which the import filed variously as a
    // determiner, a pronoun or an adjective, so all three are allowed.
    DET: ['Determiner', 'Pronoun', 'Adjective'],
    ADP: ['Preposition'],
    CCONJ: ['Conjunction'],
    SCONJ: ['Conjunction'],
    PART: ['Particle'],
    INTJ: ['Interjection'],
  },
};

/**
 * Whether a tag and a lexicon entry can be the same word.
 *
 * True when the tag carries no opinion — X, SYM, PUNCT, or anything a treebank grows later
 * that we have not mapped — and true for the one entry whose partOfSpeech is blank. Both are
 * "no evidence", and no evidence must not read as evidence against.
 */
export function posAgrees(lang: Lang, upos: string | undefined, partOfSpeech: string): boolean {
  if (!upos) return true;
  const allowed = COMPATIBLE[lang][upos];
  if (!allowed) return true;
  if (!partOfSpeech) return true;
  return allowed.includes(partOfSpeech);
}

/** True where the tagger positively contradicts a verb reading — the გვიან case. */
export function contradictsVerb(lang: Lang, upos: string | undefined): boolean {
  if (!upos) return false;
  const allowed = COMPATIBLE[lang][upos];
  return Boolean(allowed) && !allowed.includes('Verb');
}

/**
 * What the tagger is sent, which is not always the prose as it is written.
 *
 * Russian marks its stresses for learners, and Stanza was trained on newspapers that do not:
 * given ре́пу it returns the lemma ре́п, which is not a word, where репу returns репа, which is
 * a headword. The mark costs a lemma every time it appears, so it is taken off on the way out.
 *
 * The token count does not move, and that is not a hope — it follows from the pattern. A
 * Russian token is a run of letters, each optionally followed by the mark, joined by hyphens;
 * the mark is never admitted except after a letter and never appears at a boundary. So
 * removing every mark in a paragraph cannot make a token vanish (each still has its letters),
 * cannot split one (nothing separating was removed) and cannot merge two (what separates them
 * is untouched). The reply therefore lines up with the tokens of the prose as written, which
 * is what the check below asserts rather than assumes.
 *
 * The story keeps its marks. Only the copy the tagger sees loses them.
 */
const PREPARE: Record<Lang, (text: string) => string> = {
  ka: text => text,
  ru: text => text.replace(/́/g, ''),
};

/** How long to wait. A thousand tokens is well under a second once the models are warm. */
const TIMEOUT_MS = 20_000;

/** How long to wait for the much smaller question of which languages it has models for. */
const CAPABILITY_TIMEOUT_MS = 5_000;

/**
 * Which languages the deployed tagger can actually answer about, asked once and kept.
 *
 * This exists because the two halves of this feature deploy separately. Sending `lang: "ru"`
 * to an image built before Russian was added would not fail — an unknown field is ignored,
 * the Georgian pipeline runs, and every Russian word comes back tagged as though it were
 * Georgian. That is worse than no tagger at all, because the resolver would believe it. So
 * the service is asked what it has before it is asked anything else.
 *
 * Only a successful answer is cached. A refused or unreachable service is a state that ends,
 * and caching "it has nothing" would mean a restart of the analyser never took effect.
 */
let known: Set<string> | null = null;

async function languages(): Promise<Set<string> | null> {
  if (known) return known;
  if (!env.ANALYSER_URL) return null;

  try {
    const response = await fetch(new URL('/languages', env.ANALYSER_URL), {
      signal: AbortSignal.timeout(CAPABILITY_TIMEOUT_MS),
    });

    // An older image has no /languages at all. Its /health names the one language it was
    // built for, which is the same question asked of a service that predates the question.
    if (response.status === 404) {
      const health = await fetch(new URL('/health', env.ANALYSER_URL), {
        signal: AbortSignal.timeout(CAPABILITY_TIMEOUT_MS),
      });
      if (!health.ok) return null;
      const body = (await health.json()) as { lang?: string };
      known = new Set(body.lang ? [body.lang] : []);
      return known;
    }

    if (!response.ok) return null;
    const body = (await response.json()) as { languages?: string[] };
    if (!Array.isArray(body.languages)) return null;
    known = new Set(body.languages);
    return known;
  } catch (error) {
    console.warn(`analyser unavailable (${(error as Error).message}); linking without tags`);
    return null;
  }
}

/**
 * Tags for every token of every paragraph, or null if the tagger could not be reached.
 *
 * Takes the prose, not the tokens: Stanza has to tokenise for itself or its MWT layer —
 * the thing that splits სახლში into სახლ + ში — cannot run. It re-cuts the same prose with
 * the same regex on its side and aligns by character offset, so the reply is still one tag
 * per token of `tokeniseAll(lang, paragraphs)`, in order.
 *
 * That alignment is an agreement between two regexes in two languages, so it is checked
 * here rather than assumed. The resolver keys tags by position: a reply of the wrong length
 * would not fail, it would silently tag every word after the discrepancy as its neighbour.
 */
export async function analyse(lang: Lang, paragraphs: string[]): Promise<Tags | null> {
  if (!env.ANALYSER_URL) return null;

  const expected = tokeniseAll(lang, paragraphs);
  if (!expected.some(tokens => tokens.length)) return null;

  const available = await languages();
  if (!available) return null;
  if (!available.has(lang)) {
    console.warn(`analyser has no ${lang} models (it offers ${[...available].join(', ') || 'nothing'}); linking without tags`);
    return null;
  }

  try {
    const response = await fetch(new URL('/analyse', env.ANALYSER_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang, paragraphs: paragraphs.map(PREPARE[lang]) }),
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
