// Reading a Russian word of a story back to a lexicon entry.
//
// The Georgian matcher next door is a cascade: five steps in falling order of confidence,
// first hit wins. This one is not, and the difference is a fact about the two lexicons
// rather than a change of mind.
//
// Georgian's form index was typed in by a person, so a hit in it is a decision and outranks
// everything below it. Russian's was generated — 153,000 declined forms from an import, and
// 8,583 paradigms that `conjugate()` expands from a class and two stems. Those are not
// hand-confirmed and they are not of different confidences from each other: сталь's genitive
// and стать's past plural are both стали, both machine-derived, and neither has any claim to
// go first. Ordering them would be picking a winner by which query ran first, which is the
// bug the Georgian `contested` list exists to report.
//
// So the exact indexes are consulted *together* and the tagger chooses between what they
// return. That is the same use the Georgian matcher puts a tag to — narrowing a collision
// two spellings cannot — but applied at the top rather than inside one step, because here
// collisions are the normal case rather than the exception.
//
//   1. a record a person made      — applied by linkStory before any of this
//   2. every exact reading at once — headword, confirmed form, paradigm cell; tag decides
//   3. the adjectival peeler       — for adjectives and declined participles; always a guess
//   4. the tagger's lemma          — for what is left, which is mostly the irregular
//
// With no tagger reachable step 2 still works and simply cannot break a tie: it hands back
// the first reading in a fixed order and flags it, which is the honest answer to "these two
// entries both spell this and nothing here can tell them apart".
//
// Case, stress and ё are folded away before anything is looked up. See `foldRu`.

import { RU_CLASS_BY_ID, conjugate } from '@georgian/shared/grammar/ru';
import type { RuSlotKey, RuVerbRule } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import { posAgrees, type Tag } from './analyser.ts';
import {
  defaultSense,
  loadLexicon,
  preferByPos,
  type LexWord,
  type Lexicon,
  type Resolved,
} from './lexicon.ts';
import { adjectiveAnalyses } from './peel-ru.ts';

/**
 * A spelling as it is looked up: lower case, no stress mark, ё read as е.
 *
 * All three are needed and none of them is cosmetic.
 *
 * Case, because Russian capitalises the first word of every sentence and the lexicon files
 * headwords in lower case. Without this the first word of every sentence in the story would
 * be unresolved, which is one word in fifteen.
 *
 * The stress mark, because prose written for learners carries it and the dictionary keeps
 * it in a separate column: `words.accented` is де́лать and `words.headword` is делать. The
 * token keeps whichever it was written with — that is what the reader paints back — and only
 * the key drops it.
 *
 * ё, because almost nobody writes it. The lexicon has ещё, её and всё with the letter;
 * ordinary Russian prose spells all three with е, and so does Stanza's lemmatiser, which
 * returns "еще" for ещё. Folding it here is what lets the three meet. It does merge the odd
 * genuine pair — не́бо and нёбо, "sky" and "palate" — but a merged key is a key two entries
 * claim, which is a case this file already handles by flagging it rather than by guessing.
 */
export function foldRu(spelling: string): string {
  return spelling.toLowerCase().replace(/́/g, '').replace(/ё/g, 'е');
}

/** One cell of a paradigm, as the form index records it. */
export interface RuVerbCell {
  /** The paradigm's id, which `byVerbId` turns into the entry that owns it. */
  id: string;
  /** The slot, in the dotted style the noun forms already use: "pres.3sg", "past.f". */
  label: string;
}

export interface RuIndexes extends Lexicon {
  lang: 'ru';
  /** Every inflected verb form → the paradigm cells it fills. */
  verbForms: Map<string, RuVerbCell[]>;
}

/**
 * What to call a cell.
 *
 * The slot keys are already in the same dotted style as the noun forms the import wrote —
 * `gen.sg`, `nom.pl` — so they are used as they stand, with one substitution: a perfective
 * verb's `pres.*` cells are its simple future, and calling сде́лаю a present tense would be
 * wrong in the one place the reader is looking. See the note above RU_SLOTS.
 */
function cellLabel(slot: RuSlotKey, aspect: 'impf' | 'pf'): string {
  return aspect === 'pf' && slot.startsWith('pres.') ? slot.replace('pres.', 'fut.') : slot;
}

/**
 * Every index the Russian matcher needs.
 *
 * The verb half is derived rather than read: `ru_verb_forms` holds only the cells the rule
 * gets wrong, so the forms have to be expanded here exactly as the browser expands them for
 * the paradigm table. That is why `conjugate` lives in the shared package — the server's
 * index of what делаешь is a form of, and the page that prints делаешь, must not be able to
 * disagree. 8,583 verbs expand to something over 200,000 forms in well under a second.
 */
export async function buildRuIndexes(owner: string | null = null): Promise<RuIndexes> {
  const [lexicon, verbRows, overrideRows] = await Promise.all([
    loadLexicon('ru', foldRu, owner),
    db.select().from(schema.ruVerbs),
    db.select().from(schema.ruVerbForms),
  ]);

  const overridesByVerb = new Map<string, Record<string, string>>();
  for (const row of overrideRows) {
    const map = overridesByVerb.get(row.verbId) ?? {};
    map[row.slot] = row.form;
    overridesByVerb.set(row.verbId, map);
  }

  const verbForms = new Map<string, RuVerbCell[]>();
  for (const row of verbRows) {
    // Skip a verb whose class is not one we know: `conjugate` would have nothing to expand
    // it with, and a paradigm of nothing is not worth the exception it would throw.
    if (!RU_CLASS_BY_ID.has(row.classId as RuVerbRule['classId'])) continue;

    const rule: RuVerbRule = {
      infinitive: row.infinitive,
      aspect: row.aspect as RuVerbRule['aspect'],
      classId: row.classId as RuVerbRule['classId'],
      stemPresent: row.stemPresent,
      stemPresent1sg: row.stemPresent1sg,
      stemImperative: row.stemImperative,
      stemPast: row.stemPast,
      stemPastM: row.stemPastM,
      stressPresent: row.stressPresent as RuVerbRule['stressPresent'],
      stressPast: row.stressPast as RuVerbRule['stressPast'],
      stemStress: row.stemStress,
      stressInfinitive: row.stressInfinitive,
      reflexive: row.reflexive,
      transitivity: row.transitivity,
    };

    const paradigm = conjugate(rule, overridesByVerb.get(row.id) ?? {});

    for (const form of paradigm.forms) {
      // The compound future is two words — буду делать — and the half that is not буду is
      // the infinitive, which is in the list already. `inflectedForms` drops it for the same
      // reason; this walks the cells rather than that list because it wants the slot too.
      if (form.analytic) continue;

      const key = foldRu(form.form);
      const cell = { id: row.id, label: cellLabel(form.slot, rule.aspect) };
      const cells = verbForms.get(key);
      if (!cells) verbForms.set(key, [cell]);
      else if (!cells.some(c => c.id === cell.id && c.label === cell.label)) cells.push(cell);
    }
  }

  return { lang: 'ru', ...lexicon, verbForms };
}

/** One reading of a spelling, before the tag has had its say. */
interface Candidate {
  word: LexWord;
  gram: string;
  via: string;
}

/**
 * Everything the exact indexes say about one spelling, in a fixed order.
 *
 * The order is what decides an untaggable tie, so it is chosen rather than incidental: a
 * headword spelled out in full is the strongest claim, a declension the import wrote down
 * is next, and a cell a rule derived is last. Two candidates for one entry are collapsed —
 * дома as both the headword "at home" and the genitive of дом is one word twice, not a
 * choice.
 */
function exactReadings(token: string, indexes: RuIndexes, unclaimed: Map<string, number>): Candidate[] {
  const { forms, lemmas, byVerbId, verbForms } = indexes;
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const push = (word: LexWord, gram: string, via: string) => {
    if (seen.has(word.id)) return;
    seen.add(word.id);
    out.push({ word, gram, via });
  };

  for (const word of lemmas.get(token) ?? []) push(word, '', 'headword');

  const confirmed = forms.get(token);
  if (confirmed) push(confirmed.word, confirmed.gram, 'form index');

  for (const hit of verbForms.get(token) ?? []) {
    const word = byVerbId.get(hit.id);
    // A paradigm no entry claims cannot be linked to — there would be no word for the token
    // to point at. Counted instead, because "these 40 tokens are forms of a verb the
    // dictionary does not list" is the most useful thing a link report can say.
    if (!word) {
      unclaimed.set(hit.id, (unclaimed.get(hit.id) ?? 0) + 1);
      continue;
    }
    push(word, hit.label, `paradigm ${hit.label}`);
  }

  return out;
}

/** The parts of speech the peeler is allowed to land on. See the head of peel-ru.ts. */
const DECLINES_LIKE_AN_ADJECTIVE = new Set(['Adjective', 'Determiner', 'Pronoun', 'Numeral']);

/**
 * What one spelling resolves to, or null when nothing claims it.
 *
 * `tag` is what the tagger said about *this occurrence*, so two occurrences of one spelling
 * can resolve differently — which is the entire point of it and the reason the caller's
 * cache is keyed on the tag as well as the spelling.
 */
export function resolveRu(
  token: string,
  indexes: RuIndexes,
  unclaimed: Map<string, number>,
  tag?: Tag,
): Resolved | null {
  const key = foldRu(token);
  const { lemmas, verbLemmas, byVerbId, verbForms } = indexes;

  // 2. Every exact reading at once, with the tag to choose between them.
  const exact = exactReadings(key, indexes, unclaimed);
  if (exact.length) {
    const { hits, decided } = preferByPos('ru', exact.map(candidate => candidate.word), tag);
    const winner = exact.find(candidate => candidate.word.id === hits[0].id)!;
    const others = hits.slice(1);

    return {
      word: winner.word,
      sense: defaultSense(winner.word),
      gram: winner.gram,
      via: decided ? `${winner.via}, tagged ${tag!.upos}` : winner.via,
      alts: others,
      // An exact hit is only a guess when something else was equally exact and nothing
      // settled it. One reading, or several that the tag narrowed to one, is not a guess.
      check: others.length > 0 && !decided,
    };
  }

  // 3. The adjectival peeler, and the participles that decline the same way.
  for (const analysis of adjectiveAnalyses(key)) {
    const nominal = (lemmas.get(analysis.form) ?? []).filter(word =>
      DECLINES_LIKE_AN_ADJECTIVE.has(word.partOfSpeech),
    );
    // A participle: `conjugate` produces читающий and stops, so its own declension is
    // reached the same way an adjective's is.
    const participles = (verbForms.get(analysis.form) ?? [])
      .filter(hit => hit.label.startsWith('part.'))
      .map(hit => byVerbId.get(hit.id))
      .filter((word): word is LexWord => Boolean(word));

    const found = [...nominal, ...participles];
    if (!found.length) continue;

    const { hits, decided } = preferByPos('ru', found, tag);
    const participial = participles.some(word => word.id === hits[0].id);

    return {
      word: hits[0],
      sense: defaultSense(hits[0]),
      gram: participial ? `part. ${analysis.gram}` : analysis.gram,
      via: decided ? `-${analysis.gram}, tagged ${tag!.upos}` : `-${analysis.gram}`,
      alts: hits.slice(1),
      // Always. The ending came off by rule and the nominative went back on by rule, and
      // nothing in the lexicon confirmed the pair — which is exactly what the flag is for.
      check: true,
    };
  }

  // 4. The tagger's lemma, for what is left.
  //
  // Which in Russian is the genuinely irregular and the genuinely missing: a noun whose
  // declension the import did not write down, a verb of a class `conjugate` does not model,
  // a comparative, a short adjective. SynTagRus lemmatises a verb to its infinitive and a
  // nominal to its nominative singular, which is how the lexicon files both, so the answer
  // is a key into the dictionary with nothing in between.
  if (tag) {
    const verbal = tag.upos === 'VERB' || tag.upos === 'AUX';
    const lemma = foldRu(tag.lemma);
    const found = (verbal ? verbLemmas : lemmas).get(lemma) ?? [];
    // Agreement is required here rather than merely preferred: this step is reached only
    // because everything better has already failed, and a lemma that lands on an entry of
    // the wrong kind is the tagger being wrong twice rather than evidence of anything.
    const hits = found.filter(word => posAgrees('ru', tag.upos, word.partOfSpeech));

    if (hits.length) {
      return {
        word: hits[0],
        sense: defaultSense(hits[0]),
        gram: '',
        via: lemma === key ? `headword, tagged ${tag.upos}` : `lemma ${tag.lemma}`,
        alts: hits.slice(1),
        // Always a guess. Nothing confirmed it, and it is here because the lexicon's own
        // machinery had already run out — exactly the case the flag exists to mark.
        check: true,
      };
    }
  }

  return null;
}
