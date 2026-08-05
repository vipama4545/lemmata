// Writes the database back out to data/*.json.
//
//     npm run db:export
//
// The seed's inverse, and the thing that keeps the authoring pipeline usable now that the
// admin screens can edit content directly. The database is the source of truth; this is how
// the generated files catch up with it, so that `npm run build:data` has something current
// to work from and `npm run db:verify` has something true to compare against.
//
// The round trip after editing on the live site:
//
//     npm run db:export          # database  -> data/*.json
//     npm run db:verify          # proves the two now agree
//     git diff data/             # read what changed
//
// It writes through the *real* assembly — the same `buildSnapshotFromDatabase` the server
// serves from — so an export can never disagree with what the app shows. What it cannot do
// is reach scripts/: lexicon.json and storyOverrides.json are the inputs to a build, not its
// output, and a word added in the browser is simply a word data/words.json has and they do
// not. Re-running build:data will drop it. Fold anything worth keeping into scripts/ by hand,
// or leave the pipeline alone and treat the database as authoritative — which, since the
// admin screens exist, is the ordinary case.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asc } from 'drizzle-orm';
import { PERSONS, SCREEVES, SERIES } from '@georgian/shared/grammar';
import type { Story, VerbData, WordData } from '@georgian/shared/types';
import { buildSnapshotFromDatabase, loadStory } from '../router/content.ts';
import { db, schema, sql } from './index.ts';

const DATA = fileURLToPath(new URL('../../../../data/', import.meta.url));

/**
 * Deep equality that ignores the order of an object's keys but not of an array's elements —
 * the same asymmetry `npm run db:verify` uses, and for the same reason. `{present, aorist}`
 * and `{aorist, present}` are the same paradigm because the app reads screeves by name;
 * `[a, b]` and `[b, a]` are not the same word list, because the grid renders them in order.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => same(item, b[index]));
  }
  if (typeof a !== 'object') return false;

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(key => key in right && same(left[key], right[key]));
}

/**
 * Writes a file, unless what is already there says the same thing.
 *
 * The skip is not an optimisation — it is what keeps `git diff data/` worth reading. These
 * files were formatted by six different writers over time (verbs.json is emitted on one line
 * by its build script and was pretty-printed by an editor afterwards), so re-emitting them
 * all in one house style would put 130,000 lines of reflow around the three that changed.
 * Comparing the content rather than the bytes means only a real change writes anything, and
 * an export run twice is a no-op the second time.
 */
function write(name: string, value: unknown): void {
  const path = `${DATA}${name}`;
  if (existsSync(path)) {
    try {
      if (same(JSON.parse(readFileSync(path, 'utf-8')), JSON.parse(JSON.stringify(value)))) {
        console.log(`  ${name.padEnd(34)} unchanged`);
        return;
      }
    } catch {
      // Unparseable or unreadable: fall through and replace it.
    }
  }

  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`, 'utf-8');
  console.log(`  ${name.padEnd(34)} written`);
}

/** A story's prose, written only where there is not already a file. See the note below. */
function writeSource(name: string, paragraphs: string[]): void {
  const path = `${DATA}stories/${name}`;
  if (existsSync(path)) return;
  writeFileSync(path, `${paragraphs.join('\n\n')}\n`, 'utf-8');
  console.log(`  stories/${name}  (new — written from the database)`);
}

const snapshot = await buildSnapshotFromDatabase();

console.log(`Exporting content version ${snapshot.version}`);

/* ------------------------------------------------------------------- words */

// Written exactly as the assembly produces it, `englishFull` included. That field is derived
// — it is the senses as plain text — and it is tempting to leave it out as a second copy of
// something already there. It stays because words.json has always carried it and
// `npm run db:verify` compares the two field by field: dropping it here would turn every
// entry into a difference and make the check that proves this export was faithful fail.
const words: WordData = snapshot.words;

write('words.json', words);

/* ------------------------------------------------------------------- verbs */

// The three fixed-grammar arrays are put back here. They are not in the database on purpose
// — see the note at the head of grammar.ts — but verbs.json has always carried them, and the
// build scripts and db:verify both read them out of it.
const verbs: VerbData = {
  source: snapshot.verbs.source,
  persons: [...PERSONS],
  screeves: [...SCREEVES],
  series: [...SERIES],
  groups: snapshot.verbs.groups,
  verbs: snapshot.verbs.verbs,
};

write('verbs.json', verbs);
write('verbMorphemes.json', snapshot.morphemes);
write('images.json', snapshot.images);
write('categoryImages.json', snapshot.categoryImages);

/* ----------------------------------------------------------------- stories */

const storyRows = await db
  .select({ id: schema.stories.id })
  .from(schema.stories)
  .orderBy(asc(schema.stories.id));

for (const row of storyRows) {
  const story = await loadStory(row.id);
  if (!story) continue;

  // A story added in the browser has no .txt beside it, and `build:data` deletes reader data
  // whose source has gone — so one is written for it. An existing .txt is left exactly alone.
  //
  // That asymmetry is deliberate. `readLines` throws away the shape of the source: leading
  // indentation, the "-" rule under the title, whether paragraphs are separated by a blank
  // line or a newline. Writing the paragraphs back out would produce a file that reads the
  // same and diffs completely, which would bury the content changes this export exists to
  // show. The prose is the one thing here a person typed, so it is the one thing not
  // regenerated over.
  writeSource(`${story.id}.txt`, [story.title, ...story.paragraphs]);
  if (story.translation.length) {
    writeSource(`${story.id}.en.txt`, [story.titleEnglish || story.title, ...story.translation]);
  }

  write(`stories/${story.id}.json`, story satisfies Story);
}

console.log(`\nDone. ${storyRows.length} story/stories, ${words.words.length} words, ${verbs.verbs.length} verbs.`);
console.log('`npm run db:verify` will now pass. `git diff data/` shows what the edits changed.');

await sql.end({ timeout: 5 });
