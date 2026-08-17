// The shelves quizzes are filed on.
//
// The same screen as StoryCategoryList, for the same reason it is one screen rather than a list
// plus an editor: a category is three short fields and there will never be many of them. Adding
// one is a row at the top of the list; editing one is typing in the row it already occupies.
//
// Deleting is offered without any check on whether the shelf is empty, and deliberately:
// `quizzes.category_id` is `on delete set null`, so the quizzes in it come off the shelf and go
// back to being unfiled. Nothing is lost, so nothing has to be warned about.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import type { QuizCategory } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator } from '@/components/ui/page';
import { KNOW_BUTTON } from '../components/StoryReader';
import { api } from '../api/client';
import { lang, langName, quizCategories, quizSummaries } from '../content/store';
import {
  ADMIN_INPUT_GEO,
  AdminActions,
  AdminBadge,
  AdminError,
  AdminField,
  AdminGrid,
  AdminHeadRow,
  AdminHint,
  AdminInput,
  AdminLabel,
  AdminNote,
  AdminPage,
  AdminRows,
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTextarea,
  AdminTitle,
} from './ui';
import { useEdit } from './useAdmin';

interface Draft {
  name: string;
  nameNative: string;
  note: string;
}

const EMPTY: Draft = { name: '', nameNative: '', note: '' };

/** "1 quiz", "4 quizzes". The "(s)" the other admin screens use reads badly on a count of one. */
function quizzes(count: number): string {
  return `${count} ${count === 1 ? 'quiz' : 'quizzes'}`;
}

export default function QuizCategoryList() {
  const categories = quizCategories();
  const all = quizSummaries();
  const { busy, error, run } = useEdit();

  /** Which row is open: a category id, 'new' for the blank one, or null for none. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirming, setConfirming] = useState<string | null>(null);

  const unfiled = all.filter(quiz => !quiz.categoryId).length;

  const open = (category: QuizCategory | null) => {
    setEditing(category?.id ?? 'new');
    setDraft(category ? { name: category.name, nameNative: category.nameNative, note: category.note } : EMPTY);
  };

  const save = async (id: string | null) => {
    const result = await run(() =>
      api.admin.saveQuizCategory({
        ...(id ? { id } : {}),
        lang: lang(),
        name: draft.name.trim(),
        nameNative: draft.nameNative.trim(),
        note: draft.note.trim(),
      }),
    );
    if (result) {
      setEditing(null);
      setDraft(EMPTY);
    }
  };

  const remove = async (id: string) => {
    const result = await run(() => api.admin.deleteQuizCategory({ id }));
    if (result) setConfirming(null);
  };

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin">← Admin</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Quiz categories</span>
      </Breadcrumb>

      <AdminHeadRow>
        <div>
          <AdminTitle>Quiz categories</AdminTitle>
          <AdminSub>
            The headings the quiz index groups by. A quiz sits on one shelf or on none, and one with
            none is listed under “Everything else”.
          </AdminSub>
        </div>
        {editing !== 'new' && (
          <Button variant="control" size="auto" className={KNOW_BUTTON} onClick={() => open(null)}>
            <Plus /> New category
          </Button>
        )}
      </AdminHeadRow>

      {error && <AdminError>{error}</AdminError>}

      {editing === 'new' && (
        <AdminSection>
          <AdminSectionTitle>A new category</AdminSectionTitle>
          <Fields draft={draft} setDraft={setDraft} />
          <AdminActions>
            <Button
              variant="control"
              size="auto"
              className={KNOW_BUTTON}
              disabled={busy || draft.name.trim() === ''}
              onClick={() => save(null)}
            >
              <Check /> {busy ? 'Saving…' : 'Create'}
            </Button>
            <Button variant="control" size="auto" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </AdminActions>
        </AdminSection>
      )}

      {categories.length === 0 && editing !== 'new' && (
        <AdminNote>
          None yet. Until there is one, the quiz index is a single list — which is fine for a dozen
          quizzes and is what it has always been.
        </AdminNote>
      )}

      <AdminRows>
        {categories.map(category => (
          <li key={category.id} className="px-4 py-[11px]">
            {editing === category.id ? (
              <>
                <Fields draft={draft} setDraft={setDraft} />
                <AdminActions>
                  <Button
                    variant="control"
                    size="auto"
                    className={KNOW_BUTTON}
                    disabled={busy || draft.name.trim() === ''}
                    onClick={() => save(category.id)}
                  >
                    <Check /> {busy ? 'Saving…' : 'Save'}
                  </Button>
                  <Button variant="control" size="auto" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </AdminActions>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-wrap items-baseline gap-3 text-left hover:underline"
                  onClick={() => open(category)}
                >
                  <span className="text-[15px] font-semibold">{category.name}</span>
                  {category.nameNative && (
                    <span className="text-base text-muted-foreground">{category.nameNative}</span>
                  )}
                  <AdminBadge>{quizzes(category.quizCount)}</AdminBadge>
                  <code className="text-[11px] text-faint">{category.id}</code>
                </button>

                {confirming === category.id ? (
                  <span className="flex flex-wrap items-center gap-2.5 text-sm">
                    Delete it? The {quizzes(category.quizCount)} in it stay, unfiled.
                    <Button
                      variant="dangerOutline"
                      size="auto-sm"
                      disabled={busy}
                      onClick={() => remove(category.id)}
                    >
                      Yes, delete
                    </Button>
                    <Button variant="control" size="auto-sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="dangerOutline"
                    size="auto-sm"
                    disabled={busy}
                    onClick={() => setConfirming(category.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}
            {category.note && !editing && (
              <p className="mt-1 text-[13px] text-muted-foreground">{category.note}</p>
            )}
          </li>
        ))}
      </AdminRows>

      {unfiled > 0 && categories.length > 0 && (
        <AdminNote>
          {quizzes(unfiled)} {unfiled === 1 ? 'is' : 'are'} on no shelf, listed under “Everything else” —
          file {unfiled === 1 ? 'it' : 'them'} from <Link to="/admin/quizzes">the quiz list</Link>.
        </AdminNote>
      )}
    </AdminPage>
  );
}

function Fields({ draft, setDraft }: { draft: Draft; setDraft: (next: Draft) => void }) {
  return (
    <>
      <AdminGrid>
        <AdminField>
          <AdminLabel>Name</AdminLabel>
          <AdminInput
            value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })}
            placeholder="Listening"
          />
          <AdminHint>A new category’s id is slugged from this.</AdminHint>
        </AdminField>

        <AdminField>
          <AdminLabel>{langName()} name</AdminLabel>
          <AdminInput
            className={ADMIN_INPUT_GEO}
            value={draft.nameNative}
            onChange={event => setDraft({ ...draft, nameNative: event.target.value })}
            placeholder="Optional"
          />
        </AdminField>
      </AdminGrid>

      <AdminField>
        <AdminLabel>Note</AdminLabel>
        <AdminTextarea
          rows={2}
          value={draft.note}
          onChange={event => setDraft({ ...draft, note: event.target.value })}
        />
      </AdminField>
    </>
  );
}
