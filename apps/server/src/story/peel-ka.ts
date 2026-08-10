// The nominal peeler: reading an inflected Georgian noun back to the headword it came from.
//
// Ported from scripts/buildStoryData.cjs, where it has been read against a real story and
// its output corrected by hand. The suffix tables and the two-letter minimums below are the
// residue of that: each one is there because taking it out produced a wrong link somebody
// had to notice. Change them only with a story to re-link and a coverage figure to compare.
//
// This is the *last* thing the resolver tries, and everything it produces is flagged as a
// guess, because it is the only step that reconstructs rather than looks up.

const VOWELS = new Set(['ა', 'ე', 'ი', 'ო', 'უ']);

/**
 * Peeled in the order Georgian stacks them: stem + plural + case + postposition + particle.
 * Each layer is optional and taken at most once, which keeps the search shallow and leaves
 * every hit with a derivation that can be printed back out — that is what `via` shows.
 */
const PARTICLES = [
  { suffix: 'ვე', label: 'same' },
  { suffix: 'ღა', label: 'only' },
  // -ც takes a linking ა after a consonant-final word: ძალიან -> ძალიანაც.
  { suffix: 'აც', label: 'too' },
  { suffix: 'ც', label: 'too' },
];

const POSTPOSITIONS = [
  { suffix: 'თვის', label: 'for' },
  { suffix: 'გან', label: 'from' },
  { suffix: 'თან', label: 'with' },
  { suffix: 'ვით', label: 'like' },
  { suffix: 'დან', label: 'from' },
  { suffix: 'კენ', label: 'towards' },
  { suffix: 'მდე', label: 'until' },
  { suffix: 'ქვეშ', label: 'under' },
  { suffix: 'ში', label: 'in' },
  { suffix: 'ზე', label: 'on' },
];

const CASES = [
  { suffix: 'ისა', label: 'gen' },
  { suffix: 'ითა', label: 'inst' },
  { suffix: 'ის', label: 'gen' },
  { suffix: 'ით', label: 'inst' },
  { suffix: 'მა', label: 'erg' },
  { suffix: 'ად', label: 'adv' },
  { suffix: 'სა', label: 'dat' },
  { suffix: 'ს', label: 'dat' },
  { suffix: 'მ', label: 'erg' },
  { suffix: 'ო', label: 'voc' },
  { suffix: 'ი', label: 'nom' },
  { suffix: 'თ', label: 'inst' },
];

const PLURALS = [
  { suffix: 'ებ', label: 'pl' },
  { suffix: 'თა', label: 'pl.gen' },
  { suffix: 'ნი', label: 'pl' },
  { suffix: 'ნ', label: 'pl' },
];

/** One enclitic particle, for the verb step — which reconstructs nothing else. */
export const ENCLITICS = PARTICLES;

interface Restoration {
  form: string;
  note: string | null;
}

/**
 * A stem is the lemma with its nominative -ი gone, and sometimes with a stem vowel gone too:
 * მგელი -> მგლ-ის, ფოთოლი -> ფოთლ-ები. Both have to be undone to find the headword again.
 */
function restorations(stem: string): Restoration[] {
  const out: Restoration[] = [{ form: stem, note: null }];
  for (const vowel of ['ი', 'ა', 'ე']) out.push({ form: stem + vowel, note: null });

  if (stem.length >= 3 && !VOWELS.has(stem[stem.length - 1]) && !VOWELS.has(stem[stem.length - 2])) {
    const head = stem.slice(0, -1);
    const tail = stem.slice(-1);
    for (const vowel of ['ე', 'ო', 'ა']) {
      out.push({ form: head + vowel + tail, note: 'syncope' });
      out.push({ form: head + vowel + tail + 'ი', note: 'syncope' });
    }
  }
  return out;
}

export interface Analysis {
  /** The headword spelling this reading proposes. */
  form: string;
  /** The suffixes taken off, outermost last: ["pl", "gen"]. */
  peeled: string[];
  /** "syncope" where a stem vowel had to be put back. */
  note: string | null;
  depth: number;
}

/**
 * Every way the token could be read, shallowest first — so an exact headword always beats a
 * reconstruction, and a one-suffix reading always beats a three-suffix one.
 */
export function analyses(token: string): Analysis[] {
  const out: Analysis[] = [];
  const seen = new Set<string>();

  const push = (form: string, peeled: string[], note: string | null) => {
    const key = `${form}|${peeled.join(',')}`;
    if (form.length < 2 || seen.has(key)) return;
    seen.add(key);
    out.push({ form, peeled, note, depth: peeled.length });
  };

  const layer = (
    input: string,
    list: { suffix: string; label: string }[],
    peeled: string[],
    minStem: number,
  ) => {
    const results = [{ text: input, peeled }];
    for (const { suffix, label } of list) {
      if (input.endsWith(suffix) && input.length - suffix.length >= minStem) {
        results.push({ text: input.slice(0, -suffix.length), peeled: [...peeled, label] });
      }
    }
    return results;
  };

  // Two, so the enclitic comes off a two-letter pronoun as well: მე-ც, ის-ღა. A word that is
  // genuinely spelled that way is unaffected, because an exact headword is a depth-0 reading
  // and the sort puts it in front of anything peeled.
  for (const a of layer(token, PARTICLES, [], 2)) {
    // Two, not three: ხე takes -იდან as ხიდან, leaving a stem of one letter plus the linking
    // vowel the restorations put back.
    for (const b of layer(a.text, POSTPOSITIONS, a.peeled, 2)) {
      for (const c of layer(b.text, CASES, b.peeled, 2)) {
        for (const d of layer(c.text, PLURALS, c.peeled, 2)) {
          for (const r of restorations(d.text)) push(r.form, d.peeled, r.note);
        }
      }
    }
  }

  return out.sort((x, y) => x.depth - y.depth);
}
