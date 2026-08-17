// What there is to read, by category — twice over.
//
// One component behind both /lessons and /grammar, because they are one table with a `section`
// column on it and the only thing that differs between the two pages is which value of that
// column they show, what the heading says, and which icon is beside it. Two files would be two
// copies of the shelving logic, and the second copy is the one that stops getting fixed.
//
// Built the way the story and quiz indexes are, and on purpose: two levels rather than one long
// list, the shelves in the order they were made, everything unfiled gathered under "Everything
// else" at the bottom. Somebody who has learned how one of these pages works has learned all
// four.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Check, GraduationCap, ListChecks, Play, Volume2, type LucideIcon } from 'lucide-react';
import type { LessonSection, LessonSummary } from '@georgian/shared/types';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page, SectionHeading } from '@/components/ui/page';
import { LevelBadge } from '@/components/ui/word-card';
import { cn } from '@/lib/utils';
import { lang, lessonCategories, lessonSummaries } from '../content/store';
import { useQuizResults } from './QuizIndex';

/** The id the unfiled lessons are gathered under. See the note on `UNFILED` in StoryIndex. */
export const UNFILED = '-';

/**
 * What each section is called and where it lives.
 *
 * The one place the two differ. Everything below this constant is written once and reads it,
 * which is what makes "add a third section" a row here rather than a third set of screens.
 */
export const SECTIONS: Record<LessonSection, { label: string; path: string; icon: LucideIcon; blurb: string }> = {
  lessons: {
    label: 'Lessons',
    path: 'lessons',
    icon: GraduationCap,
    blurb:
      'Worked through in order, or dipped into. Some of them read themselves aloud, and some hold quizzes — pass every quiz in a lesson and it is marked done.',
  },
  grammar: {
    label: 'Grammar',
    path: 'grammar',
    icon: BookOpen,
    blurb:
      'The machinery behind the word lists: how nouns take their endings, how a verb packs a whole sentence into one word, and how the pieces go together.',
  },
};

/** Where a lesson is. */
export function lessonHref(lesson: { section: LessonSection; id: string }): string {
  return `/${lang()}/${SECTIONS[lesson.section].path}/${encodeURIComponent(lesson.id)}`;
}

/** Where a shelf is. Static "category" outranks `:lessonId`, so the two never collide. */
export function lessonShelfHref(section: LessonSection, categoryId: string): string {
  return `/${lang()}/${SECTIONS[section].path}/category/${encodeURIComponent(categoryId)}`;
}

export interface LessonShelf {
  id: string;
  name: string;
  nameNative: string;
  note: string;
  lessons: LessonSummary[];
}

/**
 * The shelves of one section, in the order they were made, with the unfiled lessons last.
 *
 * A lesson with an empty body is dropped before any of this happens, and that is the whole of
 * what stands in for a draft flag. There is nothing to read in it, so there is nothing to
 * offer; the admin list shows it, because there it is a thing you are half-way through writing.
 */
export function useLessonShelves(section: LessonSection): LessonShelf[] {
  const all = lessonSummaries(section);
  const categories = lessonCategories(section);

  return useMemo(() => {
    const ready = all.filter(lesson => lesson.blocks > 0);

    const filed: LessonShelf[] = categories
      .map(category => ({
        id: category.id,
        name: category.name,
        nameNative: category.nameNative,
        note: category.note,
        lessons: ready.filter(lesson => lesson.categoryId === category.id),
      }))
      .filter(shelf => shelf.lessons.length > 0);

    const unfiled = ready.filter(
      lesson => !lesson.categoryId || !categories.some(category => category.id === lesson.categoryId),
    );
    if (!unfiled.length) return filed;

    return [...filed, { id: UNFILED, name: 'Everything else', nameNative: '', note: '', lessons: unfiled }];
  }, [all, categories]);
}

/* --------------------------------------------------------------- progress */

/**
 * Which quizzes this account has passed, as a set.
 *
 * The same list the quiz index draws its ticks from, asked the one question the lessons have of
 * it: was this one passed. A failed attempt is not progress through a lesson — the quiz is
 * there to be taken again — so only passes are in here.
 */
export function usePassedQuizzes(): ReadonlySet<string> {
  const results = useQuizResults();

  return useMemo(
    () => new Set([...results.values()].filter(result => result.passed).map(result => result.quizId)),
    [results],
  );
}

export interface LessonProgress {
  /** How many of the lesson's quizzes have been passed. */
  done: number;
  total: number;
  /** Every one of them, and there was at least one. */
  complete: boolean;
}

/**
 * How far through a lesson somebody is.
 *
 * Measured in quizzes passed, because that is the only thing about reading a lesson this app can
 * actually observe — scrolling to the bottom is not evidence of anything. A lesson with no quiz
 * in it therefore has no progress and is never complete, which is why `complete` insists on a
 * total: nought out of nought is arithmetically finished and would tick every lesson in the
 * section that nobody had opened.
 *
 * Nothing is stored against the lesson itself. The quiz results are the record, and a lesson is
 * done when the quizzes it names have been passed — so this holds across devices for the same
 * reason a tick on the quiz index does, and cannot drift out of step with it.
 */
export function lessonProgress(lesson: { quizIds: string[] }, passed: ReadonlySet<string>): LessonProgress {
  const done = lesson.quizIds.filter(id => passed.has(id)).length;
  return { done, total: lesson.quizIds.length, complete: lesson.quizIds.length > 0 && done === lesson.quizIds.length };
}

/* ------------------------------------------------------------------ cards */

export function LessonGrid({ lessons, passed }: { lessons: LessonSummary[]; passed: ReadonlySet<string> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
      {lessons.map(lesson => (
        <LessonCard key={lesson.id} lesson={lesson} progress={lessonProgress(lesson, passed)} />
      ))}
    </div>
  );
}

function LessonCard({ lesson, progress }: { lesson: LessonSummary; progress: LessonProgress }) {
  return (
    <Link
      to={lessonHref(lesson)}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border-2 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-pop',
        progress.complete ? 'border-m-5' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[15px] leading-tight font-semibold">{lesson.title}</h3>
        {/* Done, and only done. A lesson half-way through says so in its quiz badge below;
            the tick is for the state worth spotting from across the page. */}
        {progress.complete && (
          <span
            title={`Done — all ${progress.total === 1 ? 'its quiz' : `${progress.total} quizzes`} passed`}
            className="grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--m-5)_18%,transparent)]"
          >
            <Check className="size-3.5 text-m-5" aria-label="Done" />
          </span>
        )}
      </div>
      {lesson.titleNative && <p className="text-base leading-snug text-muted-foreground">{lesson.titleNative}</p>}

      {/* The author's own line where there is one, and the opening paragraph where there is
          not. A card with neither is a lesson that begins with a table, which is rare and
          reads perfectly well as a title on its own. */}
      {(lesson.summary || lesson.excerpt) && (
        <p className="line-clamp-3 text-[13px] leading-normal text-muted-foreground">
          {lesson.summary || lesson.excerpt}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">
        {lesson.hasAudio && (
          <span
            title="Some of this is meant to be heard"
            className="grid size-6 place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <Volume2 className="size-3.5" aria-label="Has audio" />
          </span>
        )}
        {lesson.videos > 0 && (
          <span
            title={lesson.videos === 1 ? 'Has a video' : `Has ${lesson.videos} videos`}
            className="grid size-6 place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <Play className="size-3.5" aria-label="Has video" />
          </span>
        )}
        {/* How many quizzes it holds, and — once any of them has been passed — how many are
            behind you. A lesson nobody has started reads as it always did. */}
        {progress.total > 0 && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-medium',
              progress.complete
                ? 'bg-[color-mix(in_srgb,var(--m-5)_16%,transparent)] text-m-5'
                : 'bg-primary-glow text-primary',
            )}
          >
            <ListChecks className="size-3.5" aria-hidden="true" />
            {progress.done > 0
              ? `${progress.done} / ${progress.total} quizzes`
              : progress.total === 1
                ? '1 quiz'
                : `${progress.total} quizzes`}
          </span>
        )}
        {lesson.level && <LevelBadge level={lesson.level} />}
      </div>
    </Link>
  );
}

export default function LessonIndex({ section }: { section: LessonSection }) {
  const all = lessonSummaries(section);
  const shelves = useLessonShelves(section);
  const passed = usePassedQuizzes();
  const ready = useMemo(() => all.filter(lesson => lesson.blocks > 0), [all]);
  const { label, blurb, icon: Icon } = SECTIONS[section];

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{label}</span>
      </Breadcrumb>

      <header className="mb-6">
        <h1 className="mb-1.5 flex items-center gap-2.5 text-[26px] font-bold">
          <Icon className="size-[22px]" aria-hidden="true" />
          {label}
        </h1>
        <p className="max-w-[62ch] text-muted-foreground">{blurb}</p>
      </header>

      {ready.length === 0 && (
        <p className="py-6 text-center text-muted-foreground">There is nothing here yet.</p>
      )}

      {/* Until a category exists there is nothing to browse *by*, so the flat list is what
          shows — the same reasoning the story and quiz indexes give. */}
      {shelves.length <= 1 ? (
        <LessonGrid lessons={ready} passed={passed} />
      ) : (
        shelves.map(shelf => (
          <section key={shelf.id} className="mb-8">
            <SectionHeading>
              <Link to={lessonShelfHref(section, shelf.id)} className="hover:text-primary hover:underline">
                {shelf.name}
              </Link>
              {shelf.nameNative && <span className="ml-2 font-normal text-faint">{shelf.nameNative}</span>}
              <span className="ml-2 font-normal text-faint">· {shelf.lessons.length}</span>
            </SectionHeading>
            <LessonGrid lessons={shelf.lessons} passed={passed} />
          </section>
        ))
      )}
    </Page>
  );
}
