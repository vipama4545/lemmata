// One lesson, read.
//
// The markup arrives from `content.lesson` rather than out of the snapshot — a section of forty
// lessons would otherwise put forty documents in the payload that draws a list of cards — so
// this is one of the handful of screens in the app that fetches. Everything around the body,
// including the shelf it is on and the lessons either side of it, comes out of the snapshot
// that is already here.
//
// Progress is the other thing this page owns. A lesson is done when every quiz it embeds has
// been passed — nothing is stored against the lesson itself, the quiz results *are* the record
// — so this holds the reader's passes, hands them to the blocks that draw a quiz, and takes
// back the result of every run taken here. See `lessonProgress` in LessonIndex.
//
// The section is taken from the route rather than from the lesson, and then checked against it.
// `/ka/grammar/<id>` and `/ka/lessons/<id>` are two addresses for one row, and a lesson moved
// between the sections should not go on answering to its old one: the breadcrumb would lead
// back to an index it is no longer listed in.

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleCheck } from 'lucide-react';
import { parseLesson } from '@georgian/shared/lesson';
import type { Lesson, LessonSection, LessonSummary } from '@georgian/shared/types';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, NAV_LINK, Page } from '@/components/ui/page';
import { LevelBadge } from '@/components/ui/word-card';
import { cn } from '@/lib/utils';
import { api, useSession } from '../api/client';
import { lang } from '../content/store';
import LessonMarkup from './LessonMarkup';
import {
  SECTIONS,
  lessonHref,
  lessonProgress,
  useLessonShelves,
  usePassedQuizzes,
  type LessonProgress,
  type LessonShelf,
} from './LessonIndex';
import { useRecorder } from './QuizPage';

/** One empty list, so that a lesson which has not arrived yet has a stable one. */
const NO_QUIZZES: string[] = [];

/** A lesson to go on to, and the shelf it is on when that is not the shelf you are on. */
interface Step {
  lesson: LessonSummary;
  /** Set only when the step crosses into another category. See `step`. */
  shelf?: LessonShelf;
}

/**
 * The lesson before or after this one — which is not always on the same shelf.
 *
 * A section is read in the order its index lays it out, shelf after shelf, so the last lesson of
 * a category leads into the first of the next rather than into nothing. The end of a category is
 * a place to keep going from; before this, it was where the footer went quiet and the only way on
 * was back out to the index to find where you had got to.
 *
 * The shelf comes back with the lesson when the step crosses into one, and not otherwise: on an
 * ordinary next-lesson link the name would be the same word under every lesson of a category, and
 * the one time it says something is the one time it is shown.
 */
function step(shelves: LessonShelf[], shelf: number, at: number, by: 1 | -1): Step | undefined {
  if (shelf < 0 || at < 0) return undefined;

  const along = shelves[shelf]?.lessons[at + by];
  if (along) return { lesson: along };

  // Off the end of this shelf. Forwards lands on the first lesson of the next one, backwards on
  // the last of the one before — the reading order the index prints, continued.
  const over = shelves[shelf + by];
  const lesson = by === 1 ? over?.lessons[0] : over?.lessons[over.lessons.length - 1];
  return over && lesson ? { lesson, shelf: over } : undefined;
}

export default function LessonPage({ section }: { section: LessonSection }) {
  const { lessonId } = useParams<{ lessonId: string }>();
  const [lesson, setLesson] = useState<Lesson | null | 'loading'>('loading');
  const shelves = useLessonShelves(section);
  const { data: session } = useSession();
  const { label, path, icon: Icon } = SECTIONS[section];
  const home = `/${lang()}/${path}`;

  const onRecord = usePassedQuizzes();
  const { record } = useRecorder();

  /**
   * What this visit has done to the record, quiz by quiz.
   *
   * `usePassedQuizzes` is fetched once on the way in, so it cannot know about a quiz taken
   * here a minute later — and re-fetching the whole list after every run to move one bar
   * would be a request to say something this page already knows. What it holds is the *result*
   * rather than a set of passes, so that failing a quiz you had passed before takes the tick
   * away: it overrides what arrived, and a fail is as much an override as a pass.
   */
  const [thisVisit, setThisVisit] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!lessonId) return undefined;

    let live = true;
    setLesson('loading');
    setThisVisit({});
    void api.content
      .lesson({ id: lessonId })
      .then(found => {
        if (live) setLesson(found);
      })
      .catch(() => {
        if (live) setLesson(null);
      });

    return () => {
      live = false;
    };
  }, [lessonId]);

  // Parsed once per body rather than on every render. The parser is fast enough that this is
  // tidiness rather than necessity, but the document is also what the block keys are built
  // from, and a fresh tree on every render would remount every embedded quiz — throwing away a
  // half-answered one each time a play button changed colour.
  const body = lesson === 'loading' || !lesson ? null : lesson.body;
  const doc = useMemo(() => (body === null ? null : parseLesson(body)), [body]);

  // The record as this page sees it: what the account had passed when the page opened, with
  // anything answered since laid over the top.
  const quizIds = lesson === 'loading' || !lesson ? NO_QUIZZES : lesson.quizIds;
  const passed = useMemo(
    () => new Set(quizIds.filter(id => thisVisit[id] ?? onRecord.has(id))),
    [quizIds, thisVisit, onRecord],
  );

  if (lesson === 'loading') {
    return (
      <Page>
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      </Page>
    );
  }

  if (!lesson) {
    return (
      <Page>
        <div className="py-10 text-center">
          <h2 className="mb-2 text-2xl font-bold">There is no such {label.toLowerCase().replace(/s$/, '')}</h2>
          <Link to={home} className="text-primary hover:underline">
            ← Back to {label.toLowerCase()}
          </Link>
        </div>
      </Page>
    );
  }

  // Moved between sections since this link was written or bookmarked. Sending the reader to
  // where it is now beats showing it under a heading it does not belong to.
  if (lesson.section !== section) return <Navigate to={lessonHref(lesson)} replace />;

  const shelfAt = shelves.findIndex(entry => entry.lessons.some(filed => filed.id === lesson.id));
  const shelf = shelfAt >= 0 ? shelves[shelfAt] : undefined;
  const neighbours = shelf?.lessons ?? [];
  const at = neighbours.findIndex(entry => entry.id === lesson.id);
  const previous = step(shelves, shelfAt, at, -1);
  const next = step(shelves, shelfAt, at, 1);

  return (
    <Page>
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <BreadcrumbLink to={home}>{label}</BreadcrumbLink>
        {shelf && shelf.id !== '-' && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbLink to={`${home}/category/${encodeURIComponent(shelf.id)}`}>{shelf.name}</BreadcrumbLink>
          </>
        )}
        <BreadcrumbSeparator />
        <span>{lesson.title}</span>
      </Breadcrumb>

      <header className="mb-6 flex items-start gap-4">
        <span className="flex size-[46px] shrink-0 items-center justify-center rounded-sm bg-primary-light text-primary">
          <Icon className="size-[22px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="mb-0.5 text-[28px] leading-tight font-bold">{lesson.title}</h1>
          {lesson.titleNative && <p className="text-base text-faint">{lesson.titleNative}</p>}
          {lesson.level && (
            <span className="mt-2 inline-block">
              <LevelBadge level={lesson.level} />
            </span>
          )}
        </div>
      </header>

      {lesson.summary && (
        <p className="mb-7 max-w-[68ch] border-b border-border pb-5 text-[15px] text-muted-foreground">
          {lesson.summary}
        </p>
      )}

      {quizIds.length > 0 && (
        <Progress progress={lessonProgress(lesson, passed)} signedIn={Boolean(session?.user)} />
      )}

      {doc && doc.blocks.length > 0 ? (
        <LessonMarkup
          doc={doc}
          lessonId={lesson.id}
          progress={{
            passed,
            // Two things, and they are separate on purpose. The bar above moves at once,
            // because the reader has just watched themselves finish; the row in the database
            // is written in the background and nobody is told if it fails, exactly as the quiz
            // page does it. See `useRecorder`.
            onFinish: (quizId, result, answers, asked) => {
              setThisVisit(all => ({ ...all, [quizId]: result.passed }));
              record(quizId, answers, asked);
            },
          }}
        />
      ) : (
        <p className="py-6 text-muted-foreground">There is nothing in this one yet.</p>
      )}

      {(previous || next) && (
        <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-border pt-5">
          {previous ? <LessonStep step={previous} back /> : <span />}
          {next && <LessonStep step={next} />}
        </div>
      )}
    </Page>
  );
}

/**
 * One of the two links at the foot of a lesson.
 *
 * Two lines rather than one when the step leaves the category, the name of the one it is going to
 * above the lesson's title: a link that reads only "The alphabet, part one" gives no sign that
 * pressing it has moved you to another shelf, and moving to another shelf is exactly the thing
 * worth saying. Within a shelf it stays the plain title it has always been.
 */
function LessonStep({ step, back = false }: { step: Step; back?: boolean }) {
  const Arrow = back ? ArrowLeft : ArrowRight;
  const arrow = <Arrow className="size-[18px] shrink-0" aria-hidden="true" />;

  return (
    <Link to={lessonHref(step.lesson)} className={cn(NAV_LINK, 'max-w-[47%]')}>
      {back && arrow}
      <span className={cn('min-w-0', !back && 'text-right')}>
        {/* The category, quietly, and the lesson under it in the weight the title always had. */}
        {step.shelf && <span className="block text-[12px] text-faint">{step.shelf.name}</span>}
        {step.lesson.title}
      </span>
      {!back && arrow}
    </Link>
  );
}

/**
 * How much of this lesson is behind you — in one line, above the lesson.
 *
 * Counted in quizzes passed, which is the only part of reading a lesson this app can honestly
 * observe — see `lessonProgress`. A lesson with nothing to answer in it shows none of this
 * rather than an empty bar that could never fill.
 *
 * Deliberately small. This is a footnote about the lesson and not the reason anybody opened it,
 * so it is a line of text the size of a caption with a short rule beside it — a panel at the top
 * of the page would announce the scorekeeping louder than the lesson.
 *
 * Signed out it still moves, and still says so. The quizzes are answered and marked exactly as
 * they are for anybody else; what is missing is somewhere to keep the result, so the count is
 * this visit's and the line says as much. That is a better first impression than a count that
 * does not respond to finishing a quiz, and a far better one than a sign-in wall.
 */
function Progress({ progress, signedIn }: { progress: LessonProgress; signedIn: boolean }) {
  const { done, total, complete } = progress;

  return (
    <p className="mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
      {complete ? (
        <span className="flex items-center gap-1.5 font-semibold text-m-5">
          <CircleCheck className="size-4" aria-hidden="true" />
          Lesson done
        </span>
      ) : (
        <>
          <span className="tabular-nums">
            {done} of {total} {total === 1 ? 'quiz' : 'quizzes'} passed
          </span>
          <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${(done / total) * 100}%` }}
            />
          </span>
        </>
      )}

      {!signedIn && done > 0 && <span className="text-faint">· this visit only, unless you sign in</span>}
    </p>
  );
}
