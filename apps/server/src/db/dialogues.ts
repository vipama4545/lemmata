// Files the lessons' dialogues in the library.
//
//     npm run db:dialogues [-- --lang ka] [-- --force]
//
// A dialogue is not a new kind of thing. It is a story — built from data/<lang>/stories/<id>.txt
// and its .en.txt by the story builder, tokens and all, exactly as the folk tales were — and a
// lesson reaches it with `::story <id>`. What this loader exists for is the one fact a story
// file cannot carry: which shelf it sits on. `data/<lang>/stories/*.json` has no `categoryId`
// and never has; the shelves were made in the admin screens and the filing lives in the
// database. So the dialogues would arrive on a fresh install unfiled, under "Everything else",
// which is not where a reader looking for the conversation from lesson six would think to look.
//
// It skips what is already there, as `db:lessons` does and for the same reason: past the first
// run, the database is where these are edited. A story's tokens in particular are corrected by
// hand in the reader — "Edit links" — and overwriting them from a file built against last
// month's lexicon would throw that away. `--force` is how you say the file is right and
// whatever was done in the browser is not.
//
// Nothing here deletes a story. A dialogue dropped from the list is a line removed from a
// manifest, not an instruction to unpublish something people may be part-way through.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, sql as raw } from 'drizzle-orm';
import { isLang, type Lang } from '@georgian/shared/grammar';
import type { StoryFile } from '@georgian/shared/types';
import { db, schema, sql } from './index.ts';
import { readStoryFile } from './storyFile.ts';

const DATA = fileURLToPath(new URL('../../../../data/', import.meta.url));

interface DialogueFile {
  category: { id: string; name: string; nameNative?: string; note?: string };
  /** Story ids, each of which must have a built file under stories/. */
  stories: string[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* -------------------------------------------------------------------- arguments */

const args = process.argv.slice(2);
const force = args.includes('--force');
const at = args.indexOf('--lang');
const asked = at === -1 ? null : (args[at + 1] ?? '');

if (asked !== null && !isLang(asked)) {
  console.error(`“${asked}” is not a language this build knows about.`);
  process.exit(1);
}

const only = asked as Lang | null;

/* ------------------------------------------------------------------------- work */

/** The next free position, so a new shelf lands after the ones already made. */
async function nextPosition(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ max: raw<number | null>`max(${schema.storyCategories.position})` })
    .from(schema.storyCategories);
  return (row?.max ?? -1) + 1;
}

/**
 * Writes one story, its chapters and every token, having cleared whatever was there.
 *
 * Cleared rather than upserted because a token's identity is its *position* — story, chapter,
 * paragraph, word — and a rebuild that shortened a paragraph would leave the old tail of it
 * behind, pointing at words that are no longer on the page.
 */
async function writeStory(tx: Tx, lang: Lang, file: StoryFile, categoryId: string): Promise<void> {
  const cited = [
    ...new Set(file.chapters.flatMap(chapter => chapter.tokens.flat().flatMap(token => (token.word ? [token.word] : [])))),
  ];

  // A story built against a lexicon that has since lost a word would otherwise fail the
  // foreign key and take the whole run with it. A token with no link still shows its word.
  const known = new Set(
    cited.length
      ? (await tx.select({ id: schema.words.id }).from(schema.words).where(inArray(schema.words.id, cited))).map(
          row => row.id,
        )
      : [],
  );

  const row = {
    lang,
    title: file.title,
    titleEnglish: file.titleEnglish ?? '',
    level: file.level ?? '',
    source: file.source ?? '',
    note: file.note ?? '',
    categoryId,
    stats: file.stats as Record<string, number>,
  };

  await tx
    .insert(schema.stories)
    .values({ id: file.id, ...row })
    .onConflictDoUpdate({ target: schema.stories.id, set: row });

  await tx.delete(schema.storyTokens).where(eq(schema.storyTokens.storyId, file.id));
  await tx.delete(schema.storyChapters).where(eq(schema.storyChapters.storyId, file.id));

  await tx.insert(schema.storyChapters).values(
    file.chapters.map((chapter, position) => ({
      storyId: file.id,
      position,
      title: chapter.title,
      titleEnglish: chapter.titleEnglish,
      stats: chapter.stats as Record<string, number>,
      paragraphs: chapter.paragraphs,
      translation: chapter.translation,
    })),
  );

  const tokens = file.chapters.flatMap((chapter, index) =>
    chapter.tokens.flatMap((paragraph, at) =>
      paragraph.map((token, position) => ({
        storyId: file.id,
        chapter: index,
        paragraph: at,
        position,
        form: token.form,
        wordId: token.word && known.has(token.word) ? token.word : null,
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

  // postgres.js binds one parameter per column per row and a statement may carry 65,535 of
  // them, so a long text goes up in batches, as the seed does.
  for (let index = 0; index < tokens.length; index += 2_000) {
    await tx.insert(schema.storyTokens).values(tokens.slice(index, index + 2_000));
  }
}

async function load(lang: Lang): Promise<void> {
  const path = `${DATA}${lang}/dialogues.json`;
  if (!existsSync(path)) {
    console.log(`${lang}: no dialogues.json, nothing to do.`);
    return;
  }

  const file = JSON.parse(readFileSync(path, 'utf-8')) as DialogueFile;
  const added: string[] = [];
  const filed: string[] = [];
  const skipped: string[] = [];
  const elsewhere: string[] = [];
  const missing: string[] = [];

  await db.transaction(async tx => {
    const [shelf] = await tx
      .select({ id: schema.storyCategories.id })
      .from(schema.storyCategories)
      .where(eq(schema.storyCategories.id, file.category.id))
      .limit(1);

    const shelfRow = {
      lang,
      name: file.category.name,
      nameNative: file.category.nameNative ?? '',
      note: file.category.note ?? '',
    };

    if (!shelf) {
      await tx
        .insert(schema.storyCategories)
        .values({ ...shelfRow, id: file.category.id, position: await nextPosition(tx) });
    } else if (force) {
      await tx.update(schema.storyCategories).set(shelfRow).where(eq(schema.storyCategories.id, file.category.id));
    }

    for (const id of file.stories) {
      const source = `${DATA}${lang}/stories/${id}.json`;
      if (!existsSync(source)) {
        missing.push(id);
        continue;
      }

      const [existing] = await tx
        .select({ id: schema.stories.id, categoryId: schema.stories.categoryId })
        .from(schema.stories)
        .where(eq(schema.stories.id, id))
        .limit(1);

      // A story that is already here keeps its text and its tokens — but the filing is the one
      // thing this loader owns, so an unfiled one is still put on the shelf. That is not an
      // edge case: a fresh install seeds every story file first, `db:seed` knows nothing about
      // shelves, and without this the dialogues would sit under "Everything else" for ever.
      // A story somebody has since filed somewhere else is left where they put it.
      if (existing && !force) {
        if (!existing.categoryId) {
          await tx
            .update(schema.stories)
            .set({ categoryId: file.category.id })
            .where(eq(schema.stories.id, id));
          filed.push(id);
        } else if (existing.categoryId !== file.category.id) {
          elsewhere.push(id);
        } else {
          skipped.push(id);
        }
        continue;
      }

      await writeStory(tx, lang, readStoryFile(lang, JSON.parse(readFileSync(source, 'utf-8'))), file.category.id);
      added.push(id);
    }

    // What the shelf says it holds, counted rather than assumed: the file has no idea what
    // else somebody has filed here from the admin screens.
    const [count] = await tx
      .select({ total: raw<number>`count(*)` })
      .from(schema.stories)
      .where(and(eq(schema.stories.categoryId, file.category.id), eq(schema.stories.lang, lang)));
    await tx
      .update(schema.storyCategories)
      .set({ storyCount: Number(count?.total ?? 0) })
      .where(eq(schema.storyCategories.id, file.category.id));

    // Last, in the same transaction, exactly as an edit made in the browser does it: the
    // server's snapshot is keyed on this and so is every reader's cached copy.
    const version = Math.random().toString(36).slice(2, 18);
    await tx
      .insert(schema.contentVersion)
      .values({ lang, version, source: 'admin', builtAt: new Date() })
      .onConflictDoUpdate({
        target: schema.contentVersion.lang,
        set: { version, source: 'admin', builtAt: new Date() },
      });
  });

  console.log(
    `${lang}: ${added.length} dialogue(s) written and ${filed.length} already-seeded one(s) filed ` +
      `under “${file.category.name}”${added.length ? ` — ${added.join(', ')}` : ''}.`,
  );
  if (skipped.length) {
    console.log(`  ${skipped.join(', ')} already on that shelf, left alone. Pass --force to rewrite from the file.`);
  }
  if (elsewhere.length) {
    console.log(`  ${elsewhere.join(', ')} is filed on another shelf. Left there — move it in the admin screens.`);
  }
  if (missing.length) {
    console.log(`  ${missing.join(', ')} has no built story file. Run the story builder first.`);
  }
}

for (const lang of only ? [only] : (['ka', 'ru'] as const)) {
  await load(lang);
}

await sql.end({ timeout: 5 });
