// Adds the Russian rows that data/ru/*.json has and the database does not.
//
//     npm run db:add-ru            what it would insert, and nothing else
//     npm run db:add-ru -- --write actually insert it
//
// This exists because `db:seed` is the wrong tool for a bulk import. The seed is an upsert
// over *every* row of a language: it would insert the 29,527 new words and, in the same pass,
// overwrite the 152 that are already there — and those are the hand-written ones, the ones
// most likely to carry a correction made through the admin screens that exists nowhere in the
// repo. This inserts and never updates, so an edited row is untouchable by construction.
//
// Nothing here can duplicate anything either, and that is belt and braces rather than one or
// the other:
//
//   the rows are filtered against the ids the database already holds, so an existing word is
//     never even offered;
//   every statement is ON CONFLICT DO NOTHING against the table's own key, so anything that
//     slipped through the filter — a row written by someone else between the two queries —
//     lands on the primary key and is dropped rather than raising.
//
// The one thing it updates is `categories.word_count`, which is a counter rather than
// content: leaving it at 74 while the category holds 8,583 words would be a lie the UI reads.
//
// Children follow their parents. A word's senses, forms and noun grammar are inserted only
// for words this run is inserting, so a word already in the database keeps the senses it has.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq, sql as raw } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { RU_CLASS_BY_ID, RU_SLOT_KEYS } from '@georgian/shared/grammar/ru';
import type { RuSlotKey, RuVerbData, WordData } from '@georgian/shared/types';
import { db, schema, sql } from './index.ts';

const DATA = fileURLToPath(new URL('../../../../data/ru/', import.meta.url));
const WRITE = process.argv.includes('--write');

const read = <T,>(name: string): T => JSON.parse(readFileSync(`${DATA}${name}`, 'utf-8')) as T;

const words = read<WordData>('words.json');
const verbs = read<RuVerbData>('verbs.json');

/* ------------------------------------------------------------ what is there */

const [existingWords, existingVerbs, existingCategories, version] = await Promise.all([
  db.select({ id: schema.words.id }).from(schema.words).where(eq(schema.words.lang, 'ru')),
  db.select({ id: schema.ruVerbs.id }).from(schema.ruVerbs),
  db.select({ id: schema.categories.id }).from(schema.categories).where(eq(schema.categories.lang, 'ru')),
  db.select().from(schema.contentVersion).where(eq(schema.contentVersion.lang, 'ru')),
]);

const haveWord = new Set(existingWords.map(row => row.id));
const haveVerb = new Set(existingVerbs.map(row => row.id));
const haveCategory = new Set(existingCategories.map(row => row.id));

/* ------------------------------------------------------------ what is new */

// `position` is the index in the file, which is what the seed would have given these rows and
// what the app orders by. The imported entries were appended, so their indices start past the
// last existing one and no row already in the database has to be renumbered.
const newWords = words.words
  .map((word, index) => ({ word, index }))
  .filter(({ word }) => !haveWord.has(word.id));

const newVerbs = verbs.verbs
  .map((verb, index) => ({ verb, index }))
  .filter(({ verb }) => !haveVerb.has(verb.id));

// The same two checks the seed makes, made here for the same reason: a class that does not
// exist or a slot that is not a slot is a bad file, and finding out after 8,000 inserts is
// worse than finding out before one.
const badClass = newVerbs.filter(({ verb }) => !RU_CLASS_BY_ID.has(verb.classId));
if (badClass.length) {
  throw new Error(
    `data/ru/verbs.json: ${badClass.length} verb(s) claim a class that does not exist: ` +
      badClass.slice(0, 5).map(({ verb }) => `${verb.infinitive} (${verb.classId})`).join(', '),
  );
}
const slots = new Set<string>(RU_SLOT_KEYS);
for (const { verb } of newVerbs) {
  for (const slot of Object.keys(verb.overrides ?? {})) {
    if (!slots.has(slot)) throw new Error(`data/ru/verbs.json: ${verb.infinitive} overrides "${slot}", which is not a slot`);
  }
}

const newVerbIds = new Set(newVerbs.map(({ verb }) => verb.id));

const categoryRows = words.categories
  .map((category, index) => ({
    id: category.id,
    lang: 'ru' as const,
    position: index,
    name: category.name,
    nameNative: category.nameNative ?? '',
    wordCount: category.wordCount ?? 0,
  }))
  .filter(row => !haveCategory.has(row.id));

const wordRows = newWords.map(({ word, index }) => ({
  id: word.id,
  lang: 'ru' as const,
  position: index,
  headword: word.headword,
  accented: word.accented ?? '',
  english: word.english ?? '',
  definition: word.definition ?? '',
  level: word.level ?? '',
  partOfSpeech: word.partOfSpeech ?? '',
  category: word.category ?? '',
  categoryId: word.categoryId,
  origin: word.origin ?? 'core',
  defaultSense: word.defaultSense ?? null,
  verbId: word.verbId ?? null,
  needsCheck: word.check === true,
  note: word.note ?? null,
}));

const senseRows = newWords.flatMap(({ word }) =>
  (word.senses ?? []).map((sense, index) => ({ wordId: word.id, position: index + 1, english: sense.english })),
);

const wordFormRows = newWords.flatMap(({ word }) =>
  (word.forms ?? []).map((form, index) => ({
    wordId: word.id,
    position: index + 1,
    form: form.form,
    gram: form.gram ?? null,
    english: form.english ?? null,
    accented: form.accented ?? '',
  })),
);

const grammarRows = newWords
  .filter(({ word }) => word.ru != null)
  .map(({ word }) => ({
    wordId: word.id,
    gender: word.ru!.gender ?? null,
    animacy: word.ru!.animacy ?? null,
    declension: word.ru!.declension ?? null,
    stressPattern: word.ru!.stressPattern ?? null,
    needsCheck: word.ru!.check === true,
  }));

const verbRows = newVerbs.map(({ verb, index }) => ({
  id: verb.id,
  position: index,
  infinitive: verb.infinitive,
  accented: verb.accented ?? '',
  english: verb.english ?? '',
  senses: verb.senses ?? [],
  aspect: verb.aspect,
  // A pair that points at a verb this run is not inserting and the database does not have
  // would be a foreign key into nothing. Null says the same thing and inserts.
  pairId: verb.pairId && (haveVerb.has(verb.pairId) || newVerbIds.has(verb.pairId)) ? verb.pairId : null,
  classId: verb.classId,
  stemPresent: verb.stemPresent ?? '',
  stemPresent1sg: verb.stemPresent1sg ?? null,
  stemImperative: verb.stemImperative ?? null,
  stemPast: verb.stemPast ?? null,
  stemPastM: verb.stemPastM ?? null,
  stressPresent: verb.stressPresent ?? 'stem',
  stressPast: verb.stressPast ?? 'stem',
  stemStress: verb.stemStress ?? null,
  stressInfinitive: verb.stressInfinitive ?? null,
  stemPastStress: verb.stemPastStress ?? null,
  reflexive: verb.reflexive === true,
  transitivity: verb.transitivity ?? '',
  government: verb.government ?? [],
  motion: verb.motion ?? '',
  level: verb.level ?? '',
  needsCheck: verb.check === true,
  note: verb.note ?? null,
}));

// An empty form is a row, not a skipped one: it is how the data says this verb has no such
// cell, and `conjugate` reads it as a deletion. See the same note in seed.ts.
const overrideRows = newVerbs.flatMap(({ verb }) =>
  Object.entries(verb.overrides ?? {}).map(([slot, form]) => ({
    verbId: verb.id,
    slot: slot as RuSlotKey,
    form,
    accented: '',
  })),
);

/* -------------------------------------------------------------- the report */

const plan: [string, number][] = [
  ['categories', categoryRows.length],
  ['words', wordRows.length],
  ['word senses', senseRows.length],
  ['word forms', wordFormRows.length],
  ['noun grammar', grammarRows.length],
  ['verb rules', verbRows.length],
  ['verb overrides', overrideRows.length],
];

console.log(`\ndata/ru holds ${words.words.length} words and ${verbs.verbs.length} verbs.`);
console.log(`The database holds ${haveWord.size} and ${haveVerb.size}. To insert:\n`);
for (const [label, count] of plan) console.log(`  ${label.padEnd(16)} ${count.toLocaleString()}`);
console.log(`\n  ${haveWord.size} existing words and ${haveVerb.size} existing verbs are left exactly as they are.`);

const counts = new Map<string, number>();
for (const word of words.words) counts.set(word.categoryId, (counts.get(word.categoryId) ?? 0) + 1);
console.log(`  categories.word_count updated for ${counts.size} Russian categories.`);

const edited = version[0]?.source === 'admin';
if (edited) {
  console.warn(
    '\n  content_version.source is "admin", so this database has been edited through the\n' +
      '  admin screens. Nothing below overwrites those edits, and the marker is left saying\n' +
      '  "admin" rather than being reset to "seed".',
  );
}

if (!WRITE) {
  console.log('\nNothing written. Re-run with --write to insert.');
  await sql.end();
  process.exit(0);
}

/* --------------------------------------------------------------- the write */

/**
 * Insert only. Batched because postgres.js binds a parameter per column per row and a
 * statement carries at most 65,535 of them, and ON CONFLICT DO NOTHING so that a row already
 * present is skipped rather than duplicated or raised on.
 */
async function insertMissing<T extends PgTable>(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  label: string,
  table: T,
  rows: InferInsertModel<T>[],
  size = 2_000,
): Promise<void> {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += size) {
    await tx.insert(table).values(rows.slice(index, index + size)).onConflictDoNothing();
  }
  console.log(`  ${label.padEnd(16)} ${rows.length.toLocaleString()}`);
}

console.log('\nWriting…');

await db.transaction(async tx => {
  // Parents before children, so a foreign key never points at a row that is not there yet.
  await insertMissing(tx, 'categories', schema.categories, categoryRows);
  await insertMissing(tx, 'verb rules', schema.ruVerbs, verbRows);
  await insertMissing(tx, 'verb overrides', schema.ruVerbForms, overrideRows);
  await insertMissing(tx, 'words', schema.words, wordRows);
  await insertMissing(tx, 'word senses', schema.wordSenses, senseRows);
  await insertMissing(tx, 'word forms', schema.wordForms, wordFormRows, 5_000);
  await insertMissing(tx, 'noun grammar', schema.ruWordGrammar, grammarRows);

  for (const [id, count] of counts) {
    await tx.update(schema.categories).set({ wordCount: count }).where(eq(schema.categories.id, id));
  }

  // Last, as in the seed: the version is what a running server compares its cached snapshot
  // against, so no reader may see the new version before the rows behind it are committed.
  //
  // The digest is computed exactly as seedLanguage would for Russian — the same array, with
  // the Georgian slots null and no images or stories — so that a later `db:seed -- --lang ru`
  // over these same files computes this same string, finds nothing changed, and leaves every
  // browser's cached copy valid.
  const digest = createHash('sha256')
    .update(JSON.stringify([words, null, null, verbs, {}, {}, []]))
    .digest('hex')
    .slice(0, 16);

  await tx
    .insert(schema.contentVersion)
    .values({
      lang: 'ru',
      version: digest,
      source: edited ? 'admin' : 'seed',
      meta: { words: words.note ?? '', verbs: verbs.source ?? '', morphemes: '', morphemesSource: '' },
    })
    .onConflictDoUpdate({
      target: schema.contentVersion.lang,
      set: { version: digest, source: edited ? 'admin' : 'seed', builtAt: new Date(), meta: raw`excluded.meta` },
    });

  console.log(`  content version  ${digest}`);
});

/* -------------------------------------------------------------- what landed */

// Counted back out of the database rather than added up in this process, because "the rows
// I meant to insert" and "the rows that are there" are the two different things this script
// exists to keep apart.
const [after] = await db
  .select({ words: raw<number>`count(*)::int` })
  .from(schema.words)
  .where(eq(schema.words.lang, 'ru'));
const [verbTotal] = await db.select({ verbs: raw<number>`count(*)::int` }).from(schema.ruVerbs);

console.log(`\nDone. ${after?.words ?? 0} Russian words and ${verbTotal?.verbs ?? 0} verb rules in the database.`);

await sql.end();
