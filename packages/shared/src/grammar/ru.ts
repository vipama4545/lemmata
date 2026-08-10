// The fixed grammatical furniture of Russian — and, unlike its Georgian counterpart, a
// working conjugation engine as well.
//
// The two files differ in that on purpose, because the two languages store their paradigms
// differently and for a good reason. A Georgian paradigm is 66 cells that cannot be worked
// out from anything shorter, so every cell is a row in ka_verb_forms. A Russian paradigm
// very nearly can be: given the conjugation class, two stems and a stress pattern, the
// twenty-odd forms fall out by rule. So ru_verbs stores the *rule* and its inputs, and
// ru_verb_forms holds only the cells the rule gets wrong.
//
// That is why `conjugate` lives here rather than in the web app. It is the definition of the
// data — a stored stem means nothing without the function that expands it — and the server
// needs it too, to index inflected forms for the story resolver. Putting it in the shared
// package is what keeps the browser and the server from ever disagreeing about what делаешь
// is a form of.
//
// The classes are Zaliznyak's, which is the classification every Russian reference grammar
// uses: sixteen productive and semi-productive types, plus a handful of genuine irregulars.
// They are not a table. Georgian's `ka_verb_groups` is one because those came out of the
// spreadsheet carrying editorial notes and a count that moves whenever the paradigms do;
// these come out of a published classification that has not changed since 1977, and
// `RuClassId` below already pins them as a compile-time union. See the same argument, made
// at greater length, at the head of ./ka.ts.
//
// Most courses never mention any of this and teach two conjugations, so every class carries
// the `conjugation` it belongs to and the app shows that by default — `RU_CLASSES` is what
// the advanced view opens up to.

import type {
  RuAspect,
  RuClass,
  RuClassId,
  RuForm,
  RuParadigm,
  RuSlot,
  RuSlotKey,
  RuStressPast,
  RuStressPresent,
  RuVerbRule,
} from '../types.ts';

/* ------------------------------------------------------------------- letters */

const VOWELS = 'аеёиоуыэюя';

/**
 * ж, ш, ч, щ. They take -у and -а where every other consonant takes -ю and -я, which is an
 * orthographic rule rather than a fact about any verb — hence here rather than in the data.
 */
const HUSHERS = 'жшчщ';

/** U+0301. Written after the vowel it falls on; every renderer we care about combines it. */
export const ACUTE = '́';

function isVowel(letter: string): boolean {
  return VOWELS.includes(letter);
}

/** The 0-based index of the nth vowel within a word, or -1 if it has fewer than n+1. */
function vowelAt(word: string, n: number): number {
  let seen = 0;
  for (let index = 0; index < word.length; index += 1) {
    if (isVowel(word[index]!)) {
      if (seen === n) return index;
      seen += 1;
    }
  }
  return -1;
}

function countVowels(word: string): number {
  let total = 0;
  for (const letter of word) if (isVowel(letter)) total += 1;
  return total;
}

function lastLetter(stem: string): string {
  return stem.slice(-1);
}

/** Whether an ending starting -у/-а must instead start -ю/-я after this stem. */
function takesSoftEnding(stem: string, softStem: boolean): boolean {
  const last = lastLetter(stem);
  if (HUSHERS.includes(last)) return false;
  return softStem || isVowel(last) || last === 'ь' || last === 'й';
}

/**
 * Marks the stressed vowel of a form for display.
 *
 * Two forms are left alone, and both would look like errors if they were not:
 *
 *   a single syllable — Russian does not write the stress on ест or пил, because there is
 *     nowhere else it could go.
 *   anything holding a ё — the letter *is* the stress mark. несё́шь is not a more emphatic
 *     несёшь, it is a spelling nobody writes.
 */
export function accented(form: string, stress: number): string {
  if (stress < 0 || form.includes('ё') || countVowels(form) < 2) return form;
  const at = vowelAt(form, stress);
  if (at < 0) return form;
  return `${form.slice(0, at + 1)}${ACUTE}${form.slice(at + 1)}`;
}

/* -------------------------------------------------------------------- slots */

/**
 * Every cell a Russian verb has.
 *
 * `pres.*` is the one that repays reading twice: for an imperfective verb these are the
 * present tense, and for a perfective verb the *very same forms* are the simple future.
 * сделаю is "I will do", not "I do", and there is no separate set of cells for it. So the
 * slot is named for its shape rather than its meaning, and `presentLabel` below picks the
 * label from the aspect. Giving perfectives their own `fut.*` cells would have been a second
 * copy of the same six forms and an invitation for the two to disagree.
 *
 * `fut.*` is therefore the *compound* future, which only imperfectives have — буду делать.
 * It is generated from буду plus the infinitive rather than stored, for the same reason
 * nothing else derivable is stored.
 */
export const RU_SLOTS: readonly RuSlot[] = [
  { key: 'infinitive', label: 'Infinitive', group: 'principal' },

  { key: 'pres.1sg', label: 'я', group: 'present', person: '1sg' },
  { key: 'pres.2sg', label: 'ты', group: 'present', person: '2sg' },
  { key: 'pres.3sg', label: 'он / она', group: 'present', person: '3sg' },
  { key: 'pres.1pl', label: 'мы', group: 'present', person: '1pl' },
  { key: 'pres.2pl', label: 'вы', group: 'present', person: '2pl' },
  { key: 'pres.3pl', label: 'они', group: 'present', person: '3pl' },

  { key: 'fut.1sg', label: 'я', group: 'future', person: '1sg' },
  { key: 'fut.2sg', label: 'ты', group: 'future', person: '2sg' },
  { key: 'fut.3sg', label: 'он / она', group: 'future', person: '3sg' },
  { key: 'fut.1pl', label: 'мы', group: 'future', person: '1pl' },
  { key: 'fut.2pl', label: 'вы', group: 'future', person: '2pl' },
  { key: 'fut.3pl', label: 'они', group: 'future', person: '3pl' },

  // Four cells, not six. The Russian past is an old participle and agrees with its subject
  // in gender and number rather than conjugating for person — я делал and ты делал are the
  // same word, and a man and a woman saying "I did" do not say the same thing.
  { key: 'past.m', label: 'он', group: 'past' },
  { key: 'past.f', label: 'она', group: 'past' },
  { key: 'past.n', label: 'оно', group: 'past' },
  { key: 'past.pl', label: 'они', group: 'past' },

  { key: 'imp.2sg', label: 'ты', group: 'imperative' },
  { key: 'imp.2pl', label: 'вы', group: 'imperative' },

  { key: 'part.pres.act', label: 'Present active', group: 'participle' },
  { key: 'part.pres.pass', label: 'Present passive', group: 'participle' },
  { key: 'part.past.act', label: 'Past active', group: 'participle' },
  { key: 'part.past.pass', label: 'Past passive', group: 'participle' },
  { key: 'part.past.pass.short', label: 'Past passive, short', group: 'participle' },

  { key: 'ger.pres', label: 'Present', group: 'gerund' },
  { key: 'ger.past', label: 'Past', group: 'gerund' },
];

export const RU_SLOT_KEYS: readonly RuSlotKey[] = RU_SLOTS.map(slot => slot.key);

/** The six `pres.*` cells are a present tense or a simple future, depending on the aspect. */
export function presentLabel(aspect: RuAspect): string {
  return aspect === 'pf' ? 'Future' : 'Present';
}

/** What the whole paradigm is called on the page — perfectives have no present at all. */
export const RU_GROUP_LABELS: Record<RuSlot['group'], string> = {
  principal: 'Principal parts',
  present: 'Present',
  future: 'Compound future',
  past: 'Past',
  imperative: 'Imperative',
  participle: 'Participles',
  gerund: 'Verbal adverbs',
};

/* ------------------------------------------------------------------ classes */

/**
 * Zaliznyak's classes, with the rule each one applies.
 *
 * Fourteen of the sixteen are first conjugation and two are second, which is worth knowing
 * before reading the table: the "two conjugations" of a first-year course cut across this
 * classification rather than sitting above it. `conjugation` is what a beginner sees.
 */
export const RU_CLASSES: readonly RuClass[] = [
  {
    id: '1',
    conjugation: '1',
    label: '-ать → -аю',
    description:
      'The big productive class, and where most new verbs land. The infinitive stem simply takes the endings: делать → дела|ю, дела|ешь.',
    example: 'делать',
    exampleEnglish: 'to do, to make',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 'nn', base: 'stemPast' },
  },
  {
    id: '2',
    conjugation: '1',
    label: '-овать → -ую',
    description:
      'The suffix -ова-/-ева- becomes -у-/-ю- in the present: рисовать → рису|ю. Productive, and the class almost every loanword joins — организовать, программировать.',
    example: 'рисовать',
    exampleEnglish: 'to draw',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 'nn', base: 'stemPast' },
  },
  {
    id: '3',
    conjugation: '1',
    label: '-нуть → -ну',
    description:
      'The -ну- suffix stays throughout the present: вернуть → верн|у. Mostly perfectives of the "one quick action" kind — крикнуть, прыгнуть.',
    example: 'вернуть',
    exampleEnglish: 'to return (something)',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: '4',
    conjugation: '2',
    label: '-ить → -ю, -ишь',
    description:
      'Second conjugation, and the larger of its two classes. Consonant mutation hits the first person singular alone: любить → любл|ю but люб|ишь, носить → нош|у but нос|ишь.',
    example: 'говорить',
    exampleEnglish: 'to speak',
    stemPattern: 'mut1sg',
    softStem: false,
    pastNoL: false,
    passive: { type: 'enn', base: 'stem1sg' },
  },
  {
    id: '5',
    conjugation: '2',
    label: '-еть / -ать → -ишь',
    description:
      'Second conjugation with an infinitive that does not look like it: видеть, слышать, кричать, держать. The endings are the -ишь set all the same, which is why these are the verbs every course makes you memorise.',
    example: 'видеть',
    exampleEnglish: 'to see',
    stemPattern: 'mut1sg',
    softStem: false,
    // Off the plain stem, not the mutated first person — уви́денный, not *уви́женный. Class 4
    // is the other way round (ку́пленный, off купл-), which is the one real difference
    // between the two second-conjugation classes once the endings are the same.
    passive: { type: 'enn', base: 'stemPresent' },
    pastNoL: false,
  },
  {
    id: '6',
    conjugation: '1',
    label: '-ать → mutation',
    description:
      'The stem consonant mutates and stays mutated right through the present: писать → пиш|у, пиш|ешь. Unlike class 4, the change is not confined to the first person.',
    example: 'писать',
    exampleEnglish: 'to write',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 'nn', base: 'stemPast' },
  },
  {
    id: '7',
    conjugation: '1',
    label: '-ти (consonant stem)',
    description:
      'Stems ending in д, т, с, з, б: нести → нес|у, вести → вед|у. The masculine past drops its -л and lengthens the vowel — нёс, вёл — which is the class marker worth recognising.',
    example: 'нести',
    exampleEnglish: 'to carry',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: true,
    passive: { type: 'enn', base: 'stemPast' },
  },
  {
    id: '8',
    conjugation: '1',
    label: '-чь (velar stem)',
    description:
      'A к or г that shows in the first person and third plural and mutates everywhere between: печь → пек|у, печ|ёшь, печ|ёт, … пек|ут. The masculine past has no -л: пёк, мог.',
    example: 'мочь',
    exampleEnglish: 'to be able',
    stemPattern: 'velar',
    softStem: false,
    pastNoL: true,
    passive: { type: 'enn', base: 'stemPresent' },
  },
  {
    id: '9',
    conjugation: '1',
    label: '-ереть → -ру',
    description:
      'The -ере- collapses in the present: тереть → тр|у, умереть → умр|у. Small and closed, but the verbs in it are common.',
    example: 'тереть',
    exampleEnglish: 'to rub',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: true,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: '10',
    conjugation: '1',
    label: '-оть → -ю',
    description:
      'First conjugation, but with a soft stem that the spelling does not show: колоть → кол|ю, не *колу. Бороться belongs here too.',
    example: 'колоть',
    exampleEnglish: 'to prick, to chop',
    stemPattern: 'plain',
    softStem: true,
    pastNoL: false,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: '11',
    conjugation: '1',
    label: '-ить → -ью',
    description:
      'Monosyllabic stems where the и drops and a soft sign takes its place: пить → пь|ю, бить → бь|ю. All of them are stressed on the ending.',
    example: 'пить',
    exampleEnglish: 'to drink',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: '12',
    conjugation: '1',
    label: '-ыть / -еть → -ою',
    description:
      'A stem that ends in a vowel and takes the endings straight on: мыть → мо|ю, петь → по|ю, дуть → ду|ю.',
    example: 'мыть',
    exampleEnglish: 'to wash',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: '13',
    conjugation: '1',
    label: '-авать → -аю',
    description:
      'The -ва- disappears in the present but comes back in the imperative and the past: давать → да|ю, but дава|й, дава|л. Only three roots, each with a family of prefixed verbs.',
    example: 'давать',
    exampleEnglish: 'to give',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 'nn', base: 'stemPast' },
  },
  {
    id: '14',
    conjugation: '1',
    label: 'nasal stem',
    description:
      'A nasal that appears only in the present: начать → начн|у, жать → жм|у, снять → сним|у. The infinitive gives no warning at all, so these are learned one at a time.',
    example: 'начать',
    exampleEnglish: 'to begin',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: '15',
    conjugation: '1',
    label: '-ть → -ну',
    description:
      'An -н- appears in the present where the infinitive has none: стать → стан|у, деть → ден|у. Distinct from class 3, where the -ну- is already in the infinitive.',
    example: 'стать',
    exampleEnglish: 'to become',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: '16',
    conjugation: '1',
    label: '-ыть → -ву',
    description:
      'A -в- appears in the present: жить → жив|у, плыть → плыв|у. Four roots, all of them everyday words.',
    example: 'жить',
    exampleEnglish: 'to live',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: { type: 't', base: 'stemPast' },
  },
  {
    id: 'irr',
    conjugation: 'mixed',
    label: 'Irregular',
    description:
      'быть, идти, есть, дать, хотеть, бежать and their prefixed families. No rule reaches them, so every cell of these is stored rather than derived — which is what ru_verb_forms is for.',
    example: 'быть',
    exampleEnglish: 'to be',
    stemPattern: 'plain',
    softStem: false,
    pastNoL: false,
    passive: null,
  },
];

export const RU_CLASS_BY_ID = new Map<RuClassId, RuClass>(RU_CLASSES.map(cls => [cls.id, cls]));

/** The two groups a first-year course teaches, which is the default view. */
export const RU_CONJUGATIONS = [
  {
    id: '1' as const,
    label: 'First conjugation',
    endings: '-ю/-у, -ешь, -ет, -ем, -ете, -ют/-ут',
    hint: 'The -е- set. Most verbs.',
  },
  {
    id: '2' as const,
    label: 'Second conjugation',
    endings: '-ю/-у, -ишь, -ит, -им, -ите, -ят/-ат',
    hint: 'The -и- set. Mostly -ить verbs, plus a memorised handful in -еть and -ать.',
  },
  {
    id: 'mixed' as const,
    label: 'Irregular',
    endings: 'no pattern',
    hint: 'быть, идти, есть, дать, хотеть, бежать.',
  },
];

/* ------------------------------------------------------------------ endings */

/**
 * буду, будешь, … — the auxiliary the compound future is built on.
 *
 * Hardcoded because it is one verb and it is the only one that does this job. An imperfective
 * verb's future is these plus its own infinitive, which is why the six cells are generated
 * rather than stored: they would be the same six words in front of every imperfective in the
 * dictionary.
 */
const BUDU: readonly string[] = ['буду', 'будешь', 'будет', 'будем', 'будете', 'будут'];

/** Which of the six present cells the auxiliary above lines up with. */
const PRESENT_ORDER = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'] as const;

/* ------------------------------------------------------------------- engine */

/**
 * A cell the rule produced, before the stored overrides are laid over it.
 *
 * The one place ё is dealt with. It is always the stressed vowel of the word it stands in —
 * that is not a tendency but a rule of the writing system, which is why Russian only writes
 * it where the stress falls — so a form containing one needs no computed stress and any
 * computed stress that disagrees with it is wrong. несёшь, принёс and пёк all come out right
 * from this line rather than from three special cases.
 */
function cell(slot: RuSlotKey, form: string, stress: number): RuForm {
  const yo = form.indexOf('ё');
  if (yo >= 0) return { slot, form, stress: countVowels(form.slice(0, yo)), source: 'rule' };
  return { slot, form, stress, source: 'rule' };
}

/**
 * Attaches the reflexive postfix, which is the last thing that happens to any form.
 *
 * -сь after a vowel and -ся after everything else: учу|сь but учишь|ся, училá|сь but учил|ся.
 * It never carries the stress, so the index computed for the bare form still stands.
 */
function reflex(form: string, on: boolean): string {
  if (!on) return form;
  return isVowel(lastLetter(form)) ? `${form}сь` : `${form}ся`;
}

/**
 * The six present endings, each chosen against the stem *that cell actually uses*.
 *
 * Which matters, because the three stems a verb can have need not agree about it. носить
 * takes -у in the first person because its first-person stem ends in ш, and -ят in the third
 * plural because its plain stem ends in с: нош|у but нос|ят. Choosing once, off one stem,
 * gets one of the two wrong for every mutating verb in the language.
 *
 * The two conjugations also decide it differently, and this is not a detail:
 *
 *   second — husher or not, and nothing else. говор|ю, люб|ят against нош|у, слыш|ат.
 *   first  — whether the stem ends in a vowel, a soft sign, or is soft without showing it.
 *            дела|ю, пь|ю, кол|ю against нес|у, жив|у, пиш|у.
 *
 * Running the first conjugation's test over a second conjugation verb yields *говору, which
 * is the bug this comment exists to stop somebody reintroducing.
 */
function presentEndings(
  conjugation: '1' | '2' | 'mixed',
  stems: { first: string; middle: string; third: string },
  soft: boolean,
  stress: RuStressPresent,
): string[] {
  const softFirst =
    conjugation === '2'
      ? !HUSHERS.includes(lastLetter(stems.first))
      : takesSoftEnding(stems.first, soft);
  const softThird =
    conjugation === '2'
      ? !HUSHERS.includes(lastLetter(stems.third))
      : takesSoftEnding(stems.third, soft);

  if (conjugation === '2') {
    return [softFirst ? 'ю' : 'у', 'ишь', 'ит', 'им', 'ите', softThird ? 'ят' : 'ат'];
  }

  // -ёшь rather than -ешь exactly when the ending is stressed. The two are the same ending;
  // ё is simply how Russian writes a stressed /o/ here, and it is never written unstressed.
  const e = stress === 'ending' ? 'ё' : 'е';
  return [softFirst ? 'ю' : 'у', `${e}шь`, `${e}т`, `${e}м`, `${e}те`, softThird ? 'ют' : 'ут'];
}

/**
 * The whole paradigm of one verb, from its rule.
 *
 * Every cell here is derived. `conjugate` then lays the stored overrides over the result and
 * marks those cells `source: 'stored'`, so the page can show which forms the rule got and
 * which a person had to write down — and so that a verb whose rule is wrong is visibly wrong
 * rather than quietly wrong.
 */
function derive(rule: RuVerbRule): RuForm[] {
  const cls = RU_CLASS_BY_ID.get(rule.classId);
  if (!cls) return [];

  const out: RuForm[] = [];
  const refl = rule.reflexive;

  const stem = rule.stemPresent;
  const stem1sg = rule.stemPresent1sg || stem;
  // Class 8 is the odd one: the velar shows in the first person *and* the third plural, and
  // mutates in the four cells between — пек|у, печ|ёшь, … пек|ут. Everywhere else the third
  // plural keeps the plain stem, including for the class 4 verbs that mutate in the first.
  const stem3pl = cls.stemPattern === 'velar' ? stem1sg : stem;

  // The postfix comes off before the ending does. `infinitive` is stored as a dictionary
  // writes it, so a reflexive verb's is учиться rather than учить, and -ся stands exactly
  // where the -ть has to be cut from: учиться → учи, not учиться.
  const stemPast = rule.stemPast || rule.infinitive.replace(/(ся|сь)$/u, '').replace(/(ть|ти|чь)$/u, '');
  const stemPastM = rule.stemPastM || stemPast;

  const stemStress = rule.stemStress ?? -1;
  const infStress = rule.stressInfinitive ?? -1;
  // Usually the past keeps the infinitive's stress — де́лать/де́лал, чита́ть/чита́л — because
  // the past is built off the same stem. It parts company where the infinitive has a syllable
  // the past does not: умере́ть but у́мер, whose index 2 names a vowel that no longer exists.
  const pastStress = rule.stemPastStress ?? infStress;

  /* -- infinitive -- */

  // The one cell that does not go through `reflex`. Every other form here is built out of a
  // stem and has to have the postfix put back on; the infinitive is the headword itself, and
  // a reflexive verb's already carries one. Passing it through would write учитьсясь.
  out.push(cell('infinitive', rule.infinitive, infStress));

  /* -- present / simple future -- */

  const endings = presentEndings(
    cls.conjugation,
    { first: stem1sg, middle: stem, third: stem3pl },
    cls.softStem,
    rule.stressPresent,
  );

  PRESENT_ORDER.forEach((person, index) => {
    const base = index === 0 ? stem1sg : index === 5 ? stem3pl : stem;
    const ending = endings[index]!;
    const form = base + ending;

    // Where the stress falls, as a vowel index into the whole word. Three patterns cover
    // essentially every verb: fixed on the stem (чита́ю, чита́ешь), fixed on the ending
    // (несу́, несёшь), and the shifting one where only the first person takes it (пишу́,
    // пи́шешь). The third is much the commonest source of a mistake, which is why it is
    // modelled rather than left to a stored accent on each cell.
    const endingStressed =
      rule.stressPresent === 'ending' || (rule.stressPresent === 'shift' && index === 0);
    const stress = endingStressed ? countVowels(base) : stemStress;

    out.push(cell(`pres.${person}` as RuSlotKey, reflex(form, refl), stress));
  });

  /* -- compound future, imperfective only -- */

  if (rule.aspect === 'impf') {
    PRESENT_ORDER.forEach((person, index) => {
      const aux = BUDU[index]!;
      out.push({
        slot: `fut.${person}` as RuSlotKey,
        form: `${aux} ${rule.infinitive}`,
        // No index, because two words have two stresses and one number cannot say where
        // either falls. The page marks these by composing the auxiliary with the accented
        // infinitive it already has a cell for.
        stress: -1,
        source: 'rule',
        // Two words, and the second of them is the infinitive already listed above. Flagged
        // so the page can set it apart from the cells that are one word, and so the form
        // index leaves it out.
        analytic: true,
      });
    });
  }

  /* -- past -- */

  // Gender and number, not person. The masculine loses its -л after a consonant stem, which
  // is the audible marker of classes 7, 8 and 9: нёс, пёк, тёр against нес|ла, пек|ла, тёр|ла.
  const masculine = cls.pastNoL ? stemPastM : `${stemPast}л`;
  // The ending carries the stress in all four cells under 'ending', and in the feminine alone
  // under 'fem'. The masculine has no ending to carry it either way — был, нёс — so it falls
  // back on the stem, and where that stem holds a ё the rule in `cell` overrides this anyway.
  const endingStress = countVowels(stemPast);
  const pastStemStress = rule.stressPast === 'ending' ? endingStress : pastStress;

  out.push(cell('past.m', reflex(masculine, refl), cls.pastNoL ? pastStress : pastStemStress));
  // была́, жила́, взяла́ — a sizeable group of very common verbs moves the stress onto the
  // ending in the feminine and nowhere else. Getting it wrong is the classic giveaway, which
  // is why it is a named pattern rather than an accent typed onto one cell.
  const feminineStress =
    rule.stressPast === 'ending' || rule.stressPast === 'fem' ? endingStress : pastStress;
  out.push(cell('past.f', reflex(`${stemPast}ла`, refl), feminineStress));
  out.push(cell('past.n', reflex(`${stemPast}ло`, refl), pastStemStress));
  out.push(cell('past.pl', reflex(`${stemPast}ли`, refl), pastStemStress));

  /* -- imperative -- */

  // Built off the present stem, and the choice between -и, -й and -ь is mechanical: a stem
  // ending in a vowel takes -й, a stressed ending takes -и, and everything else takes -ь —
  // except that a stem ending in two consonants takes -и regardless, because *помнь is
  // unsayable.
  const impStem = rule.stemImperative || stem;
  const endsInVowel = isVowel(lastLetter(impStem));
  const endsInCluster =
    impStem.length >= 2 && !isVowel(impStem[impStem.length - 1]!) && !isVowel(impStem[impStem.length - 2]!);
  const stressedEnding = rule.stressPresent === 'ending' || rule.stressPresent === 'shift';

  const imperative = endsInVowel
    ? `${impStem}й`
    : stressedEnding || endsInCluster
      ? `${impStem}и`
      : `${impStem}ь`;
  // -й is not a syllable, so a vowel-stem imperative cannot move the stress onto its ending
  // however the present tense behaves: дава́й, not *давай́. Its stress is the last vowel of
  // the stem for the ending-stressed verbs and the usual stem stress for the rest.
  const imperativeStress = endsInVowel
    ? stressedEnding
      ? countVowels(impStem) - 1
      : stemStress
    : !stressedEnding
      ? stemStress
      : countVowels(impStem);

  out.push(cell('imp.2sg', reflex(imperative, refl), imperativeStress));
  out.push(cell('imp.2pl', reflex(`${imperative}те`, refl), imperativeStress));

  /* -- participles -- */

  const thirdPlural = stem3pl + endings[5]!;
  const firstPlural = stem + endings[3]!;
  const transitive = rule.transitivity === 'tr';

  // A participle is not a new word so much as a form that already exists with a suffix on it,
  // and the stress stays where that form had it: несу́т → несу́щий → неся́, ду́мают → ду́мающий,
  // нёс → нёсший. The suffixes -щий, -вший and -ый add a syllable after the stressed one and
  // cannot move it, and -я replaces the ending's vowel with its own.
  //
  // The shifting verbs are where that stops being simply "copy the third plural", and the
  // split runs along the conjugations:
  //
  //   second — the participle takes the ending stress the first person had, not the stem
  //            stress the third plural has. лю́бят but любя́щий, хо́дят but ходя́щий, у́чим but
  //            учи́мый. This is the one every table of participles prints and every learner
  //            gets wrong.
  //   first  — the participle keeps the third plural's stem stress: пи́шут, пи́шущий.
  //
  // The gerund goes with the first person in both, which is the one thing they agree on:
  // пишу́ → пиша́, ищу́ → ища́, колю́ → коля́, борю́сь → боря́сь, учу́сь → уча́сь.
  const shifts = rule.stressPresent === 'shift';
  const onEnding = rule.stressPresent === 'ending';
  const secondShift = shifts && cls.conjugation === '2';
  const thirdPluralStress = onEnding || secondShift ? countVowels(stem3pl) : stemStress;
  const firstPluralStress = onEnding || secondShift ? countVowels(stem) : stemStress;
  const gerundStress = onEnding || shifts ? countVowels(stem3pl) : stemStress;

  if (rule.aspect === 'impf') {
    // Present active: the third plural with its -т swapped for -щий. делают → делающий.
    out.push(cell('part.pres.act', reflex(`${thirdPlural.slice(0, -1)}щий`, refl), thirdPluralStress));
    // Present passive: the first plural plus -ый, and only a transitive imperfective has one.
    if (transitive && !refl) out.push(cell('part.pres.pass', `${firstPlural}ый`, firstPluralStress));
    // Present gerund: the third plural without its ending, plus -я. делают → делая.
    const gerundStem = thirdPlural.slice(0, -2);
    const gerund = HUSHERS.includes(lastLetter(gerundStem)) ? `${gerundStem}а` : `${gerundStem}я`;
    out.push(cell('ger.pres', reflex(gerund, refl), gerundStress));
  }

  // Past active: -вший after a vowel, -ший after a consonant. делавший, нёсший.
  const pastActiveStem = cls.pastNoL ? stemPastM : stemPast;
  out.push(
    cell(
      'part.past.act',
      reflex(isVowel(lastLetter(pastActiveStem)) ? `${pastActiveStem}вший` : `${pastActiveStem}ший`, refl),
      // The past stem's own stress, never the past ending's: жда́вший though the past is
      // ждал, ждала́, and -вший is a suffix rather than an ending for it to move onto.
      pastStress,
    ),
  );

  // Past gerund: -в after a vowel, -ши after a consonant. Overwhelmingly a perfective form —
  // сделав, принёсши — which is why an imperfective one is rare enough to leave to overrides.
  if (rule.aspect === 'pf') {
    // A reflexive one is -вшись, not the plain gerund with a postfix stuck on: верну́вшись and
    // нае́вшись, never *вернувся. The -ши- that the non-reflexive form only takes after a
    // consonant comes back for all of them, so this is built rather than passed to `reflex`.
    const afterVowel = isVowel(lastLetter(pastActiveStem));
    const gerundPast = refl
      ? `${pastActiveStem}${afterVowel ? 'вшись' : 'шись'}`
      : `${pastActiveStem}${afterVowel ? 'в' : 'ши'}`;
    out.push(cell('ger.past', gerundPast, pastStress));
  }

  // Past passive, for *perfective* transitive verbs. Three suffixes, and which one a verb
  // takes is a property of its class rather than of the verb: -нный for the -ать classes,
  // -енный/-ённый for the second conjugation and the consonant stems, -тый for the short
  // roots. A reflexive verb has no passive at all — it is already one.
  //
  // The perfective restriction is doing real work. An imperfective past passive is a
  // theoretical form rather than a word anybody says: деланный and пониманный are what the
  // suffix rule produces for делать and понимать, and neither belongs in a dictionary. The
  // handful of imperfectives that genuinely have one — читанный, писанный — are rare enough
  // to be worth writing down, which is what `overrides` is for.
  if (cls.passive && transitive && !refl && rule.aspect === 'pf') {
    const base =
      cls.passive.base === 'stem1sg' ? stem1sg : cls.passive.base === 'stemPresent' ? stem : stemPast;
    // -ённый where the ending is stressed, -енный where the stem is: принесённый, ку́пленный.
    const suffix =
      cls.passive.type === 'nn'
        ? 'нный'
        : cls.passive.type === 't'
          ? 'тый'
          : cls.id === '7' || cls.id === '8'
            ? 'ённый'
            : 'енный';

    // No stress index, unlike the participles above, and this one is a deliberate blank
    // rather than an oversight: the past passive is where the stress retracts onto the prefix
    // for a whole family of verbs — на́чатый from нача́ть, при́нятый from приня́ть, про́данный
    // from прода́ть — and no index computed off the stem sees that coming. -ённый marks itself
    // and comes out right anyway; the rest are left unmarked rather than confidently wrong.
    const full = base + suffix;
    out.push(cell('part.past.pass', full, -1));
    // The short form is the one that actually gets used — дверь закрыта, письмо написано —
    // and it is the long form with the agreement ending off and a single -н.
    const short =
      cls.passive.type === 't' ? `${base}т` : `${base}${suffix.startsWith('ё') ? 'ён' : suffix.startsWith('е') ? 'ен' : 'н'}`;
    out.push(cell('part.past.pass.short', short, -1));
  }

  return out;
}

/**
 * A verb's full paradigm: the rule expanded, then corrected by whatever was stored for it.
 *
 * `overrides` is `ru_verb_forms` for this verb — the cells the rule cannot reach. For a
 * regular verb it is empty and this returns pure derivation; for быть it supplies every cell
 * and the derivation is thrown away. Both are the same code path, which is what stops the
 * irregulars from becoming a special case that rots.
 */
export function conjugate(rule: RuVerbRule, overrides: Record<string, string> = {}): RuParadigm {
  const derived = derive(rule);
  const byslot = new Map<RuSlotKey, RuForm>();

  for (const form of derived) byslot.set(form.slot, form);

  for (const [slot, written] of Object.entries(overrides)) {
    const key = slot as RuSlotKey;

    // An empty override *removes* the cell, and this is the only way to say "this verb has
    // no such form". It is needed more often than it sounds: the gerund rule happily builds
    // ждя from ждать and можи from мочь, and both are words nobody has ever said. A rule
    // cannot know which verbs are defective — that is lexical, not morphological — so the
    // data has to be able to say so, and an absent cell is a different claim from a blank one.
    if (!written) {
      byslot.delete(key);
      continue;
    }

    // A stored cell may carry its own accent, because whoever wrote it down knows where the
    // stress falls and the rule by definition does not. Writing "хочу́" gives both the plain
    // form the index needs and the marked one the page shows, from one string.
    const at = written.indexOf(ACUTE);
    const form = at < 0 ? written : written.replace(ACUTE, '');
    const stress = at < 0 ? -1 : countVowels(written.slice(0, at - 1));

    byslot.set(key, { slot: key, form, stress, source: 'stored' });
  }

  const forms = RU_SLOT_KEYS.map(key => byslot.get(key)).filter((form): form is RuForm => form != null);

  return {
    aspect: rule.aspect,
    classId: rule.classId,
    conjugation: RU_CLASS_BY_ID.get(rule.classId)?.conjugation ?? 'mixed',
    forms,
    /** How much of this paradigm the rule produced — 100 for a regular verb, 0 for быть. */
    derivedShare:
      forms.length === 0 ? 0 : Math.round((forms.filter(f => f.source === 'rule').length / forms.length) * 100),
  };
}

/** The paradigm as a lookup, for the callers that want one cell rather than the table. */
export function paradigmMap(paradigm: RuParadigm): Partial<Record<RuSlotKey, string>> {
  const out: Partial<Record<RuSlotKey, string>> = {};
  for (const form of paradigm.forms) out[form.slot] = form.form;
  return out;
}

/**
 * Every distinct word form a verb has, for the story resolver's index.
 *
 * The compound future is left out: it is two words, and the half that is not буду is the
 * infinitive, which is already in the list.
 */
export function inflectedForms(paradigm: RuParadigm): string[] {
  const seen = new Set<string>();
  for (const form of paradigm.forms) {
    if (form.analytic) continue;
    seen.add(form.form);
  }
  return [...seen];
}

/* ------------------------------------------------------------------ persons */

/** For the pronoun column, mirroring what ka.ts gives the Georgian tables. */
export const RU_PERSONS = [
  { key: '1sg', pronoun: 'я', english: 'I' },
  { key: '2sg', pronoun: 'ты', english: 'you' },
  { key: '3sg', pronoun: 'он / она / оно', english: 'he / she / it' },
  { key: '1pl', pronoun: 'мы', english: 'we' },
  { key: '2pl', pronoun: 'вы', english: 'you (pl)' },
  { key: '3pl', pronoun: 'они', english: 'they' },
] as const;

/** The six cases, for the nominal forms that live in `word_forms` under these labels. */
export const RU_CASES = [
  { key: 'nom', label: 'Nominative', question: 'кто? что?' },
  { key: 'gen', label: 'Genitive', question: 'кого? чего?' },
  { key: 'dat', label: 'Dative', question: 'кому? чему?' },
  { key: 'acc', label: 'Accusative', question: 'кого? что?' },
  { key: 'ins', label: 'Instrumental', question: 'кем? чем?' },
  { key: 'pre', label: 'Prepositional', question: 'о ком? о чём?' },
] as const;

export type RuCaseKey = (typeof RU_CASES)[number]['key'];

/** Aspect, spelled out — the distinction the whole verb system is built on. */
export const RU_ASPECTS: readonly { id: RuAspect; label: string; hint: string }[] = [
  {
    id: 'impf',
    label: 'Imperfective',
    hint: 'The action as a process or a habit. Has a present tense, and a two-word future.',
  },
  {
    id: 'pf',
    label: 'Perfective',
    hint: 'The action as a completed whole. Has no present tense at all — its present-shaped forms are the future.',
  },
];

export type { RuStressPast, RuStressPresent };
