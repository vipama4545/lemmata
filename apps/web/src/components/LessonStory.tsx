// A passage from the library, standing in a lesson.
//
// What `::story <id>` draws. The lesson names something in the library and this reads it out of
// there — so the dialogue a lesson teaches and the dialogue a reader can look up, hear and rate
// are one text in one place, rather than a copy in the lesson that drifts from the original the
// first time either is corrected.
//
// It is the library's reading surface, not a picture of it. The words are `StoryProse`, the same
// component the library page draws its chapter with: hover one and the card that opens is the
// card that opens there, with the sense that applies in this line, the paradigm behind the form
// and the buttons that rate it. The voice is the library's player: one control reads the whole
// passage through, the highlight following the words as they are said, and a word's own card
// still offers to start from there. What the lesson leaves out is the *chrome* — the mode
// switches, the chapter menu, the finish dialogue, the admin's link editor — because none of
// that belongs in the middle of a paragraph explaining what "შენ?" means. It is one click away
// in the library, which is what the door at the foot of the panel is for.
//
// The one switch it keeps is the English, because that one is about the lesson rather than
// about the reader: a dialogue being taught line by line wants its translation there, and the
// same dialogue set as a test wants it hidden. The `::story` block says which, and the reader
// can still turn it over.
//
// The heading is drawn from the snapshot and the prose is fetched, through the same cache the
// reader uses. That split is why the panel has a title the moment the lesson does — a summary is
// already in hand for every story there is — and why opening the passage in the library
// afterwards costs nothing: it is already here.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Headphones, Languages, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LevelBadge } from '@/components/ui/word-card';
import { cn } from '@/lib/utils';
import { publishedStories } from '../content/store';
import { useStory } from '../data/stories';
import { chapterHref } from '../utils/story';
import { StoryAudioBar, useStoryAudio } from './StoryAudio';
import StoryProse from './StoryProse';

export interface StoryEmbedProps {
  storyId: string;
  /** 0-based, as the library counts internally. See the `story` block in shared/lesson.ts. */
  chapter: number;
  /**
   * Whether the English is showing when the passage is first drawn — the lesson's decision,
   * because only the lesson knows what the passage is for. The reader can still turn it over.
   */
  english: boolean;
}

export default function StoryEmbed({ storyId, chapter, english }: StoryEmbedProps) {
  // The published library alone: a lesson is part of the dictionary, and `::story` names one
  // of its texts. It is not a way to reach anybody's private library, including your own.
  const summary = publishedStories().find(story => story.id === storyId);
  const { story, loading, error } = useStory(storyId, chapter);

  // Keyed on the chapter that is actually on screen rather than the one asked for: a `::story`
  // naming a chapter past the end of a book answers with the last one, and the queue must be
  // built against what is being read.
  const audio = useStoryAudio(storyId, story?.chapter ?? chapter);

  // Whether the player is on screen. Off until somebody asks for it, as it is in the reader —
  // a bar fixed over the foot of the page for every lesson that happens to embed a dialogue
  // would be a permanent tax on the ordinary case of reading one.
  const [listening, setListening] = useState(false);

  // The lesson chooses which way this starts; the reader chooses from then on. Not remembered
  // between visits: what the author decided is the right thing to see on arriving at a lesson,
  // and a preference set on some other page three weeks ago is not.
  const [showEnglish, setShowEnglish] = useState(english);

  /** Read from here to the end of the passage, showing the controls that stop it. */
  const readFrom = (paragraph: number, word = 0) => {
    setListening(true);
    audio.playFrom(paragraph, word);
  };

  const stopListening = () => {
    setListening(false);
    audio.stop();
  };

  // A body names what it embeds as text, so nothing stops a story being deleted out from under
  // a lesson — and the snapshot lists every story there is, so a name missing from it is a name
  // that no longer exists. Saying so beats a hole in the page.
  if (!summary) {
    return (
      <p className="my-5 rounded-lg border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
        There is nothing in the library called{' '}
        <code className="rounded-[4px] bg-muted px-[5px] py-px">{storyId}</code> any more.
      </p>
    );
  }

  const landed = story?.chapter ?? chapter;
  const named = summary.chapters.find(entry => entry.position === landed);

  return (
    <figure className="my-6 max-w-[72ch] overflow-hidden rounded-lg border-2 border-border bg-card">
      <header className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 max-sm:px-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-primary-light text-primary">
          <BookOpen className="size-[18px]" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            From the library
          </p>
          <h3 className="text-base leading-tight font-bold">{summary.title}</h3>
          {/* The English title, and the chapter's own name where the passage is one chapter of
              something longer — "Chapter 3" alone tells a reader nothing about what they are
              about to read. */}
          {(summary.titleEnglish || named?.title) && (
            <p className="text-[15px] text-muted-foreground">
              {[summary.titleEnglish, summary.chapters.length > 1 ? named?.title || named?.titleEnglish : '']
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>

        {/* On a phone these take a row of their own rather than squeezing the title into a
            column two words wide. */}
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-between">
          {/* Only where there is a translation to show. A passage nobody has translated has
              nothing to turn over, and a dead switch would be a promise of one. */}
          {story && story.translation.length > 0 && (
            <Button
              variant={showEnglish ? 'controlOn' : 'control'}
              size="auto-sm"
              aria-pressed={showEnglish}
              onClick={() => setShowEnglish(on => !on)}
              title={showEnglish ? 'Hide the English' : 'Show the English'}
            >
              <Languages /> English
            </Button>
          )}

          {/* Absent, rather than disabled, where the server has no voice — the reader's rule.
              Pressing it reads the passage from the top and runs on to the end of it. */}
          {audio.available &&
            (listening ? (
              <Button variant="controlOn" size="auto-sm" onClick={stopListening}>
                <Square /> Stop
              </Button>
            ) : (
              <Button variant="control" size="auto-sm" onClick={() => readFrom(0)}>
                <Headphones /> Read it aloud
              </Button>
            ))}

          {summary.level && <LevelBadge level={summary.level} />}
        </div>
      </header>

      <div className="px-4 py-3.5 max-sm:px-3.5">
        {loading && <p className="py-4 text-center text-muted-foreground">Loading the text…</p>}

        {!loading && !story && (
          <p className="py-4 text-center text-muted-foreground">
            {error ? 'That passage could not be loaded.' : 'That passage is not there any more.'}
          </p>
        )}

        {story && (
          <StoryProse
            story={story}
            size="compact"
            // One row per line with a rule between, which is what a dialogue is: eight short
            // turns, and running them together as prose would lose who is speaking.
            layout="lines"
            translation={showEnglish}
            // On, as it is in the library: the point of the passage being *from* somewhere is
            // that its words are the dictionary's words.
            lookup
            // Off, unlike the library. A lesson is prose being taught, and tinting every word
            // of a worked example by how well it is known turns the thing being explained into
            // a study surface. The library page is where that view lives, one click away.
            highlight={false}
            spokenAt={audio.at}
            spokenLine={audio.lineKey}
            // "Read from here" on a word's card, which is the only per-line way in now that the
            // margin buttons have gone.
            onPlayFrom={audio.available ? readFrom : undefined}
          />
        )}
      </div>

      <figcaption
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted px-4 py-2.5',
          'text-[13px] text-muted-foreground max-sm:px-3.5',
        )}
      >
        <span>Hover a word to see what it means here, or rate it.</span>
        <Link
          to={chapterHref(storyId, landed)}
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
        >
          Open it in the library <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </figcaption>

      {/* Fixed to the viewport, so it stays put while the lesson scrolls under it — the same
          bar the library page uses, and for the same reason: following a recording means
          scrolling, and controls that scroll away are controls you have to go and find.
          Without the reader's spacer beneath it, though: a passage sits in the middle of a
          lesson with the rest of the page below it, so there is already something to scroll,
          and 6rem of blank space appearing inside the prose every time the voice starts would
          shove the paragraph you are reading up the screen. */}
      {listening && audio.available && <StoryAudioBar audio={audio} onClose={stopListening} />}
    </figure>
  );
}
