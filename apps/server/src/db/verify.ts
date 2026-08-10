// Proves the migration lost nothing.
//
// The whole risk of moving generated JSON into tables is that some field quietly does not
// survive the trip — an empty string that becomes a missing key, an array that comes back
// in a different order, a `check: true` that turns into `check: false`. None of that would
// throw. It would just make the app subtly wrong, months later, with no way to tell whether
// the data or the code was at fault.
//
// So this rebuilds the snapshot from Postgres using the *real* assembly the server serves
// from, and compares it field by field against the files the seed read. Run it after any
// change to either the schema or the assembly:
//
//     npm run db:verify

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PERSONS, SCREEVES, SERIES } from '@georgian/shared/grammar/ka';
import type { ImageMap, KaMorphemeData, Story, KaVerbData, WordData } from '@georgian/shared/types';
import { buildSnapshotFromDatabase, loadStory } from '../router/content.ts';
import { sql } from './index.ts';

const DATA = fileURLToPath(new URL('../../../../data/', import.meta.url));

function read<T>(name: string): T {
  return JSON.parse(readFileSync(`${DATA}${name}`, 'utf-8')) as T;
}

/**
 * Deep equality that does not care about the order of an object's keys, but does care very
 * much about the order of an array's elements.
 *
 * That asymmetry is the point. `{present: …, aorist: …}` and `{aorist: …, present: …}` are
 * the same paradigm — the app reads screeves by name. `[a, b]` and `[b, a]` are not the same
 * word list, because the category grid renders them in order.
 */
function diff(actual: unknown, expected: unknown, path: string, out: string[]): void {
  if (out.length >= 25) return;

  if (actual === expected) return;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      out.push(`${path}: one is an array and the other is not`);
      return;
    }
    if (actual.length !== expected.length) {
      out.push(`${path}: length ${actual.length}, expected ${expected.length}`);
      return;
    }
    for (let index = 0; index < expected.length; index += 1) {
      diff(actual[index], expected[index], `${path}[${index}]`, out);
    }
    return;
  }

  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) {
      const a = (actual as Record<string, unknown>)[key];
      const b = (expected as Record<string, unknown>)[key];
      // An absent key and an explicit undefined are the same thing in JSON.
      if (a === undefined && b === undefined) continue;
      diff(a, b, `${path}.${key}`, out);
    }
    return;
  }

  out.push(`${path}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

/* ------------------------------------------------------------------- run */

// Georgian only, and deliberately so. This check exists to prove that the *assembly* — the
// same code path the server serves from — reproduces the generated files field for field, and
// data/ka/ is where those files come from. Russian has no build pipeline to disagree with:
// data/ru/verbs.json is hand-maintained and is the source rather than an output, so there is
// nothing for a round trip to be faithful to. `npm run verify:ru` is its counterpart, and it
// checks something else entirely — that the conjugation rules produce the right forms.
const words = read<WordData>('ka/words.json');
const verbs = read<KaVerbData>('ka/verbs.json');
const morphemes = read<KaMorphemeData>('ka/verbMorphemes.json');
const images = read<ImageMap>('ka/images.json');
const categoryImages = read<ImageMap>('ka/categoryImages.json');
const stories = readdirSync(`${DATA}ka/stories`)
  .filter(name => name.endsWith('.json'))
  .map(name => read<Story>(`ka/stories/${name}`));

const snapshot = await buildSnapshotFromDatabase('ka');
if (snapshot.verbs.kind !== 'ka') throw new Error('The Georgian snapshot came back with Russian verbs in it.');
const kaVerbs = snapshot.verbs;

const checks: { label: string; actual: unknown; expected: unknown }[] = [
  { label: 'words.categories', actual: snapshot.words.categories, expected: words.categories },
  { label: 'words.words', actual: snapshot.words.words, expected: words.words },
  // The three that are constants rather than tables. Checked against the spreadsheet all
  // the same: they are not in the database precisely because they never change, and this is
  // what makes "never change" an assertion instead of an assumption.
  { label: 'grammar.PERSONS', actual: PERSONS, expected: verbs.persons },
  { label: 'grammar.SCREEVES', actual: SCREEVES, expected: verbs.screeves },
  { label: 'grammar.SERIES', actual: SERIES, expected: verbs.series },
  { label: 'verbs.groups', actual: kaVerbs.groups, expected: verbs.groups },
  { label: 'verbs.verbs', actual: kaVerbs.verbs, expected: verbs.verbs },
  { label: 'morphemes.verbs', actual: kaVerbs.morphemes.verbs, expected: morphemes.verbs },
  { label: 'images', actual: snapshot.images, expected: images },
  { label: 'categoryImages', actual: snapshot.categoryImages, expected: categoryImages },
];

let failures = 0;

for (const check of checks) {
  const out: string[] = [];
  diff(check.actual, check.expected, check.label, out);
  if (out.length === 0) {
    console.log(`  ok    ${check.label}`);
  } else {
    failures += 1;
    console.log(`  DIFF  ${check.label}`);
    for (const line of out) console.log(`          ${line}`);
  }
}

// The stories are fetched one at a time, because that is how the reader gets them: the
// snapshot carries only their summaries. Both paths are checked — the summary the index
// lists, and the full text and every token the reader paints.
for (const story of stories) {
  const out: string[] = [];

  const summary = snapshot.stories.find(entry => entry.id === story.id);
  if (!summary) {
    out.push(`stories: ${story.id} is missing from the snapshot`);
  } else {
    diff(summary.title, story.title, `story(${story.id}).title`, out);
    diff(summary.stats, story.stats, `story(${story.id}).stats`, out);
    diff(summary.translated, story.translation.length > 0, `story(${story.id}).translated`, out);
    diff(summary.excerpt, story.paragraphs[0] ?? '', `story(${story.id}).excerpt`, out);
  }

  const full = await loadStory(story.id);
  if (!full) {
    out.push(`story(${story.id}): content.story returned nothing`);
  } else {
    diff(full, story, `story(${story.id})`, out);
  }

  if (out.length === 0) {
    console.log(`  ok    story ${story.id}`);
  } else {
    failures += 1;
    console.log(`  DIFF  story ${story.id}`);
    for (const line of out) console.log(`          ${line}`);
  }
}

console.log(
  failures === 0
    ? '\nEverything in data/ came back out of Postgres unchanged.'
    : `\n${failures} section(s) differ. The database is not a faithful copy of data/.`,
);

process.exitCode = failures === 0 ? 0 : 1;
await sql.end({ timeout: 5 });
