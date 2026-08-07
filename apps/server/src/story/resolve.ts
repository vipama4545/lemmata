// Binding every word of a story to a lexicon entry and to the sense that applies there.
//
// This is scripts/buildStoryData.cjs's matcher, moved to the server so a story pasted into
// the admin screens links itself the same way one built offline does. The indexes it needs
// come out of Postgres rather than out of data/*.json; the resolution order, the suffix
// tables and the rules about what counts as a guess are the same, because they are the part
// that was arrived at by looking at output and correcting it.
//
// Resolution order for a token, first hit wins:
//
//   1. an existing hand-made record   — a name or an override already on the token
//   2. the lexicon's own forms index  — a form someone has already confirmed
//   3. an exact paradigm hit          — ~38,000 conjugated forms, never guessed
//   4. the nominal peeler             — case, number and postposition endings
//   5. the tagger's lemma             — when a tagger is running; see story/analyser.ts
//
// Confidence falls off down that list, and `check` marks what is genuinely a guess: anything
// the peeler had to reconstruct, and anything more than one entry answers to. A confirmed
// form and an unambiguous paradigm cell are not guesses and are not flagged, which is what
// keeps the flag worth reading.
//
// Step 5 is optional and recent. Steps 2, 3 and 4 all match a *spelling*, which is why they
// cannot tell და "and" from და "sister" and never could: nothing in the letters says which,
// and the winner was whichever entry sat earlier in the words table. A tagger answers a
// different question — what part of speech is this word, *here* — and that is the one piece
// of evidence a spelling cannot carry. It is used three ways, all of them conservative:
//
//   · to choose between entries that spell the same, inside step 4 — this is the და fix
//   · to reach a lemma the peeler cannot, as step 5, which for verbs is most of them
//   · to flag a paradigm hit the tagger contradicts — გვიან is the adverb "late" far more
//     often than it is the 3pl present of "to sweep", and step 3 had no way to doubt itself
//
// It never overrules a person or a confirmed form, and a tag that would leave a token with
// no candidate at all is discarded rather than obeyed. With no tagger reachable every one of
// those falls away and this file behaves exactly as it did before.
//
// The tagger sits *below* the peeler rather than above it, which is worth saying because the
// other order is the obvious one. The peeler's suffix tables were arrived at by reading its
// output on these stories and correcting it; the tagger was trained on 56,000 tokens of
// modern encyclopaedic prose. On this corpus the incumbent is the better bet, so it keeps
// first refusal and the tagger picks up what it drops — which is mostly verbs, since the
// peeler is not allowed near them. Swapping the two is a two-line change if that stops
// being true.
//
// Step 1 is the difference from the offline script. There, hand corrections come from
// storyOverrides.json and are applied on top; here they are already *in* the story as tokens
// marked `via: "name"` or `via: "override"`, so relinking preserves them instead of
// recomputing them. Same mechanism, one fewer file.

import { asc } from 'drizzle-orm';
import { SCREEVES } from '@georgian/shared/grammar';
import type { StoryAlt, StoryToken } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import { contradictsVerb, posAgrees, type Tag, type Tags } from './analyser.ts';
import { analyses, ENCLITICS } from './peel.ts';
import { tokenise, WORD_ONLY } from './tokenise.ts';

/* ------------------------------------------------------------------ indexes */

/** The minimum a lexicon entry has to say for the matcher to use it. */
interface LexWord {
  id: string;
  georgian: string;
  english: string;
  partOfSpeech: string;
  defaultSense: number | null;
  verbId: string | null;
  senseCount: number;
}

export interface Indexes {
  byId: Map<string, LexWord>;
  /** Headword spelling exactly as written, marks and all — what an override names. */
  byHeadword: Map<string, LexWord>;
  /** A confirmed inflected form, and the label that goes with it. */
  forms: Map<string, { word: LexWord; gram: string }>;
  /** Cleaned headword spellings, for the peeler to land on. Verbs excluded. */
  lemmas: Map<string, LexWord[]>;
  /**
   * The same for verb entries, which `lemmas` leaves out.
   *
   * Kept apart rather than merged, because the exclusion from `lemmas` is load-bearing: the
   * peeler takes nominal endings off anything it is shown, and shown a verb headword it
   * produced შინ "at home" from შია "is hungry". Only the tagger reads this map, and only
   * when it has already said the token is a verb — so nothing is stripped to reach it.
   *
   * Georgian UD lemmatises verbs to the 3sg present, which is how words.json spells its
   * verb headwords too: ადგენს, ქმნის, სწავლობს. The two conventions meet without any
   * translation between them, which is the only reason this step is a plain lookup.
   */
  verbLemmas: Map<string, LexWord[]>;
  /** Which lexicon entry owns a given paradigm. */
  byVerbId: Map<string, LexWord>;
  /** Conjugated form → the paradigm cells it fills. */
  verbForms: Map<string, { id: string; screeve: string; person: string }[]>;
  /** Spellings two lemmas both claim. The first listed wins; this is the report. */
  contested: { form: string; held: LexWord; lost: LexWord }[];
}

const SCREEVE_LABEL: Record<string, string> = Object.fromEntries(
  SCREEVES.map(screeve => [screeve.key, screeve.label]),
);

/**
 * Cells in the conjugation spreadsheet may carry a negative particle alongside the form
 * itself; those are not part of the verb.
 */
const CELL_PARTICLES = new Set(['ნუ', 'ნურ', 'არ', 'ვერ', 'მუ']);

/**
 * The real forms a paradigm cell stands for.
 *
 * A cell may offer alternatives ("ავაშენებ/ავიშენებ"), which are each a form in their own
 * right, or be periphrastic ("თანახმა იყო"), which is two words that only mean the verb
 * together. Splitting both on whitespace is what once made და — the commonest word in the
 * story — come out as the prohibitive of "to get infected". So alternatives are separated
 * first, and an alternative still holding more than one word is dropped rather than broken up.
 */
function cellForms(cell: string): string[] {
  if (!cell || /[A-Za-z%|]/.test(cell)) return [];
  const forms: string[] = [];

  for (const alternative of cell.split(/[/,]+/)) {
    const text = alternative.trim();
    if (!text) continue;
    // A parenthesised preverb — "(მო)ესმა" — marks it optional, so the cell stands for two
    // real forms. Treating the brackets as separators instead would index the preverb მო on
    // its own as if it were a verb, and never produce მოესმა at all.
    const variants = text.includes('(')
      ? [text.replace(/\([^)]*\)/g, ''), text.replace(/[()]/g, '')]
      : [text];
    for (const variant of variants) {
      const parts = variant
        .trim()
        .split(/\s+/)
        .filter(word => word && !CELL_PARTICLES.has(word));
      if (parts.length === 1 && WORD_ONLY.test(parts[0])) forms.push(parts[0]);
    }
  }
  return forms;
}

/** words.json headwords carry editorial marks the prose will never contain. */
function headwordKeys(georgian: string): string[] {
  const keys: string[] = [];
  for (const part of georgian.split('/')) {
    const clean = part.trim().replace(/\*+$/, '').replace(/\d+$/, '').trim();
    if (clean && !clean.includes('...') && !clean.includes(' ')) keys.push(clean);
  }
  return keys;
}

/**
 * Every index the matcher needs, from four queries.
 *
 * Built fresh per relink rather than cached. A relink happens when somebody presses a button
 * and takes a second either way; a cache would have to be invalidated by every word edit,
 * and a stale form index is exactly the failure that would be hardest to see.
 */
export async function buildIndexes(): Promise<Indexes> {
  const [wordRows, senseRows, formRows, verbFormRows] = await Promise.all([
    db.select().from(schema.words).orderBy(asc(schema.words.position)),
    db.select({ wordId: schema.wordSenses.wordId }).from(schema.wordSenses),
    db.select().from(schema.wordForms).orderBy(asc(schema.wordForms.position)),
    db.select().from(schema.verbForms),
  ]);

  const senseCounts = new Map<string, number>();
  for (const row of senseRows) senseCounts.set(row.wordId, (senseCounts.get(row.wordId) ?? 0) + 1);

  const byId = new Map<string, LexWord>();
  const byHeadword = new Map<string, LexWord>();
  for (const row of wordRows) {
    const word: LexWord = {
      id: row.id,
      georgian: row.georgian,
      english: row.english,
      partOfSpeech: row.partOfSpeech,
      defaultSense: row.defaultSense,
      verbId: row.verbId,
      senseCount: senseCounts.get(row.id) ?? 0,
    };
    byId.set(row.id, word);
    if (!byHeadword.has(row.georgian)) byHeadword.set(row.georgian, word);
  }

  // Confirmed forms. A form listed under a lemma is that lemma, full stop.
  const forms = new Map<string, { word: LexWord; gram: string }>();
  const contested: Indexes['contested'] = [];
  for (const row of formRows) {
    const word = byId.get(row.wordId);
    if (!word) continue;
    const held = forms.get(row.form);
    // Two lemmas claiming one spelling is a decision, not a race. Whoever is listed first
    // would quietly win it and the loser would look like it was never indexed at all —
    // which is how ველი "field" kept resolving to ელის "expects" after being added.
    if (held) {
      if (held.word.id !== word.id) contested.push({ form: row.form, held: held.word, lost: word });
      continue;
    }
    forms.set(row.form, { word, gram: row.gram ?? '' });
  }

  // Lemma spellings, for the peeler to land on. Verbs are excluded on purpose — a nominal
  // ending peeled off a verb headword is how შინ ("at home") came out as შია ("is hungry").
  const lemmas = new Map<string, LexWord[]>();
  const verbLemmas = new Map<string, LexWord[]>();
  for (const word of byId.values()) {
    const into = word.partOfSpeech === 'Verb' ? verbLemmas : lemmas;
    for (const key of headwordKeys(word.georgian)) {
      const list = into.get(key);
      if (list) list.push(word);
      else into.set(key, [word]);
    }
  }

  // Which lexicon entry owns a given paradigm. A paradigm nobody claims cannot be linked to,
  // because there would be no word for the token to point at.
  const byVerbId = new Map<string, LexWord>();
  for (const word of byId.values()) {
    if (word.verbId && !byVerbId.has(word.verbId)) byVerbId.set(word.verbId, word);
  }

  // Conjugated form → the paradigm cells it fills. Exact hits only: the paradigm table
  // already enumerates every form, so reconstructing one would be inventing morphology it
  // answers.
  const verbForms = new Map<string, { id: string; screeve: string; person: string }[]>();
  for (const row of verbFormRows) {
    for (const form of cellForms(row.form)) {
      const cells = verbForms.get(form);
      const cell = { id: row.verbId, screeve: row.screeve, person: row.person };
      if (!cells) verbForms.set(form, [cell]);
      else if (!cells.some(c => c.id === cell.id && c.screeve === cell.screeve && c.person === cell.person)) {
        cells.push(cell);
      }
    }
  }

  return { byId, byHeadword, forms, lemmas, verbLemmas, byVerbId, verbForms, contested };
}

/* ----------------------------------------------------------------- matching */

/** The sense to lead with when nothing pins one: the lexicon's own choice, or the first. */
function defaultSense(word: LexWord): number {
  return word.defaultSense ?? 1;
}

interface Resolved {
  word: LexWord;
  sense: number;
  gram: string;
  via: string;
  alts: LexWord[];
  check: boolean;
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
function preferByPos(hits: LexWord[], tag?: Tag): { hits: LexWord[]; decided: boolean } {
  if (!tag || hits.length < 2) return { hits, decided: false };

  const agree = hits.filter(word => posAgrees(tag.upos, word.partOfSpeech));
  if (!agree.length || agree.length === hits.length) return { hits, decided: false };

  const rest = hits.filter(word => !agree.includes(word));
  return { hits: [...agree, ...rest], decided: agree.length === 1 };
}

/**
 * What one spelling resolves to, or null when nothing claims it.
 *
 * `unclaimed` collects paradigms that matched but that no lexicon entry owns — the report
 * turns those into the one-line entry that would claim them, which is the single most useful
 * thing to know after linking a new story.
 *
 * `tag` is what the tagger said about *this occurrence*, so two occurrences of one spelling
 * can resolve differently — which is the entire point of it and the reason the caller's
 * cache is keyed on the tag as well as the spelling.
 */
function resolveForm(
  token: string,
  indexes: Indexes,
  unclaimed: Map<string, number>,
  tag?: Tag,
): Resolved | null {
  const { forms, lemmas, verbLemmas, byVerbId, verbForms } = indexes;

  // 2. A form somebody has already confirmed belongs to a lemma.
  const confirmed = forms.get(token);
  if (confirmed) {
    return {
      word: confirmed.word,
      sense: defaultSense(confirmed.word),
      gram: confirmed.gram,
      via: 'form index',
      alts: [],
      check: false,
    };
  }

  // 3. An exact paradigm hit. One enclitic particle may sit on top of it (მაშინვე, მოვიდაც),
  // so that is stripped first, but nothing is reconstructed.
  const candidates = [{ text: token, peeled: [] as string[] }];
  for (const { suffix, label } of ENCLITICS) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      candidates.push({ text: token.slice(0, -suffix.length), peeled: [label] });
    }
  }

  for (const candidate of candidates) {
    const hits = verbForms.get(candidate.text);
    if (!hits?.length) continue;

    // Distinct verbs only: one form filling several cells of the same paradigm (2sg and 3sg
    // optative are routinely identical) is not an ambiguity the reader has to resolve.
    const claimed = hits.filter(hit => byVerbId.has(hit.id));
    if (!claimed.length) {
      for (const hit of hits) unclaimed.set(hit.id, (unclaimed.get(hit.id) ?? 0) + 1);
      continue;
    }

    const hit = claimed[0];
    const word = byVerbId.get(hit.id)!;
    const others = [...new Map(claimed.slice(1).map(h => [h.id, h])).values()].filter(h => h.id !== hit.id);

    // A conjugated form the tagger says is not a verb, *and* a non-verb entry spelled the
    // same for it to have meant instead. Both halves are needed. This is the გვიან case —
    // the adverb "late", which the 3pl present of "to sweep" had been quietly outranking
    // with nothing to show for it — but the tag alone is not enough to raise it: on this
    // prose the tagger calls a Georgian verb a noun or an adverb often enough (five times
    // in one 638-token story) that acting on that by itself is noise, not a warning. A
    // rival entry is what turns it into the choice it actually is.
    const rival =
      tag && contradictsVerb(tag.upos)
        ? (lemmas.get(candidate.text) ?? []).filter(entry => posAgrees(tag.upos, entry.partOfSpeech))
        : [];
    const trail = candidate.peeled.length ? `paradigm, -${candidate.peeled.join(' -')}` : 'paradigm';

    return {
      word,
      sense: defaultSense(word),
      gram: [SCREEVE_LABEL[hit.screeve] ?? hit.screeve, hit.person].filter(Boolean).join(' '),
      via: rival.length ? `${trail}, tagged ${tag!.upos}` : trail,
      // The rival goes in the shortlist too: an editor told the tagger disagrees will want
      // the entry it disagreed in favour of, not a flag and a search box.
      alts: [...others.map(h => byVerbId.get(h.id)).filter((w): w is LexWord => Boolean(w)), ...rival],
      // A verbatim hit in a curated paradigm table is as good as a confirmed form — unless
      // two different verbs spell a cell the same way, which is a real choice to make, or
      // the tagger read the sentence and named a different word that spells the same.
      check: others.length > 0 || rival.length > 0,
    };
  }

  // 4. The peeler.
  for (const analysis of analyses(token)) {
    const found = lemmas.get(analysis.form);
    if (!found?.length) continue;

    // Where two entries spell the same, the tag chooses. და is the whole of this case in
    // the lexicon as it stands: sister and and*, decided by CCONJ against Conjunction.
    const { hits, decided } = preferByPos(found, tag);

    const trail: string[] = [
      analysis.form === token ? 'headword' : analysis.peeled.length ? `-${analysis.peeled.join(' -')}` : 'restored',
    ];
    if (analysis.note) trail.push(analysis.note);
    if (decided) trail.push(`tagged ${tag!.upos}`);

    const reconstructed = analysis.form !== token || Boolean(analysis.note);

    return {
      word: hits[0],
      sense: defaultSense(hits[0]),
      gram: analysis.peeled.join('.'),
      via: trail.join(', '),
      alts: hits.slice(1),
      // The headword spelled out in full is not a guess; anything peeled or restored is, and
      // so is a spelling more than one entry answers to — unless the tagger settled which.
      check: reconstructed || (hits.length > 1 && !decided),
    };
  }

  // 5. The tagger's lemma, for what the peeler could not reach.
  //
  // Mostly verbs. The peeler is kept away from verb headwords on purpose, so a conjugated
  // form missing from the paradigm tables — and only 165 of 603 paradigms are claimed by an
  // entry — had nowhere left to go and came out unresolved. Georgian UD lemmatises verbs to
  // the 3sg present, which is the form words.json files them under, so the tagger's answer
  // is a key into the lexicon with nothing in between.
  if (tag) {
    const verbal = tag.upos === 'VERB' || tag.upos === 'AUX';
    const found = (verbal ? verbLemmas : lemmas).get(tag.lemma) ?? [];
    // Agreement is required here rather than merely preferred: this step is reached only
    // because everything better has already failed, and a lemma that lands on an entry of
    // the wrong kind is the tagger being wrong twice rather than evidence of anything.
    const hits = found.filter(word => posAgrees(tag.upos, word.partOfSpeech));

    if (hits.length) {
      // What the tagger split off the head, if anything: the ში of სახლში, the copula of
      // ობიექტია. `tag.lemma` is already the head alone, which is why this step reaches a
      // headword at all for a spelling that has a postposition welded to it — the rest is
      // grammar, and is reported the way the peeler reports the endings it strips.
      const glued = (tag.parts ?? []).filter(part => part.lemma !== tag.lemma);
      const split = glued.map(part => part.lemma).join('.');

      return {
        word: hits[0],
        sense: defaultSense(hits[0]),
        gram: split,
        via: split
          ? `split ${tag.lemma}+${glued.map(p => p.lemma).join('+')}`
          : tag.lemma === token
            ? `headword, tagged ${tag.upos}`
            : `lemma ${tag.lemma}`,
        alts: hits.slice(1),
        // Always a guess. Nothing confirmed it, and it is here because the lexicon's own
        // machinery had already run out — exactly the case the flag exists to mark.
        check: true,
      };
    }
  }

  return null;
}

/* ------------------------------------------------------------------ linking */

/** A token row as it is stored, minus the story it belongs to. */
export interface ResolvedToken {
  paragraph: number;
  position: number;
  form: string;
  wordId: string | null;
  sense: number | null;
  gram: string | null;
  name: string | null;
  via: string;
  needsCheck: boolean;
  alts: StoryAlt[];
  comment: string | null;
}

/**
 * A record a person made rather than the resolver, carried across a relink untouched.
 *
 * Keyed by `${paragraph}:${position}:${form}` — the spelling is part of the key on purpose.
 * If the prose is edited, the words after the edit shift along, and a pin re-applied by
 * position alone would land on a different word and assert something nobody said. Including
 * the form makes that case drop the pin instead, which is recoverable; the other is not.
 */
export type Pinned = Map<string, StoryToken>;

/** True of the tokens a person decided. See the note on `story_tokens.via`. */
export function isHandMade(via: string): boolean {
  return via === 'name' || via.startsWith('override');
}

export function pinKey(paragraph: number, position: number, form: string): string {
  return `${paragraph}:${position}:${form}`;
}

export interface LinkReport {
  tokens: ResolvedToken[];
  stats: {
    tokens: number;
    distinctForms: number;
    covered: number;
    coverage: number;
    names: number;
    unresolved: number;
    flagged: number;
  };
  /** Spellings nothing matched, commonest first. */
  unresolved: { form: string; count: number }[];
  /** Links reached by a guess, commonest first. */
  flagged: { form: string; count: number }[];
  /** Paradigms that matched but that no lexicon entry claims, commonest first. */
  unclaimedVerbs: { verbId: string; count: number }[];
}

/**
 * Links a whole story: one record per word occurrence, in reading order.
 *
 * `pinned` is applied first and short-circuits everything else, which is what makes this
 * safe to run again after any change to the lexicon — the words a person placed stay where
 * they were placed, and every other token is worked out afresh against the dictionary as it
 * now stands.
 */
export function linkStory(
  paragraphs: string[],
  indexes: Indexes,
  pinned: Pinned,
  tags?: Tags | null,
): LinkReport {
  const tokens: ResolvedToken[] = [];
  const unclaimed = new Map<string, number>();
  const unresolvedCounts = new Map<string, number>();
  const flaggedCounts = new Map<string, number>();
  const distinct = new Set<string>();

  let linked = 0;
  let named = 0;

  // Resolved once per distinct spelling: a story of 976 tokens holds around 575 spellings,
  // and the peeler is the expensive step. A pin is applied on top of the shared result.
  //
  // Keyed on the tag as well as the spelling. A tagger exists precisely so that one spelling
  // can resolve two ways in one story, and a cache on the spelling alone would hand the
  // first occurrence's answer to every later one and quietly undo the whole thing.
  const cache = new Map<string, Resolved | null>();
  const resolveOnce = (form: string, tag?: Tag): Resolved | null => {
    const key = tag ? `${form}\0${tag.upos}\0${tag.lemma}` : form;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const resolved = resolveForm(form, indexes, unclaimed, tag);
    cache.set(key, resolved);
    return resolved;
  };

  paragraphs.forEach((paragraph, p) => {
    const words = tokenise(paragraph);

    // Tags are read back by position, so a paragraph is only tagged if the reply still has
    // exactly one entry per word in it. The client checks this against what it sent; this
    // checks it against what is actually being linked, which is not the same claim if the
    // prose was edited between the two. Same rule as `at()` on the web side: a position is
    // believed only when something independent of it agrees.
    const tagged = tags?.[p]?.length === words.length ? tags[p] : undefined;

    words.forEach((form, t) => {
      distinct.add(form);

      // 1. A record a person made. Carried straight across, exactly as it was.
      const pin = pinned.get(pinKey(p, t, form));
      if (pin) {
        if (pin.name) named += 1;
        else if (pin.word) linked += 1;
        // Counted as flagged, exactly as the resolver's own guesses are: an editor who
        // marked a pin "come back to this" wants it in the same list.
        if (pin.check) flaggedCounts.set(form, (flaggedCounts.get(form) ?? 0) + 1);
        tokens.push({
          paragraph: p,
          position: t,
          form,
          wordId: pin.word ?? null,
          sense: pin.sense ?? null,
          gram: pin.gram ?? null,
          name: pin.name ?? null,
          via: pin.via,
          // Carried across, not cleared. Deciding something and being sure of it are
          // different claims, and only the editor knows which one they made.
          needsCheck: pin.check === true,
          alts: pin.alts ?? [],
          comment: pin.comment ?? null,
        });
        return;
      }

      // Absent for every token when no tagger is reachable, which is the null that makes
      // all of this optional: resolveForm without a tag is the function as it was.
      const resolved = resolveOnce(form, tagged?.[t]);

      if (!resolved) {
        unresolvedCounts.set(form, (unresolvedCounts.get(form) ?? 0) + 1);
        tokens.push({
          paragraph: p,
          position: t,
          form,
          wordId: null,
          sense: null,
          gram: null,
          name: null,
          via: 'unresolved',
          needsCheck: false,
          alts: [],
          comment: null,
        });
        return;
      }

      linked += 1;
      if (resolved.check) flaggedCounts.set(form, (flaggedCounts.get(form) ?? 0) + 1);

      tokens.push({
        paragraph: p,
        position: t,
        form,
        wordId: resolved.word.id,
        sense: resolved.sense,
        gram: resolved.gram || null,
        name: null,
        via: resolved.via,
        needsCheck: resolved.check,
        // Kept so a wrong default can be corrected by pointing at one of these, and so the
        // editing screen has the shortlist it would otherwise have to recompute.
        alts: resolved.alts.slice(0, 4).map(word => ({ word: word.id, english: word.english })),
        comment: null,
      });
    });
  });

  const total = tokens.length;
  const covered = linked + named;
  const byCount = (a: { count: number; form: string }, b: { count: number; form: string }) =>
    b.count - a.count || a.form.localeCompare(b.form, 'ka');

  return {
    tokens,
    stats: {
      tokens: total,
      distinctForms: distinct.size,
      covered,
      coverage: total ? Number(((covered / total) * 100).toFixed(1)) : 0,
      names: named,
      unresolved: total - covered,
      flagged: [...flaggedCounts.values()].reduce((sum, n) => sum + n, 0),
    },
    unresolved: [...unresolvedCounts].map(([form, count]) => ({ form, count })).sort(byCount),
    flagged: [...flaggedCounts].map(([form, count]) => ({ form, count })).sort(byCount),
    unclaimedVerbs: [...unclaimed]
      .map(([verbId, count]) => ({ verbId, count }))
      .sort((a, b) => b.count - a.count || a.verbId.localeCompare(b.verbId)),
  };
}
