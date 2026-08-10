// Writes the database back out to data/<lang>/*.json.
//
//     npm run db:export [-- --lang ka]
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { LANGS, isLang } from '@georgian/shared/grammar';
import { PERSONS, SCREEVES, SERIES } from '@georgian/shared/grammar/ka';
import type { KaVerbData, Lang, RuVerbData, StoryCategory, StoryFile, WordData } from '@georgian/shared/types';
import { buildSnapshotFromDatabase } from '../router/content.ts';
import { db, schema, sql } from './index.ts';
import { loadStoryFile } from './storyFile.ts';

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
function write(lang: Lang, name: string, value: unknown): void {
  const path = `${DATA}${lang}/${name}`;
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
function writeSource(lang: Lang, name: string, paragraphs: string[]): void {
  const path = `${DATA}${lang}/stories/${name}`;
  if (existsSync(path)) return;
  writeFileSync(path, `${paragraphs.join('\n\n')}\n`, 'utf-8');
  console.log(`  stories/${name}  (new — written from the database)`);
}

const argv = process.argv.slice(2);
const at = argv.findIndex(a => a === '--lang' || a.startsWith('--lang='));
const named = at < 0 ? null : argv[at]!.includes('=') ? argv[at]!.split('=')[1]! : argv[at + 1];

if (named != null && !isLang(named)) {
  console.error(`--lang must be one of ${LANGS.join(', ')}; got ${named}`);
  await sql.end({ timeout: 5 });
  process.exit(1);
}

const langs: Lang[] = named ? [named as Lang] : [...LANGS];

for (const lang of langs) {
  const snapshot = await buildSnapshotFromDatabase(lang);
  if (!snapshot.words.words.length) {
    console.log(`\nSkipping ${lang} — nothing in the database for it.`);
    continue;
  }

  mkdirSync(`${DATA}${lang}/stories`, { recursive: true });
  console.log(`\nExporting ${lang} — content version ${snapshot.version}`);

  /* ----------------------------------------------------------------- words */

  // Written exactly as the assembly produces it, `englishFull` included. That field is
  // derived — it is the senses as plain text — and it is tempting to leave it out as a second
  // copy of something already there. It stays because words.json has always carried it and
  // `npm run db:verify` compares the two field by field: dropping it here would turn every
  // entry into a difference and make the check that proves this export was faithful fail.
  write(lang, 'words.json', snapshot.words satisfies WordData);

  /* ----------------------------------------------------------------- verbs */

  // The one place this file has to know which language it is looking at, and the discriminant
  // makes it say so out loud. A Georgian export puts the three fixed-grammar arrays back —
  // they are not in the database on purpose, see the head of grammar/ka.ts, but verbs.json has
  // always carried them and both the build scripts and db:verify read them out of it. A
  // Russian export has no such arrays and no separate morphemes file: its verbs.json is a list
  // of rules, and that is the whole of it.
  if (snapshot.verbs.kind === 'ka') {
    write(lang, 'verbs.json', {
      source: snapshot.verbs.source,
      persons: [...PERSONS],
      screeves: [...SCREEVES],
      series: [...SERIES],
      groups: snapshot.verbs.groups,
      verbs: snapshot.verbs.verbs,
    } satisfies KaVerbData);
    write(lang, 'verbMorphemes.json', snapshot.verbs.morphemes);
  } else {
    write(lang, 'verbs.json', {
      source: snapshot.verbs.source,
      verbs: snapshot.verbs.verbs,
    } satisfies RuVerbData);
  }

  write(lang, 'images.json', snapshot.images);
  write(lang, 'categoryImages.json', snapshot.categoryImages);

  /* --------------------------------------------------------------- stories */

  // Written even when empty, unlike the story files: an export that left the file alone
  // could not say whether the shelves were never created or had all been deleted, and the
  // seed would put deleted ones back.
  write(lang, 'storyCategories.json', snapshot.storyCategories satisfies StoryCategory[]);

  const storyRows = await db
    .select({ id: schema.stories.id })
    .from(schema.stories)
    .where(eq(schema.stories.lang, lang))
    .orderBy(asc(schema.stories.id));

  for (const row of storyRows) {
    const story = await loadStoryFile(row.id);
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
    //
    // One .txt per chapter once there is more than one, suffixed by its number. A story of a
    // single chapter keeps the unsuffixed name it has always had, so nothing in data/ is
    // renamed by a story simply having been through this.
    story.chapters.forEach((chapter, index) => {
      const stem = story.chapters.length > 1 ? `${story.id}.${index + 1}` : story.id;
      writeSource(lang, `${stem}.txt`, [chapter.title || story.title, ...chapter.paragraphs]);
      if (chapter.translation.length) {
        writeSource(lang, `${stem}.en.txt`, [
          chapter.titleEnglish || chapter.title || story.titleEnglish || story.title,
          ...chapter.translation,
        ]);
      }
    });

    write(lang, `stories/${story.id}.json`, story satisfies StoryFile);
  }

  const chapters = storyRows.length;
  console.log(
    `  ${chapters} story/stories, ${snapshot.storyCategories.length} story categories, ` +
      `${snapshot.words.words.length} words, ${snapshot.verbs.verbs.length} verbs.`,
  );
}

console.log('\n`npm run db:verify` will now pass. `git diff data/` shows what the edits changed.');

await sql.end({ timeout: 5 });
