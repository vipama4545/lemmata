// A story: what is true of the whole of it, and the chapters it is made of.
//
// The prose is not on this screen any more. A story is a container now — a title, a level, a
// shelf — and the text belongs to its chapters, which are added one at a time on the screen
// next door. What is left here is the cover and the table of contents.
//
// The one exception is creating a story, which still takes prose in one go. A story of a
// single chapter is the ordinary case, and making it two screens to save one optional field
// would be charging every short story for a feature only a book uses.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import type { StoryChapterSummary } from '@georgian/shared/types';
import { ArrowDown, ArrowUp, Check, Eye, Pencil, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { forgetStory, replaceStory } from '../data/stories';
import { chapterHref } from '../utils/story';
import { api } from '../api/client';
import { lang, langName, publishedStories, storyCategories } from '../content/store';
import {
  ADMIN_INPUT_GEO,
  AdminActions,
  AdminBadge,
  AdminCount,
  AdminError,
  AdminField,
  AdminGrid,
  AdminHead,
  AdminHint,
  AdminInput,
  AdminLabel,
  AdminNote,
  AdminPage,
  AdminRowEn,
  AdminRowGeo,
  AdminRowMeta,
  AdminRows,
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTextarea,
  AdminTitle,
  AdminWarning,
} from './ui';
import { useEdit } from './useAdmin';
import { LinkReport } from './LinkReport';

/**
 * What to put in an empty textarea, per language.
 *
 * The placeholder is doing more work than a placeholder usually does: it is the only place
 * the shape of the input is *shown* rather than described, and "first line is the title,
 * blank line, then the prose" reads much faster as two lines of a story than as a sentence
 * about them.
 */
const PLACEHOLDER: Record<Lang, { text: string; translation: string }> = {
  ka: { text: 'სამი გოჭი\n\nიყო და არა იყო რა…', translation: 'The Three Little Pigs\n\nOnce upon a time…' },
  ru: { text: 'Колобо́к\n\nЖил-был стари́к со стару́хой…', translation: 'The Little Round Bun\n\nOnce upon a time…' },
};

/** The value the category picker uses for "not on any shelf". A Select cannot hold null. */
const UNFILED = '__none__';

interface Draft {
  title: string;
  titleEnglish: string;
  level: string;
  source: string;
  note: string;
  categoryId: string;
  text: string;
  translation: string;
}

function StoryEditor() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useEdit();

  // Read straight out of the snapshot on every render rather than memoised on `storyId`.
  // The chapter list below is edited *in place* — reordered, deleted — and each of those
  // bumps the content version, which `useEdit` re-fetches and `App`'s `useContent` repaints
  // from. A memo keyed on the id alone would survive all of that and keep showing the
  // chapter order from before the click.
  const summary = publishedStories().find(story => story.id === storyId) ?? null;
  const categories = storyCategories();

  const [draft, setDraft] = useState<Draft>({
    title: summary?.title ?? '',
    titleEnglish: summary?.titleEnglish ?? '',
    level: summary?.level ?? '',
    source: summary?.source ?? '',
    note: summary?.note ?? '',
    categoryId: summary?.categoryId ?? '',
    text: '',
    translation: '',
  });
  const [report, setReport] = useState<StoryLinkResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (storyId && !summary) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to="/admin/stories">← Stories</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is no story with the id “{storyId}”.</p>
      </Page>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  const save = async () => {
    const result = await run(() =>
      api.admin.saveStory({
        ...(storyId ? { id: storyId } : {}),
        lang: lang(),
        title: draft.title.trim(),
        titleEnglish: draft.titleEnglish.trim(),
        level: draft.level.trim(),
        source: draft.source.trim(),
        note: draft.note.trim(),
        categoryId: draft.categoryId || null,
        // Only ever sent on the way in. Editing an existing story's prose is a chapter's
        // business, and the server refuses this field rather than ignoring it.
        text: storyId ? '' : draft.text,
        translation: storyId ? '' : draft.translation,
      }),
    );

    if (result) {
      setReport(result.report);
      // The title and the level are on the story the reader fetched, not only on its summary in
      // the snapshot, so its cached copy has to go for a rename to show up there.
      if (storyId) forgetStory(storyId);
      if (!storyId) navigate(`/admin/stories/${encodeURIComponent(result.id)}`, { replace: true });
    }
  };

  const relink = async () => {
    if (!storyId) return;
    const result = await run(() => api.admin.relinkStory({ id: storyId }));
    if (result) {
      setReport(result);
      // Every chapter was re-resolved, so every one the reader has cached is stale.
      replaceStory(result.story);
    }
  };

  const remove = async () => {
    if (!storyId) return;
    const result = await run(() => api.admin.deleteStory({ id: storyId }));
    if (result) {
      forgetStory(storyId);
      navigate('/admin/stories', { replace: true });
    }
  };

  // Both renumber what the reader has cached under this story, so the cache is dropped after
  // either of them.
  const moveChapter = (position: number, direction: 'up' | 'down') => {
    if (!storyId) return;
    void run(() => api.admin.moveChapter({ storyId, position, direction })).then(() => forgetStory(storyId));
  };

  const removeChapter = (position: number) => {
    if (!storyId) return;
    void run(() => api.admin.deleteChapter({ storyId, position })).then(() => forgetStory(storyId));
  };

  const paragraphCount = draft.text.split('\n').map(line => line.trim()).filter(line => line && line !== '-').length - 1;
  const translationCount =
    draft.translation.trim() === ''
      ? 0
      : draft.translation.split('\n').map(line => line.trim()).filter(line => line && line !== '-').length - 1;
  const mismatched = translationCount > 0 && translationCount !== paragraphCount;

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin/stories">← Stories</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{summary ? summary.titleEnglish || summary.title : 'New story'}</span>
      </Breadcrumb>

      <AdminHead>
        <AdminTitle>{summary ? summary.title : 'New story'}</AdminTitle>
        {summary && (
          <AdminSub>
            <code>{summary.id}</code> · {summary.chapters.length} chapter(s) · {summary.stats.tokens} words ·{' '}
            {summary.stats.coverage}% linked · {summary.stats.names} name(s)
          </AdminSub>
        )}
      </AdminHead>

      {error && <AdminError>{error}</AdminError>}

      <AdminSection>
        <AdminSectionTitle>About it</AdminSectionTitle>
        <AdminGrid>
          <AdminField>
            <AdminLabel>{langName()} title</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_GEO}
              value={draft.title}
              onChange={event => set('title', event.target.value)}
              placeholder={storyId ? '' : 'Taken from the first line of the text'}
            />
          </AdminField>

          <AdminField>
            <AdminLabel>English title</AdminLabel>
            <AdminInput
              value={draft.titleEnglish}
              onChange={event => set('titleEnglish', event.target.value)}
              placeholder="The Three Little Pigs"
            />
            <AdminHint>A new story’s id is slugged from this.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Level</AdminLabel>
            <AdminInput
              value={draft.level}
              onChange={event => set('level', event.target.value)}
              placeholder="A2"
            />
            <AdminHint>Free text: a story is not confined to the A1/A2 word list.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Category</AdminLabel>
            <Select
              value={draft.categoryId || UNFILED}
              onValueChange={value => set('categoryId', value === UNFILED ? '' : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNFILED}>No category</SelectItem>
                {categories.map(category => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                    {category.nameNative ? ` · ${category.nameNative}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AdminHint>
              {categories.length === 0 ? (
                <>
                  There are none yet. <Link to="/admin/story-categories">Make one</Link>.
                </>
              ) : (
                <>
                  The heading it is listed under.{' '}
                  <Link to="/admin/story-categories">Manage categories</Link>.
                </>
              )}
            </AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Source</AdminLabel>
            <AdminInput value={draft.source} onChange={event => set('source', event.target.value)} />
          </AdminField>
        </AdminGrid>

        <AdminField>
          <AdminLabel>Note</AdminLabel>
          <AdminTextarea rows={2} value={draft.note} onChange={event => set('note', event.target.value)} />
        </AdminField>
      </AdminSection>

      {/* The prose box exists only before the story does. Once it has an id, its text lives
          in chapters, and the section below replaces this one. */}
      {!storyId && (
        <AdminSection>
          <AdminSectionTitle>The first chapter</AdminSectionTitle>
          <AdminNote>
            First line is the title, blank lines separate paragraphs, a lone “-” is a rule and is dropped.
            A translation must have one paragraph per {langName()} paragraph, because the side-by-side view
            pairs them by position. Leave this empty to create the story now and upload its chapters after.
          </AdminNote>

          <AdminGrid className="mb-0 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
            <AdminField>
              <AdminLabel>
                {langName()} <AdminCount>{Math.max(paragraphCount, 0)} paragraph(s)</AdminCount>
              </AdminLabel>
              <AdminTextarea
                className={cn(TALL, ADMIN_INPUT_GEO)}
                rows={16}
                value={draft.text}
                onChange={event => set('text', event.target.value)}
                placeholder={PLACEHOLDER[lang()].text}
              />
            </AdminField>

            <AdminField>
              <AdminLabel>
                English{' '}
                <AdminCount wrong={mismatched}>
                  {translationCount > 0 ? `${translationCount} paragraph(s)` : 'optional'}
                </AdminCount>
              </AdminLabel>
              <AdminTextarea
                className={TALL}
                rows={16}
                value={draft.translation}
                onChange={event => set('translation', event.target.value)}
                placeholder={PLACEHOLDER[lang()].translation}
              />
            </AdminField>
          </AdminGrid>

          {mismatched && (
            <AdminWarning>
              The translation has {translationCount} paragraph(s) and the {langName()} has {paragraphCount}.
              The side-by-side view pairs them by position, so they would drift out of step.
            </AdminWarning>
          )}
        </AdminSection>
      )}

      <AdminActions>
        <Button variant="control" size="auto" className={KNOW_BUTTON} disabled={busy} onClick={save}>
          <Check /> {busy ? 'Saving…' : storyId ? 'Save' : 'Create'}
        </Button>

        {storyId && (
          <>
            <Button variant="control" size="auto" disabled={busy} onClick={relink}>
              <RotateCcw /> Relink every chapter
            </Button>
            <Button variant="control" size="auto" asChild>
              <Link to={chapterHref(storyId, 0)}>
                <Eye /> Open the reader
              </Link>
            </Button>
          </>
        )}

        {storyId && !confirmDelete && (
          <Button variant="dangerOutline" size="auto" disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        {storyId && confirmDelete && (
          <span className="flex flex-wrap items-center gap-2.5 text-sm">
            Delete this story, every chapter and every link in it?
            <Button variant="dangerOutline" size="auto" disabled={busy} onClick={remove}>
              Yes, delete
            </Button>
            <Button variant="control" size="auto" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        )}
      </AdminActions>

      {storyId && summary && (
        <ChapterList
          storyId={storyId}
          chapters={summary.chapters}
          busy={busy}
          onMove={moveChapter}
          onDelete={removeChapter}
        />
      )}

      {report && <LinkReport result={report} />}
    </AdminPage>
  );
}

/** Room for a whole chapter without the textarea having to be dragged open first. */
const TALL = 'min-h-80 text-[15px] md:text-[15px]';

/**
 * The table of contents, and where chapters are added, reordered and removed.
 *
 * Reordering is a step at a time rather than a drag: the list is short, a step is
 * unambiguous on a touch screen, and each one is a request that either worked or did not.
 */
function ChapterList({
  storyId,
  chapters,
  busy,
  onMove,
  onDelete,
}: {
  storyId: string;
  chapters: StoryChapterSummary[];
  busy: boolean;
  onMove: (position: number, direction: 'up' | 'down') => void;
  onDelete: (position: number) => void;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);

  return (
    <AdminSection>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <AdminSectionTitle className="mb-0">Chapters</AdminSectionTitle>
        <Button variant="control" size="auto" className={KNOW_BUTTON} asChild>
          <Link to={`/admin/stories/${encodeURIComponent(storyId)}/chapters/new`}>
            <Plus /> Add a chapter
          </Link>
        </Button>
      </div>

      {chapters.length === 0 ? (
        <AdminNote>
          No chapters yet. A story with none has nothing to read — paste the first one in.
        </AdminNote>
      ) : (
        <AdminRows>
          {chapters.map((chapter, index) => (
            <li key={chapter.position} className="flex flex-wrap items-center gap-3 px-4 py-[11px]">
              <span className="w-6 shrink-0 text-sm font-semibold text-faint tabular-nums">
                {chapter.position + 1}
              </span>

              <Link
                to={`/admin/stories/${encodeURIComponent(storyId)}/chapters/${chapter.position}`}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-3 hover:underline"
              >
                <AdminRowGeo>{chapter.title || <span className="text-faint">Untitled</span>}</AdminRowGeo>
                <AdminRowEn>{chapter.titleEnglish}</AdminRowEn>
                <AdminRowMeta>
                  <AdminBadge>{chapter.paragraphs} paragraph(s)</AdminBadge>
                  <AdminBadge>{chapter.stats.tokens} words</AdminBadge>
                  <AdminBadge flagged={chapter.stats.coverage < 90}>
                    {chapter.stats.coverage}% linked
                  </AdminBadge>
                  {chapter.translated && <AdminBadge>translated</AdminBadge>}
                </AdminRowMeta>
              </Link>

              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="control"
                  size="auto-sm"
                  aria-label="Move up"
                  disabled={busy || index === 0}
                  onClick={() => onMove(chapter.position, 'up')}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="control"
                  size="auto-sm"
                  aria-label="Move down"
                  disabled={busy || index === chapters.length - 1}
                  onClick={() => onMove(chapter.position, 'down')}
                >
                  <ArrowDown />
                </Button>
                <Button variant="control" size="auto-sm" asChild>
                  <Link
                    to={`/admin/stories/${encodeURIComponent(storyId)}/chapters/${chapter.position}`}
                    aria-label="Edit"
                  >
                    <Pencil />
                  </Link>
                </Button>
                {confirming === chapter.position ? (
                  <>
                    <Button
                      variant="dangerOutline"
                      size="auto-sm"
                      disabled={busy}
                      onClick={() => {
                        onDelete(chapter.position);
                        setConfirming(null);
                      }}
                    >
                      Delete it
                    </Button>
                    <Button variant="control" size="auto-sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="dangerOutline"
                    size="auto-sm"
                    disabled={busy}
                    onClick={() => setConfirming(chapter.position)}
                  >
                    Delete
                  </Button>
                )}
              </span>
            </li>
          ))}
        </AdminRows>
      )}
    </AdminSection>
  );
}

export default StoryEditor;
