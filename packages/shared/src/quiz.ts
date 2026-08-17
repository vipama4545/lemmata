// What counts as a right answer.
//
// One module, imported by the browser and by the server, and that is the whole reason it
// exists as a file rather than as a function in the runner. The browser marks a question the
// moment it is answered, because a quiz that waits on the network to say "yes, and here is
// why" stops teaching and starts testing. The server marks the same answers again before it
// writes a result, because a score it was simply told is a score anybody can send.
//
// Two copies of these rules would be two copies that eventually disagree, and the way that
// failure shows up is the cruellest kind: a run that said 8/10 on screen and recorded 7/10,
// with nothing on either side to say which was wrong.
//
// So: `mark()` is the answer to "how did that go", and it is the same answer wherever it is
// asked. Nothing in here touches a database or a component.

import type { Quiz, QuizAnswer, QuizQuestion } from './types.ts';

/* ------------------------------------------------------------- typed answers */

/**
 * The characters a typed answer is allowed to differ by.
 *
 * Deliberately generous. A learner typing მე მიყვარს ქართული has got the question right, and
 * a trailing full stop, a double space or a smart quote is not the thing being examined. What
 * is *not* in here matters as much: no letter is ever folded into another one.
 */
const PUNCTUATION = /[.,!?;:"'“”„«»…—–\-()[\]]/g;

/**
 * Combining acute and grave — the marks Russian writes stress with.
 *
 * Stripped because they are notation rather than spelling: де́лать and делать are the same
 * word written for two different readers, `words.accented` exists precisely to keep the two
 * apart, and nobody types the acute. Note what this does *not* do — ё keeps its diaeresis,
 * because ё is a letter of the alphabet and все and всё are two different words. Folding
 * those together would mark a wrong answer right.
 */
const STRESS = /[\u0300\u0301]/g;

/**
 * A typed answer, reduced to what is actually being asked about.
 *
 * NFC first, so that a б and a combining mark typed separately compare equal to the composed
 * character somebody else's keyboard produces — without it two identical-looking strings can
 * differ byte for byte, which is a wrong answer nobody can see the wrongness of.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFC')
    .replace(STRESS, '')
    .replace(PUNCTUATION, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------------------------------------------------------- marking */

/** The positions that make up the answer, in order. Empty for a `type` question. */
export function correctPositions(question: QuizQuestion): number[] {
  return question.choices.filter(choice => choice.correct).map(choice => choice.position);
}

/**
 * Whether one answer is right.
 *
 * A question nobody could get right is marked wrong rather than thrown over: a `choice` with
 * no correct option and a `type` with no accepted answers are both quizzes half-written, and
 * the place to catch that is the editor, which says so, rather than a run that explodes on
 * question six. `unanswerable()` below is what the editor asks.
 */
export function isCorrect(question: QuizQuestion, answer: QuizAnswer): boolean {
  const wanted = correctPositions(question);

  switch (question.kind) {
    case 'choice': {
      if (!wanted.length) return false;
      // Sets, not sequences: which options were picked is the question, and the order they
      // were clicked in is not something the reader was asked about.
      const picked = new Set(answer.picked);
      return picked.size === wanted.length && wanted.every(position => picked.has(position));
    }

    case 'order': {
      if (!wanted.length) return false;
      // Sequences, and this is the one place order is the whole point. Getting the right
      // words in the wrong order is wrong, which is what makes it a question about word order.
      return answer.picked.length === wanted.length && wanted.every((position, at) => answer.picked[at] === position);
    }

    case 'type': {
      const given = normalise(answer.text);
      if (!given) return false;
      return question.answers.some(accepted => normalise(accepted) === given);
    }
  }
}

/** How a whole run went. */
export interface QuizMark {
  /** Right answers. */
  score: number;
  /** Questions there were. Never the number *answered* — a skipped question is a wrong one. */
  total: number;
  /** Rounded down, so a pass mark of 70 needs a real 70. */
  percent: number;
  passed: boolean;
  /** One entry per question, in `quiz.questions` order rather than the order they were asked. */
  correct: boolean[];
}

/**
 * Marks a whole run.
 *
 * `answers` is keyed by question position rather than being a list, because the runner may
 * ask the questions in any order — `shuffleQuestions` — and a list would then be in the order
 * *this* run happened to take, which is not an order anything else knows. A position with no
 * entry is a question left unanswered, and is marked wrong.
 *
 * A quiz with no questions passes, and that is the sensible reading of a vacuous claim: it
 * cannot be got wrong. The index never offers one, so nobody ever sees it.
 */
export function mark(quiz: Quiz, answers: Record<number, QuizAnswer>): QuizMark {
  const correct = quiz.questions.map(question =>
    isCorrect(question, answers[question.position] ?? { picked: [], text: '' }),
  );

  const score = correct.filter(Boolean).length;
  const total = correct.length;
  const percent = total === 0 ? 100 : Math.floor((score / total) * 100);

  return { score, total, percent, passed: percent >= quiz.passMark, correct };
}

/* ------------------------------------------------------------ half-written */

/**
 * Why this question could not be answered correctly by anybody, or null when it is fine.
 *
 * For the editor, which shows it against the question rather than refusing the save. A quiz
 * is written over several sittings and a half-finished question is an ordinary state to leave
 * one in; what is not ordinary is *publishing* it without noticing, which is what this is for.
 */
export function unanswerable(question: QuizQuestion): string | null {
  switch (question.kind) {
    case 'choice': {
      const right = question.choices.filter(choice => choice.correct).length;
      if (question.choices.length < 2) return 'Needs at least two options.';
      if (right === 0) return 'No option is marked correct.';
      if (right > 1 && !question.multiple) return 'More than one option is marked correct — tick “several answers”.';
      return null;
    }

    case 'order': {
      if (question.choices.filter(choice => choice.correct).length < 2) {
        return 'Needs at least two words in the answer.';
      }
      return null;
    }

    case 'type': {
      if (!question.answers.some(answer => normalise(answer))) return 'No accepted answer.';
      return null;
    }
  }
}
