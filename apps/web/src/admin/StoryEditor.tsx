// Adding and editing a story, and the report of how well it linked itself.
//
// Pasting prose in is the whole of adding a story. The server tokenises it and resolves every
// word against the lexicon — around 95% of them, on the evidence of the one story here — and
// what comes back is the list of what it could not do: the spellings nothing matched, and the
// links it reached by a guess. Those two lists are the work, and they are the point of this
// screen. Everything left over is either a word the dictionary is missing or a proper noun,
// and the second is fixed in the reader itself, on the word, where you can see the sentence.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import { Check, Eye, RotateCcw, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { api } from '../api/client';
import { lang, langName, storySummaries } from '../content/store';
import {
  ADMIN_INPUT_GEO,
  AdminActions,
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
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTextarea,
  AdminTitle,
  AdminWarning,
} from './ui';
import { useEdit } from './useAdmin';

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

interface Draft {
  title: string;
  titleEnglish: string;
  level: string;
  source: string;
  note: string;
  text: string;
  translation: string;
}

function StoryEditor() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useEdit();

  const summary = useMemo(
    () => storySummaries().find(story => story.id === storyId) ?? null,
    [storyId],
  );

  const [draft, setDraft] = useState<Draft>({
    title: summary?.title ?? '',
    titleEnglish: summary?.titleEnglish ?? '',
    level: summary?.level ?? '',
    source: summary?.source ?? '',
    note: summary?.note ?? '',
    text: '',
    translation: '',
  });
  const [loadedText, setLoadedText] = useState(!storyId);
  const [report, setReport] = useState<StoryLinkResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The prose is not in the snapshot — only the summary is — so editing an existing story
  // needs the one extra fetch that the reader makes too.
  const loadText = async () => {
    if (!storyId) return;
    const story = await api.content.story({ id: storyId });
    if (!story) return;
    setDraft(current => ({
      ...current,
      text: [story.title, ...story.paragraphs].join('\n\n'),
      translation: story.translation.length ? [story.titleEnglish || story.title, ...story.translation].join('\n\n') : '',
    }));
    setLoadedText(true);
  };

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
        text: draft.text,
        translation: draft.translation,
      }),
    );

    if (result) {
      setReport(result);
      if (!storyId) navigate(`/admin/stories/${encodeURIComponent(result.story.id)}`, { replace: true });
    }
  };

  const relink = async () => {
    if (!storyId) return;
    const result = await run(() => api.admin.relinkStory({ id: storyId }));
    if (result) setReport(result);
  };

  const remove = async () => {
    if (!storyId) return;
    const result = await run(() => api.admin.deleteStory({ id: storyId }));
    if (result) navigate('/admin/stories', { replace: true });
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
            <code>{summary.id}</code> · {summary.stats.tokens} words · {summary.stats.coverage}% linked ·{' '}
            {summary.stats.names} name(s)
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
              placeholder="Taken from the first line of the text"
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
            <AdminLabel>Source</AdminLabel>
            <AdminInput value={draft.source} onChange={event => set('source', event.target.value)} />
          </AdminField>
        </AdminGrid>

        <AdminField>
          <AdminLabel>Note</AdminLabel>
          <AdminTextarea rows={2} value={draft.note} onChange={event => set('note', event.target.value)} />
        </AdminField>
      </AdminSection>

      <AdminSection>
        <AdminSectionTitle>The text</AdminSectionTitle>
        <AdminNote>
          First line is the title, blank lines separate paragraphs, a lone “-” is a rule and is dropped —
          the same reading a <code>.txt</code> under <code>data/{lang()}/stories/</code> has always had. A
          translation must have one paragraph per {langName()} paragraph, because the side-by-side view pairs
          them by position.
        </AdminNote>

        {storyId && !loadedText ? (
          <Button variant="control" size="auto" onClick={loadText}>
            <Type /> Load the text to edit it
          </Button>
        ) : (
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
        )}

        {mismatched && (
          <AdminWarning>
            The translation has {translationCount} paragraph(s) and the {langName()} has {paragraphCount}. The
            side-by-side view pairs them by position, so they would drift out of step.
          </AdminWarning>
        )}
      </AdminSection>

      <AdminActions>
        <Button
          variant="control"
          size="auto"
          className={KNOW_BUTTON}
          disabled={busy || draft.text.trim() === '' || (Boolean(storyId) && !loadedText)}
          onClick={save}
        >
          <Check /> {busy ? 'Linking…' : storyId ? 'Save and relink' : 'Create and link'}
        </Button>

        {storyId && (
          <>
            <Button variant="control" size="auto" disabled={busy} onClick={relink}>
              <RotateCcw /> Relink from the lexicon
            </Button>
            <Button variant="control" size="auto" asChild>
              <Link to={`/stories/${encodeURIComponent(storyId)}`}>
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
            Delete this story and every link in it?
            <Button variant="dangerOutline" size="auto" disabled={busy} onClick={remove}>
              Yes, delete
            </Button>
            <Button variant="control" size="auto" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        )}
      </AdminActions>

      {report && <LinkReport result={report} />}
    </AdminPage>
  );
}

/** Room for a whole story without the textarea having to be dragged open first. */
const TALL = 'min-h-80 text-[15px] md:text-[15px]';

/**
 * What linking managed, and what it did not.
 *
 * Two lists, and they call for different things. An unresolved spelling is usually a word the
 * dictionary does not have — or a proper noun, which is not a dictionary word and never will
 * be. A flagged one did resolve, by a guess, and wants a read-through. Both are fixed on the
 * word itself in the reader, which is where the sentence is.
 */
function LinkReport({ result }: { result: StoryLinkResult }) {
  const { story, unresolved, flagged } = result;

  return (
    <AdminSection>
      <AdminSectionTitle>How it linked</AdminSectionTitle>

      <div className="mb-4 flex flex-wrap gap-[18px]">
        <Stat value={`${story.stats.coverage}%`}>linked</Stat>
        <Stat value={story.stats.tokens}>words</Stat>
        <Stat value={story.stats.distinctForms}>spellings</Stat>
        <Stat value={story.stats.names}>names</Stat>
        <Stat value={story.stats.unresolved}>unresolved</Stat>
        <Stat value={story.stats.flagged}>guessed</Stat>
      </div>

      <AdminNote>
        Fix these in the reader, on the word itself — <Link to={`/stories/${encodeURIComponent(story.id)}`}>open it</Link>{' '}
        and turn on Edit links. A proper noun is named there and stays out of the dictionary; a missing word
        is added to the lexicon and every story that uses it picks it up on the next relink.
      </AdminNote>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
        <TagList title="Nothing matched" items={unresolved} empty="Every word resolved." />
        <TagList title="Reached by a guess" items={flagged} empty="Nothing was guessed." flagged />
      </div>
    </AdminSection>
  );
}

function Stat({ value, children }: { value: number | string; children: React.ReactNode }) {
  return (
    <span className="text-[13px] text-muted-foreground">
      <strong className="block text-xl text-foreground">{value}</strong>
      {children}
    </span>
  );
}

/** One of the two lists of spellings, capped so a badly linked story does not fill the page. */
function TagList({
  title,
  items,
  empty,
  flagged = false,
}: {
  title: string;
  items: { form: string; count: number }[];
  empty: string;
  flagged?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-bold">
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <AdminHint>{empty}</AdminHint>
      ) : (
        <ul className="flex list-none flex-wrap gap-1.5">
          {items.slice(0, 60).map(item => (
            <li
              key={item.form}
              className={cn(
                'flex items-baseline gap-[5px] rounded-full px-[9px] py-[3px] text-sm',
                flagged ? 'bg-[color-mix(in_srgb,var(--m-3)_20%,transparent)]' : 'bg-muted',
              )}
            >
              <span className="text-base">{item.form}</span>
              {item.count > 1 && <span className="text-[11px] text-faint">{item.count}</span>}
            </li>
          ))}
          {items.length > 60 && <AdminHint>…and {items.length - 60} more</AdminHint>}
        </ul>
      )}
    </div>
  );
}

export default StoryEditor;
