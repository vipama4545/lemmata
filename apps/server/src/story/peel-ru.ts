// The adjectival peeler: reading a declined Russian adjective back to its dictionary form.
//
// The Georgian peeler next door is a large, hand-tuned thing because Georgian stacks its
// suffixes and the lexicon stores no case forms. Russian needs far less: 13,169 of the
// nouns come with their whole declension in `word_forms`, and every verb form falls out of
// `conjugate()`, so the exact indexes already answer most of a story. What they do not
// answer is the adjectives — 5,311 entries, stored as a headword and nothing else — and the
// declined participles, which `conjugate()` produces only in the nominative masculine.
//
// Both take the same twelve endings, and the set is closed: unlike Georgian's, these tables
// are not a residue of corrections but the paradigm as any grammar prints it. So this is
// short, and it does one thing — take an adjectival ending off and put a nominative back on.
//
// Everything it produces is a guess, for the same reason the Georgian one's output is: it
// reconstructs a spelling rather than looking one up. The caller narrows that by refusing
// any candidate that is not an adjective, a determiner, a pronoun, a numeral or a
// participle — see `resolve-ru.ts`. Without that filter домом would peel to домой, which is
// a real word and the wrong one.

/** One reading of a declined adjective. */
export interface RuAnalysis {
  /** The nominative-singular-masculine spelling this reading proposes. */
  form: string;
  /** What was taken off, in the dotted style the Russian form index already uses. */
  gram: string;
}

/**
 * The endings, longest first so -ого is taken before -го could be.
 *
 * Hard and soft variants sit side by side because a stem's hardness is not knowable from
 * here: нов|ый takes -ого and син|ий takes -его, and which of the two came off is decided
 * by which restoration below lands on a headword.
 *
 * The labels name the commonest reading of each ending rather than every reading. -ого is
 * the animate accusative as often as it is the genitive, -ым is the instrumental singular
 * and the dative plural, and -ее is a comparative at least as often as it is a neuter. All
 * of them reach the right lemma, which is what the link is for; the label is a hint beside
 * it, and one that says "gen.m" over an accusative is a smaller wrong than no link at all.
 */
const ENDINGS: { suffix: string; gram: string }[] = [
  { suffix: 'ого', gram: 'gen.m' },
  { suffix: 'его', gram: 'gen.m' },
  { suffix: 'ому', gram: 'dat.m' },
  { suffix: 'ему', gram: 'dat.m' },
  { suffix: 'ыми', gram: 'ins.pl' },
  { suffix: 'ими', gram: 'ins.pl' },
  { suffix: 'ая', gram: 'nom.f' },
  { suffix: 'яя', gram: 'nom.f' },
  { suffix: 'ую', gram: 'acc.f' },
  { suffix: 'юю', gram: 'acc.f' },
  { suffix: 'ое', gram: 'nom.n' },
  { suffix: 'ее', gram: 'nom.n' },
  { suffix: 'ые', gram: 'nom.pl' },
  { suffix: 'ие', gram: 'nom.pl' },
  { suffix: 'ых', gram: 'gen.pl' },
  { suffix: 'их', gram: 'gen.pl' },
  { suffix: 'ым', gram: 'ins.m' },
  { suffix: 'им', gram: 'ins.m' },
  { suffix: 'ом', gram: 'pre.m' },
  { suffix: 'ем', gram: 'pre.m' },
  { suffix: 'ой', gram: 'gen.f' },
  { suffix: 'ей', gram: 'gen.f' },
];

/**
 * What the nominative could be spelled.
 *
 * Three, and the lexicon decides between them: но́вый is hard, си́ний is soft, большо́й has
 * the stress on the ending. Nothing in the stem says which, so all three are proposed and
 * only the one that is a headword survives.
 */
const NOMINATIVES = ['ый', 'ий', 'ой'];

/**
 * The shortest a stem may be. Three, because нов-, син-, больш- and втор- all are, and
 * because two would let ним peel to "н" and propose ний.
 */
const MIN_STEM = 3;

/** Every way the token could be read as a declined adjective, in table order. */
export function adjectiveAnalyses(token: string): RuAnalysis[] {
  const out: RuAnalysis[] = [];
  const seen = new Set<string>();

  for (const { suffix, gram } of ENDINGS) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, -suffix.length);
    if (stem.length < MIN_STEM) continue;

    for (const nominative of NOMINATIVES) {
      const form = stem + nominative;
      // The token spelled as it already is proves nothing — that reading is the exact
      // headword lookup, which has been tried and missed before this is reached.
      if (form === token || seen.has(form)) continue;
      seen.add(form);
      out.push({ form, gram });
    }
  }

  return out;
}
