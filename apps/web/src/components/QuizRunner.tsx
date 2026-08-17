// Taking a quiz: one question at a time, marked the moment it is answered.
//
// The whole of the run lives here, and the whole of it is local. Nothing in this file talks to
// the server — it is handed a `Quiz` and hands back a `QuizMark` when the last question is
// done, and what happens to that mark is the caller's business. That is what lets the same
// component be the page, the embed and, in the admin, a preview of a quiz nobody has taken yet.
//
// Marking is `mark()` from @georgian/shared/quiz, the same function the server re-marks with, so
// what the screen says and what gets recorded cannot disagree. See the head of that file.
//
// Three kinds of question and one component apiece, because they are genuinely three different
// interactions and a single "answer" widget with three modes would be worse at all of them:
//
//   choice — press an option. Or several, when the question says so.
//   order  — press words out of a bank to build a line, press them again to take them back.
//   type   — write it, and press enter.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Lightbulb, RotateCcw, X } from 'lucide-react';
import { mark, type QuizMark } from '@georgian/shared/quiz';
import type { Quiz, QuizAnswer, QuizChoice, QuizQuestion } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { sourceUrl } from '../data/quizAudio';
import { PlayButton, usePlayer } from './AudioButton';

/* ------------------------------------------------------------------ shuffling */

/**
 * Fisher–Yates, on a copy.
 *
 * Not seeded and not meant to be: two runs of the same quiz should not be the same quiz, and
 * nothing anywhere needs to reproduce a particular shuffle. What does matter is that a shuffle
 * happens *once per run* rather than once per render — see the `useState` initialisers below,
 * which is where that is arranged. A shuffle in the render body would deal the options again on
 * every keystroke.
 */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The order this question's options are shown in.
 *
 * `order` questions are shuffled whatever the quiz says, and that is not the setting being
 * ignored — it is the setting not applying. `quiz_choices` holds an ordering question's answer
 * *as the order of its correct rows*, so showing the bank unshuffled would print the answer
 * across the screen. The setting exists for the one case that wants a fixed order, options
 * reading "1985 / 1995 / 2005", and that case is a `choice`.
 */
function layout(question: QuizQuestion, shuffleOptions: boolean): QuizChoice[] {
  return shuffleOptions || question.kind === 'order' ? shuffled(question.choices) : [...question.choices];
}

/**
 * Whether an Enter belongs to this runner.
 *
 * Inside it, always: the typed-answer field lives there, and pressing Enter in it is how that
 * kind of question is answered. Outside it, only when whatever has focus is something the
 * runner *sits inside* — the document body on the quiz page, where the whole page is this quiz
 * and a reader who has clicked nowhere still means "go on", and the dialog shell a lesson's
 * quiz opens in, which takes focus when it opens and does nothing of its own with the key.
 *
 * Everything else focused owns its own Enter: a textarea somebody is writing a lesson in, a
 * link, a button. None of those is an ancestor of the runner, which is what the containment
 * test turns on.
 */
function ownsKey(root: HTMLElement | null, target: EventTarget | null): boolean {
  if (!root || !(target instanceof Node)) return false;
  return root.contains(target) || target.contains(root);
}

/* ----------------------------------------------------------------- the runner */

const EMPTY: QuizAnswer = { picked: [], text: '' };

export interface QuizRunnerProps {
  quiz: Quiz;
  /**
   * Called once, when the last question has been checked and the run is over.
   *
   * Optional, and the runner does not care whether there is one: a signed-out reader, an
   * embedded quiz and an admin previewing their own work all take exactly the same quiz, and
   * the only difference between them is whether anybody records it.
   */
  onFinish?: (result: QuizMark, answers: Record<number, QuizAnswer>, asked: number[]) => void;
  /**
   * Where the results screen leads, for a run that was opened from somewhere.
   *
   * A quiz taken from inside a lesson is taken in an overlay over it, and the way back is the
   * thing the reader wants most once the score is on screen — so it goes on the results screen
   * as the first button, not only in the corner as a cross. A quiz on its own page has nowhere
   * particular to go back to and passes none.
   */
  onExit?: () => void;
  /** What that button says. Ignored without an `onExit`. */
  exitLabel?: string;
  /** Tighter chrome and no outer padding, for the embed. */
  embedded?: boolean;
}

export default function QuizRunner({ quiz, onFinish, onExit, exitLabel = 'Done', embedded = false }: QuizRunnerProps) {
  // One shuffle per run. The `useState` initialiser is what makes it per-run rather than per
  // render; `run` is bumped by "try again", which is what makes a second attempt a new deal.
  const [run, setRun] = useState(0);

  const order = useMemo(
    () => {
      // A pool quiz asks `askCount` of its questions and leaves the rest in the deck. Drawing
      // scrambles them, so the order is put back afterwards unless the quiz wanted it shuffled
      // — otherwise turning on a pool would silently turn on shuffling too.
      const pool =
        quiz.askCount > 0 && quiz.askCount < quiz.questions.length
          ? shuffled(quiz.questions).slice(0, quiz.askCount)
          : [...quiz.questions];

      return quiz.shuffleQuestions ? shuffled(pool) : pool.sort((a, b) => a.position - b.position);
    },
    // Deliberately keyed on `run` as well as the quiz: the same questions, dealt again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quiz, run],
  );

  /**
   * The quiz as this run sees it, which is the one everything downstream must use.
   *
   * `mark()` counts `quiz.questions`, and a question that was never dealt is not one the run
   * got wrong — marking ten answers against a pool of thirty-three would score every perfect
   * run at thirty percent. Narrowing here rather than teaching `mark` about pools keeps the
   * marking rule one rule: every question in the quiz you were given, answered or not.
   */
  const dealt = useMemo(() => ({ ...quiz, questions: order }), [quiz, order]);

  const layouts = useMemo(
    () => new Map(quiz.questions.map(question => [question.position, layout(question, quiz.shuffleOptions)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quiz, run],
  );

  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({});
  /** Which questions have been marked. A question is answerable until it is in here. */
  const [checked, setChecked] = useState<number[]>([]);
  const [showingHint, setShowingHint] = useState(false);
  const [done, setDone] = useState(false);

  const { play, playing } = usePlayer();
  const root = useRef<HTMLDivElement>(null);

  const question = order[at];
  const answer = question ? answers[question.position] ?? EMPTY : EMPTY;
  const isChecked = question ? checked.includes(question.position) : false;
  const result = useMemo(() => mark(dealt, answers), [dealt, answers]);

  const restart = () => {
    setRun(n => n + 1);
    setAt(0);
    setAnswers({});
    setChecked([]);
    setShowingHint(false);
    setDone(false);
  };

  const setAnswer = (next: QuizAnswer) => {
    if (!question || isChecked) return;
    setAnswers(all => ({ ...all, [question.position]: next }));
  };

  /** Whether there is enough of an answer to be worth marking. */
  const answered =
    question?.kind === 'type' ? answer.text.trim().length > 0 : answer.picked.length > 0;

  const check = () => {
    if (!question || isChecked || !answered) return;
    setChecked(list => [...list, question.position]);
    setShowingHint(false);
  };

  const next = () => {
    if (at + 1 < order.length) {
      setAt(at + 1);
      setShowingHint(false);
      return;
    }

    setDone(true);
    // Once, at the end, with the marking this screen has been doing all along. The caller
    // decides whether that means a row in the database or nothing at all.
    onFinish?.(result, answers, order.map(question => question.position));
  };

  // Enter carries the run forward, which is what a keyboard expects and what makes a quiz of
  // typed answers bearable. It is bound on the window rather than on the input so it also works
  // for the other two kinds — and skipped while a modifier is down, so it never eats a shortcut.
  //
  // A window listener means this runner claims Enter for the *whole document*, which is fine on
  // a page that is nothing but a quiz and wrong everywhere else. Two places are now everywhere
  // else: a quiz embedded in a lesson sits among the prose, and the lesson editor's preview puts
  // one on screen beside the textarea the lesson is being typed into. There, this swallowed
  // every newline the author pressed — the quiz was off-screen and had no idea it had taken the
  // key. So the listener ignores Enter that belongs to whatever is focused: a field being typed
  // in, or anything else that does something of its own with it.
  //
  // No dependency array, deliberately: `check` and `next` close over the answer as it stands,
  // and an array that named them would be an array naming everything they read. Re-binding a
  // listener on each render is the cheaper mistake to make than holding a stale one that marks
  // the answer somebody had typed two keystrokes ago.
  useEffect(() => {
    if (done) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!ownsKey(root.current, event.target)) return;
      event.preventDefault();
      if (isChecked) next();
      else check();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!quiz.questions.length) {
    return (
      <div ref={root} className={cn('rounded-lg border border-border bg-card p-8 text-center', !embedded && 'mt-4')}>
        <p className="text-muted-foreground">There are no questions in this quiz yet.</p>
      </div>
    );
  }

  // `dealt`, not `quiz`: the review lists one square per question asked, and `result.correct`
  // is indexed by that same list.
  if (done) {
    return (
      <Results
        quiz={dealt}
        result={result}
        onRestart={restart}
        onExit={onExit}
        exitLabel={exitLabel}
        embedded={embedded}
      />
    );
  }

  if (!question) return null;

  const promptSrc = sourceUrl(quiz.id, question.position, question.audio);
  const correct = result.correct[dealt.questions.findIndex(entry => entry.position === question.position)];

  return (
    <div ref={root} className={cn('flex flex-col gap-4', !embedded && 'mt-1')}>
      <Progress at={at} total={order.length} />

      <div className="rounded-lg border border-border bg-card p-6 shadow-card max-sm:p-4">
        {question.prompt && <p className="text-[15px] leading-relaxed font-medium">{question.prompt}</p>}

        {question.promptNative && (
          <p className="mt-2.5 text-2xl leading-snug font-semibold max-sm:text-xl">{question.promptNative}</p>
        )}

        {/* The big play button, for the questions whose prompt *is* the audio. It sits where
            the text would be, because for those questions it is the text. */}
        {promptSrc && (
          <div className={cn('flex', question.promptNative || question.prompt ? 'mt-4' : 'mt-1')}>
            <PlayButton src={promptSrc} playing={playing === promptSrc} onPlay={play} big label="Play the question" />
          </div>
        )}

        <div className="mt-5">
          {question.kind === 'choice' && (
            <ChoiceAnswer
              quiz={quiz}
              question={question}
              choices={layouts.get(question.position) ?? []}
              answer={answer}
              checked={isChecked}
              onAnswer={setAnswer}
              play={play}
              playing={playing}
            />
          )}

          {question.kind === 'order' && (
            <OrderAnswer
              quiz={quiz}
              question={question}
              bank={layouts.get(question.position) ?? []}
              answer={answer}
              checked={isChecked}
              onAnswer={setAnswer}
              play={play}
              playing={playing}
            />
          )}

          {question.kind === 'type' && (
            <TypeAnswer answer={answer} checked={isChecked} correct={correct} onAnswer={setAnswer} />
          )}
        </div>

        {isChecked && <Verdict question={question} correct={correct} />}

        {!isChecked && showingHint && question.hint && (
          <p className="mt-4 flex items-start gap-2 rounded-sm bg-[color-mix(in_srgb,var(--m-3)_14%,var(--card))] px-3 py-2.5 text-[13.5px]">
            <Lightbulb className="mt-px size-4 shrink-0" aria-hidden="true" />
            {question.hint}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {isChecked ? (
            <Button variant="control" size="auto" className={CORRECT_BUTTON} onClick={next}>
              {at + 1 < order.length ? (
                <>
                  Next <ArrowRight />
                </>
              ) : (
                <>
                  <Check /> See how you did
                </>
              )}
            </Button>
          ) : (
            <Button variant="control" size="auto" disabled={!answered} onClick={check}>
              <Check /> Check
            </Button>
          )}

          {!isChecked && question.hint && !showingHint && (
            <Button variant="ghost" size="auto-sm" onClick={() => setShowingHint(true)}>
              <Lightbulb /> Hint
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The green of a right answer and of the button that carries the run forward. */
const CORRECT_BUTTON = 'border-m-5 text-m-5 hover:border-m-5';

function Progress({ at, total }: { at: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${((at + 1) / total) * 100}%` }}
        />
      </div>
      <span className="text-[13px] tabular-nums text-muted-foreground">
        {at + 1} / {total}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------- answers */

interface AnswerProps {
  quiz: Quiz;
  question: QuizQuestion;
  answer: QuizAnswer;
  checked: boolean;
  onAnswer: (next: QuizAnswer) => void;
  play: (src: string) => void;
  playing: string | null;
}

/**
 * Pick an option — or several, when the question says so.
 *
 * Buttons rather than radios and checkboxes, which is a deliberate trade. What is lost is the
 * native grouping a fieldset gives a screen reader; what is bought is that an option can hold a
 * play button, and a listening question is half the point of this feature. `aria-pressed` is
 * what puts the state back, and the multi-select case says so in words above the options rather
 * than relying on the shape of a control to imply it.
 */
function ChoiceAnswer({ quiz, question, choices, answer, checked, onAnswer, play, playing }: AnswerProps & { choices: QuizChoice[] }) {
  const toggle = (position: number) => {
    if (question.multiple) {
      const picked = answer.picked.includes(position)
        ? answer.picked.filter(entry => entry !== position)
        : [...answer.picked, position];
      onAnswer({ ...answer, picked });
    } else {
      onAnswer({ ...answer, picked: [position] });
    }
  };

  return (
    <>
      {question.multiple && !checked && (
        <p className="mb-2.5 text-[13px] text-muted-foreground">Pick every one that is right.</p>
      )}

      <ul className="flex list-none flex-col gap-2.5">
        {choices.map(choice => {
          const picked = answer.picked.includes(choice.position);
          const src = sourceUrl(quiz.id, question.position, choice.audio, choice.position);

          // After marking, every option says what it was — not only the one that was pressed.
          // A quiz that showed you only your own mistake would leave you to guess the answer.
          const state = !checked ? null : choice.correct ? 'right' : picked ? 'wrong' : null;

          return (
            <li key={choice.position}>
              <button
                type="button"
                aria-pressed={picked}
                disabled={checked}
                onClick={() => toggle(choice.position)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border-2 border-border bg-background px-4 py-3 text-left transition-colors',
                  'disabled:cursor-default',
                  !checked && 'cursor-pointer hover:border-primary hover:bg-control-hover',
                  picked && !checked && 'border-primary bg-primary-glow',
                  state === 'right' && 'border-m-5 bg-[color-mix(in_srgb,var(--m-5)_12%,var(--card))]',
                  state === 'wrong' && 'border-m-1 bg-[color-mix(in_srgb,var(--m-1)_10%,var(--card))]',
                )}
              >
                {src && (
                  <PlayButton
                    src={src}
                    playing={playing === src}
                    onPlay={play}
                    label={choice.text ? `Play "${choice.text}"` : 'Play this option'}
                  />
                )}

                <span className={cn('min-w-0 flex-1 text-[15px]', !choice.text && 'text-faint')}>
                  {choice.text || (src ? 'Listen' : '—')}
                </span>

                {state === 'right' && <Check className="size-[18px] shrink-0 text-m-5" aria-label="Correct" />}
                {state === 'wrong' && <X className="size-[18px] shrink-0 text-m-1" aria-label="Not this one" />}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Build a line out of a bank of words, some of which do not belong in it.
 *
 * The answer is `picked` as a *sequence*, so the order the chips were pressed in is the answer —
 * which is why a chip pressed again is removed rather than toggled off in place. Taking a word
 * out of the middle of a line and putting it at the end are two different edits, and both are
 * this one gesture.
 */
function OrderAnswer({ quiz, question, bank, answer, checked, onAnswer, play, playing }: AnswerProps & { bank: QuizChoice[] }) {
  const byPosition = new Map(question.choices.map(choice => [choice.position, choice]));
  const wanted = question.choices.filter(choice => choice.correct).map(choice => choice.position);

  const place = (position: number) => onAnswer({ ...answer, picked: [...answer.picked, position] });
  const take = (index: number) => onAnswer({ ...answer, picked: answer.picked.filter((_, at) => at !== index) });

  return (
    <>
      {/* The line being built. Empty, it is a dashed rule rather than nothing, so that there is
          somewhere for the words to be going. */}
      <div
        className={cn(
          'flex min-h-16 flex-wrap content-start items-start gap-2 rounded-md border-2 border-dashed border-border-strong p-3',
          checked && 'border-solid',
        )}
      >
        {answer.picked.length === 0 && (
          <span className="self-center text-[13.5px] text-faint">Press the words below, in order.</span>
        )}

        {answer.picked.map((position, index) => {
          const choice = byPosition.get(position);
          // After marking, a chip is green where it stands in the right place and red where it
          // does not — position by position, so "right words, wrong order" reads as exactly that.
          const right = checked ? wanted[index] === position : null;

          return (
            <button
              key={`${position}-${index}`}
              type="button"
              disabled={checked}
              onClick={() => take(index)}
              className={cn(
                'rounded-md border-2 border-border bg-card px-3 py-1.5 text-[15px] transition-colors',
                !checked && 'cursor-pointer hover:border-primary hover:bg-control-hover',
                right === true && 'border-m-5 text-m-5',
                right === false && 'border-m-1 text-m-1',
              )}
            >
              {choice?.text || '—'}
            </button>
          );
        })}
      </div>

      {/* What is left to place. A word already in the line is gone from here rather than
          greyed: it is in one place or the other, and showing it twice invites pressing it twice. */}
      {!checked && (
        <ul className="mt-3 flex list-none flex-wrap gap-2">
          {bank
            .filter(choice => !answer.picked.includes(choice.position))
            .map(choice => {
              const src = sourceUrl(quiz.id, question.position, choice.audio, choice.position);
              return (
                <li key={choice.position}>
                  <button
                    type="button"
                    onClick={() => place(choice.position)}
                    className="flex cursor-pointer items-center gap-2 rounded-md border-2 border-border bg-background px-3 py-1.5 text-[15px] transition-colors hover:border-primary hover:bg-control-hover"
                  >
                    {src && (
                      <PlayButton src={src} playing={playing === src} onPlay={play} label={`Play "${choice.text}"`} />
                    )}
                    {choice.text || '—'}
                  </button>
                </li>
              );
            })}
        </ul>
      )}

      {checked && (
        <p className="mt-3 text-[13.5px] text-muted-foreground">
          The answer:{' '}
          <span className="font-semibold text-foreground">
            {wanted.map(position => byPosition.get(position)?.text ?? '').join(' ')}
          </span>
        </p>
      )}
    </>
  );
}

/**
 * Write it out.
 *
 * The field stays on screen after marking, holding what was typed, and the accepted answer goes
 * underneath it. Clearing it would take away the one thing that makes a near miss instructive —
 * seeing that you wrote ვმუშაობ where the answer was ვმუშაობთ.
 */
function TypeAnswer({
  answer,
  checked,
  correct,
  onAnswer,
}: {
  answer: QuizAnswer;
  checked: boolean;
  correct: boolean;
  onAnswer: (next: QuizAnswer) => void;
}) {
  return (
    <input
      type="text"
      value={answer.text}
      disabled={checked}
      // Off, all of it. A phone keyboard correcting a Georgian verb into an English word it
      // half-recognises is not a help, and a suggestion bar offering the answer you typed last
      // time turns the question into a memory test about this session.
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      // Focused on arrival: a question that is answered by typing should be answerable by
      // typing, without a click to say so first.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      onChange={event => onAnswer({ ...answer, text: event.target.value })}
      placeholder="Type your answer…"
      className={cn(
        'w-full rounded-md border-2 border-border-strong bg-background px-4 py-3 text-xl outline-none',
        'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-glow',
        'disabled:cursor-default',
        checked && correct && 'border-m-5 text-m-5',
        checked && !correct && 'border-m-1 text-m-1',
      )}
    />
  );
}

/** What a marked question says about itself: right or wrong, the answer, and why. */
function Verdict({ question, correct }: { question: QuizQuestion; correct: boolean }) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className={cn('flex items-center gap-2 text-[15px] font-semibold', correct ? 'text-m-5' : 'text-m-1')}>
        {correct ? <Check className="size-[18px]" /> : <X className="size-[18px]" />}
        {correct ? 'Right' : 'Not quite'}
      </p>

      {/* The accepted spelling, for a typed question that was got wrong. Only the first of them:
          the others are alternatives, and a list of four right answers reads as a puzzle. */}
      {!correct && question.kind === 'type' && question.answers.length > 0 && (
        <p className="mt-1.5 text-[15px]">
          The answer: <span className="font-semibold">{question.answers[0]}</span>
        </p>
      )}

      {question.explanation && (
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted-foreground">{question.explanation}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- results */

function Results({
  quiz,
  result,
  onRestart,
  onExit,
  exitLabel,
  embedded,
}: {
  /** The run's quiz — the questions it was dealt, not the whole pool. */
  quiz: Quiz;
  result: QuizMark;
  onRestart: () => void;
  onExit?: () => void;
  exitLabel: string;
  embedded: boolean;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-6 shadow-card max-sm:p-4', !embedded && 'mt-1')}>
      <p className="text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {result.passed ? 'Passed' : 'Not this time'}
      </p>

      <p className={cn('mt-1 text-4xl font-bold tabular-nums', result.passed ? 'text-m-5' : 'text-m-1')}>
        {result.score} / {result.total}
      </p>

      <p className="mt-1.5 text-[14px] text-muted-foreground">
        {result.percent}%, and {quiz.passMark}% was the pass mark.
      </p>

      {/* One square per question, in the order this run asked them — which is a different order
          each time, since questions are shuffled by default. Numbering them by the run rather
          than by the quiz is what makes the squares readable at all: square 3 is the third
          question you were asked, the one the counter called 3 / 10 at the time. */}
      <ul className="mt-5 flex list-none flex-wrap gap-1.5">
        {result.correct.map((right, index) => (
          <li
            key={quiz.questions[index]?.position ?? index}
            title={`Question ${index + 1}: ${right ? 'right' : 'wrong'}`}
            className={cn(
              'grid size-7 place-items-center rounded-sm text-[12px] font-semibold tabular-nums',
              right ? 'bg-[color-mix(in_srgb,var(--m-5)_18%,transparent)] text-m-5' : 'bg-[color-mix(in_srgb,var(--m-1)_15%,transparent)] text-m-1',
            )}
          >
            {index + 1}
          </li>
        ))}
      </ul>

      {/* The way out first where there is one: somebody who has just been shown a score wants
          to get back to what they were doing more often than they want a second attempt. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {onExit && (
          <Button variant="control" size="auto" className={CORRECT_BUTTON} onClick={onExit}>
            <ArrowLeft /> {exitLabel}
          </Button>
        )}
        <Button variant="control" size="auto" onClick={onRestart}>
          <RotateCcw /> Try it again
        </Button>
      </div>
    </div>
  );
}
