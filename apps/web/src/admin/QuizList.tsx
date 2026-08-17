// Every quiz, including the ones with nothing in them yet.
//
// That last part is the difference between this list and the reader's index, and it is the whole
// of what stands in for a draft flag. There is no `published` column — see the note on the
// `quizzes` table — so a quiz becomes visible to readers by having questions in it. This screen
// shows the empty ones and says so, because here they are a thing you are half-way through
// writing rather than a thing with nothing to answer.
//
// Read out of the snapshot, like every other admin list: the quizzes are already in this browser
// and filtering them as you type costs nothing. Only the writes go over the wire.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Volume2 } from 'lucide-react';
import type { QuizKind } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator } from '@/components/ui/page';
import { SearchField } from '@/components/ui/search-field';
import { KNOW_BUTTON } from '../components/StoryReader';
import { quizCategories, quizSummaries } from '../content/store';
import {
  ADMIN_ROW_LINK,
  ADMIN_ROW_LINK_HOVER,
  AdminBadge,
  AdminCountLine,
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

/** What each kind is called on a badge. The runner's word for it, not the column's. */
const KIND_LABELS: Record<QuizKind, string> = {
  choice: 'choose',
  order: 'order',
  type: 'type',
};

export default function QuizList() {
  const quizzes = quizSummaries();
  const categories = quizCategories();
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return quizzes;
    return quizzes.filter(
      quiz =>
        quiz.title.toLowerCase().includes(needle) ||
        quiz.titleNative.includes(needle) ||
        quiz.description.toLowerCase().includes(needle),
    );
  }, [quizzes, search]);

  const empty = quizzes.filter(quiz => quiz.questionCount === 0).length;
  const names = new Map(categories.map(category => [category.id, category.name]));

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin">← Admin</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Quizzes</span>
      </Breadcrumb>

      <AdminHeadRow>
        <div>
          <AdminTitle>Quizzes</AdminTitle>
          <AdminSub>
            A quiz is offered to readers as soon as it has a question in it. There is no separate
            “publish” — an empty one is simply not listed, which is what makes writing one over
            several sittings safe.
          </AdminSub>
        </div>
        <Button asChild variant="control" size="auto" className={KNOW_BUTTON}>
          <Link to="/admin/quizzes/new">
            <Plus /> New quiz
          </Link>
        </Button>
      </AdminHeadRow>

      <SearchField placeholder="Search quizzes…" value={search} onChange={event => setSearch(event.target.value)} />

      <AdminCountLine>
        {shown.length} of {quizzes.length}
        {empty > 0 && ` · ${empty} with no questions yet`}
      </AdminCountLine>

      {quizzes.length === 0 && (
        <AdminNote>
          None yet. A quiz is a title and a list of questions; the questions can be a choice of
          options, words to put in order, or a form to type — and any of them can be something to
          listen to rather than read.
        </AdminNote>
      )}

      <AdminRows>
        {shown.map(quiz => (
          <li key={quiz.id}>
            <Link to={`/admin/quizzes/${encodeURIComponent(quiz.id)}`} className={`${ADMIN_ROW_LINK} ${ADMIN_ROW_LINK_HOVER}`}>
              <AdminRowGeo>{quiz.title}</AdminRowGeo>
              <AdminRowEn>{quiz.titleNative || quiz.description}</AdminRowEn>
              <AdminRowMeta>
                {quiz.questionCount === 0 ? (
                  <AdminBadge flagged>no questions</AdminBadge>
                ) : (
                  <AdminBadge>
                    {quiz.questionCount} {quiz.questionCount === 1 ? 'question' : 'questions'}
                  </AdminBadge>
                )}
                {quiz.kinds.map(kind => (
                  <AdminBadge key={kind}>{KIND_LABELS[kind]}</AdminBadge>
                ))}
                {quiz.hasAudio && (
                  <AdminBadge>
                    <Volume2 className="size-3" aria-label="Has audio" />
                  </AdminBadge>
                )}
                {quiz.categoryId && <AdminBadge>{names.get(quiz.categoryId) ?? quiz.categoryId}</AdminBadge>}
                {quiz.level && <AdminBadge>{quiz.level}</AdminBadge>}
              </AdminRowMeta>
            </Link>
          </li>
        ))}
      </AdminRows>
    </AdminPage>
  );
}
