// The dictionary as the story resolvers read it.
//
// Both languages ask the words table the same four questions — what entries are there, what
// are they spelled, what inflected forms has somebody confirmed, and which paradigm does
// each entry own — so those live here rather than twice. What they do with the answers is
// where they part company, and that is in resolve-ka.ts and resolve-ru.ts.
//
// The one thing this file is parameterised by is `key`: how a spelling becomes a lookup key.
// Georgian's is the identity function, because Mkhedruli is unicase and words.json spells a
// headword exactly as prose does. Russian's folds case, the stress mark and ё, because prose
// capitalises the first word of every sentence and writes е where the dictionary writes ё —
// see the note above `foldRu`. Passing it in rather than branching keeps the Georgian path
// byte-for-byte what it was before there were two.

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { Lang } from '@georgian/shared/grammar';
import { db, schema } from '../db/index.ts';
import { posAgrees, type Tag } from './analyser.ts';

/** The minimum a lexicon entry has to say for a matcher to use it. */
export interface LexWord {
  id: string;
  headword: string;
  english: string;
  partOfSpeech: string;
  defaultSense: number | null;
  verbId: string | null;
  senseCount: number;
}

/** What a matcher decided one spelling is. */
export interface Resolved {
  word: LexWord;
  sense: number;
  gram: string;
  via: string;
  alts: LexWord[];
  check: boolean;
}

/** The sense to lead with when nothing pins one: the lexicon's own choice, or the first. */
export function defaultSense(word: LexWord): number {
  return word.defaultSense ?? 1;
}

/** A spelling two lemmas both claim. The first listed wins; this is the report. */
export interface Contested {
  form: string;
  held: LexWord;
  lost: LexWord;
}

/** Everything both matchers need out of the words table, keyed by `key`. */
export interface Lexicon {
  byId: Map<string, LexWord>;
  /** Headword spelling exactly as written, marks and all — what an override names. */
  byHeadword: Map<string, LexWord>;
  /** A confirmed inflected form, and the label that goes with it. */
  forms: Map<string, { word: LexWord; gram: string }>;
  /** Cleaned headword spellings, for a matcher to land on. Verbs excluded. */
  lemmas: Map<string, LexWord[]>;
  /**
   * The same for verb entries, which `lemmas` leaves out.
   *
   * Kept apart rather than merged, because the exclusion from `lemmas` is load-bearing in
   * Georgian: the peeler takes nominal endings off anything it is shown, and shown a verb
   * headword it produced შინ "at home" from შია "is hungry". Only the tagger reads this map,
   * and only when it has already said the token is a verb — so nothing is stripped to reach
   * it.
   *
   * Both treebanks lemmatise a verb to the form words.json files it under: the 3sg present
   * in Georgian (ადგენს, ქმნის), the infinitive in Russian (делать, прийти). The two
   * conventions meet without any translation between them, which is the only reason this
   * step is a plain lookup.
   */
  verbLemmas: Map<string, LexWord[]>;
  /** Which lexicon entry owns a given paradigm. */
  byVerbId: Map<string, LexWord>;
  contested: Contested[];
}

/** words.json headwords carry editorial marks the prose will never contain. */
export function headwordKeys(headword: string): string[] {
  const keys: string[] = [];
  for (const part of headword.split('/')) {
    const clean = part.trim().replace(/\*+$/, '').replace(/\d+$/, '').trim();
    if (clean && !clean.includes('...') && !clean.includes(' ')) keys.push(clean);
  }
  return keys;
}

/**
 * One language's slice of the dictionary, from three queries.
 *
 * Built fresh per relink rather than cached. A relink happens when somebody presses a button
 * and takes a second either way; a cache would have to be invalidated by every word edit,
 * and a stale form index is exactly the failure that would be hardest to see.
 *
 * `word_senses` and `word_forms` are fetched whole rather than scoped to this language's
 * ids: neither carries a `lang` of its own — getting one would mean a column that could
 * disagree with the word it hangs off — and an `IN` list of 30,000 ids is not a saving. The
 * rows of the other language fall out on the `byId` lookup below.
 *
 * `owner` is whose private vocabulary to include beside the published one, and this is the
 * only query here that reads both sides of `words.owner_id` at once. Null means the dictionary
 * alone, which covers every published story and every relink an admin runs. A user id means the
 * dictionary plus that person's own entries, which is what finds a word somebody added in the
 * text they added it for.
 *
 * Deliberately not "every private entry there is". Somebody else's gloss turning up in your
 * story would be a stranger's notebook leaking into your reading, and on a published story it
 * would be that leak to everyone at once.
 */
export async function loadLexicon(
  lang: Lang,
  key: (spelling: string) => string,
  owner: string | null = null,
): Promise<Lexicon> {
  const visible = owner
    ? and(eq(schema.words.lang, lang), or(isNull(schema.words.ownerId), eq(schema.words.ownerId, owner)))
    : and(eq(schema.words.lang, lang), isNull(schema.words.ownerId));

  const [wordRows, senseRows, formRows] = await Promise.all([
    db.select().from(schema.words).where(visible).orderBy(asc(schema.words.position)),
    db.select({ wordId: schema.wordSenses.wordId }).from(schema.wordSenses),
    db.select().from(schema.wordForms).orderBy(asc(schema.wordForms.position)),
  ]);

  const senseCounts = new Map<string, number>();
  for (const row of senseRows) senseCounts.set(row.wordId, (senseCounts.get(row.wordId) ?? 0) + 1);

  const byId = new Map<string, LexWord>();
  const byHeadword = new Map<string, LexWord>();
  for (const row of wordRows) {
    const word: LexWord = {
      id: row.id,
      headword: row.headword,
      english: row.english,
      partOfSpeech: row.partOfSpeech,
      defaultSense: row.defaultSense,
      verbId: row.verbId,
      senseCount: senseCounts.get(row.id) ?? 0,
    };
    byId.set(row.id, word);
    if (!byHeadword.has(row.headword)) byHeadword.set(row.headword, word);
  }

  // Confirmed forms. A form listed under a lemma is that lemma, full stop.
  const forms = new Map<string, { word: LexWord; gram: string }>();
  const contested: Contested[] = [];
  for (const row of formRows) {
    const word = byId.get(row.wordId);
    if (!word) continue;
    const folded = key(row.form);
    const held = forms.get(folded);
    // Two lemmas claiming one spelling is a decision, not a race. Whoever is listed first
    // would quietly win it and the loser would look like it was never indexed at all —
    // which is how ველი "field" kept resolving to ელის "expects" after being added.
    if (held) {
      if (held.word.id !== word.id) contested.push({ form: row.form, held: held.word, lost: word });
      continue;
    }
    forms.set(folded, { word, gram: row.gram ?? '' });
  }

  // Lemma spellings, for a matcher to land on. Verbs are excluded on purpose — see the note
  // on `verbLemmas` above.
  const lemmas = new Map<string, LexWord[]>();
  const verbLemmas = new Map<string, LexWord[]>();
  for (const word of byId.values()) {
    const into = word.partOfSpeech === 'Verb' ? verbLemmas : lemmas;
    for (const spelling of headwordKeys(word.headword)) {
      const folded = key(spelling);
      const list = into.get(folded);
      if (list) list.push(word);
      else into.set(folded, [word]);
    }
  }

  // Which lexicon entry owns a given paradigm. A paradigm nobody claims cannot be linked to,
  // because there would be no word for the token to point at.
  const byVerbId = new Map<string, LexWord>();
  for (const word of byId.values()) {
    if (word.verbId && !byVerbId.has(word.verbId)) byVerbId.set(word.verbId, word);
  }

  return { byId, byHeadword, forms, lemmas, verbLemmas, byVerbId, contested };
}

/**
 * Candidates reordered so the ones the tagger agrees with come first.
 *
 * `decided` says the tag left exactly one standing, which is a real disambiguation and not
 * a guess — that is what clears `check` on და. A tag that agrees with all of them or with
 * none of them has decided nothing, and the order is left alone: ruling out every candidate
 * would turn a mistagged word into an unresolved one, which is strictly worse than the
 * arbitrary-but-plausible entry it would otherwise have got.
 */
export function preferByPos(lang: Lang, hits: LexWord[], tag?: Tag): { hits: LexWord[]; decided: boolean } {
  if (!tag || hits.length < 2) return { hits, decided: false };

  const agree = hits.filter(word => posAgrees(lang, tag.upos, word.partOfSpeech));
  if (!agree.length || agree.length === hits.length) return { hits, decided: false };

  const rest = hits.filter(word => !agree.includes(word));
  return { hits: [...agree, ...rest], decided: agree.length === 1 };
}
