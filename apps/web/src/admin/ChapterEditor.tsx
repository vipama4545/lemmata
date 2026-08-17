// Uploading one chapter, and the report of how well it linked itself.
//
// Pasting prose in is the whole of adding a chapter. The server tokenises it and resolves
// every word against the lexicon — around 95% of them, on the evidence of the stories here —
// and what comes back is the list of what it could not do: the spellings nothing matched, and
// the links it reached by a guess. Those two lists are the work, and they are the point of
// this screen. Everything left over is either a word the dictionary is missing or a proper
// noun, and the second is fixed in the reader itself, on the word, where the sentence is.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import { Check, Eye, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { replaceStory } from '../data/stories';
import { chapterHref } from '../utils/story';
import { api } from '../api/client';
import { lang, langName, publishedStories } from '../content/store';
import {
  ADMIN_INPUT_GEO,
  AdminActions,
  AdminCheck,
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
import { LinkReport } from './LinkReport';

const PLACEHOLDER: Record<Lang, { text: string; translation: string }> = {
  ka: { text: 'პირველი თავი\n\nიყო და არა იყო რა…', translation: 'Chapter One\n\nOnce upon a time…' },
  ru: { text: 'Глава́ пе́рвая\n\nЖил-был стари́к со стару́хой…', translation: 'Chapter One\n\nOnce upon a time…' },
};

/** Room for a whole chapter without the textarea having to be dragged open first. */
const TALL = 'min-h-80 text-[15px] md:text-[15px]';

/** How many paragraphs a pasted text will come out as, counted the way the server counts. */
function paragraphsIn(text: string, titled: boolean): number {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line && line !== '-');
  return Math.max(titled ? lines.length - 1 : lines.length, 0);
}

function ChapterEditor() {
  const { storyId, position: positionParam } = useParams<{ storyId: string; position: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useEdit();

  // "new" rather than a missing segment, so the two routes read differently in a URL bar and
  // an existing chapter 0 is never mistaken for a new one.
  const position = positionParam === undefined ? null : Number(positionParam);
  const isNew = position === null;

  // Straight out of the snapshot, unmemoised: saving a chapter relinks it and bumps the
  // content version, and the counts in the header are this chapter's own. See the same note
  // in StoryEditor.
  const summary = publishedStories().find(story => story.id === storyId) ?? null;
  const chapter =
    position === null ? null : summary?.chapters.find(entry => entry.position === position) ?? null;

  const [titled, setTitled] = useState(true);
  const [title, setTitle] = useState(chapter?.title ?? '');
  const [titleEnglish, setTitleEnglish] = useState(chapter?.titleEnglish ?? '');
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  const [loaded, setLoaded] = useState(isNew);
  const [report, setReport] = useState<StoryLinkResult | null>(null);

  // A chapter's prose is not in the snapshot — only its shape is — so editing one needs the
  // one extra fetch the reader makes too. Done on demand rather than on mount: most visits
  // here are to add the next chapter, not to reopen an old one.
  const loadText = async () => {
    if (!storyId || position === null) return;
    const story = await api.content.story({ id: storyId, chapter: position });
    if (!story) return;
    // Round-tripped through the same rule the server reads by, headings included, so what
    // comes back into the boxes is what would go out of them again unchanged.
    setText([...(story.chapterTitle ? [story.chapterTitle] : []), ...story.paragraphs].join('\n\n'));
    setTranslation(
      story.translation.length
        ? [...(story.chapterTitleEnglish ? [story.chapterTitleEnglish] : []), ...story.translation].join('\n\n')
        : '',
    );
    setTitled(Boolean(story.chapterTitle));
    setLoaded(true);
  };

  // Moving between chapters keeps the component mounted, so the boxes have to be emptied by
  // hand — otherwise chapter 2 opens holding chapter 1's prose, and saving would overwrite it.
  useEffect(() => {
    setText('');
    setTranslation('');
    setReport(null);
    setLoaded(positionParam === undefined);
    setTitle('');
    setTitleEnglish('');
    setTitled(true);
  }, [storyId, positionParam]);

  if (!storyId || !summary) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to="/admin/stories">← Stories</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is no story with the id “{storyId}”.</p>
      </Page>
    );
  }

  if (position !== null && !chapter) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to={`/admin/stories/${encodeURIComponent(storyId)}`}>← The story</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">
          This story has no chapter {(position ?? 0) + 1}.
        </p>
      </Page>
    );
  }

  const save = async () => {
    const result = await run(() =>
      api.admin.saveChapter({
        storyId,
        ...(position === null ? {} : { position }),
        titled,
        title: title.trim(),
        titleEnglish: titleEnglish.trim(),
        text,
        translation,
      }),
    );

    if (result) {
      setReport(result);
      // The reader caches fetched chapters for the session, so opening the story after this
      // would otherwise show the text as it was before the save. The server has handed back the
      // relinked chapter, so it goes straight in.
      replaceStory(result.story);
      if (isNew) {
        navigate(`/admin/stories/${encodeURIComponent(storyId)}/chapters/${result.story.chapter}`, {
          replace: true,
        });
      }
    }
  };

  const paragraphCount = paragraphsIn(text, titled);
  const translationCount = translation.trim() === '' ? 0 : paragraphsIn(translation, titled);
  const mismatched = translationCount > 0 && translationCount !== paragraphCount;
  const nextNumber = (summary.chapters.length ?? 0) + 1;

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin/stories">← Stories</BreadcrumbLink>
        <BreadcrumbSeparator />
        <BreadcrumbLink to={`/admin/stories/${encodeURIComponent(storyId)}`}>
          {summary.titleEnglish || summary.title}
        </BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{isNew ? `Chapter ${nextNumber}` : `Chapter ${(position ?? 0) + 1}`}</span>
      </Breadcrumb>

      <AdminHead>
        <AdminTitle>
          {isNew ? `New chapter ${nextNumber}` : chapter?.title || `Chapter ${(position ?? 0) + 1}`}
        </AdminTitle>
        <AdminSub>
          {summary.title}
          {chapter && (
            <>
              {' · '}
              {chapter.stats.tokens} words · {chapter.stats.coverage}% linked
            </>
          )}
        </AdminSub>
      </AdminHead>

      {error && <AdminError>{error}</AdminError>}

      <AdminSection>
        <AdminSectionTitle>The text</AdminSectionTitle>
        <AdminNote>
          Blank lines separate paragraphs and a lone “-” is a rule and is dropped — the same reading a{' '}
          <code>.txt</code> under <code>data/{lang()}/stories/</code> has always had. A translation must have
          one paragraph per {langName()} paragraph, because the side-by-side view pairs them by position.
        </AdminNote>

        <AdminCheck className="mb-4">
          <Checkbox className="mt-0.5" checked={titled} onCheckedChange={value => setTitled(value === true)} />
          <span>
            The first line is this chapter’s heading
            <AdminHint>
              Turn this off for a chapter that has no heading of its own, or its opening sentence would be
              read as one and disappear from the prose.
            </AdminHint>
          </span>
        </AdminCheck>

        {!loaded ? (
          <Button variant="control" size="auto" onClick={loadText}>
            <Type /> Load the text to edit it
          </Button>
        ) : (
          <AdminGrid className="mb-0 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
            <AdminField>
              <AdminLabel>
                {langName()} <AdminCount>{paragraphCount} paragraph(s)</AdminCount>
              </AdminLabel>
              <AdminTextarea
                className={cn(TALL, ADMIN_INPUT_GEO)}
                rows={16}
                value={text}
                onChange={event => setText(event.target.value)}
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
                value={translation}
                onChange={event => setTranslation(event.target.value)}
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

      {/* Only worth showing where the first line is not already saying it. */}
      {!titled && (
        <AdminSection>
          <AdminSectionTitle>Its heading</AdminSectionTitle>
          <AdminGrid>
            <AdminField>
              <AdminLabel>{langName()} heading</AdminLabel>
              <AdminInput
                className={ADMIN_INPUT_GEO}
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="Leave empty for no heading"
              />
            </AdminField>
            <AdminField>
              <AdminLabel>English heading</AdminLabel>
              <AdminInput
                value={titleEnglish}
                onChange={event => setTitleEnglish(event.target.value)}
                placeholder="Chapter One"
              />
            </AdminField>
          </AdminGrid>
        </AdminSection>
      )}

      <AdminActions>
        <Button
          variant="control"
          size="auto"
          className={KNOW_BUTTON}
          disabled={busy || text.trim() === '' || !loaded}
          onClick={save}
        >
          <Check /> {busy ? 'Linking…' : isNew ? 'Add and link' : 'Save and relink'}
        </Button>

        {!isNew && (
          <Button variant="control" size="auto" asChild>
            <Link to={chapterHref(storyId, position ?? 0)}>
              <Eye /> Open the reader
            </Link>
          </Button>
        )}

        <Button variant="control" size="auto" asChild>
          <Link to={`/admin/stories/${encodeURIComponent(storyId)}`}>Back to the story</Link>
        </Button>
      </AdminActions>

      {report && <LinkReport result={report} />}
    </AdminPage>
  );
}

export default ChapterEditor;
