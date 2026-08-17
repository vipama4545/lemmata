// Copies the uploads under MEDIA_DIR into the database, once.
//
// The other half of migration 0011. That migration added `lesson_media.data` and
// `quiz_audio.data`; this fills them in from the files those rows used to point at, so that a
// dump of the database is the whole of the content rather than an index into a directory that
// has to be moved separately.
//
// Safe to run twice, and safe to run against a database that has already been imported: it only
// looks at rows whose `data` is still null, so a second run finds nothing to do and says so. It
// is also safe to run where the files have gone — those rows are reported and left null, which
// is exactly what a null in that column is for.
//
// Nothing is deleted here. The files stay where they are until somebody who has seen the
// pictures still draw removes the directory by hand.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, isNull } from 'drizzle-orm';
import { db, schema, sql } from './index.ts';
import { env } from '../env.ts';

/** `--dry-run` reads and counts, and writes nothing. */
const dryRun = process.argv.includes('--dry-run');

/**
 * The two tables, each with the directory layout its module used to write.
 *
 * `pathFor` mirrors `legacyPathFor` in lesson/media.ts and quiz/media.ts. Duplicated rather
 * than imported because those are private to modules that no longer write files at all, and a
 * one-off importer is the wrong reason to widen either interface.
 */
const groups = [
  {
    label: 'lesson_media',
    table: schema.lessonMedia,
    pathFor: (id: string) => join(env.MEDIA_DIR, 'lesson', id.slice(0, 2), id),
  },
  {
    label: 'quiz_audio',
    table: schema.quizAudio,
    pathFor: (id: string) => join(env.MEDIA_DIR, id.slice(0, 2), id),
  },
];

let filled = 0;
let missing = 0;
let resized = 0;

for (const group of groups) {
  const rows = await db
    .select({ id: group.table.id, bytes: group.table.bytes })
    .from(group.table)
    .where(isNull(group.table.data));

  if (rows.length === 0) {
    console.log(`${group.label}: nothing to import — every row already has its bytes.`);
    continue;
  }

  console.log(`${group.label}: ${rows.length} row(s) without bytes.`);

  for (const row of rows) {
    const path = group.pathFor(row.id);

    let data: Buffer;
    try {
      data = await readFile(path);
    } catch {
      // The row outlived its file. Left null, which is what the column documents.
      console.warn(`  missing: ${row.id} — no file at ${path}`);
      missing += 1;
      continue;
    }

    // The recorded size is what the editor shows and what a total is summed from; if the file
    // disagrees, the file is the truth and the column is corrected on the way past.
    if (data.byteLength !== row.bytes) {
      console.warn(`  size: ${row.id} recorded ${row.bytes}, file is ${data.byteLength} — taking the file's.`);
      resized += 1;
    }

    if (!dryRun) {
      await db.update(group.table).set({ data, bytes: data.byteLength }).where(eq(group.table.id, row.id));
    }
    filled += 1;
  }
}

console.log(
  `\n${dryRun ? 'Would import' : 'Imported'} ${filled} file(s).` +
    (missing ? ` ${missing} row(s) had no file and were left null.` : '') +
    (resized ? ` ${resized} recorded size(s) corrected.` : ''),
);
if (dryRun) console.log('Dry run — nothing was written.');

await sql.end({ timeout: 5 });
