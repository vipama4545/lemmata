// One quiz, inside the app.
//
// A thin thing: it fetches the quiz, draws the heading and hands the rest to `QuizRunner`. The
// run itself is entirely the runner's, which is what lets the embed be a different shell around
// the same component rather than a second implementation of the same quiz.
//
// What lives here and not in the runner is the *recording*. The runner marks a run and says so;
// this decides that a marked run is worth keeping, which it is only when somebody is signed in
// to keep it against. A signed-out reader gets the identical quiz and the identical marking, and
// a line at the bottom saying what signing in would add — never a wall in front of the questions.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, ListChecks } from 'lucide-react';
import type { QuizMark } from '@georgian/shared/quiz';
import type { Quiz, QuizAnswer, QuizResult } from '@georgian/shared/types';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { LevelBadge } from '@/components/ui/word-card';
import { api, useSession } from '../api/client';
import { lang } from '../content/store';
import QuizRunner from './QuizRunner';
import { quizShelfHref } from './QuizIndex';

type State = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; quiz: Quiz };

/**
 * Fetches one quiz by id.
 *
 * Not from the snapshot, and this is the one page in the app that has to go to the network for
 * content it could in principle have been sent already. The reason is on the `Quiz` type: the
 * questions carry the answers, and the snapshot is a single payload cached in every browser and
 * on disk. Downloading every answer to every quiz in order to show a list of titles would be the
 * wrong trade even before considering that the list is where people who have not taken them look.
 */
export function useQuiz(id: string | undefined): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!id) {
      setState({ status: 'missing' });
      return undefined;
    }

    let live = true;
    setState({ status: 'loading' });

    void api.quiz
      .get({ id })
      .then(quiz => {
        if (!live) return;
        setState(quiz ? { status: 'ready', quiz } : { status: 'missing' });
      })
      .catch(() => {
        // A quiz that will not load and a quiz that does not exist are the same thing to
        // somebody following a link: there is nothing here to answer.
        if (live) setState({ status: 'missing' });
      });

    return () => {
      live = false;
    };
  }, [id]);

  return state;
}

/**
 * Records a finished run, when there is somebody to record it against.
 *
 * The answers go up rather than the score — the server marks them again, with the same function
 * this browser used. See the note on `quiz.finish` in the contract.
 *
 * Failures are swallowed on purpose. The reader has finished the quiz and can see how they did;
 * a network error on the way to writing it down is not something to put in front of them, and
 * there is nothing they could do about it if it were.
 */
export function useRecorder(): {
  record: (quizId: string, answers: Record<number, QuizAnswer>, asked: number[]) => void;
  saved: QuizResult | null;
} {
  const { data: session } = useSession();
  const [saved, setSaved] = useState<QuizResult | null>(null);

  // `asked` is which questions the run was dealt. It matters only for a quiz with a pool, where
  // the run is shorter than the quiz and the server would otherwise mark the answers against
  // every question there is. See `dealt` in the server's quiz router.
  const record = (quizId: string, answers: Record<number, QuizAnswer>, asked: number[]) => {
    if (!session?.user) return;

    void api.quiz
      .finish({ quizId, answers: Object.fromEntries(Object.entries(answers)), asked })
      .then(answer => setSaved(answer.result))
      .catch(() => {});
  };

  return { record, saved };
}

function QuizPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const state = useQuiz(quizId);
  const { data: session } = useSession();
  const { record, saved } = useRecorder();
  const [finished, setFinished] = useState<QuizMark | null>(null);

  if (state.status === 'loading') {
    return (
      <Page>
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      </Page>
    );
  }

  if (state.status === 'missing') {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to={`/${lang()}/quizzes`}>← Quizzes</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is no such quiz.</p>
      </Page>
    );
  }

  const { quiz } = state;

  return (
    <Page className="max-w-[860px]">
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}/quizzes`}>← Quizzes</BreadcrumbLink>
        {quiz.categoryId && quiz.category && (
          <>
            <BreadcrumbSeparator />
            <Link to={quizShelfHref(quiz.categoryId)} className="text-primary hover:underline">
              {quiz.category}
            </Link>
          </>
        )}
        <BreadcrumbSeparator />
        <span>{quiz.title}</span>
      </Breadcrumb>

      <header className="mb-5">
        <h1 className="flex flex-wrap items-center gap-2.5 text-[26px] font-bold">
          <ListChecks className="size-[22px]" aria-hidden="true" />
          {quiz.title}
          {quiz.titleNative && <span className="text-xl font-normal text-muted-foreground">{quiz.titleNative}</span>}
          <LevelBadge level={quiz.level} />
        </h1>
        {quiz.description && <p className="mt-1.5 max-w-[64ch] text-muted-foreground">{quiz.description}</p>}
      </header>

      <QuizRunner
        quiz={quiz}
        onFinish={(result, answers, asked) => {
          setFinished(result);
          record(quiz.id, answers, asked);
        }}
      />

      {/* Only once the run is over. Saying it up front would read as a gate on a page that has
          no gate, which is the impression most likely to make somebody close it. */}
      {finished && !session?.user && (
        <p className="mt-4 text-[13.5px] text-muted-foreground">
          Signing in keeps the last run of each quiz, so the index can show what you have got through.
          Nothing about this run was saved.
        </p>
      )}

      {finished && saved && (
        <p className="mt-4 flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <Check className="size-4 text-m-5" aria-hidden="true" />
          Kept as your latest run of this quiz.
        </p>
      )}
    </Page>
  );
}

export default QuizPage;
