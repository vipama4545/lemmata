// Writing quizzes from the browser.
//
// A file of its own rather than more of admin.ts, which is already sixty kilobytes of lexicon,
// paradigms and story linking. The procedures here are merged into the same `admin` namespace
// at the foot of that file, so nothing about the contract or the client changes — this is a
// division of the source, not of the API.
//
// The three rules at the head of admin.ts hold here too: one transaction per edit with the
// version bump last, derived columns maintained here rather than by the caller, and a delete
// refused when something still points at the row. Only the last needs a word, because quizzes
// are on the receiving end of it exactly once — an uploaded clip cannot be deleted while a
// question still plays it.
//
// What is different is `writeQuiz`, and it is worth saying why up front: it deletes every
// question and option of the quiz and writes the submitted set back, rather than working out
// which ones changed. See the note on it.

import { ORPCError } from '@orpc/server';
import { asc, count, eq, inArray, sql as raw } from 'drizzle-orm';
import type { QuizAudioClip, QuizCategoryInput, QuizInput } from '@georgian/shared/contract';
import { isQuizKind } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { discard } from '../quiz/media.ts';
import { adminOnly, os } from './base.ts';
import { bumpContentVersion } from './content.ts';
import { clipUses } from './quiz.ts';

/* ------------------------------------------------------------------- helpers */

function fail(message: string): never {
  throw new ORPCError('BAD_REQUEST', { message });
}

/**
 * A url-safe id from a title. The same rule `slug` in admin.ts uses, and deliberately not
 * imported from it: that one is not exported, and a quiz id has one extra job — see below.
 */
function slug(text: string, fallback: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

/**
 * Ids a quiz may not take, because the reader's routes spend them on something else.
 *
 * `/quizzes/category/verbs` is a shelf and `/quizzes/<id>/embed` is the standalone player, so a
 * quiz slugged "category" would own a URL that already means something — and would lose, since
 * a static segment outranks `:quizId`. Treated as taken rather than refused, exactly as
 * `RESERVED_STORY_IDS` is: the quiz is called what it is called, and `category-2` is a better
 * answer than an error about routing.
 */
const RESERVED_QUIZ_IDS = new Set(['category', 'embed', 'new']);

/** `${base}`, then `${base}-2`, until nothing has it. */
async function freeQuizId(tx: Tx, table: 'quizzes' | 'quizCategories', base: string): Promise<string> {
  const target = table === 'quizzes' ? schema.quizzes : schema.quizCategories;
  for (let n = 1; n < 500; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (table === 'quizzes' && RESERVED_QUIZ_IDS.has(id)) continue;
    const [taken] = await tx.select({ id: target.id }).from(target).where(eq(target.id, id)).limit(1);
    if (!taken) return id;
  }
  return `${base}-${Math.floor(Date.now() % 100_000_000).toString(36)}`;
}

/** The next free position, so a new row lands at the end of the list rather than at 0. */
async function nextPosition(tx: Tx, table: typeof schema.quizzes | typeof schema.quizCategories): Promise<number> {
  const [row] = await tx.select({ max: raw<number | null>`max(${table.position})` }).from(table);
  return (row?.max ?? -1) + 1;
}

/** Recounts the shelves named, so the index's counts stay true. Both, when a quiz moves. */
async function recountQuizCategories(tx: Tx, categoryIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;

  const counts = await tx
    .select({ categoryId: schema.quizzes.categoryId, total: count() })
    .from(schema.quizzes)
    .where(inArray(schema.quizzes.categoryId, ids))
    .groupBy(schema.quizzes.categoryId);

  const byId = new Map(counts.map(row => [row.categoryId, Number(row.total)]));
  for (const id of ids) {
    await tx
      .update(schema.quizCategories)
      .set({ quizCount: byId.get(id) ?? 0 })
      .where(eq(schema.quizCategories.id, id));
  }
}

/** Every clip the editor knows about, with a count of what plays each. */
async function listClips(tx: Tx | typeof db = db): Promise<QuizAudioClip[]> {
  const rows = await tx.select().from(schema.quizAudio).orderBy(asc(schema.quizAudio.createdAt));
  const uses = await clipUses(
    rows.map(row => row.id),
    tx,
  );

  return rows.map(row => ({
    id: row.id,
    lang: row.lang,
    mime: row.mime,
    bytes: row.bytes,
    name: row.name,
    createdAt: row.createdAt.getTime(),
    uses: uses.get(row.id) ?? 0,
  }));
}

/* --------------------------------------------------------------------- quizzes */

/**
 * Creates or updates one quiz, with every question and option it holds.
 *
 * **The questions are replaced wholesale.** Every `quiz_questions` and `quiz_choices` row for
 * this quiz is deleted and the submitted set written back, in one transaction. That is not
 * laziness about diffing, it is the thing that makes the editor safe: a question's identity is
 * its position, so reordering, inserting in the middle and deleting all rewrite the positions
 * of everything after them. A diff would have to work out which of the submitted questions is
 * "the same" as which stored one — a question the editor cannot answer either, since it has no
 * ids to match on — and would get it wrong in exactly the case that matters, a question moved
 * and edited in the same sitting.
 *
 * What that costs is a quiz's worth of rows rewritten on every save, which is a few dozen. What
 * it buys is that there is no state where the questions and their options disagree about how
 * many there are, and none where two questions claim one position.
 *
 * The results are deliberately *not* cleared by this. Editing a typo in question three does not
 * make anybody's pass untrue, and a rule that wiped the records on every save would mean the
 * one thing being tracked is lost by the ordinary act of fixing a quiz.
 */
async function writeQuiz(tx: Tx, input: QuizInput): Promise<string> {
  const existing = input.id
    ? (
        await tx
          .select({ id: schema.quizzes.id, lang: schema.quizzes.lang, categoryId: schema.quizzes.categoryId })
          .from(schema.quizzes)
          .where(eq(schema.quizzes.id, input.id))
          .limit(1)
      )[0]
    : undefined;

  if (input.id && !existing) fail('There is no such quiz.');

  // A quiz does not change language, for the reason a story does not: its questions are written
  // in one language and marked against it, and an edit arriving under the other is a switcher
  // left on the wrong dictionary rather than anything anybody meant.
  if (existing && existing.lang !== input.lang) {
    fail(`That quiz is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
  }

  if (input.categoryId) {
    const [category] = await tx
      .select({ id: schema.quizCategories.id, lang: schema.quizCategories.lang })
      .from(schema.quizCategories)
      .where(eq(schema.quizCategories.id, input.categoryId))
      .limit(1);
    if (!category) fail('There is no such category.');
    if (category.lang !== input.lang) {
      fail(`That category is ${category.lang} and this quiz is ${input.lang}.`);
    }
  }

  // Checked here against the union in types.ts rather than pinned as a Zod enum on the wire,
  // for the reason `paradigmInput` is loose: a second copy of the set could disagree with it.
  for (const [at, question] of input.questions.entries()) {
    if (!isQuizKind(question.kind)) fail(`Question ${at + 1} is a "${question.kind}", which is not a kind of question.`);
  }

  // Every clip cited has to exist. The column is `set null`, so a bad id would otherwise save
  // as silence — a listening question with no sound and nothing to say why.
  const clipIds = [
    ...new Set(
      input.questions
        .flatMap(question => [question.audio.clipId, ...question.choices.map(choice => choice.audio.clipId)])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (clipIds.length) {
    const found = await tx
      .select({ id: schema.quizAudio.id })
      .from(schema.quizAudio)
      .where(inArray(schema.quizAudio.id, clipIds));
    const missing = clipIds.filter(id => !found.some(row => row.id === id));
    if (missing.length) fail(`No such audio clip: ${missing.join(', ')}. Upload it again.`);
  }

  const id = existing?.id ?? (await freeQuizId(tx, 'quizzes', slug(input.title, 'quiz')));

  const row = {
    lang: input.lang,
    title: input.title,
    titleNative: input.titleNative,
    description: input.description,
    level: input.level,
    categoryId: input.categoryId,
    shuffleQuestions: input.shuffleQuestions,
    shuffleOptions: input.shuffleOptions,
    askCount: input.askCount,
    passMark: input.passMark,
    questionCount: input.questions.length,
    note: input.note,
  };

  if (existing) {
    await tx.update(schema.quizzes).set(row).where(eq(schema.quizzes.id, id));
  } else {
    await tx.insert(schema.quizzes).values({ ...row, id, position: await nextPosition(tx, schema.quizzes) });
  }

  // Out with all of them, in with all of them. See the note above.
  await tx.delete(schema.quizChoices).where(eq(schema.quizChoices.quizId, id));
  await tx.delete(schema.quizQuestions).where(eq(schema.quizQuestions.quizId, id));

  if (input.questions.length) {
    await tx.insert(schema.quizQuestions).values(
      input.questions.map((question, position) => ({
        quizId: id,
        position,
        kind: question.kind,
        prompt: question.prompt,
        promptNative: question.promptNative,
        say: question.audio.say,
        audioId: question.audio.clipId,
        multiple: question.multiple,
        // A `type` question's accepted answers, and nobody else's. Storing what a `choice`
        // question happened to have left in the field would be storing an answer that nothing
        // marks against, which is the kind of dead data that later reads as a bug.
        answers: question.kind === 'type' ? question.answers : [],
        hint: question.hint,
        explanation: question.explanation,
      })),
    );

    const choices = input.questions.flatMap((question, at) =>
      // Likewise: a `type` question has no options, whatever was typed into the option rows
      // before the kind was switched.
      question.kind === 'type'
        ? []
        : question.choices.map((choice, position) => ({
            quizId: id,
            question: at,
            position,
            text: choice.text,
            correct: choice.correct,
            say: choice.audio.say,
            audioId: choice.audio.clipId,
          })),
    );

    if (choices.length) await tx.insert(schema.quizChoices).values(choices);
  }

  await recountQuizCategories(tx, [existing?.categoryId ?? null, input.categoryId]);
  return id;
}

/** Creates or updates one shelf. The counterpart of `writeStoryCategory` in admin.ts. */
async function writeQuizCategory(tx: Tx, input: QuizCategoryInput): Promise<string> {
  const existing = input.id
    ? (
        await tx
          .select({ id: schema.quizCategories.id, lang: schema.quizCategories.lang })
          .from(schema.quizCategories)
          .where(eq(schema.quizCategories.id, input.id))
          .limit(1)
      )[0]
    : undefined;

  if (input.id && !existing) fail('There is no such category.');
  if (existing && existing.lang !== input.lang) {
    fail(`That category is ${existing.lang}, not ${input.lang}.`);
  }

  const id = existing?.id ?? (await freeQuizId(tx, 'quizCategories', slug(input.name, 'category')));
  const row = { lang: input.lang, name: input.name, nameNative: input.nameNative, note: input.note };

  if (existing) {
    await tx.update(schema.quizCategories).set(row).where(eq(schema.quizCategories.id, id));
  } else {
    await tx
      .insert(schema.quizCategories)
      .values({ ...row, id, position: await nextPosition(tx, schema.quizCategories) });
  }

  return id;
}

/* --------------------------------------------------------------------- routes */

/**
 * The quiz half of the admin namespace, spread into `adminRouter` in admin.ts.
 *
 * An object rather than `os.admin.router({...})`, because a router built here would be a second
 * router under the same name — these have to become part of the one that already exists.
 */
export const quizAdminRoutes = {
  saveQuiz: os.admin.saveQuiz.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const id = await writeQuiz(tx, input);
      return { id, version: await bumpContentVersion(tx, input.lang) };
    }),
  ),

  deleteQuiz: os.admin.deleteQuiz.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [quiz] = await tx
        .select({ lang: schema.quizzes.lang, categoryId: schema.quizzes.categoryId })
        .from(schema.quizzes)
        .where(eq(schema.quizzes.id, input.id))
        .limit(1);
      if (!quiz) fail('There is no such quiz.');

      // Nothing is refused here, unlike deleting a word. What cascades off a quiz is its own
      // questions, its own options and the records of people having taken it — all of which are
      // about this quiz and none of which mean anything without it. An uploaded clip is the one
      // thing that survives, because it is content in its own right; see `deleteQuizAudio`.
      await tx.delete(schema.quizzes).where(eq(schema.quizzes.id, input.id));
      await recountQuizCategories(tx, [quiz.categoryId]);

      return { version: await bumpContentVersion(tx, quiz.lang) };
    }),
  ),

  saveQuizCategory: os.admin.saveQuizCategory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const id = await writeQuizCategory(tx, input);
      return { id, version: await bumpContentVersion(tx, input.lang) };
    }),
  ),

  deleteQuizCategory: os.admin.deleteQuizCategory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [category] = await tx
        .select({ lang: schema.quizCategories.lang })
        .from(schema.quizCategories)
        .where(eq(schema.quizCategories.id, input.id))
        .limit(1);
      if (!category) fail('There is no such category.');

      // No check that it is empty: `quizzes.category_id` is `on delete set null`, so the
      // quizzes on it come off the shelf and go back to being unfiled. Nothing is lost, so
      // nothing has to be warned about — the same bargain `deleteStoryCategory` strikes.
      await tx.delete(schema.quizCategories).where(eq(schema.quizCategories.id, input.id));

      return { version: await bumpContentVersion(tx, category.lang) };
    }),
  ),

  quizAudio: os.admin.quizAudio.use(adminOnly).handler(async () => ({ clips: await listClips() })),

  deleteQuizAudio: os.admin.deleteQuizAudio.use(adminOnly).handler(async ({ input }) => {
    const [clip] = await db
      .select({ id: schema.quizAudio.id, name: schema.quizAudio.name })
      .from(schema.quizAudio)
      .where(eq(schema.quizAudio.id, input.id))
      .limit(1);
    if (!clip) fail('There is no such clip.');

    // The foreign key is `set null`, so this would otherwise succeed and quietly leave a
    // listening question with nothing to hear — and no indication that there ever was anything.
    const uses = (await clipUses([input.id])).get(input.id) ?? 0;
    if (uses > 0) {
      fail(
        `${clip.name || 'That clip'} is still played by ${uses} ${uses === 1 ? 'question or option' : 'questions and options'}. ` +
          'Take it off those first.',
      );
    }

    // The row, then the file. A crash between them leaves bytes nothing names rather than a row
    // promising a file that is gone — see `discard`. No content version bump: a clip nothing
    // plays is in no snapshot, so nothing anyone is reading has changed.
    await db.delete(schema.quizAudio).where(eq(schema.quizAudio.id, input.id));
    await discard(input.id);

    return { clips: await listClips() };
  }),
};
