// Everything of yours, in one place: the stories you wrote or pasted in, the words you added,
// and the shelves you filed them on.
//
// Two lists rather than two pages, because they are two halves of one habit. You read
// something, you meet a word, you write the word down, and the next thing you paste in finds
// it. One screen makes that loop visible, which is also why the words section leads with what
// it is for rather than with a count.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Pencil, Plus, Type } from 'lucide-react';
import type { Category, StorySummary, Word } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { LevelBadge } from '@/components/ui/word-card';
import { api } from '../api/client';
import { lang, langName, myCategories, myStories, myWords } from '../content/store';
import { chapterHref } from '../utils/story';
import { useLibraryEdit, useSignedIn } from './store';
import {
  Badge,
  Empty,
  ErrorLine,
  Input,
  LinkButton,
  Rows,
  RowEn,
  RowMeta,
  RowTarget,
  Section,
  SectionTitle,
  SignInFirst,
  libraryHref,
} from './ui';

export default function MyLibrary() {
  const signedIn = useSignedIn();
  if (!signedIn) return <SignInFirst what="your own stories and words" />;
  return <Library />;
}

function Library() {
  const stories = myStories();
  const words = myWords();
  const categories = myCategories();
  const { busy, error, run } = useLibraryEdit();

  return (
    <Page className="pb-15">
      <Breadcrumb>
        <BreadcrumbLink to={`/${lang()}`}>← Home</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>My library</span>
      </Breadcrumb>

      <header className="mb-7">
        <h1 className="mb-1.5 text-[26px] font-bold">My library</h1>
        <p className="max-w-[68ch] text-muted-foreground">
          Your own {langName()} texts and vocabulary. Everything here is private to your account:
          the words you add are searched, studied and linked into your own stories exactly as the
          dictionary's are, and nobody else sees any of it.
        </p>
      </header>

      {error && <ErrorLine>{error}</ErrorLine>}

      <Stories stories={stories} />
      <Words words={words} categories={categories} busy={busy} run={run} />
    </Page>
  );
}

/* ------------------------------------------------------------------ stories */

function Stories({ stories }: { stories: StorySummary[] }) {
  return (
    <Section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle className="mb-0 flex items-center gap-2">
          <BookOpen className="size-[18px]" aria-hidden="true" /> Your stories
        </SectionTitle>
        <Button variant="control" size="auto" asChild>
          <Link to={libraryHref('/stories/new')}>
            <Plus /> New story
          </Link>
        </Button>
      </div>

      {stories.length === 0 ? (
        <Empty>
          Nothing yet. Paste in anything you are reading: a news item, a page of a book, a message
          from a friend. Every word in it is linked back to the dictionary.
        </Empty>
      ) : (
        <Rows>
          {stories.map(story => (
            <li key={story.id} className="flex flex-wrap items-center gap-3 px-4 py-[11px]">
              <Link to={chapterHref(story.id, 0)} className="flex min-w-0 flex-1 flex-wrap items-center gap-3 hover:underline">
                <RowTarget>{story.title}</RowTarget>
                <RowEn>{story.titleEnglish}</RowEn>
                <RowMeta>
                  {story.level && <LevelBadge level={story.level} />}
                  {story.chapters.length > 1 && <Badge>{story.chapters.length} chapters</Badge>}
                  <Badge>{story.stats.tokens} words</Badge>
                  <Badge flagged={story.stats.coverage < 70}>{Math.round(story.stats.coverage)}% linked</Badge>
                </RowMeta>
              </Link>
              <Button variant="control" size="auto-sm" asChild>
                <Link to={libraryHref(`/stories/${encodeURIComponent(story.id)}`)} aria-label="Edit">
                  <Pencil />
                </Link>
              </Button>
            </li>
          ))}
        </Rows>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------- words */

type Run = ReturnType<typeof useLibraryEdit>['run'];

function Words({
  words,
  categories,
  busy,
  run,
}: {
  words: Word[];
  categories: Category[];
  busy: boolean;
  run: Run;
}) {
  const [filter, setFilter] = useState('');

  // Case-folded on the English alone. The headword is Mkhedruli or Cyrillic, where a
  // `toLowerCase()` is either a no-op or, for Russian, the wrong thing to do to a search the
  // reader typed unaccented anyway.
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return words;
    return words.filter(
      word => word.headword.includes(filter.trim()) || word.english.toLowerCase().includes(needle),
    );
  }, [words, filter]);

  return (
    <Section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle className="mb-0 flex items-center gap-2">
          <Type className="size-[18px]" aria-hidden="true" /> Your words
        </SectionTitle>
        <Button variant="control" size="auto" asChild>
          <Link to={libraryHref('/words/new')}>
            <Plus /> Add a word
          </Link>
        </Button>
      </div>

      {words.length === 0 ? (
        <Empty>
          Nothing yet. A word you add here is searched and studied like any other, and if you list
          its inflected forms it is found in your own stories wherever it turns up.
        </Empty>
      ) : (
        <>
          {words.length > 12 && (
            <Input
              className="mb-3"
              value={filter}
              placeholder="Filter your words…"
              onChange={event => setFilter(event.target.value)}
            />
          )}

          <Rows>
            {shown.map(word => (
              <li key={word.id}>
                <Link
                  to={libraryHref(`/words/${encodeURIComponent(word.id)}`)}
                  className="flex flex-wrap items-center gap-3 px-4 py-[11px] hover:bg-muted"
                >
                  <RowTarget>{word.accented || word.headword}</RowTarget>
                  <RowEn>{word.english}</RowEn>
                  <RowMeta>
                    {word.partOfSpeech && <Badge>{word.partOfSpeech}</Badge>}
                    {word.forms?.length ? <Badge>{word.forms.length} form(s)</Badge> : null}
                    {word.verbId && <Badge>paradigm</Badge>}
                    <Badge>{word.category}</Badge>
                  </RowMeta>
                </Link>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-4 py-3 text-sm text-faint">Nothing of yours matches that.</li>
            )}
          </Rows>
        </>
      )}

      <Shelves categories={categories} busy={busy} run={run} />
    </Section>
  );
}

/* ------------------------------------------------------------------ shelves */

/**
 * The shelves your words are filed on.
 *
 * The first one, "My words", is made for you when you add your first word, so this list is
 * never how a shelf comes into being. That is why it sits at the foot of the words section
 * rather than standing as an equal beside it. It is here to rename that shelf, and to add a
 * second for somebody who wants their vocabulary in more than one pile.
 */
function Shelves({ categories, busy, run }: { categories: Category[]; busy: boolean; run: Run }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [renamed, setRenamed] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    const done = await run(() => api.library.saveCategory({ lang: lang(), name: name.trim(), nameNative: '' }));
    if (done) {
      setName('');
      setAdding(false);
    }
  };

  const rename = async (id: string) => {
    if (!renamed.trim()) return;
    const done = await run(() =>
      api.library.saveCategory({ id, lang: lang(), name: renamed.trim(), nameNative: '' }),
    );
    if (done) setEditing(null);
  };

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase">Your shelves</h3>
        {!adding && (
          <LinkButton onClick={() => setAdding(true)}>Add a shelf</LinkButton>
        )}
      </div>

      {categories.length === 0 && !adding ? (
        <p className="text-[13px] text-faint">
          One called “My words” is made for you when you add your first word.
        </p>
      ) : (
        <ul className="flex list-none flex-wrap gap-2">
          {categories.map(category =>
            editing === category.id ? (
              <li key={category.id} className="flex items-center gap-2">
                <Input
                  className="h-8 w-44"
                  value={renamed}
                  autoFocus
                  onChange={event => setRenamed(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') void rename(category.id);
                    if (event.key === 'Escape') setEditing(null);
                  }}
                />
                <Button variant="control" size="auto-sm" disabled={busy} onClick={() => void rename(category.id)}>
                  Save
                </Button>
                <LinkButton onClick={() => setEditing(null)}>Cancel</LinkButton>
              </li>
            ) : (
              <li key={category.id}>
                <button
                  type="button"
                  className="cursor-pointer rounded-full border border-border bg-card px-3 py-1 text-[13px] hover:border-primary"
                  onClick={() => {
                    setEditing(category.id);
                    setRenamed(category.name);
                  }}
                >
                  {category.name}
                  <span className="ml-2 text-faint">{category.wordCount}</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {adding && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-56"
            value={name}
            autoFocus
            placeholder="Verbs I keep forgetting"
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void add();
              if (event.key === 'Escape') setAdding(false);
            }}
          />
          <Button variant="control" size="auto-sm" disabled={busy || !name.trim()} onClick={() => void add()}>
            Add
          </Button>
          <LinkButton onClick={() => setAdding(false)}>Cancel</LinkButton>
        </div>
      )}
    </div>
  );
}
