// The shelves lessons and grammar topics are filed on.
//
// The same screen as QuizCategoryList — a list you edit in place, because a category is four
// short fields and there will never be many of them — with one thing added: a shelf belongs to
// one of the two sections, so the list is grouped by section and a new one has to say which it
// is joining. That is the whole of what makes "Verbs" as a grammar heading and "Verbs" as a
// lesson heading two different shelves.
//
// Deleting is offered without any check on whether the shelf is empty, and deliberately:
// `lessons.category_id` is `on delete set null`, so the lessons in it come off the shelf and go
// back to being unfiled. Nothing is lost, so nothing has to be warned about.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import type { LessonCategory, LessonSection } from '@georgian/shared/types';
import { LESSON_SECTIONS } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator } from '@/components/ui/page';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KNOW_BUTTON } from '../components/StoryReader';
import { SECTIONS } from '../components/LessonIndex';
import { api } from '../api/client';
import { lang, langName, lessonCategories, lessonSummaries } from '../content/store';
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
  section: LessonSection;
  name: string;
  nameNative: string;
  note: string;
}

const EMPTY: Draft = { section: 'lessons', name: '', nameNative: '', note: '' };

/** "1 lesson", "4 lessons". The "(s)" the other admin screens use reads badly on a count of one. */
function lessons(count: number): string {
  return `${count} ${count === 1 ? 'lesson' : 'lessons'}`;
}

export default function LessonCategoryList() {
  const categories = lessonCategories();
  const all = lessonSummaries();
  const { busy, error, run } = useEdit();

  /** Which row is open: a category id, 'new' for the blank one, or null for none. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirming, setConfirming] = useState<string | null>(null);

  const open = (category: LessonCategory | null, section: LessonSection = 'lessons') => {
    setEditing(category?.id ?? 'new');
    setDraft(
      category
        ? {
            section: category.section,
            name: category.name,
            nameNative: category.nameNative,
            note: category.note,
          }
        : { ...EMPTY, section },
    );
  };

  const save = async (id: string | null) => {
    const result = await run(() =>
      api.admin.saveLessonCategory({
        ...(id ? { id } : {}),
        lang: lang(),
        section: draft.section,
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
    const result = await run(() => api.admin.deleteLessonCategory({ id }));
    if (result) setConfirming(null);
  };

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin">← Admin</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>Lesson categories</span>
      </Breadcrumb>

      <AdminHeadRow>
        <div>
          <AdminTitle>Lesson categories</AdminTitle>
          <AdminSub>
            The headings the two reading indexes group by. A shelf belongs to one section, so the
            same name can exist under both; a lesson sits on one shelf or on none, and one with none
            is listed under “Everything else”.
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
          <Fields draft={draft} setDraft={setDraft} sectionFixed={false} />
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
          None yet. Until there is one, each index is a single list — which is fine for a dozen
          lessons and is what both of them start as.
        </AdminNote>
      )}

      {LESSON_SECTIONS.map(section => {
        const mine = categories.filter(category => category.section === section);
        if (!mine.length) return null;

        return (
          <section key={section} className="mb-7">
            <AdminSectionTitle>{SECTIONS[section].label}</AdminSectionTitle>
            <AdminRows>
              {mine.map(category => (
                <li key={category.id} className="px-4 py-[11px]">
                  {editing === category.id ? (
                    <>
                      {/* The section is fixed once the shelf exists. Moving it while lessons
                          stand on it would leave each of them filed here with a section of
                          their own that no longer matches, so the server refuses it too. */}
                      <Fields draft={draft} setDraft={setDraft} sectionFixed />
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
                        <AdminBadge>{lessons(category.lessonCount)}</AdminBadge>
                        <code className="text-[11px] text-faint">{category.id}</code>
                      </button>

                      {confirming === category.id ? (
                        <span className="flex flex-wrap items-center gap-2.5 text-sm">
                          Delete it? The {lessons(category.lessonCount)} in it stay, unfiled.
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
                  {category.note && editing !== category.id && (
                    <p className="mt-1 text-[13px] text-muted-foreground">{category.note}</p>
                  )}
                </li>
              ))}
            </AdminRows>
          </section>
        );
      })}

      <Unfiled count={all.filter(lesson => !lesson.categoryId).length} any={categories.length > 0} />
    </AdminPage>
  );
}

function Unfiled({ count, any }: { count: number; any: boolean }) {
  if (!count || !any) return null;
  return (
    <AdminNote>
      {lessons(count)} {count === 1 ? 'is' : 'are'} on no shelf, listed under “Everything else” — file{' '}
      {count === 1 ? 'it' : 'them'} from <Link to="/admin/lessons">the lesson list</Link>.
    </AdminNote>
  );
}

function Fields({
  draft,
  setDraft,
  sectionFixed,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  sectionFixed: boolean;
}) {
  return (
    <>
      <AdminGrid>
        <AdminField>
          <AdminLabel>Section</AdminLabel>
          <Select
            value={draft.section}
            onValueChange={value => setDraft({ ...draft, section: value as LessonSection })}
            disabled={sectionFixed}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LESSON_SECTIONS.map(section => (
                <SelectItem key={section} value={section}>
                  {SECTIONS[section].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AdminHint>
            {sectionFixed
              ? 'Fixed once the shelf exists — move its lessons off it first.'
              : 'Which of the two indexes lists this shelf.'}
          </AdminHint>
        </AdminField>

        <AdminField>
          <AdminLabel>Name</AdminLabel>
          <AdminInput
            value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })}
            placeholder="Writing & sounds"
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
