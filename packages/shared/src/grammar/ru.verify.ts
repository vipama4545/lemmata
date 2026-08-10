// Checks the conjugation rules against paradigms known to be right.
//
//     npm run verify:ru
//
// It exists because ./ru.ts is the only file in this project that *generates* content rather
// than carrying it. A wrong stem in the data is one wrong verb; a wrong rule here is every
// verb of its class, silently, and no amount of reading the code catches an ending applied to
// the wrong stem. So every class has at least one verb below with its forms written out from
// a reference grammar, and the rules have to reproduce them.
//
// One case per class is the floor, not the target. Where a class has a second way of going
// wrong — the mutation in class 4, the velar in class 8, the feminine stress shift, the
// reflexive postfix — there is a verb for that too. Add one whenever a rule is changed, and
// especially whenever one is changed to fix a verb: that is exactly the edit that breaks the
// other fifty verbs of the class.
//
// A mismatch here does not necessarily mean the rule is wrong. It can also mean the verb is
// irregular and wants a row in ru_verb_forms — несомый below is one, and the engine's answer
// of несёмый is what a regular class 7 verb would do. The distinction is a judgement, which
// is why this prints the disagreement rather than deciding.

import { readFileSync } from 'node:fs';
import { ACUTE, RU_CLASSES, RU_CLASS_BY_ID, accented, conjugate, paradigmMap } from './ru.ts';
import type { RuSlotKey, RuVerbData, RuVerbRule } from '../types.ts';

type Case = { rule: RuVerbRule; expect: Partial<Record<RuSlotKey, string>> };

const r = (o: Partial<RuVerbRule> & Pick<RuVerbRule, 'infinitive' | 'aspect' | 'classId' | 'stemPresent'>): RuVerbRule => ({
  stressPresent: 'stem', stressPast: 'stem', reflexive: false, transitivity: 'tr', ...o,
});

const cases: Case[] = [
  { rule: r({ infinitive: 'делать', aspect: 'impf', classId: '1', stemPresent: 'дела', stemStress: 0, stressInfinitive: 0 }),
    expect: { 'pres.1sg': 'делаю', 'pres.2sg': 'делаешь', 'pres.3pl': 'делают', 'past.m': 'делал', 'past.f': 'делала', 'imp.2sg': 'делай', 'part.pres.act': 'делающий', 'ger.pres': 'делая', 'part.past.act': 'делавший' } },
  { rule: r({ infinitive: 'читать', aspect: 'impf', classId: '1', stemPresent: 'чита', stemStress: 1, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'читаю', 'pres.2pl': 'читаете', 'pres.3pl': 'читают', 'part.pres.pass': 'читаемый' } },
  { rule: r({ infinitive: 'рисовать', aspect: 'impf', classId: '2', stemPresent: 'рису', stemStress: 1, stressInfinitive: 2 }),
    expect: { 'pres.1sg': 'рисую', 'pres.2sg': 'рисуешь', 'pres.3pl': 'рисуют', 'past.m': 'рисовал', 'imp.2sg': 'рисуй' } },
  { rule: r({ infinitive: 'вернуть', aspect: 'pf', classId: '3', stemPresent: 'верн', stressPresent: 'ending', stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'верну', 'pres.2sg': 'вернёшь', 'pres.3pl': 'вернут', 'past.m': 'вернул', 'imp.2sg': 'верни', 'part.past.pass': 'вернутый', 'ger.past': 'вернув' } },
  { rule: r({ infinitive: 'говорить', aspect: 'impf', classId: '4', stemPresent: 'говор', stressPresent: 'ending', stressInfinitive: 2 }),
    expect: { 'pres.1sg': 'говорю', 'pres.2sg': 'говоришь', 'pres.3pl': 'говорят', 'past.m': 'говорил', 'imp.2sg': 'говори', 'ger.pres': 'говоря' } },
  { rule: r({ infinitive: 'любить', aspect: 'impf', classId: '4', stemPresent: 'люб', stemPresent1sg: 'любл', stressPresent: 'shift', stemStress: 0, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'люблю', 'pres.2sg': 'любишь', 'pres.3pl': 'любят', 'imp.2sg': 'люби' } },
  { rule: r({ infinitive: 'носить', aspect: 'impf', classId: '4', stemPresent: 'нос', stemPresent1sg: 'нош', stressPresent: 'shift', stemStress: 0, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'ношу', 'pres.2sg': 'носишь', 'pres.3pl': 'носят' } },
  { rule: r({ infinitive: 'видеть', aspect: 'impf', classId: '5', stemPresent: 'вид', stemPresent1sg: 'виж', stemStress: 0, stressInfinitive: 0 }),
    expect: { 'pres.1sg': 'вижу', 'pres.2sg': 'видишь', 'pres.3pl': 'видят', 'past.m': 'видел' } },
  { rule: r({ infinitive: 'слышать', aspect: 'impf', classId: '5', stemPresent: 'слыш', stemStress: 0, stressInfinitive: 0 }),
    expect: { 'pres.1sg': 'слышу', 'pres.2sg': 'слышишь', 'pres.3pl': 'слышат' } },
  { rule: r({ infinitive: 'писать', aspect: 'impf', classId: '6', stemPresent: 'пиш', stemPast: 'писа', stressPresent: 'shift', stemStress: 0, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'пишу', 'pres.2sg': 'пишешь', 'pres.3pl': 'пишут', 'past.m': 'писал', 'imp.2sg': 'пиши', 'ger.pres': 'пиша' } },
  { rule: r({ infinitive: 'нести', aspect: 'impf', classId: '7', stemPresent: 'нес', stemPast: 'нес', stemPastM: 'нёс', stressPresent: 'ending', stressPast: 'ending', stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'несу', 'pres.2sg': 'несёшь', 'pres.3pl': 'несут', 'past.m': 'нёс', 'past.f': 'несла', 'past.pl': 'несли', 'imp.2sg': 'неси', 'part.past.act': 'нёсший' } },
  { rule: r({ infinitive: 'мочь', aspect: 'impf', classId: '8', stemPresent: 'мож', stemPresent1sg: 'мог', stemPast: 'мог', stressPresent: 'shift', stressPast: 'ending', stemStress: 0, stressInfinitive: 0, transitivity: 'intr' }),
    expect: { 'pres.1sg': 'могу', 'pres.2sg': 'можешь', 'pres.3pl': 'могут', 'past.m': 'мог', 'past.f': 'могла', 'past.pl': 'могли' } },
  { rule: r({ infinitive: 'печь', aspect: 'impf', classId: '8', stemPresent: 'печ', stemPresent1sg: 'пек', stemPast: 'пек', stemPastM: 'пёк', stressPresent: 'ending', stressPast: 'ending', stressInfinitive: 0 }),
    expect: { 'pres.1sg': 'пеку', 'pres.2sg': 'печёшь', 'pres.3pl': 'пекут', 'past.m': 'пёк', 'past.f': 'пекла' } },
  { rule: r({ infinitive: 'тереть', aspect: 'impf', classId: '9', stemPresent: 'тр', stemPast: 'тёр', stressPresent: 'ending', stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'тру', 'pres.2sg': 'трёшь', 'pres.3pl': 'трут', 'past.m': 'тёр', 'past.f': 'тёрла', 'imp.2sg': 'три' } },
  { rule: r({ infinitive: 'колоть', aspect: 'impf', classId: '10', stemPresent: 'кол', stressPresent: 'shift', stemStress: 0, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'колю', 'pres.2sg': 'колешь', 'pres.3pl': 'колют', 'past.m': 'колол', 'imp.2sg': 'коли' } },
  { rule: r({ infinitive: 'пить', aspect: 'impf', classId: '11', stemPresent: 'пь', stemImperative: 'пе', stemPast: 'пи', stressPresent: 'ending', stressPast: 'fem', stressInfinitive: 0 }),
    expect: { 'pres.1sg': 'пью', 'pres.2sg': 'пьёшь', 'pres.3pl': 'пьют', 'past.m': 'пил', 'past.f': 'пила', 'imp.2sg': 'пей', 'imp.2pl': 'пейте' } },
  { rule: r({ infinitive: 'мыть', aspect: 'impf', classId: '12', stemPresent: 'мо', stemPast: 'мы', stemStress: 0, stressInfinitive: 0 }),
    expect: { 'pres.1sg': 'мою', 'pres.2sg': 'моешь', 'pres.3pl': 'моют', 'past.m': 'мыл', 'imp.2sg': 'мой' } },
  { rule: r({ infinitive: 'петь', aspect: 'impf', classId: '12', stemPresent: 'по', stemImperative: 'по', stemPast: 'пе', stressPresent: 'ending', stressInfinitive: 0 }),
    expect: { 'pres.1sg': 'пою', 'pres.2sg': 'поёшь', 'pres.3pl': 'поют', 'past.m': 'пел', 'imp.2sg': 'пой' } },
  { rule: r({ infinitive: 'давать', aspect: 'impf', classId: '13', stemPresent: 'да', stemImperative: 'дава', stressPresent: 'ending', stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'даю', 'pres.2sg': 'даёшь', 'pres.3pl': 'дают', 'past.m': 'давал', 'imp.2sg': 'давай' } },
  { rule: r({ infinitive: 'начать', aspect: 'pf', classId: '14', stemPresent: 'начн', stemPast: 'нача', stressPresent: 'ending', stressPast: 'fem', stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'начну', 'pres.2sg': 'начнёшь', 'pres.3pl': 'начнут', 'past.m': 'начал', 'past.f': 'начала', 'imp.2sg': 'начни', 'part.past.pass': 'начатый', 'part.past.pass.short': 'начат' } },
  { rule: r({ infinitive: 'стать', aspect: 'pf', classId: '15', stemPresent: 'стан', stemPast: 'ста', stemStress: 0, stressInfinitive: 0, transitivity: 'intr' }),
    expect: { 'pres.1sg': 'стану', 'pres.2sg': 'станешь', 'pres.3pl': 'станут', 'past.m': 'стал', 'imp.2sg': 'стань', 'ger.past': 'став' } },
  { rule: r({ infinitive: 'жить', aspect: 'impf', classId: '16', stemPresent: 'жив', stemPast: 'жи', stressPresent: 'ending', stressPast: 'fem', stressInfinitive: 0, transitivity: 'intr' }),
    expect: { 'pres.1sg': 'живу', 'pres.2sg': 'живёшь', 'pres.3pl': 'живут', 'past.m': 'жил', 'past.f': 'жила', 'imp.2sg': 'живи' } },
  { rule: r({ infinitive: 'учиться', aspect: 'impf', classId: '4', stemPresent: 'уч', stemPast: 'учи', reflexive: true, stressPresent: 'shift', stemStress: 0, stressInfinitive: 0, transitivity: 'intr' }),
    expect: { 'pres.1sg': 'учусь', 'pres.2sg': 'учишься', 'pres.3pl': 'учатся', 'past.m': 'учился', 'past.f': 'училась', 'imp.2sg': 'учись',
      // The infinitive already carries its postfix, and the compound future is built on it.
      // Put it through the same -ся that every other cell needs and you get учитьсясь.
      'infinitive': 'учиться', 'fut.1sg': 'буду учиться' } },
  // Reflexive with no stored past stem, which is where the postfix and the -ть collide: the
  // default stem is cut off the infinitive, and бороться has to lose both to reach боро.
  { rule: r({ infinitive: 'бороться', aspect: 'impf', classId: '10', stemPresent: 'бор', reflexive: true, stressPresent: 'shift', stemStress: 0, stressInfinitive: 1, transitivity: 'intr' }),
    expect: { 'infinitive': 'бороться', 'past.m': 'боролся', 'past.f': 'боролась', 'pres.1sg': 'борюсь', 'pres.3pl': 'борются' } },
  // The reflexive past gerund, which is a different suffix rather than the plain one with a
  // postfix on it. Half the perfectives in the dictionary are reflexive, so getting this from
  // the rule rather than from a stored cell is the difference between 1,200 overrides and none.
  { rule: r({ infinitive: 'вернуться', aspect: 'pf', classId: '3', stemPresent: 'верн', stemPast: 'верну', reflexive: true, stressPresent: 'ending', stressInfinitive: 1, transitivity: 'intr' }),
    expect: { 'ger.past': 'верну́вшись', 'past.m': 'вернулся', 'past.f': 'вернулась', 'pres.1sg': 'вернусь', 'imp.2sg': 'вернись' } },
  // Where the stress sits, as opposed to which letters are there. A participle keeps the
  // stress of the cell it is built from, and these are the four shapes that can take.
  { rule: r({ infinitive: 'делать', aspect: 'impf', classId: '1', stemPresent: 'дела', stemStress: 0, stressInfinitive: 0 }),
    expect: { 'part.pres.act': 'де́лающий', 'ger.pres': 'де́лая', 'part.past.act': 'де́лавший', 'part.pres.pass': 'де́лаемый' } },
  { rule: r({ infinitive: 'нести', aspect: 'impf', classId: '7', stemPresent: 'нес', stemPast: 'нес', stemPastM: 'нёс', stressPresent: 'ending', stressPast: 'ending', stressInfinitive: 1 }),
    expect: { 'part.pres.act': 'несу́щий', 'ger.pres': 'неся́', 'part.past.act': 'нёсший', 'pres.1sg': 'несу́', 'past.f': 'несла́' } },
  { rule: r({ infinitive: 'говорить', aspect: 'impf', classId: '4', stemPresent: 'говор', stressPresent: 'ending', stressInfinitive: 2 }),
    expect: { 'part.pres.act': 'говоря́щий', 'ger.pres': 'говоря́', 'part.past.act': 'говори́вший' } },
  // сде́лать is stressed on its first vowel, which is index 0 — the prefix is not a syllable
  // this counts and the е is the first vowel there is. Worth a case of its own: the same verb
  // sits in the list above with the letters checked and the accent not, and the two disagreed.
  { rule: r({ infinitive: 'сделать', aspect: 'pf', classId: '1', stemPresent: 'сдела', stemStress: 0, stressInfinitive: 0 }),
    expect: { 'infinitive': 'сде́лать', 'pres.1sg': 'сде́лаю', 'ger.past': 'сде́лав', 'part.past.act': 'сде́лавший' } },
  { rule: r({ infinitive: 'сделать', aspect: 'pf', classId: '1', stemPresent: 'сдела', stemStress: 1, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'сделаю', 'pres.3pl': 'сделают', 'past.m': 'сделал', 'part.past.pass': 'сделанный', 'part.past.pass.short': 'сделан', 'ger.past': 'сделав' } },
  { rule: r({ infinitive: 'построить', aspect: 'pf', classId: '4', stemPresent: 'постро', stemStress: 1, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'построю', 'pres.2sg': 'построишь', 'pres.3pl': 'построят', 'part.past.pass': 'построенный', 'part.past.pass.short': 'построен' } },
  { rule: r({ infinitive: 'купить', aspect: 'pf', classId: '4', stemPresent: 'куп', stemPresent1sg: 'купл', stressPresent: 'shift', stemStress: 0, stressInfinitive: 1 }),
    expect: { 'pres.1sg': 'куплю', 'pres.2sg': 'купишь', 'pres.3pl': 'купят', 'part.past.pass': 'купленный', 'part.past.pass.short': 'куплен' } },
  { rule: r({ infinitive: 'принести', aspect: 'pf', classId: '7', stemPresent: 'принес', stemPast: 'принес', stemPastM: 'принёс', stressPresent: 'ending', stressPast: 'ending', stressInfinitive: 2 }),
    expect: { 'pres.1sg': 'принесу', 'pres.2sg': 'принесёшь', 'past.m': 'принёс', 'past.f': 'принесла', 'part.past.pass': 'принесённый', 'ger.past': 'принёсши' } },
];

let failures = 0;
for (const { rule, expect } of cases) {
  const paradigm = conjugate(rule);
  const got = paradigmMap(paradigm);
  // An expected form written with an acute is checked *as displayed*, stress and all. The
  // plain ones are checked as letters, which is what most of the cases above care about —
  // писать takes a mutated stem or it does not, and where the accent lands is a separate
  // claim. Writing the accent in is how a case says it is making that second claim too.
  const marked = new Map(paradigm.forms.map(form => [form.slot, accented(form.form, form.stress)]));
  for (const [slot, want] of Object.entries(expect)) {
    const have = want.includes(ACUTE) ? marked.get(slot as RuSlotKey) : got[slot as RuSlotKey];
    if (have !== want) {
      failures += 1;
      console.log(`FAIL ${rule.infinitive.padEnd(12)} ${slot.padEnd(20)} want ${want.padEnd(16)} got ${have ?? '(none)'}`);
    }
  }
}
console.log(failures === 0 ? `All ${cases.length} reference paradigms match.` : `${failures} mismatches across ${cases.length} reference paradigms.`);

/* ------------------------------------------------------- the shipped dataset */

// The second half: run every verb the dictionary actually holds through the same engine.
//
// The cases above prove the *rules* are right. This proves the *data* is, which is a
// different failure: a verb can sit in a class it does not belong to, or claim a stem that
// leaves a cell empty, and nothing above would notice. The checks are deliberately shallow —
// no reference forms, because there is no reference to check 500 verbs against — so they look
// only for shapes that are always wrong, whatever the verb.

const data = JSON.parse(readFileSync(new URL('../../../../data/ru/verbs.json', import.meta.url), 'utf-8')) as RuVerbData;

const complaints: string[] = [];
let stored = 0;

for (const verb of data.verbs) {
  const cls = RU_CLASS_BY_ID.get(verb.classId);
  if (!cls) {
    complaints.push(`${verb.infinitive}: class "${verb.classId}" does not exist`);
    continue;
  }

  const paradigm = conjugate(verb, verb.overrides as Record<string, string>);
  const forms = paradigmMap(paradigm);
  stored += Object.keys(verb.overrides ?? {}).length;

  // Every verb must have the cells no Russian verb is without. A missing one means a stem is
  // empty or a class was misassigned, and the page would render a gap.
  for (const slot of ['infinitive', 'pres.1sg', 'pres.3pl', 'past.m', 'past.f'] as const) {
    if (!forms[slot]) complaints.push(`${verb.infinitive}: no ${slot}`);
  }

  // A form that still holds a stem boundary, or is shorter than its own stem, means the rule
  // fell through rather than applied.
  for (const form of paradigm.forms) {
    if (!form.analytic && form.form.length < 2) {
      complaints.push(`${verb.infinitive}: ${form.slot} is "${form.form}", which is too short to be a word`);
    }
  }

  // A perfective with a compound future, or an imperfective without one, means `aspect` is
  // wrong — which is the single most consequential field on the record.
  const hasCompound = paradigm.forms.some(f => f.slot.startsWith('fut.'));
  if (hasCompound !== (verb.aspect === 'impf')) {
    complaints.push(`${verb.infinitive}: aspect "${verb.aspect}" disagrees with its future`);
  }

  // The pair link has to point at the other aspect, or it is pointing at the wrong verb.
  if (verb.pairId) {
    const partner = data.verbs.find(v => v.id === verb.pairId);
    if (!partner) complaints.push(`${verb.infinitive}: pairId "${verb.pairId}" matches no verb`);
    else if (partner.aspect === verb.aspect) {
      complaints.push(`${verb.infinitive}: paired with ${partner.infinitive}, which is the same aspect`);
    }
  }
}

const byClass = new Map<string, number>();
for (const verb of data.verbs) byClass.set(verb.classId, (byClass.get(verb.classId) ?? 0) + 1);
const uncovered = RU_CLASSES.filter(cls => !byClass.has(cls.id));

console.log(`\n${data.verbs.length} verbs in data/ru/verbs.json across ${byClass.size} classes.`);
console.log(`  ${stored} stored cells in total — everything else is derived.`);
if (uncovered.length) {
  console.log(`  No verb yet for class(es): ${uncovered.map(c => `${c.id} (${c.example})`).join(', ')}`);
}
for (const line of complaints) console.log(`  ${line}`);

if (failures || complaints.length) process.exitCode = 1;
else console.log('\nEverything checks out.');

/* ------------------------------------------------------------------- example */

// One paradigm in full, so that a run of this leaves something a person can read.
const demo = data.verbs.find(v => v.infinitive === 'нести') ?? data.verbs[0]!;
const shown = conjugate(demo, demo.overrides as Record<string, string>);
console.log(
  `\n${demo.infinitive} — class ${shown.classId}, conjugation ${shown.conjugation}, ` +
    `${shown.derivedShare}% derived`,
);
for (const f of shown.forms) {
  console.log(`  ${f.slot.padEnd(22)} ${accented(f.form, f.stress)}${f.source === 'stored' ? '   (stored)' : ''}`);
}
