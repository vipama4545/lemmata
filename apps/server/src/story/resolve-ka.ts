// Reading a Georgian word of a story back to a lexicon entry.
//
// This is scripts/buildStoryData.cjs's matcher, moved to the server so a story pasted into
// the admin screens links itself the same way one built offline does. The indexes it needs
// come out of Postgres rather than out of data/*.json; the resolution order, the suffix
// tables and the rules about what counts as a guess are the same, because they are the part
// that was arrived at by looking at output and correcting it.
//
// Resolution order for a token, first hit wins. Step 1 — a record a person made — is applied
// by linkStory before any of this is reached, so the numbering starts at 2 to match the
// order given there:
//
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

import { SCREEVES } from '@georgian/shared/grammar/ka';
import { db, schema } from '../db/index.ts';
import { contradictsVerb, posAgrees, type Tag } from './analyser.ts';
import {
  defaultSense,
  loadLexicon,
  preferByPos,
  type Contested,
  type LexWord,
  type Lexicon,
  type Resolved,
} from './lexicon.ts';
import { analyses, ENCLITICS } from './peel-ka.ts';
import { isWord } from './tokenise.ts';

/** One cell of a paradigm, as the form index records it. */
export interface VerbCell {
  /** The paradigm's id, which `byVerbId` turns into the entry that owns it. */
  id: string;
  /** What to print for it: "Aorist 3sg". Built at index time so matching needs no tables. */
  label: string;
}

export interface KaIndexes extends Lexicon {
  lang: 'ka';
  /** Conjugated form → the paradigm cells it fills. */
  verbForms: Map<string, VerbCell[]>;
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
      if (parts.length === 1 && isWord('ka', parts[0])) forms.push(parts[0]);
    }
  }
  return forms;
}

/** Every index the Georgian matcher needs. Mkhedruli is unicase, so a key is a spelling. */
export async function buildKaIndexes(): Promise<KaIndexes> {
  const [lexicon, verbFormRows] = await Promise.all([
    loadLexicon('ka', spelling => spelling),
    db.select().from(schema.kaVerbForms),
  ]);

  // Conjugated form → the paradigm cells it fills. Exact hits only: the paradigm table
  // already enumerates every form, so reconstructing one would be inventing morphology it
  // answers.
  const verbForms = new Map<string, VerbCell[]>();
  for (const row of verbFormRows) {
    const label = [SCREEVE_LABEL[row.screeve] ?? row.screeve, row.person].filter(Boolean).join(' ');
    for (const form of cellForms(row.form)) {
      const cells = verbForms.get(form);
      const cell = { id: row.verbId, label };
      if (!cells) verbForms.set(form, [cell]);
      else if (!cells.some(c => c.id === cell.id && c.label === cell.label)) cells.push(cell);
    }
  }

  return { lang: 'ka', ...lexicon, verbForms };
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
export function resolveKa(
  token: string,
  indexes: KaIndexes,
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
      tag && contradictsVerb('ka', tag.upos)
        ? (lemmas.get(candidate.text) ?? []).filter(entry => posAgrees('ka', tag.upos, entry.partOfSpeech))
        : [];
    const trail = candidate.peeled.length ? `paradigm, -${candidate.peeled.join(' -')}` : 'paradigm';

    return {
      word,
      sense: defaultSense(word),
      gram: hit.label,
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
    const { hits, decided } = preferByPos('ka', found, tag);

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
    const hits = found.filter(word => posAgrees('ka', tag.upos, word.partOfSpeech));

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

export type { Contested };
