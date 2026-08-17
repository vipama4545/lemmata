// What there is to answer, by category.
//
// Built the same way the story index is, and on purpose: two levels rather than one long list,
// the shelves in the order they were made, and everything unfiled gathered under "Everything
// else" at the bottom. Somebody who has learned how one of these pages works has learned both.
//
// The one thing this has that the story index does not is a tick. `quiz.results` says which of
// these have been passed, and it is the only thing on the page that is fetched rather than read
// out of the snapshot — a result belongs to one account and cannot live in a payload shared by
// every visitor. Signed out it answers with an empty list, and the page simply has no ticks on
// it, which is exactly what "no account, no record" should look like.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ListChecks, Volume2 } from 'lucide-react';
import type { QuizResult, QuizSummary } from '@georgian/shared/types';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page, SectionHeading } from '@/components/ui/page';
import { LevelBadge } from '@/components/ui/word-card';
import { cn } from '@/lib/utils';
import { api, useSession } from '../api/client';
import { lang, quizCategories, quizSummaries } from '../content/store';

/** The id the unfiled quizzes are gathered under. See the note on `UNFILED` in StoryIndex. */
export const UNFILED = '-';

/** Where a shelf lives. Static "category" outranks `:quizId`, so the two never collide. */
export function quizShelfHref(categoryId: string): string {
  return `/${lang()}/quizzes/category/${encodeURIComponent(categoryId)}`;
}

export interface QuizShelf {
  id: string;
  name: string;
  nameNative: string;
  note: string;
  quizzes: QuizSummary[];
}

/**
 * The shelves, in the order they were made, with the unfiled quizzes last.
 *
 * A quiz with no questions is dropped before any of this happens, and that is the whole of what
 * stands in for a draft flag. There is nothing to answer in it, so there is nothing to offer;
 * the admin list shows it, because there it is a thing you are half-way through writing.
 */
export function useQuizShelves(): QuizShelf[] {
  const all = quizSummaries();
  const categories = quizCategories();

  return useMemo(() => {
    const ready = all.filter(quiz => quiz.questionCount > 0);

    const filed: QuizShelf[] = categories
      .map(category => ({
        id: category.id,
        name: category.name,
        nameNative: category.nameNative,
        note: category.note,
        quizzes: ready.filter(quiz => quiz.categoryId === category.id),
      }))
      .filter(shelf => shelf.quizzes.length > 0);

    const unfiled = ready.filter(
      quiz => !quiz.categoryId || !categories.some(category => category.id === quiz.categoryId),
    );
    if (!unfiled.length) return filed;

    return [...filed, { id: UNFILED, name: 'Everything else', nameNative: '', note: '', quizzes: unfiled }];
  }, [all, categories]);
}

/**
 * Which quizzes this account has passed, keyed by id.
 *
 * Fetched once per mount rather than held in the content store, because it is not content: it
 * belongs to one person, and the store is a cache of a payload every visitor shares. Failures
 * are swallowed — an index that would not draw because it could not find out which quizzes you
 * had already done would be a worse page than one with no ticks on it.
 */
export function useQuizResults(): Map<string, QuizResult> {
  const { data: session } = useSession();
  const [results, setResults] = useState<Map<string, QuizResult>>(new Map());

  useEffect(() => {
    if (!session?.user) {
      setResults(new Map());
      return undefined;
    }

    let live = true;
    void api.quiz
      .results({ lang: lang() })
      .then(answer => {
        if (live) setResults(new Map(answer.results.map(result => [result.quizId, result])));
      })
      .catch(() => {});

    return () => {
      live = false;
    };
    // On the account's id rather than on `session.user`, which is a fresh object on every
    // session refresh and would re-fetch this list for no change anybody made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  return results;
}

export function QuizGrid({ quizzes, results }: { quizzes: QuizSummary[]; results: Map<string, QuizResult> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
      {quizzes.map(quiz => (
        <QuizCard key={quiz.id} quiz={quiz} result={results.get(quiz.id)} />
      ))}
    </div>
  );
}

function QuizCard({ quiz, result }: { quiz: QuizSummary; result: QuizResult | undefined }) {
  return (
    <Link
      to={`/${lang()}/quizzes/${quiz.id}`}
      className="group flex flex-col gap-2 rounded-lg border-2 border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-pop"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] leading-tight font-semibold">{quiz.title}</h3>
        {/* Passed, and only passed. A failed attempt is not something to label somebody's
            card with on the way past — the quiz is there to be taken again. */}
        {result?.passed && (
          <span
            title={`Passed — ${result.score}/${result.total}`}
            className="grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--m-5)_18%,transparent)]"
          >
            <Check className="size-3.5 text-m-5" aria-label="Passed" />
          </span>
        )}
      </div>

      {quiz.titleNative && <p className="text-base leading-snug text-muted-foreground">{quiz.titleNative}</p>}
      {quiz.description && (
        <p className="line-clamp-2 text-[13px] leading-normal text-muted-foreground">{quiz.description}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">
        <span className="rounded-full bg-primary-glow px-2.5 py-0.5 text-[12.5px] font-medium text-primary">
          {quiz.questionCount} {quiz.questionCount === 1 ? 'question' : 'questions'}
        </span>
        {quiz.hasAudio && (
          <span
            title="Some of this is meant to be heard"
            className="grid size-6 place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <Volume2 className="size-3.5" aria-label="Has audio" />
          </span>
        )}
        {quiz.level && <LevelBadge level={quiz.level} />}
      </div>
    </Link>
  );
}

function QuizIndex() {
  const all = quizSummaries();
  const shelves = useQuizShelves();
  const results = useQuizResults();
  const ready = useMemo(() => all.filter(quiz => quiz.questionCount > 0), [all]);

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Quizzes</span>
      </Breadcrumb>

      <header className="mb-6">
        <h1 className="mb-1.5 flex items-center gap-2.5 text-[26px] font-bold">
          <ListChecks className="size-[22px]" aria-hidden="true" />
          Quizzes
        </h1>
        <p className="max-w-[62ch] text-muted-foreground">
          Every question is marked as you answer it, with the reason underneath. Sign in and the last
          run of each is kept, so you can see what you have already got through.
        </p>
      </header>

      {ready.length === 0 && (
        <p className="py-6 text-center text-muted-foreground">There are no quizzes yet.</p>
      )}

      {/* Until a category exists there is nothing to browse *by*, so the flat list is what
          shows — the same reasoning the story index gives, and it is right for a dozen quizzes. */}
      {shelves.length <= 1 ? (
        <QuizGrid quizzes={ready} results={results} />
      ) : (
        shelves.map(shelf => (
          <section key={shelf.id} className="mb-8">
            <SectionHeading>
              <Link to={quizShelfHref(shelf.id)} className="hover:text-primary hover:underline">
                {shelf.name}
              </Link>
              {shelf.nameNative && <span className="ml-2 font-normal text-faint">{shelf.nameNative}</span>}
              <span className={cn('ml-2 font-normal text-faint')}>· {shelf.quizzes.length}</span>
            </SectionHeading>
            <QuizGrid quizzes={shelf.quizzes} results={results} />
          </section>
        ))
      )}
    </Page>
  );
}

export default QuizIndex;
