// Splits a conjugated Georgian verb form into its morphemes so the detail view can
// colour them. Nothing here guesses at a verb's lexical make-up: the root, PFSF and
// preverbs come from src/data/verbMorphemes.json, which is generated once and then
// hand-editable. This module only decides *where* those known pieces sit in a given
// form and what the leftover affixes are.
//
// Slot order in a Georgian verb:
//   preverb · person marker · version vowel · ROOT · PFSF · stem marker · screeve marker · ending

export const MORPHEME_PARTS = [
  { key: 'preverb', label: 'Preverb', hint: 'direction, and perfective aspect in Series II/III' },
  { key: 'person', label: 'Person marker', hint: 'subject or object agreement prefix' },
  { key: 'version', label: 'Version vowel', hint: 'ა · ე · ი · უ · ო' },
  { key: 'root', label: 'Root', hint: 'the lexical core of the verb' },
  { key: 'pfsf', label: 'PFSF', hint: 'present / future stem formant' },
  { key: 'stem', label: 'Stem marker', hint: '-ინ- / -ევინ- causative and Series III stems' },
  { key: 'screeve', label: 'Screeve marker', hint: '-დ- / -ოდ- imperfect and subjunctive' },
  { key: 'ending', label: 'Ending', hint: 'person and number suffix' },
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
// -ულ-/-ილ- build the Series III participle that the compound perfect is made of
// (და-ბრმავ-ებ-ულ-იყო); -ინ-/-ევინ- are the causative and Series III stem markers.
const STEM_MARKERS = ['ევინ', 'ინ', 'ევ', 'ულ', 'ილ'];
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

// The suffix has to be fully consumed by this slot list, each slot optional, so a bare
// aorist (-ე) and a pluperfect (-ებ-ინ-ა-თ) both fall out of the same grammar.
//
// The leading -დ- slot is the doniani marker of 2nd-conjugation verbs, which sits before
// the PFSF (ვ-ჩერ-დ-ებ-ი); the -დ-/-ოდ- further down is the imperfect screeve marker
// that sits after it (ჩერ-დებ-ოდი). Same consonant, different slot, different colour.
const SUFFIX_SLOTS = [
  { part: 'stem', options: ['დ'] },
  { part: 'pfsf', options: PFSFS },
  { part: 'stem', options: STEM_MARKERS },
  { part: 'screeve', options: SCREEVE_MARKERS },
  { part: 'ending', options: AUXILIARIES },
  { part: 'ending', options: ENDINGS },
  { part: 'ending', options: PLURALS },
];

// True when a string is nothing but affix material — used when deriving roots, to stop a
// candidate like -ებდ- being mistaken for one.
export function isAffixString(text) {
  return text !== '' && bestParse(text, SUFFIX_SLOTS, {}) !== null;
}

// Screeves that carry the preverb are recorded per verb; without that list we fall back
// to the rule of thumb that Series I present-group screeves are preverbless.
const PREVERBLESS_SCREEVES = ['present', 'imperfect', 'presentSubjunctive'];

function prefixSlots(lex, screeve) {
  let preverbs;
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
    { part: 'version', options: lex?.version ? [lex.version, ...VERSION_VOWELS] : VERSION_VOWELS },
  ];
}

// Walks the slot list left to right, trying each option and backtracking, and returns
// every parse that swallows the whole string. Slot lists are five deep at most, so the
// search space stays trivial.
function parseSlots(text, slots, preferred) {
  const results = [];
  const walk = (rest, slotIndex, acc) => {
    if (rest === '') {
      results.push(acc);
      return;
    }
    if (slotIndex >= slots.length) return;
    walk(rest, slotIndex + 1, acc); // skipping a slot is always allowed
    const slot = slots[slotIndex];
    const options = preferred[slot.part]
      ? [...preferred[slot.part], ...slot.options]
      : slot.options;
    const seen = new Set();
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
function scoreParse(parse, preferred) {
  let score = 0;
  for (const seg of parse) {
    if (preferred[seg.part]?.includes(seg.text)) score += 10;
    score += seg.text.length;
  }
  return score - parse.length * 2;
}

function bestParse(text, slots, preferred) {
  if (text === '') return [];
  const parses = parseSlots(text, slots, preferred);
  if (parses.length === 0) return null;
  return parses.reduce((a, b) => (scoreParse(b, preferred) > scoreParse(a, preferred) ? b : a));
}

function rootCandidates(lex) {
  return [...new Set([lex?.root, ...(lex?.roots || [])].filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
}

// Segments one whitespace-free token: tries every root variant at every position it
// occurs and keeps the split whose prefix and suffix both parse cleanly.
function segmentToken(token, lex, screeve) {
  const preferredPrefix = {
    preverb: lex?.preverbs || [],
    version: lex?.version ? [lex.version] : [],
  };
  const preferredSuffix = { pfsf: lex?.pfsf ? [lex.pfsf] : [] };
  const slots = prefixSlots(lex, screeve);

  let best = null;
  for (const root of rootCandidates(lex)) {
    for (let index = token.indexOf(root); index !== -1; index = token.indexOf(root, index + 1)) {
      const prefix = token.slice(0, index);
      const suffix = token.slice(index + root.length);
      const prefixParse = bestParse(prefix, slots, preferredPrefix);
      const suffixParse = bestParse(suffix, SUFFIX_SLOTS, preferredSuffix);
      const candidate = {
        complete: prefixParse !== null && suffixParse !== null,
        index,
        root,
        segments: [
          ...(prefixParse || [{ text: prefix, part: 'other' }]),
          { text: root, part: 'root' },
          ...(suffixParse || [{ text: suffix, part: 'other' }]),
        ],
      };
      // A clean parse always wins; failing that, the longest root at the earliest fit.
      const better =
        !best ||
        (candidate.complete && !best.complete) ||
        (candidate.complete === best.complete &&
          (root.length > best.root.length ||
            (root.length === best.root.length && index < best.index)));
      if (better) best = candidate;
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
 * @param {string} form   a cell from the paradigm, e.g. "ნუ მიატოვებ"
 * @param {object} lex    this verb's entry from verbMorphemes.json
 * @param {string} screeve  which screeve the form comes from, so preverbless tenses stay so
 * @returns {{segments: {text: string, part: string}[], complete: boolean}}
 */
export function segmentForm(form, lex, screeve) {
  if (!form || !lex) return { segments: [{ text: form || '', part: 'other' }], complete: false };

  const segments = [];
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
