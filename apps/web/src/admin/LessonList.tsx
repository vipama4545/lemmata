// Every lesson and every grammar topic, including the ones with nothing in them yet.
//
// That last part is the difference between this list and the two reader indexes, and it is the
// whole of what stands in for a draft flag. There is no `published` column — see the note on the
// `lessons` table — so a lesson becomes visible by having something in its body. This screen
// shows the empty ones and says so, because here they are a thing you are half-way through
// writing rather than a thing with nothing to read.
//
// Both sections in one screen, filtered by a pair of tabs, because they are one table and
// moving a lesson from one to the other is a field on the editor. Two admin screens would make
// that look like two different kinds of thing.
//
// Read out of the snapshot, like every other admin list. Only the writes go over the wire — and
// reordering is the one write on this screen, because the order lessons stand in is the order
// they are meant to be worked through and there is nowhere else to say so.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, ListChecks, Play, Plus, Volume2 } from 'lucide-react';
import type { LessonSection, LessonSummary } from '@georgian/shared/types';
import { LESSON_SECTIONS } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator } from '@/components/ui/page';
import { SearchField } from '@/components/ui/search-field';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { SECTIONS } from '../components/LessonIndex';
import { api } from '../api/client';
import { lessonCategories, lessonSummaries } from '../content/store';
import {
  ADMIN_ROW_LINK,
  AdminBadge,
  AdminCountLine,
  AdminError,
  AdminHeadRow,
  AdminNote,
  AdminPage,
  AdminRowEn,
  AdminRowGeo,
  AdminRowMeta,
  AdminRows,
  AdminSub,
  AdminTitle,
} from './ui';
import { useEdit } from './useAdmin';

export default function LessonList() {
  const all = lessonSummaries();
  const categories = lessonCategories();
  const { busy, error, run } = useEdit();

  const [section, setSection] = useState<LessonSection>('lessons');
  const [search, setSearch] = useState('');

  const mine = useMemo(() => all.filter(lesson => lesson.section === section), [all, section]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return mine;
    return mine.filter(
      lesson =>
        lesson.title.toLowerCase().includes(needle) ||
        lesson.titleNative.includes(needle) ||
        lesson.summary.toLowerCase().includes(needle),
    );
  }, [mine, search]);

  const empty = mine.filter(lesson => lesson.blocks === 0).length;
  const names = new Map(categories.map(category => [category.id, category.name]));

  const move = (id: string, direction: 'up' | 'down') => run(() => api.admin.moveLesson({ id, direction }));

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin">← Admin</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Lessons</span>
      </Breadcrumb>

      <AdminHeadRow>
        <div>
          <AdminTitle>Lessons</AdminTitle>
          <AdminSub>
            A lesson is offered to readers as soon as there is something in its body. There is no
            separate “publish” — an empty one is simply not listed, which is what makes writing one
            over several sittings safe.
          </AdminSub>
        </div>
        <Button asChild variant="control" size="auto" className={KNOW_BUTTON}>
          <Link to={`/admin/lessons/new?section=${section}`}>
            <Plus /> New {section === 'grammar' ? 'topic' : 'lesson'}
          </Link>
        </Button>
      </AdminHeadRow>

      {error && <AdminError>{error}</AdminError>}

      {/* Two tabs rather than two screens: a lesson moves between the sections by changing one
          field, and the list you are looking at should follow it. */}
      <div className="mb-4 flex gap-2">
        {LESSON_SECTIONS.map(entry => (
          <Button
            key={entry}
            variant={entry === section ? 'controlOn' : 'control'}
            size="auto-sm"
            onClick={() => setSection(entry)}
          >
            {SECTIONS[entry].label}
            <span className="ml-1.5 text-[12px] opacity-70">
              {all.filter(lesson => lesson.section === entry).length}
            </span>
          </Button>
        ))}
      </div>

      <SearchField placeholder="Search lessons…" value={search} onChange={event => setSearch(event.target.value)} />

      <AdminCountLine>
        {shown.length} of {mine.length}
        {empty > 0 && ` · ${empty} with nothing in ${empty === 1 ? 'it' : 'them'} yet`}
      </AdminCountLine>

      {mine.length === 0 && (
        <AdminNote>
          None yet. A lesson is a title and a body of markup: headings, tables, coloured letters,
          pictures, a play button on any paragraph, and a quiz from the quiz screens answerable
          where it stands.
        </AdminNote>
      )}

      <AdminRows>
        {shown.map((lesson, at) => (
          <li key={lesson.id}>
            <div className={cn(ADMIN_ROW_LINK, 'gap-2')}>
              <Link
                to={`/admin/lessons/${encodeURIComponent(lesson.id)}`}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-3 hover:underline"
              >
                <AdminRowGeo>{lesson.title}</AdminRowGeo>
                <AdminRowEn>{lesson.titleNative || lesson.summary || lesson.excerpt}</AdminRowEn>
                <Facts lesson={lesson} categoryName={lesson.categoryId ? names.get(lesson.categoryId) : undefined} />
              </Link>

              {/* Up and down rather than a drag handle, and it swaps with the neighbour on the
                  same shelf — which is the list a reader sees, so it is the list being ordered.
                  Disabled at the ends of the *filtered* view is deliberately not attempted:
                  what "the end" means depends on the shelf, not on the search box, and the
                  server treats a move with no neighbour as a no-op. */}
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="control"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Move ${lesson.title} up`}
                  onClick={() => move(lesson.id, 'up')}
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="control"
                  size="icon-sm"
                  disabled={busy || at === shown.length - 1}
                  aria-label={`Move ${lesson.title} down`}
                  onClick={() => move(lesson.id, 'down')}
                >
                  <ChevronDown />
                </Button>
              </span>
            </div>
          </li>
        ))}
      </AdminRows>
    </AdminPage>
  );
}

function Facts({ lesson, categoryName }: { lesson: LessonSummary; categoryName: string | undefined }) {
  return (
    <AdminRowMeta>
      {lesson.blocks === 0 ? (
        <AdminBadge flagged>empty</AdminBadge>
      ) : (
        <AdminBadge>
          {lesson.blocks} {lesson.blocks === 1 ? 'block' : 'blocks'}
        </AdminBadge>
      )}
      {lesson.quizIds.length > 0 && (
        <AdminBadge>
          <ListChecks className="size-3" aria-hidden="true" /> {lesson.quizIds.length}
        </AdminBadge>
      )}
      {lesson.videos > 0 && (
        <AdminBadge>
          <Play className="size-3" aria-hidden="true" /> {lesson.videos}
        </AdminBadge>
      )}
      {lesson.hasAudio && (
        <AdminBadge>
          <Volume2 className="size-3" aria-label="Has audio" />
        </AdminBadge>
      )}
      {categoryName && <AdminBadge>{categoryName}</AdminBadge>}
      {lesson.level && <AdminBadge>{lesson.level}</AdminBadge>}
    </AdminRowMeta>
  );
}
