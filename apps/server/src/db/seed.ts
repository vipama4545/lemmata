// Loads the generated files under data/ into Postgres.
//
// The authoring pipeline has not changed: the scripts under scripts/ still turn the
// spreadsheet, the scrape and the hand-written lexicon into data/*.json, and those files
// are still the thing to correct. This is the step that was previously done by `import`.
//
// It is a full replace inside one transaction rather than a diff. The content tables hold
// nothing a user has touched — every row is reproducible from the files — so working out
// which of 2,096 words changed would be effort spent to save a few seconds, and a diff that
// got it wrong would be far worse than a table that was briefly locked.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { InferInsertModel } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type {
  ImageMap,
  MorphemeData,
  Story,
  VerbData,
  WordData,
} from '@georgian/shared/types';
import { db, schema, sql } from './index.ts';

const DATA = fileURLToPath(new URL('../../../../data/', import.meta.url));

function read<T>(name: string): T {
  return JSON.parse(readFileSync(`${DATA}${name}`, 'utf-8')) as T;
}

/** The thing you can run statements on inside `db.transaction`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rows go in in batches, because postgres.js binds one parameter per column per row and a
 * statement may carry 65,535 of them. 2,000 rows is comfortably under that for the widest
 * table here and still turns 44,000 verb forms into 22 statements rather than 44,000.
 */
async function insertAll<T extends PgTable>(
  tx: Tx,
  label: string,
  table: T,
  rows: InferInsertModel<T>[],
  size = 2_000,
): Promise<void> {
  for (let index = 0; index < rows.length; index += size) {
    await tx.insert(table).values(rows.slice(index, index + size));
  }
  console.log(`  ${label.padEnd(16)} ${rows.length}`);
}

/* ------------------------------------------------------------------ files */

const words = read<WordData>('words.json');
const verbs = read<VerbData>('verbs.json');
const morphemes = read<MorphemeData>('verbMorphemes.json');
const images = read<ImageMap>('images.json');
const categoryImages = read<ImageMap>('categoryImages.json');

const storyFiles = readdirSync(`${DATA}stories`).filter(name => name.endsWith('.json'));
const stories = storyFiles.map(name => read<Story>(`stories/${name}`));

/**
 * The version the client caches against: a digest of exactly what went in.
 *
 * Content-addressed rather than a timestamp, so re-running the seed over unchanged files
 * leaves every browser's cached snapshot valid. That matters more than it sounds — a seed
 * is the sort of thing that gets run twice while someone is checking whether it worked.
 */
const version = createHash('sha256')
  .update(JSON.stringify([words, verbs, morphemes, images, categoryImages, stories]))
  .digest('hex')
  .slice(0, 16);

console.log(`Seeding content version ${version}`);

/* ------------------------------------------------------------------- rows */

const categoryRows = words.categories.map((category, index) => ({
  id: category.id,
  position: index,
  name: category.name,
  nameGeorgian: category.nameGeorgian ?? '',
  wordCount: category.wordCount ?? 0,
}));

const wordRows = words.words.map((word, index) => ({
  id: word.id,
  position: index,
  georgian: word.georgian,
  english: word.english ?? '',
  georgianDefinition: word.georgianDefinition ?? '',
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

const senseRows = words.words.flatMap(word =>
  (word.senses ?? []).map((sense, index) => ({
    wordId: word.id,
    position: index + 1,
    english: sense.english,
  })),
);

const wordFormRows = words.words.flatMap(word =>
  (word.forms ?? []).map((form, index) => ({
    wordId: word.id,
    position: index + 1,
    form: form.form,
    gram: form.gram ?? null,
    english: form.english ?? null,
  })),
);

const groupRows = verbs.groups.map((group, index) => ({
  id: group.id,
  position: index,
  label: group.label,
  name: group.name ?? '',
  notes: group.notes ?? [],
  verbCount: group.verbCount ?? 0,
}));

const knownGroups = new Set(groupRows.map(group => group.id));

const verbRows = verbs.verbs.map((verb, index) => ({
  id: verb.id,
  position: index,
  english: verb.english ?? '',
  senses: verb.senses ?? [],
  transitivity: verb.transitivity ?? '',
  verbalNoun: verb.verbalNoun ?? '',
  group: verb.group ?? '',
  // A paradigm whose group is not one of the sixteen keeps its display label above and
  // simply has no group row to point at, rather than failing the whole seed.
  groupId: verb.groupId && knownGroups.has(verb.groupId) ? verb.groupId : null,
  present3sg: verb.present3sg ?? '',
  url: verb.url ?? '',
  synonymsEnglish: verb.synonymsEnglish ?? [],
  synonymsGeorgian: verb.synonymsGeorgian ?? [],
}));

// Every cell of every paradigm, flattened. The imperative and prohibitive go in under those
// names alongside the eleven real screeves; the assembly lifts them back out into their own
// fields, because they are not screeves and the grammar page must not list them as such.
//
// A blank cell is kept, not skipped. 245 of these hold the empty string rather than being
// absent, and the two are not the same claim: a screeve listing all six persons with three
// of them blank is a paradigm the spreadsheet has a gap in, while a screeve missing those
// persons is one that does not inflect for them. Dropping the blanks would quietly turn the
// first into the second, and break the promise types.ts makes that every screeve table holds
// all six persons.
const verbFormRows = verbs.verbs.flatMap(verb => {
  const rows: { verbId: string; screeve: string; person: string; form: string }[] = [];

  for (const [screeve, forms] of Object.entries(verb.forms ?? {})) {
    for (const [person, form] of Object.entries(forms ?? {})) {
      if (form != null) rows.push({ verbId: verb.id, screeve, person, form });
    }
  }
  for (const [screeve, forms] of [
    ['imperative', verb.imperative],
    ['prohibitive', verb.prohibitive],
  ] as const) {
    for (const [person, form] of Object.entries(forms ?? {})) {
      if (form != null) rows.push({ verbId: verb.id, screeve, person, form });
    }
  }

  return rows;
});

const knownVerbs = new Set(verbRows.map(verb => verb.id));

const morphemeRows = Object.entries(morphemes.verbs)
  .filter(([verbId, entry]) => entry != null && knownVerbs.has(verbId))
  .map(([verbId, entry]) => ({
    verbId,
    root: entry!.root,
    roots: entry!.roots ?? [],
    pfsf: entry!.pfsf ?? null,
    preverbs: entry!.preverbs ?? [],
    preverbScreeves: entry!.preverbScreeves ?? [],
    version: entry!.version ?? null,
    parsed: entry!.parsed ?? 0,
    needsCheck: entry!.check === true,
  }));

const knownWords = new Set(wordRows.map(word => word.id));

function imageRowsFor(kind: 'word' | 'category', map: ImageMap) {
  return Object.entries(map)
    .filter(([, info]) => info != null)
    .map(([subjectId, info]) => ({
      kind,
      subjectId,
      url: info!.url,
      width: info!.width ?? 0,
      height: info!.height ?? 0,
      title: info!.title ?? '',
      page: info!.page ?? '',
      author: info!.author ?? '',
      license: info!.license ?? '',
      licenseUrl: info!.licenseUrl ?? '',
    }));
}

const imageRows = [...imageRowsFor('word', images), ...imageRowsFor('category', categoryImages)];

const storyRows = stories.map(story => ({
  id: story.id,
  title: story.title,
  titleEnglish: story.titleEnglish ?? '',
  level: story.level ?? '',
  source: story.source ?? '',
  note: story.note ?? '',
  stats: (story.stats ?? {}) as Record<string, number>,
  paragraphs: story.paragraphs ?? [],
  translation: story.translation ?? [],
}));

const storyTokenRows = stories.flatMap(story =>
  (story.tokens ?? []).flatMap((paragraph, paragraphIndex) =>
    paragraph.map((token, position) => ({
      storyId: story.id,
      paragraph: paragraphIndex,
      position,
      form: token.form,
      // A token may cite a word the lexicon no longer has, if a story was built against an
      // older one. Better a token with no link than a seed that will not run.
      wordId: token.word && knownWords.has(token.word) ? token.word : null,
      sense: token.sense ?? null,
      gram: token.gram ?? null,
      name: token.name ?? null,
      via: token.via ?? '',
      needsCheck: token.check === true,
      alts: token.alts ?? [],
      comment: token.comment ?? null,
    })),
  ),
);

const droppedTokenLinks = stories
  .flatMap(story => story.tokens ?? [])
  .flat()
  .filter(token => token.word && !knownWords.has(token.word)).length;

/* ------------------------------------------------------------------ write */

// One transaction for the lot. A reader that arrives halfway through sees the old content,
// never an empty dictionary — and a seed that fails on the last table leaves the previous
// version serving rather than a half-loaded one.
await db.transaction(async tx => {
  // Children first. The foreign keys cascade, but relying on that would make the order a
  // matter of luck rather than of intent.
  await tx.delete(schema.storyTokens);
  await tx.delete(schema.stories);
  await tx.delete(schema.images);
  await tx.delete(schema.wordForms);
  await tx.delete(schema.wordSenses);
  await tx.delete(schema.words);
  await tx.delete(schema.verbMorphemes);
  await tx.delete(schema.verbForms);
  await tx.delete(schema.verbs);
  await tx.delete(schema.verbGroups);
  await tx.delete(schema.categories);
  await tx.delete(schema.contentVersion);

  await insertAll(tx, 'categories', schema.categories, categoryRows);
  await insertAll(tx, 'verb groups', schema.verbGroups, groupRows);
  await insertAll(tx, 'verbs', schema.verbs, verbRows);
  await insertAll(tx, 'verb forms', schema.verbForms, verbFormRows, 5_000);
  await insertAll(tx, 'morphemes', schema.verbMorphemes, morphemeRows);
  await insertAll(tx, 'words', schema.words, wordRows);
  await insertAll(tx, 'senses', schema.wordSenses, senseRows);
  await insertAll(tx, 'word forms', schema.wordForms, wordFormRows);
  await insertAll(tx, 'images', schema.images, imageRows);
  await insertAll(tx, 'stories', schema.stories, storyRows);
  await insertAll(tx, 'story tokens', schema.storyTokens, storyTokenRows, 5_000);

  // Last, and on purpose: the version is what a running server compares its cached snapshot
  // against, so a reader must not be able to see the new version before the rows behind it.
  await tx.insert(schema.contentVersion).values({
    id: 1,
    version,
    meta: {
      words: words.note ?? '',
      verbs: verbs.source ?? '',
      morphemes: morphemes.note ?? '',
      morphemesSource: morphemes.source ?? '',
    },
  });
});

if (droppedTokenLinks > 0) {
  console.warn(
    `\n  ${droppedTokenLinks} story token(s) cite a word id the lexicon no longer has; ` +
      'their links were dropped. Re-run `npm run build:data` to rebuild the stories.',
  );
}

console.log(`\nDone. Content version ${version} is live.`);

await sql.end({ timeout: 5 });
