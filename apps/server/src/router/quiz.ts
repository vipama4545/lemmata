// Taking a quiz.
//
// Three procedures, and the interesting one is the last. `get` hands over a quiz with its
// answers in it, because a quiz that has to ask the server whether you were right stops being
// something you learn from — see the note on the `Quiz` type. `finish` is what keeps that from
// making the record meaningless: it is sent the *answers*, not the score, and marks them again
// with the same `mark()` the browser used, so what lands in `quiz_results` is this server's own
// reading of what was answered.
//
// Which leaves one thing worth saying plainly. A determined person can still send a set of
// answers they did not work out, and no amount of server-side marking changes that — the only
// defence against it would be to withhold the answers, and withholding the answers is exactly
// what would ruin the thing. This is a language app, the record is for the person it is about,
// and the failure mode of cheating at it is not learning Georgian.

import { ORPCError } from '@orpc/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { mark } from '@georgian/shared/quiz';
import type { Quiz, QuizAnswer, QuizChoice, QuizKind, QuizQuestion, QuizResult } from '@georgian/shared/types';
import { isQuizKind } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { authed, os } from './base.ts';

/**
 * One quiz, with every question and option, or null when there is no such quiz.
 *
 * Two queries rather than a join: a join would repeat every question's prompt once per option
 * it has, which is the whole payload again several times over, and the grouping would still
 * have to happen here. Exported because the admin editor loads a quiz through this too — it
 * edits exactly what a reader would be shown, and a second assembly could disagree with this
 * one about what the quiz says.
 */
/**
 * The quiz as one run of it saw it: only the questions that run was dealt.
 *
 * A quiz with an `askCount` asks a random handful of its pool, so the run and the stored quiz
 * disagree about how many questions there were, and marking the one against the other would
 * record ten right answers out of thirty-three. The runner says what it dealt and this narrows
 * to it.
 *
 * The count is checked rather than taken as given. A run must be dealt as many as the quiz
 * deals — `askCount` of them, or the whole pool when there are fewer than that — and a list
 * that is the wrong length is ignored in favour of the whole quiz. That is not an anti-cheat
 * measure and could not be one: the head of this file says plainly that someone determined can
 * send answers they did not work out, and withholding the answers is the only defence there is.
 * It is there so that an honest client with a bug records a wrong score rather than a
 * flattering one, which is the failure worth preventing because nobody would report it.
 */
function dealt(quiz: Quiz, asked: number[]): Quiz {
  if (!asked.length) return quiz;

  const wanted = new Set(asked);
  const questions = quiz.questions.filter(question => wanted.has(question.position));

  const size = quiz.askCount > 0 ? Math.min(quiz.askCount, quiz.questions.length) : quiz.questions.length;
  return questions.length === size ? { ...quiz, questions } : quiz;
}

export async function loadQuiz(id: string, tx: Tx | typeof db = db): Promise<Quiz | null> {
  const [row] = await tx.select().from(schema.quizzes).where(eq(schema.quizzes.id, id)).limit(1);
  if (!row) return null;

  const [questionRows, choiceRows, categoryRows] = await Promise.all([
    tx
      .select()
      .from(schema.quizQuestions)
      .where(eq(schema.quizQuestions.quizId, id))
      .orderBy(asc(schema.quizQuestions.position)),
    tx
      .select()
      .from(schema.quizChoices)
      .where(eq(schema.quizChoices.quizId, id))
      .orderBy(asc(schema.quizChoices.question), asc(schema.quizChoices.position)),
    row.categoryId
      ? tx
          .select({ name: schema.quizCategories.name })
          .from(schema.quizCategories)
          .where(eq(schema.quizCategories.id, row.categoryId))
          .limit(1)
      : [],
  ]);

  const choicesByQuestion = new Map<number, QuizChoice[]>();
  for (const choice of choiceRows) {
    const list = choicesByQuestion.get(choice.question) ?? [];
    list.push({
      position: choice.position,
      text: choice.text,
      correct: choice.correct,
      audio: { say: choice.say, clipId: choice.audioId },
    });
    choicesByQuestion.set(choice.question, list);
  }

  const questions: QuizQuestion[] = questionRows.map(question => ({
    position: question.position,
    // Narrowed on the way out rather than trusted. `kind` is plain text in the column — the
    // set of kinds is a compile-time union, not a table — so a row written by something other
    // than `saveQuiz` cannot make the runner render a fourth kind it has no case for.
    kind: (isQuizKind(question.kind) ? question.kind : 'choice') as QuizKind,
    prompt: question.prompt,
    promptNative: question.promptNative,
    audio: { say: question.say, clipId: question.audioId },
    multiple: question.multiple,
    answers: question.answers,
    hint: question.hint,
    explanation: question.explanation,
    choices: choicesByQuestion.get(question.position) ?? [],
  }));

  return {
    id: row.id,
    lang: row.lang,
    title: row.title,
    titleNative: row.titleNative,
    description: row.description,
    level: row.level,
    categoryId: row.categoryId,
    category: categoryRows[0]?.name ?? '',
    shuffleQuestions: row.shuffleQuestions,
    shuffleOptions: row.shuffleOptions,
    askCount: row.askCount,
    passMark: row.passMark,
    note: row.note,
    questions,
  };
}

/** The wire's shape for a stored result — epoch ms, as every instant that crosses it is. */
function wire(row: { quizId: string; passed: boolean; score: number; total: number; finishedAt: Date }): QuizResult {
  return {
    quizId: row.quizId,
    passed: row.passed,
    score: row.score,
    total: row.total,
    finishedAt: row.finishedAt.getTime(),
  };
}

export const quizRouter = os.quiz.router({
  /**
   * One quiz, for anybody.
   *
   * No `authed`, and that is the deliberate half of this file. The dictionary is readable
   * without an account and a quiz is part of it; more to the point, an embedded quiz on
   * somebody else's page is loaded by a third-party iframe that has no cookie to send, so a
   * gate here would make the embed a sign-in screen.
   */
  get: os.quiz.get.handler(({ input }) => loadQuiz(input.id)),

  /**
   * Records how a run went, having marked it here first.
   *
   * Signed in only. A signed-out run is scored and explained on screen exactly as any other —
   * the runner never calls this — because there is no one to keep a record against, not
   * because there is anything to withhold.
   */
  finish: os.quiz.finish.use(authed).handler(async ({ input, context }) => {
    const quiz = await loadQuiz(input.quizId);
    if (!quiz) throw new ORPCError('NOT_FOUND', { message: 'There is no such quiz.' });

    // Keys arrive as strings, because that is what an object's keys are on the wire. Anything
    // that is not a question position is dropped rather than rejected: it can only be a
    // question deleted since the run began, and losing the run over it would be worse than
    // marking that question unanswered, which is what leaving it out does.
    const answers: Record<number, QuizAnswer> = {};
    for (const [key, answer] of Object.entries(input.answers)) {
      const position = Number(key);
      if (Number.isInteger(position)) answers[position] = answer;
    }

    const marked = mark(dealt(quiz, input.asked), answers);
    const finishedAt = new Date();

    const row = {
      userId: context.user.id,
      quizId: quiz.id,
      lang: quiz.lang,
      passed: marked.passed,
      score: marked.score,
      total: marked.total,
      finishedAt,
    };

    // One row per person per quiz, overwritten. Re-taking replaces what it says, including
    // replacing a pass with a fail — see the note on the `quiz_results` table.
    await db
      .insert(schema.quizResults)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.quizResults.userId, schema.quizResults.quizId],
        set: { lang: row.lang, passed: row.passed, score: row.score, total: row.total, finishedAt },
      });

    return { result: wire(row) };
  }),

  /**
   * Every quiz this account has taken, in one language.
   *
   * Answers with an empty list rather than refusing when signed out. The index asks for this
   * on the way in and draws a tick against what has been passed; having no account is not an
   * error there, it is simply having taken nothing.
   */
  results: os.quiz.results.handler(async ({ input, context }) => {
    const user = context.session?.user;
    if (!user) return { results: [] };

    const rows = await db
      .select()
      .from(schema.quizResults)
      .where(and(eq(schema.quizResults.userId, user.id), eq(schema.quizResults.lang, input.lang)));

    return { results: rows.map(wire) };
  }),
});

/**
 * The quizzes that cite any of these clips, so a delete can say what would break.
 *
 * Here rather than in the admin router because it reads the quiz tables and nothing else, and
 * because both callers want the same answer: the editor asks before offering to delete, and
 * `deleteQuizAudio` asks again before doing it.
 */
export async function clipUses(clipIds: string[], tx: Tx | typeof db = db): Promise<Map<string, number>> {
  if (!clipIds.length) return new Map();

  const [questionRows, choiceRows] = await Promise.all([
    tx
      .select({ audioId: schema.quizQuestions.audioId })
      .from(schema.quizQuestions)
      .where(inArray(schema.quizQuestions.audioId, clipIds)),
    tx
      .select({ audioId: schema.quizChoices.audioId })
      .from(schema.quizChoices)
      .where(inArray(schema.quizChoices.audioId, clipIds)),
  ]);

  const uses = new Map<string, number>();
  for (const row of [...questionRows, ...choiceRows]) {
    if (!row.audioId) continue;
    uses.set(row.audioId, (uses.get(row.audioId) ?? 0) + 1);
  }
  return uses;
}
