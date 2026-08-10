// The fixed grammatical furniture of Georgian: six persons, three series, eleven screeves.
//
// These are not in the database, and deliberately so. They are facts about the language
// rather than data about this dictionary — Georgian is not going to grow a twelfth screeve
// while the seed is running — and `PersonKey`, `ScreeveKey` and `SeriesId` in types.ts
// already pin them as compile-time unions. A table whose rows had to match a literal union
// would be a second copy of the same closed set, with the added property that the two could
// silently disagree.
//
// The spreadsheet still states them, and `npm run db:verify` checks these against what it
// says, so the two cannot drift without something failing loudly.
//
// The gloss on each screeve uses "abandon" because the paradigms are alphabetical and that
// is the first verb in the source; it is a worked example, not a translation of anything.
//
// Its Russian counterpart is ./ru.ts, and the two are deliberately not made to share an
// abstraction: an eleven-screeve × six-person grid and an aspect pair with a gender-marked
// past have nothing in common but the word "verb". ./index.ts holds the registry that lets
// the app pick between them without either knowing the other exists.

import type { Person, Screeve, Series } from '../types.ts';

export const PERSONS: readonly Person[] = [
  { key: '1sg', label: '1sg', pronoun: 'მე', english: 'I' },
  { key: '2sg', label: '2sg', pronoun: 'შენ', english: 'you' },
  { key: '3sg', label: '3sg', pronoun: 'ის', english: 'he/she/it' },
  { key: '1pl', label: '1pl', pronoun: 'ჩვენ', english: 'we' },
  { key: '2pl', label: '2pl', pronoun: 'თქვენ', english: 'you (pl)' },
  { key: '3pl', label: '3pl', pronoun: 'ისინი', english: 'they' },
];

export const SCREEVES: readonly Screeve[] = [
  { key: 'present', label: 'Present', series: 'I', gloss: 'I abandon' },
  { key: 'imperfect', label: 'Imperfect', series: 'I', gloss: 'I was abandoning' },
  { key: 'presentSubjunctive', label: 'Present subjunctive', series: 'I', gloss: '(that) I abandon' },
  { key: 'future', label: 'Future', series: 'I', gloss: 'I will abandon' },
  { key: 'conditional', label: 'Conditional', series: 'I', gloss: 'I would abandon' },
  { key: 'futureSubjunctive', label: 'Future subjunctive', series: 'I', gloss: '(that) I will abandon' },
  { key: 'aorist', label: 'Aorist', series: 'II', gloss: 'I abandoned' },
  { key: 'optative', label: 'Optative', series: 'II', gloss: '(that) I abandon' },
  { key: 'perfect', label: 'Perfect', series: 'III', gloss: 'I have abandoned' },
  { key: 'pluperfect', label: 'Pluperfect', series: 'III', gloss: 'I had abandoned' },
  { key: 'perfectSubjunctive', label: 'Perfect subjunctive', series: 'III', gloss: '(that) I have abandoned' },
];

export const SERIES: readonly Series[] = [
  {
    id: 'I',
    label: 'Series I — present and future',
    screeves: ['present', 'imperfect', 'presentSubjunctive', 'future', 'conditional', 'futureSubjunctive'],
  },
  { id: 'II', label: 'Series II — aorist', screeves: ['aorist', 'optative'] },
  { id: 'III', label: 'Series III — perfect', screeves: ['perfect', 'pluperfect', 'perfectSubjunctive'] },
];
