// Writing lessons from the browser.
//
// A file of its own rather than more of admin.ts, on the same terms as adminQuiz.ts: the
// procedures here are merged into the one `admin` namespace at the foot of that file, so
// nothing about the contract or the client changes. This is a division of the source.
//
// The three rules at the head of admin.ts hold here too — one transaction per edit with the
// version bump last, derived columns maintained here rather than by the caller, and a delete
// refused while something still points at the row. The last one is the interesting case,
// because what points at a lesson's picture is *text*: there is no foreign key from a body to
// the uploads it draws, so "is anything still using this" is a question about the contents of
// `lessons.body` rather than about a column. See `filesInUse`.
//
// What is *not* here is any validation of the markup. The parser accepts anything and reports
// what it could not make sense of; refusing a save because a table is half-typed would mean the
// only way to keep a draft is to keep it somewhere else. The one thing this does check is what
// the body *names* — a quiz or an upload that is not there — and it reports that rather than
// refusing, because writing a lesson around a quiz you have not made yet is ordinary.

import { ORPCError } from '@orpc/server';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, sql as raw } from 'drizzle-orm';
import type { LessonCategoryInput, LessonInput, LessonMediaFile } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import { lessonMediaIds, lessonQuizIds, parseLesson } from '@georgian/shared/lesson';
import { isLessonSection } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { discard } from '../lesson/media.ts';
import { adminOnly, os } from './base.ts';
import { bumpContentVersion } from './content.ts';

/* ------------------------------------------------------------------- helpers */

function fail(message: string): never {
  throw new ORPCError('BAD_REQUEST', { message });
}

/** A url-safe id from a title. The same rule the other two admin files use. */
function slug(text: string, fallback: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

/**
 * Ids a lesson may not take, because the reader's routes spend them on something else.
 *
 * `/lessons/category/verbs` is a shelf, so a lesson slugged "category" would own a URL that
 * already means something — and would lose, since a static segment outranks `:lessonId`.
 * Treated as taken rather than refused, exactly as the quizzes' and the stories' are: the
 * lesson is called what it is called, and `category-2` is a better answer than an error about
 * routing.
 */
const RESERVED_LESSON_IDS = new Set(['category', 'new']);

/** `${base}`, then `${base}-2`, until nothing has it. */
async function freeLessonId(tx: Tx, table: 'lessons' | 'lessonCategories', base: string): Promise<string> {
  const target = table === 'lessons' ? schema.lessons : schema.lessonCategories;
  for (let n = 1; n < 500; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (table === 'lessons' && RESERVED_LESSON_IDS.has(id)) continue;
    const [taken] = await tx.select({ id: target.id }).from(target).where(eq(target.id, id)).limit(1);
    if (!taken) return id;
  }
  return `${base}-${Math.floor(Date.now() % 100_000_000).toString(36)}`;
}

/** The next free position, so a new row lands at the end of the list rather than at 0. */
async function nextPosition(tx: Tx, table: typeof schema.lessons | typeof schema.lessonCategories): Promise<number> {
  const [row] = await tx.select({ max: raw<number | null>`max(${table.position})` }).from(table);
  return (row?.max ?? -1) + 1;
}

/** Recounts the shelves named, so the index's counts stay true. Both, when a lesson moves. */
async function recountLessonCategories(tx: Tx, categoryIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;

  const counts = await tx
    .select({ categoryId: schema.lessons.categoryId, total: count() })
    .from(schema.lessons)
    .where(inArray(schema.lessons.categoryId, ids))
    .groupBy(schema.lessons.categoryId);

  const byId = new Map(counts.map(row => [row.categoryId, Number(row.total)]));
  for (const id of ids) {
    await tx
      .update(schema.lessonCategories)
      .set({ lessonCount: byId.get(id) ?? 0 })
      .where(eq(schema.lessonCategories.id, id));
  }
}

/* --------------------------------------------------------------- what is used */

/**
 * How many lesson bodies mention each uploaded file.
 *
 * Every body is read and parsed once, and the ids each names are counted up — rather than one
 * `LIKE '%<id>%'` per file, which is the query this looks like it should be. Two reasons, and
 * the second is the one that matters. A substring match would count an id that happens to occur
 * inside a longer word, which is unlikely with sixteen hex characters but is the sort of
 * unlikely that turns into a delete being refused for no visible reason. And the parser is the
 * definition of "uses": an id in a line the parser rejected is not a picture the lesson draws,
 * and something that counts text rather than blocks cannot tell the two apart.
 *
 * The cost is every body in memory at once. A lesson is a few kilobytes and this runs when an
 * admin opens the media list, which is not a hot path.
 */
async function filesInUse(tx: Tx | typeof db = db): Promise<Map<string, number>> {
  const bodies = await tx.select({ body: schema.lessons.body }).from(schema.lessons);
  const uses = new Map<string, number>();

  for (const row of bodies) {
    if (!row.body) continue;
    for (const id of lessonMediaIds(parseLesson(row.body))) {
      uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }

  return uses;
}

/** Every uploaded file the editor knows about, with a count of the lessons that name each. */
async function listFiles(tx: Tx | typeof db = db): Promise<LessonMediaFile[]> {
  const [rows, uses] = await Promise.all([
    tx.select().from(schema.lessonMedia).orderBy(desc(schema.lessonMedia.createdAt)),
    filesInUse(tx),
  ]);

  return rows.map(row => ({
    id: row.id,
    lang: row.lang,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    name: row.name,
    width: row.width,
    height: row.height,
    alt: row.alt,
    createdAt: row.createdAt.getTime(),
    uses: uses.get(row.id) ?? 0,
  }));
}

/** The ids in `wanted` that no row of `table` answers to. What `saveLesson` reports back. */
async function missingFrom(
  tx: Tx,
  table: typeof schema.quizzes | typeof schema.lessonMedia,
  wanted: string[],
): Promise<string[]> {
  if (!wanted.length) return [];
  const found = await tx.select({ id: table.id }).from(table).where(inArray(table.id, wanted));
  const have = new Set(found.map(row => row.id));
  return wanted.filter(id => !have.has(id));
}

/* --------------------------------------------------------------------- lessons */

/** Creates or updates one lesson. */
async function writeLesson(
  tx: Tx,
  input: LessonInput,
): Promise<{ id: string; unknownQuizzes: string[]; unknownMedia: string[] }> {
  if (!isLessonSection(input.section)) fail(`“${input.section}” is not a section.`);

  const existing = input.id
    ? (
        await tx
          .select({
            id: schema.lessons.id,
            lang: schema.lessons.lang,
            categoryId: schema.lessons.categoryId,
          })
          .from(schema.lessons)
          .where(eq(schema.lessons.id, input.id))
          .limit(1)
      )[0]
    : undefined;

  if (input.id && !existing) fail('There is no such lesson.');

  // A lesson does not change language, for the reason a quiz does not: it is written in one and
  // read in one, and an edit arriving under the other is a switcher left on the wrong
  // dictionary rather than anything anybody meant. The *section* may change, and that is the
  // point of it being a column — moving a topic between the two lists is a thing to do.
  if (existing && existing.lang !== input.lang) {
    fail(`That lesson is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
  }

  if (input.categoryId) {
    const [category] = await tx
      .select({
        id: schema.lessonCategories.id,
        lang: schema.lessonCategories.lang,
        section: schema.lessonCategories.section,
      })
      .from(schema.lessonCategories)
      .where(eq(schema.lessonCategories.id, input.categoryId))
      .limit(1);
    if (!category) fail('There is no such category.');
    if (category.lang !== input.lang) {
      fail(`That category is ${category.lang} and this lesson is ${input.lang}.`);
    }
    // Shelves belong to one section, so filing a grammar topic on a lesson shelf would put it
    // under a heading its own index never draws — visible from nowhere, which is worse than an
    // error. Moving a lesson between sections therefore means re-filing it.
    if (category.section !== input.section) {
      fail(`That category is in ${category.section} and this lesson is in ${input.section}.`);
    }
  }

  const id = existing?.id ?? (await freeLessonId(tx, 'lessons', slug(input.title, 'lesson')));

  const row = {
    lang: input.lang,
    section: input.section,
    title: input.title,
    titleNative: input.titleNative,
    summary: input.summary,
    level: input.level,
    categoryId: input.categoryId,
    body: input.body,
    note: input.note,
  };

  if (existing) {
    await tx.update(schema.lessons).set(row).where(eq(schema.lessons.id, id));
  } else {
    await tx.insert(schema.lessons).values({ ...row, id, position: await nextPosition(tx, schema.lessons) });
  }

  await recountLessonCategories(tx, [existing?.categoryId ?? null, input.categoryId]);

  // Parsed once, here, for the two lists that go back to the editor. Neither is a reason to
  // refuse; see the note on `saveLesson` in the contract.
  const doc = parseLesson(input.body);
  const [unknownQuizzes, unknownMedia] = await Promise.all([
    missingFrom(tx, schema.quizzes, lessonQuizIds(doc)),
    missingFrom(tx, schema.lessonMedia, lessonMediaIds(doc)),
  ]);

  return { id, unknownQuizzes, unknownMedia };
}

/** Creates or updates one shelf. The counterpart of `writeQuizCategory` in adminQuiz.ts. */
async function writeLessonCategory(tx: Tx, input: LessonCategoryInput): Promise<string> {
  if (!isLessonSection(input.section)) fail(`“${input.section}” is not a section.`);

  const existing = input.id
    ? (
        await tx
          .select({
            id: schema.lessonCategories.id,
            lang: schema.lessonCategories.lang,
            section: schema.lessonCategories.section,
          })
          .from(schema.lessonCategories)
          .where(eq(schema.lessonCategories.id, input.id))
          .limit(1)
      )[0]
    : undefined;

  if (input.id && !existing) fail('There is no such category.');
  if (existing && existing.lang !== input.lang) fail(`That category is ${existing.lang}, not ${input.lang}.`);
  // A shelf does not change section while lessons stand on it: they would still be filed here,
  // and their own section would no longer match, so each of them would vanish from both indexes
  // at once. Emptying it first is the honest way to do this.
  if (existing && existing.section !== input.section) {
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(schema.lessons)
      .where(eq(schema.lessons.categoryId, existing.id));
    if (Number(total) > 0) {
      fail(`That shelf holds ${total} ${Number(total) === 1 ? 'lesson' : 'lessons'}. Move them off it first.`);
    }
  }

  const id = existing?.id ?? (await freeLessonId(tx, 'lessonCategories', slug(input.name, 'category')));
  const row = {
    lang: input.lang,
    section: input.section,
    name: input.name,
    nameNative: input.nameNative,
    note: input.note,
  };

  if (existing) {
    await tx.update(schema.lessonCategories).set(row).where(eq(schema.lessonCategories.id, id));
  } else {
    await tx
      .insert(schema.lessonCategories)
      .values({ ...row, id, position: await nextPosition(tx, schema.lessonCategories) });
  }

  return id;
}

/**
 * Swaps a lesson with its neighbour on the same shelf.
 *
 * The neighbour is found in the same language, the same section *and* the same category,
 * because that is the list on screen: swapping with something on another shelf would move a
 * lesson out of the view it was being reordered in. A lesson at the end of its shelf has no
 * neighbour in that direction and this is a no-op rather than an error, which is what a button
 * held down at the end of a list should do.
 */
async function moveLesson(tx: Tx, id: string, direction: 'up' | 'down'): Promise<Lang> {
  const [lesson] = await tx.select().from(schema.lessons).where(eq(schema.lessons.id, id)).limit(1);
  if (!lesson) fail('There is no such lesson.');

  const shelf = and(
    eq(schema.lessons.lang, lesson.lang),
    eq(schema.lessons.section, lesson.section),
    // `= null` is never true in SQL, so the unfiled shelf needs its own test. Without this,
    // reordering the lessons nobody has filed would silently do nothing.
    lesson.categoryId === null
      ? isNull(schema.lessons.categoryId)
      : eq(schema.lessons.categoryId, lesson.categoryId),
  );

  const [neighbour] = await tx
    .select({ id: schema.lessons.id, position: schema.lessons.position })
    .from(schema.lessons)
    .where(
      and(
        shelf,
        direction === 'up'
          ? lt(schema.lessons.position, lesson.position)
          : gt(schema.lessons.position, lesson.position),
      ),
    )
    .orderBy(direction === 'up' ? desc(schema.lessons.position) : asc(schema.lessons.position))
    .limit(1);

  if (neighbour) {
    await tx.update(schema.lessons).set({ position: lesson.position }).where(eq(schema.lessons.id, neighbour.id));
    await tx.update(schema.lessons).set({ position: neighbour.position }).where(eq(schema.lessons.id, id));
  }

  return lesson.lang;
}

/* --------------------------------------------------------------------- routes */

/**
 * The lesson half of the admin namespace, spread into `adminRouter` in admin.ts.
 *
 * An object rather than `os.admin.router({...})`, because a router built here would be a second
 * router under the same name — these have to become part of the one that already exists.
 */
export const lessonAdminRoutes = {
  saveLesson: os.admin.saveLesson.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const written = await writeLesson(tx, input);
      return { ...written, version: await bumpContentVersion(tx, input.lang) };
    }),
  ),

  deleteLesson: os.admin.deleteLesson.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [lesson] = await tx
        .select({ lang: schema.lessons.lang, categoryId: schema.lessons.categoryId })
        .from(schema.lessons)
        .where(eq(schema.lessons.id, input.id))
        .limit(1);
      if (!lesson) fail('There is no such lesson.');

      // Nothing is refused and nothing cascades: a lesson owns no rows at all. The quizzes it
      // embedded and the pictures it drew belong to somebody else and stay where they are,
      // which is why deleting the last lesson that used a picture does not delete the picture.
      await tx.delete(schema.lessons).where(eq(schema.lessons.id, input.id));
      await recountLessonCategories(tx, [lesson.categoryId]);

      return { version: await bumpContentVersion(tx, lesson.lang) };
    }),
  ),

  moveLesson: os.admin.moveLesson.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const lang = await moveLesson(tx, input.id, input.direction);
      return { version: await bumpContentVersion(tx, lang) };
    }),
  ),

  saveLessonCategory: os.admin.saveLessonCategory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const id = await writeLessonCategory(tx, input);
      return { id, version: await bumpContentVersion(tx, input.lang) };
    }),
  ),

  deleteLessonCategory: os.admin.deleteLessonCategory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [category] = await tx
        .select({ lang: schema.lessonCategories.lang })
        .from(schema.lessonCategories)
        .where(eq(schema.lessonCategories.id, input.id))
        .limit(1);
      if (!category) fail('There is no such category.');

      // No check that it is empty: `lessons.category_id` is `on delete set null`, so the
      // lessons on it come off the shelf and go back to being unfiled. Nothing is lost, so
      // nothing has to be warned about — the same bargain `deleteQuizCategory` strikes.
      await tx.delete(schema.lessonCategories).where(eq(schema.lessonCategories.id, input.id));

      return { version: await bumpContentVersion(tx, category.lang) };
    }),
  ),

  lessonMedia: os.admin.lessonMedia.use(adminOnly).handler(async () => ({ files: await listFiles() })),

  updateLessonMedia: os.admin.updateLessonMedia.use(adminOnly).handler(async ({ input }) => {
    const [file] = await db
      .select({ id: schema.lessonMedia.id })
      .from(schema.lessonMedia)
      .where(eq(schema.lessonMedia.id, input.id))
      .limit(1);
    if (!file) fail('There is no such file.');

    // No content version bump: the name and the alt text are not in any snapshot — the page
    // reads alt text from the media row when it draws the picture — so nothing anybody is
    // looking at has changed shape.
    await db
      .update(schema.lessonMedia)
      .set({ name: input.name, alt: input.alt })
      .where(eq(schema.lessonMedia.id, input.id));

    return { files: await listFiles() };
  }),

  deleteLessonMedia: os.admin.deleteLessonMedia.use(adminOnly).handler(async ({ input }) => {
    const [file] = await db
      .select({ id: schema.lessonMedia.id, name: schema.lessonMedia.name })
      .from(schema.lessonMedia)
      .where(eq(schema.lessonMedia.id, input.id))
      .limit(1);
    if (!file) fail('There is no such file.');

    // Nothing in the database would stop this — a body names what it draws in its text — so the
    // guard has to be this count. Without it the delete succeeds and a lesson quietly acquires
    // a broken picture, with nothing to say when it happened or what used to be there.
    const uses = (await filesInUse()).get(input.id) ?? 0;
    if (uses > 0) {
      fail(
        `${file.name || 'That file'} is still used by ${uses} ${uses === 1 ? 'lesson' : 'lessons'}. ` +
          'Take it out of those first.',
      );
    }

    // The row, then the bytes. A crash between them leaves a file nothing names rather than a
    // row promising one that is gone — see `discard`.
    await db.delete(schema.lessonMedia).where(eq(schema.lessonMedia.id, input.id));
    await discard(input.id);

    return { files: await listFiles() };
  }),
};
