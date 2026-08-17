// One chapter of a story of yours, and the report of how well it linked itself.
//
// Pasting prose in is the whole of adding a chapter. The server tokenises it and resolves every
// word against the dictionary and against the words you have added yourself. What comes back is
// the list of what it could not do: the spellings nothing matched, and the links it reached by
// a guess. On a private text that list is longer than on a published one, which is not a fault.
// It is the reading list for your own vocabulary. Anything in it that matters is a word worth
// adding, and adding it and pressing "link it again" is the loop this section exists for.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import { Check, Eye, Plus, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { BreadcrumbSeparator } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { api } from '../api/client';
import { LinkReport } from '../admin/LinkReport';
import { lang, langName, myStories } from '../content/store';
import { replaceStory } from '../data/stories';
import { chapterHref } from '../utils/story';
import { useLibraryEdit, useSignedIn } from './store';
import {
  Actions,
  Check as CheckRow,
  Count,
  EditorPage,
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
  Section,
  SectionTitle,
  SignInFirst,
  Sub,
  Textarea,
  Title,
  Warning,
  libraryHref,
} from './ui';

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

export default function ChapterForm() {
  const signedIn = useSignedIn();
  if (!signedIn) return <SignInFirst what="stories of your own" />;
  return <Form />;
}

function Form() {
  const { storyId, position: positionParam } = useParams<{ storyId: string; position: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useLibraryEdit();

  // "new" rather than a missing segment, so the two routes read differently in a URL bar and an
  // existing chapter 0 is never mistaken for a new one.
  const position = positionParam === undefined ? null : Number(positionParam);
  const isNew = position === null;

  const story = myStories().find(entry => entry.id === storyId) ?? null;
  const chapter =
    position === null ? null : story?.chapters.find(entry => entry.position === position) ?? null;

  const [titled, setTitled] = useState(true);
  const [title, setTitle] = useState('');
  const [titleEnglish, setTitleEnglish] = useState('');
  const [text, setText] = useState('');
  const [translation, setTranslation] = useState('');
  const [loaded, setLoaded] = useState(isNew);
  const [report, setReport] = useState<StoryLinkResult | null>(null);

  // Moving between chapters keeps this component mounted, so the boxes have to be emptied by
  // hand. Otherwise chapter 2 opens holding chapter 1's prose, and saving would overwrite it.
  useEffect(() => {
    setText('');
    setTranslation('');
    setReport(null);
    setLoaded(positionParam === undefined);
    setTitle('');
    setTitleEnglish('');
    setTitled(true);
  }, [storyId, positionParam]);

  if (!storyId || !story) {
    return (
      <EditorPage>
        <LibraryCrumb />
        <p className="py-6 text-center text-muted-foreground">There is no story of yours with that address.</p>
      </EditorPage>
    );
  }

  if (position !== null && !chapter) {
    return (
      <EditorPage>
        <LibraryCrumb>{story.titleEnglish || story.title}</LibraryCrumb>
        <p className="py-6 text-center text-muted-foreground">
          This story has no chapter {(position ?? 0) + 1}.
        </p>
      </EditorPage>
    );
  }

  // The overlay carries a chapter's shape but not its prose, so editing one needs the same fetch
  // the reader makes. On demand rather than on mount: most visits here are to add the next
  // chapter, not to reopen an old one.
  const loadText = async () => {
    if (position === null) return;
    const fetched = await api.content.story({ id: storyId, chapter: position });
    if (!fetched) return;
    // Round-tripped through the same rule the server reads by, headings included, so what comes
    // back into the boxes is what would go out of them again unchanged.
    setText([...(fetched.chapterTitle ? [fetched.chapterTitle] : []), ...fetched.paragraphs].join('\n\n'));
    setTranslation(
      fetched.translation.length
        ? [
            ...(fetched.chapterTitleEnglish ? [fetched.chapterTitleEnglish] : []),
            ...fetched.translation,
          ].join('\n\n')
        : '',
    );
    setTitled(Boolean(fetched.chapterTitle));
    setLoaded(true);
  };

  const save = async () => {
    const result = await run(() =>
      api.library.saveChapter({
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
      setReport(result.result);
      // The reader keeps fetched chapters for the session, so without this it would show the
      // text as it was before this save. The server has just handed back the relinked chapter,
      // so put that in rather than only clearing the old one.
      replaceStory(result.result.story);
      if (isNew) {
        navigate(
          libraryHref(`/stories/${encodeURIComponent(storyId)}/chapters/${result.result.story.chapter}`),
          { replace: true },
        );
      }
    }
  };

  const paragraphCount = paragraphsIn(text, titled);
  const translationCount = translation.trim() === '' ? 0 : paragraphsIn(translation, titled);
  const mismatched = translationCount > 0 && translationCount !== paragraphCount;
  const nextNumber = story.chapters.length + 1;

  return (
    <EditorPage>
      <LibraryCrumb>
        <Link className="hover:underline" to={libraryHref(`/stories/${encodeURIComponent(storyId)}`)}>
          {story.titleEnglish || story.title}
        </Link>
        <BreadcrumbSeparator />
        {isNew ? `Chapter ${nextNumber}` : `Chapter ${(position ?? 0) + 1}`}
      </LibraryCrumb>

      <Head>
        <Title>{isNew ? `New chapter ${nextNumber}` : chapter?.title || `Chapter ${(position ?? 0) + 1}`}</Title>
        <Sub>
          {story.title}
          {chapter && (
            <>
              {' · '}
              {chapter.stats.tokens} words · {Math.round(chapter.stats.coverage)}% linked
            </>
          )}
        </Sub>
      </Head>

      {error && <ErrorLine>{error}</ErrorLine>}

      <Section>
        <SectionTitle>The text</SectionTitle>
        <Note>
          Blank lines separate paragraphs and a lone “-” is a rule and is dropped. A translation
          must have one paragraph per {langName()} paragraph, because the side-by-side view pairs
          them by position.
        </Note>

        <CheckRow className="mb-4">
          <Checkbox className="mt-0.5" checked={titled} onCheckedChange={value => setTitled(value === true)} />
          <span>
            The first line is this chapter’s heading
            <Hint>
              Turn this off for a chapter with no heading of its own, or its opening sentence would
              be read as one and disappear from the prose.
            </Hint>
          </span>
        </CheckRow>

        {!loaded ? (
          <Button variant="control" size="auto" onClick={loadText}>
            <Type /> Load the text to edit it
          </Button>
        ) : (
          <Grid className="mb-0 grid-cols-[repeat(auto-fit,minmax(320px,1fr))]">
            <Field>
              <Label>
                {langName()} <Count>{paragraphCount} paragraph(s)</Count>
              </Label>
              <Textarea
                className={cn(TALL, INPUT_TARGET)}
                rows={16}
                value={text}
                onChange={event => setText(event.target.value)}
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
                value={translation}
                onChange={event => setTranslation(event.target.value)}
                placeholder={PLACEHOLDER[lang()].translation}
              />
            </Field>
          </Grid>
        )}

        {mismatched && (
          <Warning>
            The translation has {translationCount} paragraph(s) and the {langName()} has{' '}
            {paragraphCount}. The side-by-side view pairs them by position, so they would drift out
            of step.
          </Warning>
        )}
      </Section>

      {/* Only worth showing where the first line is not already saying it. */}
      {!titled && (
        <Section>
          <SectionTitle>Its heading</SectionTitle>
          <Grid>
            <Field>
              <Label>{langName()} heading</Label>
              <Input
                className={INPUT_TARGET}
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="Leave empty for no heading"
              />
            </Field>
            <Field>
              <Label>English heading</Label>
              <Input
                value={titleEnglish}
                onChange={event => setTitleEnglish(event.target.value)}
                placeholder="Chapter One"
              />
            </Field>
          </Grid>
        </Section>
      )}

      <Actions>
        <Button
          variant="control"
          size="auto"
          className="font-semibold"
          disabled={busy || text.trim() === '' || !loaded}
          onClick={save}
        >
          <Check /> {busy ? 'Linking…' : isNew ? 'Add and link' : 'Save and link again'}
        </Button>

        {!isNew && (
          <Button variant="control" size="auto" asChild>
            <Link to={chapterHref(storyId, position ?? 0)}>
              <Eye /> Read it
            </Link>
          </Button>
        )}

        <Button variant="control" size="auto" asChild>
          <Link to={libraryHref(`/stories/${encodeURIComponent(storyId)}`)}>Back to the story</Link>
        </Button>

        {/* Where the unresolved list below leads. A word that turned up in your own text is the
            best possible reason to add one, and this saves finding the form from the index. */}
        {report && report.unresolved.length > 0 && (
          <Button variant="control" size="auto" asChild>
            <Link to={libraryHref('/words/new')}>
              <Plus /> Add a word
            </Link>
          </Button>
        )}
      </Actions>

      {report && <LinkReport result={report} />}
    </EditorPage>
  );
}
