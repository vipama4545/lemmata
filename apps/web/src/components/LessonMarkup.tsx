// A parsed lesson, drawn.
//
// One component for both reading sections and for the editor's preview, which is the whole
// reason it takes a `LessonDoc` rather than a lesson: the preview has a document that has never
// been saved and no id to fetch anything with. Everything that needs the lesson itself — the
// speech route, which addresses a block by its position — is behind an optional `lessonId`, and
// without one the play buttons for synthesised lines simply are not drawn. An uploaded
// recording still plays, because that is addressed by its own id.
//
// Nothing here parses. `parseLesson` produced the tree and this walks it, so the language is
// described in exactly one place — see the head of shared/lesson.ts.
//
// Two blocks do more than draw themselves. A `::quiz` is an invitation rather than a quiz:
// pressing it covers the lesson entirely, and finishing it tells the page, which is what a
// lesson's progress is counted from — see `EmbeddedQuiz`. A `::story` reaches into the library
// and reads a passage out of it; that one lives in LessonStory.tsx.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ListChecks, Play, Volume2, X } from 'lucide-react';
import { plainInline } from '@georgian/shared/lesson';
import type { LessonBlock, LessonColour, LessonDoc, LessonInline } from '@georgian/shared/lesson';
import type { QuizMark } from '@georgian/shared/quiz';
import type { Quiz, QuizAnswer, QuizSummary } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LevelBadge } from '@/components/ui/word-card';
import { cn } from '@/lib/utils';
import { api } from '../api/client';
import { blockAudioUrl, mediaUrl } from '../data/lessonMedia';
import { lessonImages, quizSummaries } from '../content/store';
import { PlayButton, usePlayer } from './AudioButton';
import StoryEmbed from './LessonStory';
import QuizRunner from './QuizRunner';

/** Prose is held to a measure — a lesson is read, not scanned. The same width the topics had. */
const PROSE = 'max-w-[72ch]';

/**
 * The class each colour name resolves to.
 *
 * Written out rather than interpolated as `text-ink-${colour}`, and that is not verbosity for
 * its own sake: Tailwind finds the classes it must generate by scanning the source for literal
 * strings, so a class built at runtime is a class that exists in this file and in no
 * stylesheet. The failure is a word that renders in the ordinary ink with nothing to say why.
 */
const INK: Record<LessonColour, string> = {
  red: 'text-ink-red',
  orange: 'text-ink-orange',
  yellow: 'text-ink-yellow',
  green: 'text-ink-green',
  teal: 'text-ink-teal',
  blue: 'text-ink-blue',
  purple: 'text-ink-purple',
  pink: 'text-ink-pink',
  grey: 'text-ink-grey',
};

/**
 * What an inline play button needs and cannot be handed as a prop.
 *
 * `Inline` is recursive and is called from a dozen places — a cell, a caption, the inside of a
 * colour — so threading four values down to it would mean four more parameters on every one of
 * them, for the sake of the one node kind that reads them. A context is set once per block
 * instead, and the block index it carries is what makes `{say:…}` addressable at all.
 */
const Sound = createContext<{
  lessonId: string | null;
  block: number;
  play: (src: string) => void;
  playing: string | null;
} | null>(null);

/* ------------------------------------------------------------------- inline */

/**
 * Whether a run of text is in the script being learned.
 *
 * Georgian and Cyrillic are set a size larger and heavier than the English beside them, because
 * at matching sizes the letterforms read as too light — the same rule the word cards and the
 * conjugation tables follow. The old grammar module got this by marking Georgian columns in its
 * data; a lesson is prose somebody typed, so there is nothing to mark and the text has to be
 * asked instead.
 *
 * Deliberately "contains", not "is entirely": a cell reading `ვხატავ (I draw)` is a Georgian
 * cell with a gloss after it, and setting the whole cell is what makes a column line up.
 */
const TARGET_SCRIPT = /[Ⴀ-ჿЀ-ӿ]/;

function Inline({ nodes }: { nodes: LessonInline[] }) {
  return (
    <>
      {nodes.map((node, at) => {
        switch (node.kind) {
          case 'text':
            // Line breaks inside a block are kept — see the head of shared/lesson.ts — and
            // `whitespace-pre-line` on the block is what honours them, so the text goes in as
            // it stands.
            return <span key={at}>{node.text}</span>;
          case 'bold':
            return (
              <strong key={at} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case 'italic':
            return (
              <em key={at}>
                <Inline nodes={node.children} />
              </em>
            );
          case 'code':
            return (
              <code key={at} className="rounded-[4px] bg-muted px-[5px] py-px text-[0.92em]">
                {node.text}
              </code>
            );
          case 'colour':
            return (
              <span key={at} className={cn(INK[node.colour], 'font-semibold')}>
                <Inline nodes={node.children} />
              </span>
            );
          case 'audio':
            return <InlineAudio key={at} node={node} />;
          case 'image':
            return <InlineImage key={at} node={node} />;
          case 'link':
            // An internal path goes through the router so it does not reload the app; anything
            // else is somewhere off this site and opens in its own tab.
            return node.href.startsWith('http') ? (
              <a
                key={at}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                <Inline nodes={node.children} />
              </a>
            ) : (
              <Link key={at} to={node.href} className="text-primary underline underline-offset-2">
                <Inline nodes={node.children} />
              </Link>
            );
        }
      })}
    </>
  );
}

/**
 * A play button standing in the text.
 *
 * The icon alone, at the height of a line of text, because these are written one per row of a
 * table: a button carrying the word "Play" in every row of the alphabet would be a column of the
 * word "Play" with the alphabet beside it. The block-level `::clip` on its own line keeps the
 * label, because there it is the whole of what the reader is being offered.
 */
function InlineAudio({ node }: { node: Extract<LessonInline, { kind: 'audio' }> }) {
  const sound = useContext(Sound);
  if (!sound) return null;

  const src = blockAudioUrl(sound.lessonId ?? '', sound.block, node.audio, node.slot);
  // A synthesised line is addressed by where it sits in a lesson the server can look up, so the
  // editor's preview — which has no saved lesson — offers no button for one. An uploaded
  // recording has an id of its own and plays anywhere, including there.
  if (!src || (!sound.lessonId && !node.audio.clipId)) return null;

  return (
    <PlayButton
      src={src}
      playing={sound.playing === src}
      onPlay={sound.play}
      label={node.audio.say ? `Play “${node.audio.say}”` : 'Play'}
      className="mx-0.5 size-6 min-w-0 shrink-0 align-[-0.3em] [&_svg]:size-3.5"
    />
  );
}

/**
 * A small picture standing in the text, which opens at a useful size when pressed.
 *
 * Drawn at two lines' height, which is what makes it usable in a table: the Russian alphabet
 * table carries one of these per row — the letter's cursive form beside its printed one — and a
 * column of full-width figures would be a column you scroll past rather than read across.
 *
 * At that size a cursive Ж is a smudge, so the thumbnail is a button rather than an image. What
 * opens is a dialog rather than a new tab, for the reason the quiz overlay is one: pressing back
 * should leave a lesson, not step through every picture that was looked at on the way down it.
 *
 * `title` and the button's label are the alt text, so a reader on a touch screen who cannot
 * hover still learns what they are about to open, and a reader with no images gets a named
 * button instead of an empty box.
 */
function InlineImage({ node }: { node: Extract<LessonInline, { kind: 'image' }> }) {
  const [open, setOpen] = useState(false);
  const details = lessonImages()[node.mediaId];
  const alt = node.alt || details?.alt || '';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={alt || undefined}
        aria-label={alt ? `Enlarge: ${alt}` : 'Enlarge this picture'}
        className={cn(
          'mx-0.5 inline-block cursor-zoom-in overflow-hidden rounded-[3px] border border-border',
          'bg-white align-middle transition-colors hover:border-primary',
        )}
      >
        <img
          src={mediaUrl(node.mediaId)}
          alt={alt}
          {...(details?.width ? { width: details.width, height: details.height } : {})}
          loading="lazy"
          className="block h-9 w-auto"
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(92vw,40rem)] gap-3 p-4">
          <DialogTitle className="text-[15px] leading-tight font-bold">{alt || 'Picture'}</DialogTitle>
          {/* The dialog needs a description for screen readers whether or not there is anything
              to add; the alt text is already the title, so this says what the picture is for. */}
          <DialogDescription className="sr-only">Shown larger than it appears in the lesson.</DialogDescription>
          <img
            src={mediaUrl(node.mediaId)}
            alt={alt}
            className="h-auto w-full rounded-sm border border-border bg-white"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------- one block */

interface BlockProps {
  block: LessonBlock;
  lessonId: string | null;
  play: (src: string) => void;
  playing: string | null;
  /** How the lesson's quizzes are getting on. Null where nobody is keeping score. */
  progress: LessonQuizProgress | null;
}

/**
 * The play button beside a block, or nothing.
 *
 * Positioned as a floated element at the start of the block rather than as a row above it, so
 * that a paragraph with sound looks like a paragraph rather than like a player with a caption.
 */
function BlockAudio({ block, lessonId, play, playing }: BlockProps) {
  if (!('audio' in block) || !block.audio) return null;

  // A synthesised line is addressed by where it sits in *this* lesson, so the preview — which
  // has no lesson yet — can offer no button for one. An uploaded recording has an id of its
  // own and plays anywhere, including in the preview.
  const src = blockAudioUrl(lessonId ?? '', block.index, block.audio);
  if (!src || (!lessonId && !block.audio.clipId)) return null;

  return (
    <PlayButton
      src={src}
      playing={playing === src}
      onPlay={play}
      label="Read this aloud"
      className="float-left mt-0.5 mr-2.5 mb-1"
    />
  );
}

function Block(props: BlockProps) {
  const sound = useMemo(
    () => ({ lessonId: props.lessonId, block: props.block.index, play: props.play, playing: props.playing }),
    [props.lessonId, props.block.index, props.play, props.playing],
  );

  return (
    <Sound.Provider value={sound}>
      <BlockBody {...props} />
    </Sound.Provider>
  );
}

function BlockBody(props: BlockProps) {
  const { block } = props;

  switch (block.kind) {
    case 'heading': {
      const Tag = (['h2', 'h3', 'h4'] as const)[block.level - 1];
      return (
        <Tag
          className={cn(
            'mt-8 mb-2.5 scroll-mt-24 font-bold first:mt-0',
            block.level === 1 && 'text-[26px]',
            block.level === 2 && 'text-lg',
            block.level === 3 && 'text-[15px] text-muted-foreground uppercase tracking-[0.04em]',
          )}
        >
          <BlockAudio {...props} />
          <Inline nodes={block.content} />
        </Tag>
      );
    }

    case 'paragraph':
      return (
        <p className={cn(PROSE, 'mb-3.5 whitespace-pre-line')}>
          <BlockAudio {...props} />
          <Inline nodes={block.content} />
        </p>
      );

    case 'note':
      return (
        <p
          className={cn(
            PROSE,
            'my-4 rounded-r-sm border-l-[3px] border-primary bg-control-hover px-3.5 py-2.5',
            'text-sm whitespace-pre-line text-muted-foreground',
          )}
        >
          <BlockAudio {...props} />
          <Inline nodes={block.content} />
        </p>
      );

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <div className={cn(PROSE, 'mb-3.5')}>
          <BlockAudio {...props} />
          <Tag className={cn('ml-5 [&>li]:mb-1.5', block.ordered ? 'list-decimal' : 'list-disc')}>
            {block.items.map((item, at) => (
              <li key={at}>
                <Inline nodes={item} />
              </li>
            ))}
          </Tag>
        </div>
      );
    }

    case 'table':
      return (
        <div className="my-4">
          <BlockAudio {...props} />
          {/* Scrolled inside its own box rather than pushing the page sideways, the way the
              conjugation tables are. A lesson about the cases is seven columns wide. */}
          <Table containerClassName="rounded-sm border border-border bg-card" className="min-w-[420px]">
            {block.header.length > 0 && (
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {block.header.map((cell, at) => (
                    <TableHead
                      key={at}
                      scope="col"
                      className="h-auto bg-muted px-3.5 py-2.5 text-xs font-bold tracking-[0.04em] text-muted-foreground uppercase"
                    >
                      <Inline nodes={cell} />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
            )}
            <TableBody>
              {block.rows.map((row, at) => (
                <TableRow key={at} className="hover:bg-transparent">
                  {row.map((cell, column) => (
                    <Cell key={column} cell={cell} />
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );

    case 'image':
      return <Picture block={block} />;

    case 'video':
      return <Video block={block} />;

    case 'quiz':
      return <EmbeddedQuiz quizId={block.quizId} progress={props.progress} />;

    case 'story':
      return <StoryEmbed storyId={block.storyId} chapter={block.chapter} english={block.english} />;

    case 'audio': {
      const src = blockAudioUrl(props.lessonId ?? '', block.index, block.audio);
      if (!src || (!props.lessonId && !block.audio.clipId)) return null;
      return (
        <div className="my-4">
          <PlayButton src={src} playing={props.playing === src} onPlay={props.play} big label="Play" />
        </div>
      );
    }

    case 'rule':
      return <hr className="my-7 border-border" />;
  }
}

/** One table cell, set in the heavier face when it holds the script being learned. */
function Cell({ cell }: { cell: LessonInline[] }) {
  // `plainInline` rather than a shallow pass over the nodes: a cell reading {blue:ვ}ხატავ has
  // its Georgian inside a colour, and something that only looked at the top level would see
  // "ხატავ" — or, for a fully coloured cell, nothing at all, and set it in the English face.
  const text = plainInline(cell);
  return (
    <TableCell className={cn('px-3.5 py-2.5 text-[14.5px]', TARGET_SCRIPT.test(text) && 'text-[17px] font-semibold')}>
      <Inline nodes={cell} />
    </TableCell>
  );
}

/**
 * An uploaded picture.
 *
 * `width` and `height` come off the snapshot rather than out of the markup, so the browser can
 * hold the space before the bytes arrive. Where the header could not be read they are zero and
 * the attributes are left off entirely — a `width="0"` would be a promise of nothing.
 *
 * The alt text is the description stored with the upload; the caption stands in when there is
 * none, and an empty string when there is neither, which is the correct HTML for a picture
 * carrying no information a reader would otherwise miss.
 */
function Picture({ block }: { block: Extract<LessonBlock, { kind: 'image' }> }) {
  const details = lessonImages()[block.mediaId];
  const caption = plainInline(block.caption);

  return (
    <figure className="my-5">
      <img
        src={mediaUrl(block.mediaId)}
        alt={details?.alt || caption}
        {...(details?.width ? { width: details.width, height: details.height } : {})}
        loading="lazy"
        className="h-auto max-w-full rounded-sm border border-border bg-card"
      />
      {block.caption.length > 0 && (
        <figcaption className="mt-1.5 text-[13px] text-faint">
          <Inline nodes={block.caption} />
        </figcaption>
      )}
    </figure>
  );
}

/**
 * A YouTube video — as a poster and a play button until somebody presses it.
 *
 * The facade is the whole of what is interesting here. An embedded player is around a megabyte
 * of somebody else's JavaScript, and it loads whether or not anybody watches: a lesson with
 * three videos in it would pull three of them before the first paragraph had been read, on
 * whatever connection the reader happens to have. It also sets cookies for a third party on
 * behalf of somebody who has not asked to watch anything.
 *
 * So nothing of YouTube's is loaded until the button is pressed — a poster image, and then the
 * player with `autoplay=1` so the press that swapped it in is also the press that starts it.
 * `youtube-nocookie.com` is the domain YouTube provides for exactly this reason.
 *
 * The poster is fetched from YouTube too, which is a third-party request of its own; it is one
 * image against a megabyte of player, and there is no version of "embed a YouTube video" that
 * asks them for nothing at all.
 */
function Video({ block }: { block: Extract<LessonBlock, { kind: 'video' }> }) {
  const [watching, setWatching] = useState(false);
  const [poster, setPoster] = useState(true);
  const caption = plainInline(block.caption);

  return (
    <figure className="my-5">
      {/* 16:9 with a cap, so a video in a column of prose is a video rather than a billboard. */}
      <div className="relative aspect-video w-full max-w-[42rem] overflow-hidden rounded-sm border border-border bg-black">
        {watching ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${block.videoId}?autoplay=1&rel=0${block.start ? `&start=${block.start}` : ''}`}
            title={caption || 'YouTube video'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setWatching(true)}
            aria-label={caption ? `Play the video: ${caption}` : 'Play the video'}
            className="group absolute inset-0 grid cursor-pointer place-items-center"
          >
            {poster && (
              <img
                src={`https://i.ytimg.com/vi/${block.videoId}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                // A video that has been made private since the lesson was written has no
                // thumbnail. The button still works and still says what it is; the black box
                // behind it is a better answer than a broken-image icon.
                onError={() => setPoster(false)}
                className="absolute inset-0 size-full object-cover"
              />
            )}
            <span className="relative grid h-11 w-16 place-items-center rounded-[12px] bg-black/70 transition-colors group-hover:bg-[#f00]">
              <Play className="size-6 fill-white text-white" aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
      {block.caption.length > 0 && (
        <figcaption className="mt-1.5 text-[13px] text-faint">
          <Inline nodes={block.caption} />
        </figcaption>
      )}
    </figure>
  );
}

/* ---------------------------------------------------------------- quizzes */

/**
 * How a lesson's quizzes are getting on, and what to do when one of them ends.
 *
 * Handed down from the page rather than worked out here, because it is one fact about the whole
 * lesson — how much of it is done — and each quiz on the page is a part of it. Null where
 * nobody is keeping score; the quizzes are still fully answerable there.
 */
export interface LessonQuizProgress {
  /** Which of this lesson's quizzes have been passed. */
  passed: ReadonlySet<string>;
  /** A run has just ended. What that means is the page's business — see `LessonPage`. */
  onFinish: (
    quizId: string,
    result: QuizMark,
    answers: Record<number, QuizAnswer>,
    asked: number[],
  ) => void;
}

/**
 * A quiz in the middle of a lesson: a card, and behind it the whole screen.
 *
 * It used to be the runner itself, sitting in the prose with the lesson going on above and below
 * it. That reads well enough for one question and badly for eight: the next heading is visible
 * over the top of the options, the answer to question three is often in the paragraph beside it,
 * and a run has no beginning or end — you simply scroll past it.
 *
 * So the block is an invitation, and pressing it covers the lesson entirely. What is on screen
 * during a run is the quiz and nothing else, and the way back is a button rather than a scroll
 * position. That is also what makes the run *countable*: it has a start somebody chose and an
 * end the page hears about, which is what the lesson's progress is built from.
 *
 * Which reverses something. A quiz embedded in a lesson used to record nothing, on the grounds
 * that getting one question right while reading is not the same claim as having taken the quiz.
 * That was the right rule for a quiz you scrolled past half-answered, and it is the wrong one
 * for this: what happens here now is a whole run of the whole quiz, begun on purpose and marked
 * at the end, which is the same claim the quiz page makes. So it is kept — the page hands the
 * result to `useRecorder` — and the tick this puts on the quiz index means what it says there.
 *
 * The card is drawn from the snapshot's quiz summaries rather than from a fetch. A lesson with
 * three quizzes used to make three requests as the page drew — for three titles — and now makes
 * none until somebody starts one.
 */
function EmbeddedQuiz({ quizId, progress }: { quizId: string; progress: LessonQuizProgress | null }) {
  const summary = quizSummaries().find(quiz => quiz.id === quizId);
  const [running, setRunning] = useState(false);
  const passed = progress?.passed.has(quizId) ?? false;

  // A body names the quizzes it embeds as text, so nothing stops one being deleted out from
  // under a lesson — and the snapshot lists every quiz there is, so a name missing from it is a
  // name that no longer exists. Saying so beats a hole in the page: whoever is reading knows
  // something is missing, and whoever wrote it can search for the id.
  if (!summary) {
    return (
      <p className="my-5 rounded-lg border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
        There is no quiz called <code className="rounded-[4px] bg-muted px-[5px] py-px">{quizId}</code> any more.
      </p>
    );
  }

  return (
    <>
      <div
        className={cn(
          'my-6 max-w-[72ch] rounded-lg border-2 bg-card p-4 max-sm:px-3.5',
          passed ? 'border-m-5' : 'border-border',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-sm',
              passed
                ? 'bg-[color-mix(in_srgb,var(--m-5)_16%,transparent)] text-m-5'
                : 'bg-primary-light text-primary',
            )}
          >
            {passed ? <Check className="size-[18px]" /> : <ListChecks className="size-[18px]" />}
          </span>

          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-[11.5px] font-semibold tracking-[0.07em] uppercase',
                passed ? 'text-m-5' : 'text-muted-foreground',
              )}
            >
              {passed ? 'Quiz — passed' : 'Quiz'}
            </p>
            <h3 className="text-base leading-tight font-bold">{summary.title}</h3>
            {summary.titleNative && <p className="text-[15px] text-muted-foreground">{summary.titleNative}</p>}
          </div>
        </div>

        {summary.description && (
          <p className="mt-2.5 text-[14px] leading-relaxed text-muted-foreground">{summary.description}</p>
        )}

        {/* A quiz nobody has written any questions into yet. The reader is told rather than
            offered a button that would open on an empty screen. */}
        {summary.questionCount === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">There is nothing to answer in it yet.</p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Button variant="control" size="auto" onClick={() => setRunning(true)}>
              <Play /> {passed ? 'Take it again' : 'Start the quiz'}
            </Button>

            <span className="rounded-full bg-primary-glow px-2.5 py-0.5 text-[12.5px] font-medium text-primary">
              {summary.questionCount} {summary.questionCount === 1 ? 'question' : 'questions'}
            </span>

            {summary.hasAudio && (
              <span
                title="Some of this is meant to be heard"
                className="grid size-6 place-items-center rounded-full bg-muted text-muted-foreground"
              >
                <Volume2 className="size-3.5" aria-label="Has audio" />
              </span>
            )}

            {summary.level && <LevelBadge level={summary.level} />}
          </div>
        )}
      </div>

      <QuizOverlay
        summary={summary}
        open={running}
        onOpenChange={setRunning}
        progress={progress}
      />
    </>
  );
}

/**
 * The whole screen, for as long as a quiz is being taken.
 *
 * A dialog rather than a route, and the difference matters at the back button: a route would put
 * every quiz somebody opened into their history, so leaving a lesson with three quizzes in it
 * would mean pressing back four times. Closing this leaves the reader exactly where the lesson
 * was, scrolled to the card they pressed.
 *
 * Opaque and edge to edge rather than a panel over a dimmed page. The point of covering the
 * lesson is that the answers are often in it, and a translucent sheet over the paragraph that
 * gives the game away is no better than no sheet at all.
 *
 * A click outside cannot close it, because there is no outside — the panel fills the viewport —
 * and the guard is there so a stray click on the edge cannot throw away a half-finished run.
 * Escape still closes, as it must for anything modal.
 */
function QuizOverlay({
  summary,
  open,
  onOpenChange,
  progress,
}: {
  summary: QuizSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: LessonQuizProgress | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={event => event.preventDefault()}
        // Above the site header, which is sticky at z-100 and would otherwise sit on top of a
        // panel that is meant to be the only thing on screen. The dialog's own z-50 is enough
        // for a small centred box under that header; it is not enough for this.
        className="fixed inset-0 z-300 flex max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 sm:max-w-none"
      >
        <header className="flex items-start gap-3 border-b border-border bg-card px-5 py-3 max-sm:px-3.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm bg-primary-light text-primary">
            <ListChecks className="size-4" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[15px] leading-tight font-bold">{summary.title}</DialogTitle>
            <DialogDescription className="truncate text-[13px]">
              {summary.titleNative || 'Answer it, then go back to the lesson.'}
            </DialogDescription>
          </div>

          {/* Named rather than a bare cross: this is the one control on screen that says where
              leaving goes, and somebody half-way through a quiz should not have to guess. */}
          <Button variant="control" size="auto-sm" onClick={() => onOpenChange(false)}>
            <X /> <span className="max-sm:sr-only">Back to the lesson</span>
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 max-sm:px-3.5">
          <div className="mx-auto w-full max-w-[720px]">
            {open && <QuizRun summary={summary} progress={progress} onDone={() => onOpenChange(false)} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The run itself, fetched when the overlay opens.
 *
 * A `QuizSummary` carries no questions — see the note on the `Quiz` type — so this is where the
 * quiz proper is asked for, once somebody has said they want to take it. Mounted only while the
 * overlay is open, which is also what makes every opening a fresh run rather than a resumed one.
 */
function QuizRun({
  summary,
  progress,
  onDone,
}: {
  summary: QuizSummary;
  progress: LessonQuizProgress | null;
  onDone: () => void;
}) {
  const [quiz, setQuiz] = useState<Quiz | null | 'loading'>('loading');

  useEffect(() => {
    let live = true;
    void api.quiz
      .get({ id: summary.id })
      .then(found => {
        if (live) setQuiz(found);
      })
      .catch(() => {
        if (live) setQuiz(null);
      });

    return () => {
      live = false;
    };
  }, [summary.id]);

  if (quiz === 'loading') {
    return <p className="py-10 text-center text-muted-foreground">Loading the quiz…</p>;
  }

  if (!quiz) {
    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-muted-foreground">That quiz could not be loaded.</p>
        <Button variant="control" size="auto" onClick={onDone}>
          Back to the lesson
        </Button>
      </div>
    );
  }

  return (
    <QuizRunner
      quiz={quiz}
      onFinish={(result, answers, asked) => progress?.onFinish(quiz.id, result, answers, asked)}
      onExit={onDone}
      exitLabel="Back to the lesson"
    />
  );
}

/* --------------------------------------------------------------- the whole */

export interface LessonMarkupProps {
  doc: LessonDoc;
  /**
   * The lesson these blocks came from, for the audio route — which addresses a block by its
   * position in a lesson the server can look up. Null in the editor's preview, where the
   * document has not been saved and there is nothing to address.
   */
  lessonId?: string | null;
  /**
   * How the lesson's quizzes are getting on, for the blocks that hold one. Omitted where
   * nothing is keeping score — the quizzes still open, are still marked, and simply count
   * towards nothing.
   */
  progress?: LessonQuizProgress | null;
}

export default function LessonMarkup({ doc, lessonId = null, progress = null }: LessonMarkupProps) {
  const { play, playing } = usePlayer();

  return (
    <div>
      {doc.blocks.map(block => (
        <Block
          key={block.index}
          block={block}
          lessonId={lessonId}
          play={play}
          playing={playing}
          progress={progress}
        />
      ))}
    </div>
  );
}
