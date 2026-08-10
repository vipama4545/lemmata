// Splits a conjugated Georgian verb form into its morphemes so the detail view can
// colour them. Nothing here guesses at a verb's lexical make-up: the root, PFSF and
// preverbs come from src/data/verbMorphemes.json, which is generated once and then
// hand-editable. This module only decides *where* those known pieces sit in a given
// form and what the leftover affixes are.
//
// Slot order in a Georgian verb:
//   preverb · person marker · version vowel · ROOT · PFSF · stem marker · screeve marker · ending

import type { KaVerbMorphemes } from '@georgian/shared/types';

/**
 * What a stretch of a form was identified as. The first seven are the slots proper and
 * each has its own colour; the last three are the leftovers — `other` for a stretch that
 * would not parse, `plain` for punctuation and non-verbal words, and `particle` for the
 * ნუ or ვერ standing in front of a form.
 */
export type MorphemePart =
  | 'preverb'
  | 'person'
  | 'version'
  | 'root'
  | 'pfsf'
  | 'screeve'
  | 'ending'
  | 'other'
  | 'plain'
  | 'particle';

/** A stretch of a form, and what it turned out to be. */
export interface Segment {
  text: string;
  part: MorphemePart;
}

export interface SegmentedForm {
  segments: Segment[];
  complete: boolean;
  /** Whether a root was found at all. Absent when there was no lexicon entry to look for. */
  matched?: boolean;
}

export const MORPHEME_PARTS: { key: MorphemePart; label: string; hint: string }[] = [
  {
    key: 'preverb',
    label: 'Preverb',
    hint: 'direction, and completedness from the future tense onward — მი- მო- გა- და-',
  },
  {
    key: 'person',
    label: 'Person marker',
    hint: 'who is doing it, or who it is done to — ვ- მ- გ- გვ-',
  },
  {
    key: 'version',
    label: 'Version vowel',
    hint: 'who the action is aimed at or belongs to — ა- ე- ი- უ-',
  },
  { key: 'root', label: 'Root', hint: 'the part that carries the meaning' },
  {
    key: 'pfsf',
    label: 'PFSF',
    hint: 'builds the present/future stem and picks the pattern; gone in the aorist — -ებ -ავ -ამ -ობ -ი, and -დებ in doniani verbs',
  },
  {
    key: 'screeve',
    label: 'Tense marker',
    hint: 'what the tense itself adds — -დ- -ოდ- in the imperfect and subjunctives, -ინ- in the pluperfect',
  },
  { key: 'ending', label: 'Ending', hint: 'person and number of the subject' },
];

// Fallback preverb inventory. A verb's own preverb list from the lexicon is used instead
// whenever it exists, because a prefix like მი- is a preverb in one verb and an object
// marker plus version vowel (მ-ი-) in the next.
export const PREVERBS = [
  'გადმო', 'წარმო', 'გარდა', 'გადა', 'გამო', 'შემო', 'ჩამო', 'წამო', 'მიმო',
  'აღმო', 'ამო', 'უკუ', 'წარ', 'თან', 'გან', 'შთა', 'აღ', 'მი', 'მო', 'გა',
  'და', 'შე', 'ჩა', 'წა',
];
export const PERSON_PREFIXES = ['გვ', 'ვ', 'მ', 'გ', 'ს', 'ჰ', 'ხ'];
export const VERSION_VOWELS = ['ა', 'ე', 'ი', 'უ', 'ო'];

// Suffix inventories.
export const PFSFS = ['ებ', 'ავ', 'ამ', 'ობ', 'ოფ', 'ულ', 'ენ', 'ინ', 'ევ', 'ომ', 'ი'];
// Everything a tense adds between the stem and the ending: -ინ-/-ევინ- in the pluperfect
// and perfect subjunctive, -ულ-/-ილ- in the compound perfect (და-ბრმავ-ებ-ულ-იყო), and
// -დ-/-ოდ- in the imperfect and the subjunctives.
const TENSE_MARKERS = ['ევინ', 'ინ', 'ევ', 'ულ', 'ილ'];
const SCREEVE_MARKERS = ['ოდ', 'დ'];
// The copula fused onto a participle in the compound Series III forms.
const AUXILIARIES = [
  'იყავით', 'იყვნენ', 'იყავი', 'იყოთ', 'იყოს', 'იყო', 'ვართ', 'ხართ', 'არიან',
  'არის', 'ვარ', 'ხარ', 'ართ',
];
const ENDINGS = [
  'ნენ', 'იან', 'ეს', 'ოს', 'ას', 'ის', 'ონ', 'ეთ', 'ოთ', 'ათ', 'ით', 'ენ',
  'ან', 'ია', 'ს', 'თ', 'ი', 'ე', 'ა', 'ო', 'ნ',
];
const PLURALS = ['თ'];

const PARTICLES = ['ნუ', 'ნურ', 'არ', 'ვერ', 'მუ'];

/**
 * One position in the form, with the morphemes that may fill it. Every slot is optional,
 * and `prefer` puts this verb's own morphemes at the head of the list so they win ties.
 */
interface Slot {
  part: MorphemePart;
  options: string[];
  prefer?: string[] | null;
  /** Marks the PFSF slot proper, the one that takes the verb's own PFSF as a preference. */
  prefersLexPfsf?: boolean;
}

// The suffix has to be fully consumed by this slot list, each slot optional, so a bare
// aorist (-ე) and a pluperfect (-ებ-ინ-ა-თ) both fall out of the same grammar.
//
// The leading -დ- is the doniani marker of 2nd-conjugation verbs. It sits before the PFSF
// and belongs to it — ვ-ჩერ-დ-ებ-ი is a present tense, so this -დ- marks no tense at all,
// unlike the -დ-/-ოდ- further down that builds the imperfect (ჩერ-დებ-ოდი).
const SUFFIX_SLOTS: Slot[] = [
  { part: 'pfsf', options: ['დ'] },
  { part: 'pfsf', options: PFSFS, prefersLexPfsf: true },
  { part: 'screeve', options: TENSE_MARKERS },
  { part: 'screeve', options: SCREEVE_MARKERS },
  { part: 'ending', options: AUXILIARIES },
  { part: 'ending', options: ENDINGS },
  { part: 'ending', options: PLURALS },
];

// True when a string is nothing but affix material — used when deriving roots, to stop a
// candidate like -ებდ- being mistaken for one.
export function isAffixString(text: string): boolean {
  return text !== '' && bestParse(text, SUFFIX_SLOTS, EMPTY_PREFERENCE) !== null;
}

// Screeves that carry the preverb are recorded per verb; without that list we fall back
// to the rule of thumb that Series I present-group screeves are preverbless.
const PREVERBLESS_SCREEVES = ['present', 'imperfect', 'presentSubjunctive'];

function prefixSlots(lex: KaVerbMorphemes | null | undefined, screeve: string | undefined): Slot[] {
  let preverbs: string[];
  if (!lex || !lex.preverbs) {
    preverbs = PREVERBS;
  } else if (
    screeve &&
    lex.preverbScreeves &&
    !lex.preverbScreeves.includes(screeve)
  ) {
    preverbs = [];
  } else if (screeve && !lex.preverbScreeves && PREVERBLESS_SCREEVES.includes(screeve)) {
    preverbs = [];
  } else {
    preverbs = lex.preverbs;
  }
  return [
    { part: 'preverb', options: preverbs },
    { part: 'person', options: PERSON_PREFIXES },
    { part: 'version', options: VERSION_VOWELS, prefer: lex?.version ? [lex.version] : null },
  ];
}

// The PFSF slot proper is the only suffix slot with a per-verb preference; the doniani -დ-
// slot shares its colour but must keep its own single option.
function suffixSlots(lex: KaVerbMorphemes | null | undefined): Slot[] {
  const pfsf = lex?.pfsf;
  if (!pfsf) return SUFFIX_SLOTS;
  return SUFFIX_SLOTS.map(slot =>
    slot.prefersLexPfsf ? { ...slot, prefer: [pfsf] } : slot,
  );
}

// Walks the slot list left to right, trying each option and backtracking, and returns
// every parse that swallows the whole string. Slot lists are five deep at most, so the
// search space stays trivial.
function parseSlots(text: string, slots: Slot[]): Segment[][] {
  const results: Segment[][] = [];
  const walk = (rest: string, slotIndex: number, acc: Segment[]) => {
    if (rest === '') {
      results.push(acc);
      return;
    }
    if (slotIndex >= slots.length) return;
    walk(rest, slotIndex + 1, acc); // skipping a slot is always allowed
    const slot = slots[slotIndex];
    // Preference is per slot, not per part name: two slots can share a colour (the
    // doniani -დ- and the PFSF proper) without sharing an option list.
    const options = slot.prefer ? [...slot.prefer, ...slot.options] : slot.options;
    const seen = new Set<string>();
    for (const option of options) {
      if (!option || seen.has(option)) continue;
      seen.add(option);
      if (rest.startsWith(option)) {
        walk(rest.slice(option.length), slotIndex + 1, [...acc, { text: option, part: slot.part }]);
      }
    }
  };
  walk(text, 0, []);
  return results;
}

// Between two complete parses, prefer the one built from the verb's own known morphemes,
// then the one with fewer pieces (a single -ით ending beats -ი plus a plural -თ).
function scoreParse(parse: Segment[], known: Set<string>): number {
  let score = 0;
  for (const seg of parse) {
    if (known.has(seg.text)) score += 10;
    score += seg.text.length;
  }
  return score - parse.length * 2;
}

function bestParse(text: string, slots: Slot[], known: Set<string>): Segment[] | null {
  if (text === '') return [];
  const parses = parseSlots(text, slots);
  if (parses.length === 0) return null;
  return parses.reduce((a, b) => (scoreParse(b, known) > scoreParse(a, known) ? b : a));
}

const EMPTY_PREFERENCE = new Set<string>();

function rootCandidates(lex: KaVerbMorphemes | null | undefined): string[] {
  return [
    ...new Set([lex?.root, ...(lex?.roots || [])].filter((root): root is string => Boolean(root))),
  ].sort((a, b) => b.length - a.length);
}

/** A token split at one occurrence of one root variant, and how well the split went. */
interface TokenSplit {
  complete: boolean;
  index: number;
  root: string;
  segments: Segment[];
}

// A clean parse always wins; failing that, the longest root at the earliest fit.
function beatsBest(candidate: TokenSplit, best: TokenSplit): boolean {
  if (candidate.complete !== best.complete) return candidate.complete;
  if (candidate.root.length !== best.root.length) {
    return candidate.root.length > best.root.length;
  }
  return candidate.index < best.index;
}

// Segments one whitespace-free token: tries every root variant at every position it
// occurs and keeps the split whose prefix and suffix both parse cleanly.
function segmentToken(
  token: string,
  lex: KaVerbMorphemes | null | undefined,
  screeve: string | undefined,
): Required<SegmentedForm> {
  // The verb's own morphemes, used to break ties between two otherwise valid parses.
  const known = new Set(
    [...(lex?.preverbs || []), lex?.version, lex?.pfsf].filter((m): m is string => Boolean(m)),
  );
  const prefixSlotList = prefixSlots(lex, screeve);
  const suffixSlotList = suffixSlots(lex);

  let best: TokenSplit | null = null;
  for (const root of rootCandidates(lex)) {
    for (let index = token.indexOf(root); index !== -1; index = token.indexOf(root, index + 1)) {
      const prefix = token.slice(0, index);
      const suffix = token.slice(index + root.length);
      const prefixParse = bestParse(prefix, prefixSlotList, known);
      const suffixParse = bestParse(suffix, suffixSlotList, known);
      const candidate: TokenSplit = {
        complete: prefixParse !== null && suffixParse !== null,
        index,
        root,
        segments: [
          ...(prefixParse || [{ text: prefix, part: 'other' as const }]),
          { text: root, part: 'root' },
          ...(suffixParse || [{ text: suffix, part: 'other' as const }]),
        ],
      };
      if (best === null || beatsBest(candidate, best)) best = candidate;
      if (best.complete) break;
    }
    if (best?.complete) break;
  }

  // No root anywhere in the token: this is the non-verbal half of a compound verb
  // (თანახმა ვარ "I agree"), so it is left plain rather than reported as a failure.
  if (!best) return { segments: [{ text: token, part: 'plain' }], complete: true, matched: false };
  return { segments: best.segments, complete: best.complete, matched: true };
}

/**
 * Splits a form into coloured segments.
 * @param form     a cell from the paradigm, e.g. "ნუ მიატოვებ"
 * @param lex      this verb's entry from verbMorphemes.json
 * @param screeve  which screeve the form comes from, so preverbless tenses stay so
 */
export function segmentForm(
  form: string | null | undefined,
  lex: KaVerbMorphemes | null | undefined,
  screeve?: string,
): SegmentedForm {
  if (!form || !lex) return { segments: [{ text: form || '', part: 'other' }], complete: false };

  const segments: Segment[] = [];
  let complete = true;
  let matched = false;
  // Cells hold particles, slashed alternatives and the occasional parenthesised preverb;
  // split on those, segment the verb words, and pass the punctuation through untouched.
  const chunks = form.split(/(\s+|\/|\(|\)|,)/).filter(Boolean);

  for (const chunk of chunks) {
    if (/^[\s/(),]+$/.test(chunk)) {
      segments.push({ text: chunk, part: 'plain' });
    } else if (PARTICLES.includes(chunk)) {
      segments.push({ text: chunk, part: 'particle' });
    } else {
      const result = segmentToken(chunk, lex, screeve);
      segments.push(...result.segments);
      if (!result.complete) complete = false;
      if (result.matched) matched = true;
    }
  }

  return { segments, complete: complete && matched, matched };
}
