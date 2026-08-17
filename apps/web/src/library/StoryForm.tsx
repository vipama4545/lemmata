// A story of your own: what is true of the whole of it, and the chapters it is made of.
//
// The same division the admin editor makes, and for the same reason: the prose belongs to a
// chapter, and a story is the cover and the table of contents. There is one exception. Creating
// one takes the text in the same breath, because almost all of these are a single chapter, and
// making it two screens would charge every pasted news article for a feature only a book uses.
//
// What is deliberately not on this screen is a shelf. The shelves are the dictionary's, and a
// private story is never filed on one; see the note on `stories.owner_id`.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import type { StoryChapterSummary } from '@georgian/shared/types';
import { ArrowDown, ArrowUp, Check, Eye, Pencil, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '../api/client';
import { LinkReport } from '../admin/LinkReport';
import { lang, langName, myStories } from '../content/store';
import { forgetStory, replaceStory } from '../data/stories';
import { chapterHref } from '../utils/story';
import { useLibraryEdit, useSignedIn } from './store';
import {
  Actions,
  Badge,
  Count,
  ErrorLine,
  Field,
  Grid,
  Head,
  Hint,
  INPUT_TARGET,
  Input,
  Label,
  LibraryCrumb,
  Note,
  Rows,
  RowEn,
  RowMeta,
  RowTarget,
  Section,
  SectionTitle,
  SignInFirst,
  Sub,
  Textarea,
  Title,
  Warning,
  EditorPage,
  libraryHref,
} from './ui';

/**
 * What to put in an empty textarea, per language.
 *
 * The placeholder is doing more work than a placeholder usually does: it is the only place the
 * shape of the input is *shown* rather than described, and "first line is the title, blank
 * line, then the prose" reads much faster as two lines of a story than as a sentence about them.
 */
const PLACEHOLDER: Record<Lang, { text: string; translation: string }> = {
  ka: { text: 'ჩემი დღე\n\nდილით ადრე ავდექი…', translation: 'My day\n\nI got up early…' },
  ru: { text: 'Мой день\n\nЯ встал ра́но у́тром…', translation: 'My day\n\nI got up early…' },
};

/** Room for a whole chapter without the textarea having to be dragged open first. */
const TALL = 'min-h-80 text-[15px] md:text-[15px]';

interface Draft {
  title: string;
  titleEnglish: string;
  level: string;
  source: string;
  note: string;
  text: string;
  translation: string;
}

export default function StoryForm() {
  const signedIn = useSignedIn();
  const { storyId } = useParams<{ storyId: string }>();
  if (!signedIn) return <SignInFirst what="stories of your own" />;

  // Keyed for the reason the word form is: the route pattern is the same for every story, so
  // moving between two of them would otherwise keep the first one's draft in the boxes.
  return <Form key={storyId ?? 'new'} />;
}

function Form() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useLibraryEdit();

  // Read out of the overlay on every render rather than memoised on the id: the chapter list
  // below is edited in place, and every one of those edits swaps a new overlay in.
  const story = myStories().find(entry => entry.id === storyId) ?? null;

  const [draft, setDraft] = useState<Draft>({
    title: story?.title ?? '',
    titleEnglish: story?.titleEnglish ?? '',
    level: story?.level ?? '',
    source: story?.source ?? '',
    note: story?.note ?? '',
    text: '',
    translation: '',
  });
  const [report, setReport] = useState<StoryLinkResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (storyId && !story) {
    return (
      <EditorPage>
        <LibraryCrumb />
        <p className="py-6 text-center text-muted-foreground">
          There is no story of yours with that address.
        </p>
      </EditorPage>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const save = async () => {
    const result = await run(() =>
      api.library.saveStory({
        ...(storyId ? { id: storyId } : {}),
        lang: lang(),
        title: draft.title.trim(),
        titleEnglish: draft.titleEnglish.trim(),
        level: draft.level.trim(),
        source: draft.source.trim(),
        note: draft.note.trim(),
        // Only ever sent on the way in. Editing an existing story's prose is a chapter's
        // business, and the server refuses this field rather than ignoring it.
        text: storyId ? '' : draft.text,
        translation: storyId ? '' : draft.translation,
      }),
    );

    if (result) {
      setReport(result.report);
      // The title and the level are on the story the reader fetched, not only on the summary in
      // the overlay, so its cached copy has to go for a rename to show up there.
      if (storyId) forgetStory(storyId);
      if (!storyId) navigate(libraryHref(`/stories/${encodeURIComponent(result.id)}`), { replace: true });
    }
  };

  const relink = async () => {
    if (!storyId) return;
    const result = await run(() => api.library.relinkStory({ id: storyId }));
    if (result) {
      setReport(result.result);
      // Every chapter was re-resolved, so every cached one is stale. The answer carries chapter
      // one, which goes back in; the rest are dropped by the same call.
      replaceStory(result.result.story);
    }
  };

  const remove = async () => {
    if (!storyId) return;
    const done = await run(() => api.library.deleteStory({ id: storyId }));
    if (done) {
      // Or the reader would go on serving a deleted story out of its cache for the rest of the
      // session.
      forgetStory(storyId);
      navigate(libraryHref(), { replace: true });
    }
  };

  // Deleting or reordering a chapter renumbers what the reader has cached under this story, so
  // the cache is dropped after any of them. The chapter list is handed this rather than `run`.
  const runOnStory: typeof run = action =>
    run(action).then(result => {
      if (result && storyId) forgetStory(storyId);
      return result;
    });

  const paragraphCount =
    draft.text.split('\n').map(line => line.trim()).filter(line => line && line !== '-').length - 1;
  const translationCount =
    draft.translation.trim() === ''
      ? 0
      : draft.translation.split('\n').map(line => line.trim()).filter(line => line && line !== '-').length - 1;
  const mismatched = translationCount > 0 && translationCount !== paragraphCount;

  return (
    <EditorPage>
      <LibraryCrumb>{story ? story.titleEnglish || story.title : 'New story'}</LibraryCrumb>

      <Head>
        <Title>{story ? story.title : 'New story'}</Title>
        {story && (
          <Sub>
            {story.chapters.length} chapter(s) · {story.stats.tokens} words ·{' '}
            {Math.round(story.stats.coverage)}% linked to the dictionary
          </Sub>
        )}
      </Head>

      {error && <ErrorLine>{error}</ErrorLine>}

      <Section>
        <SectionTitle>About it</SectionTitle>
        <Grid>
          <Field>
            <Label>{langName()} title</Label>
            <Input
              className={INPUT_TARGET}
              value={draft.title}
              onChange={event => set('title', event.target.value)}
              placeholder={storyId ? '' : 'Taken from the first line of the text'}
            />
          </Field>

          <Field>
            <Label>English title</Label>
            <Input
              value={draft.titleEnglish}
              onChange={event => set('titleEnglish', event.target.value)}
              placeholder="My day"
            />
          </Field>

          <Field>
            <Label>Level</Label>
            <Input value={draft.level} onChange={event => set('level', event.target.value)} placeholder="A2" />
            <Hint>Free text, and only for you. Nothing filters on it.</Hint>
          </Field>

          <Field>
            <Label>Where it came from</Label>
            <Input
              value={draft.source}
              onChange={event => set('source', event.target.value)}
              placeholder="A message from Nino"
            />
          </Field>
        </Grid>

        <Field>
          <Label>Note</Label>
          <Textarea rows={2} value={draft.note} onChange={event => set('note', event.target.value)} />
        </Field>
      </Section>

      {/* The prose box exists only before the story does. Once it has an address, its text
          lives in chapters, and the list below replaces this. */}
      {!storyId && (
        <Section>
          <SectionTitle>The text</SectionTitle>
          <Note>
            First line is the title, blank lines separate paragraphs, a lone “-” is a rule and is
            dropped. A translation must have one paragraph per {langName()} paragraph, because the
            side-by-side view pairs them by position. Leave it empty and add chapters afterwards.
          </Note>

          <Grid className="mb-0 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
            <Field>
              <Label>
                {langName()} <Count>{Math.max(paragraphCount, 0)} paragraph(s)</Count>
              </Label>
              <Textarea
                className={cn(TALL, INPUT_TARGET)}
                rows={16}
                value={draft.text}
                onChange={event => set('text', event.target.value)}
                placeholder={PLACEHOLDER[lang()].text}
              />
            </Field>

            <Field>
              <Label>
                English{' '}
                <Count wrong={mismatched}>
                  {translationCount > 0 ? `${translationCount} paragraph(s)` : 'optional'}
                </Count>
              </Label>
              <Textarea
                className={TALL}
                rows={16}
                value={draft.translation}
                onChange={event => set('translation', event.target.value)}
                placeholder={PLACEHOLDER[lang()].translation}
              />
            </Field>
          </Grid>

          {mismatched && (
            <Warning>
              The translation has {translationCount} paragraph(s) and the {langName()} has{' '}
              {paragraphCount}. The side-by-side view pairs them by position, so they would drift
              out of step.
            </Warning>
          )}
        </Section>
      )}

      <Actions>
        <Button variant="control" size="auto" className="font-semibold" disabled={busy} onClick={save}>
          <Check /> {busy ? 'Saving…' : storyId ? 'Save' : 'Create'}
        </Button>

        {storyId && (
          <>
            <Button variant="control" size="auto" disabled={busy} onClick={relink}>
              <RotateCcw /> Link it again
            </Button>
            <Button variant="control" size="auto" asChild>
              <Link to={chapterHref(storyId, 0)}>
                <Eye /> Read it
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
            Delete this story and everything in it?
            <Button variant="dangerOutline" size="auto" disabled={busy} onClick={remove}>
              Yes, delete
            </Button>
            <Button variant="control" size="auto" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        )}
      </Actions>

      {storyId && (
        <>
          <ChapterList storyId={storyId} chapters={story?.chapters ?? []} busy={busy} run={runOnStory} />
          <Note className="mt-6 mb-0">
            “Link it again” runs your text past the dictionary and your own words once more.
            Worth pressing after adding vocabulary: a word you wrote down today is a link this
            story could not have made yesterday.
          </Note>
        </>
      )}

      {report && <LinkReport result={report} />}
    </EditorPage>
  );
}

/**
 * The table of contents, and where chapters are added, reordered and removed.
 *
 * Reordering is a step at a time rather than a drag: the list is short, a step is unambiguous
 * on a touch screen, and each one is a request that either worked or did not.
 */
function ChapterList({
  storyId,
  chapters,
  busy,
  run,
}: {
  storyId: string;
  chapters: StoryChapterSummary[];
  busy: boolean;
  run: ReturnType<typeof useLibraryEdit>['run'];
}) {
  const [confirming, setConfirming] = useState<number | null>(null);

  return (
    <Section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle className="mb-0">Chapters</SectionTitle>
        <Button variant="control" size="auto" asChild>
          <Link to={libraryHref(`/stories/${encodeURIComponent(storyId)}/chapters/new`)}>
            <Plus /> Add a chapter
          </Link>
        </Button>
      </div>

      {chapters.length === 0 ? (
        <Note className="mb-0">
          Nothing in it yet. A story with no chapters has nothing to read, so paste one in.
        </Note>
      ) : (
        <Rows>
          {chapters.map((chapter, index) => (
            <li key={chapter.position} className="flex flex-wrap items-center gap-3 px-4 py-[11px]">
              <span className="w-6 shrink-0 text-sm font-semibold text-faint tabular-nums">
                {chapter.position + 1}
              </span>

              <Link
                to={libraryHref(`/stories/${encodeURIComponent(storyId)}/chapters/${chapter.position}`)}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-3 hover:underline"
              >
                <RowTarget>{chapter.title || <span className="text-faint">Untitled</span>}</RowTarget>
                <RowEn>{chapter.titleEnglish}</RowEn>
                <RowMeta>
                  <Badge>{chapter.paragraphs} paragraph(s)</Badge>
                  <Badge>{chapter.stats.tokens} words</Badge>
                  <Badge flagged={chapter.stats.coverage < 70}>
                    {Math.round(chapter.stats.coverage)}% linked
                  </Badge>
                  {chapter.translated && <Badge>translated</Badge>}
                </RowMeta>
              </Link>

              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="control"
                  size="auto-sm"
                  aria-label="Move up"
                  disabled={busy || index === 0}
                  onClick={() =>
                    void run(() => api.library.moveChapter({ storyId, position: chapter.position, direction: 'up' }))
                  }
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="control"
                  size="auto-sm"
                  aria-label="Move down"
                  disabled={busy || index === chapters.length - 1}
                  onClick={() =>
                    void run(() =>
                      api.library.moveChapter({ storyId, position: chapter.position, direction: 'down' }),
                    )
                  }
                >
                  <ArrowDown />
                </Button>
                <Button variant="control" size="auto-sm" asChild>
                  <Link
                    to={libraryHref(`/stories/${encodeURIComponent(storyId)}/chapters/${chapter.position}`)}
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
                        void run(() => api.library.deleteChapter({ storyId, position: chapter.position }));
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
        </Rows>
      )}
    </Section>
  );
}
