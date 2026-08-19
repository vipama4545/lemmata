// Watching a video and reading it at the same time.
//
// The prose is `StoryProse`, unchanged and un-forked — the same component the library and the
// lessons show a text with, so a word in a video means what a word in a story means: hover it
// for the sense that applies here, click it to fix the link, watch it dim as you learn it. What
// this screen adds is the video above it and the clock that ties the two together.
//
// One column, video above and subtitles below, and the video pinned to the top of the viewport
// as the text scrolls under it. That is the one thing this page must get right: a highlight
// moving down a transcript is no use to anybody who has to scroll away from the video to read it.
//
// Beside each other was the first arrangement and it was worse, for a reason that only shows up
// with real subtitles in it. A cue is a short line — a dozen words — so a column half the screen
// wide sets each one as a stack of two or three, and the highlight moving through them reads as
// jumping about rather than travelling down the page. Full width gives a subtitle a single line,
// which is the shape it was written in.
//
// Links are corrected here rather than on a screen of their own, and by the same panel the
// library reader uses. A subtitle track is worse raw material than a written story — auto
// captions have no punctuation and guess at proper nouns — so a video arrives with more of the
// resolver's guesses in it than a pasted text does, and the place to fix a word is the place you
// noticed it was wrong. The corrections are ordinary story pins: `via: 'override'`, kept through
// every later relink, exactly as they are for anything else in the library.
//
// Following the line, rather than the word, is the honest limit of what a subtitle track knows.
// A cue is "these words, between these two moments" and nothing inside it says when each word
// lands. The reader already had this case — a line the voice could not be aligned to lights
// whole — so it needed nothing new, and where per-word timings do exist later the same
// component takes them through `spokenAt`.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GripHorizontal, Link2, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Trash2, X } from 'lucide-react';
import type { VideoTrack } from '@georgian/shared/contract';
import type { Story, StoryToken } from '@georgian/shared/types';
import { Button } from '@/components/ui/button';
import { Page } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import StoryProse, { linkTally } from '../components/StoryProse';
import { forgetStory, replaceStory } from '../data/stories';
import { api } from '../api/client';
import { useStory } from '../data/stories';
import { useLibraryEdit, useSignedIn } from '../library/store';
import { ErrorLine, SignInFirst } from '../library/ui';
import { RATES, SKIP, useVideoTrack } from './useVideoTrack';
import { useVideoSize } from './useVideoSize';
import { useAwake, useFullscreen } from './useFullscreen';
import { useCaptionSpot } from './useCaptionSpot';
import { videosHref } from './href';

// The same panel the library reader corrects a word with, and it needs no telling that this is
// a video: it branches on `story.mine`, a video story is owned, and so it writes through
// `library.setStoryToken` like any other story of your own. Lazily loaded because most visits
// here are to watch something rather than to fix it.
const TokenEditor = lazy(() => import('../admin/TokenEditor'));

/** Which occurrence the panel is open on. */
interface Editing {
  token: StoryToken;
  paragraph: number;
  position: number;
}

export default function VideoReader() {
  const signedIn = useSignedIn();
  if (!signedIn) return <SignInFirst what="your video library" />;
  return <Reader />;
}

function Reader() {
  const { storyId } = useParams<{ storyId: string }>();
  const { story: fetched, loading } = useStory(storyId, 0);

  // Editing is a mode rather than something always on, for the reason the library reader gives:
  // it turns every word into a control, and a video is opened to be watched.
  const navigate = useNavigate();
  const { busy, error: failure, run } = useLibraryEdit();
  const [confirming, setConfirming] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editingToken, setEditingToken] = useState<Editing | null>(null);
  // A save answers with the whole relinked chapter, and that is what the page shows from then
  // on. Held here rather than pushed back through `useStory`, so the fetch hook stays about
  // fetching. Guarded on the id so that one render of another video's tokens can never land on
  // this one's prose.
  const [edited, setEdited] = useState<Story | null>(null);
  const story = edited && edited.id === storyId ? edited : fetched;

  useEffect(() => {
    setEdited(null);
    setEditingToken(null);
  }, [storyId]);

  // Leaving edit mode takes the panel with it, as turning the player off takes its controls.
  useEffect(() => {
    if (!editing) setEditingToken(null);
  }, [editing]);

  const [track, setTrack] = useState<VideoTrack | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!storyId) return;
    let live = true;
    setTrack(null);
    setGone(false);

    void api.library.video({ storyId }).then(
      found => {
        if (!live) return;
        setTrack(found);
        setGone(!found);
      },
      () => {
        if (live) setGone(true);
      },
    );

    return () => {
      live = false;
    };
  }, [storyId]);

  // One count per paragraph, so a line can be lit end to end. Off the chapter's tokens rather
  // than recounted from the prose: those positions are what the spans are keyed on, and a
  // second count is a second thing to disagree.
  const words = useMemo(() => (story?.tokens ?? []).map(list => list.length), [story]);

  // `headRef` is the pinned block holding the video and its controls. Two things measure it:
  // the resize, which may not let the frame outgrow the column it sits in, and the scroll below,
  // which puts the spoken line just under whatever that block currently covers.
  const proseRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const lastScrolled = useRef<number | null>(null);

  const video = useVideoTrack(track, words);
  const size = useVideoSize(headRef);
  // Taken on the wrapper below, never on the iframe — that distinction is the whole feature.
  // See useFullscreen.ts.
  const frameWrap = useRef<HTMLDivElement | null>(null);
  const full = useFullscreen(frameWrap);
  const awake = useAwake(full.on, frameWrap);
  // The picture's own box — what the caption is dragged around inside, and what its position is
  // stored as a fraction of.
  const pictureRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const spot = useCaptionSpot(pictureRef, captionRef);

  /**
   * Removes this video from the library.
   *
   * `library.deleteStory`, not a video-shaped endpoint of its own: a video story *is* a story,
   * and `story_videos` hangs off that row with `on delete cascade`, so the subtitles and their
   * timings go with the prose and the tokens.
   */
  const remove = async () => {
    if (!storyId) return;
    const done = await run(() => api.library.deleteStory({ id: storyId }));
    if (!done) return;
    // Chapters are held for the session, so without this the video goes on being readable from
    // the cache after it has been deleted.
    forgetStory(storyId);
    navigate(videosHref(), { replace: true });
  };

  // The one line to draw over the picture while fullscreen. A slice of the chapter rather than a
  // string, so the overlay can be the same `StoryProse` as everything else and a word over the
  // video means what a word in the list below means: hover it and it says what it is there.
  const overlaid = useMemo(() => {
    if (!story || video.paragraph === null) return null;
    const paragraph = story.paragraphs[video.paragraph];
    if (paragraph === undefined) return null;
    return {
      ...story,
      paragraphs: [paragraph],
      tokens: [story.tokens[video.paragraph] ?? []],
      // Dropped rather than sliced. There is room over a video for one line of the language being
      // learned, and the English under it would be the answer given away at exactly the moment
      // the reader is meant to be working it out.
      translation: [],
    };
  }, [story, video.paragraph]);

  // Keep the sounding line on screen. Only while playing, and only when it has actually moved:
  // scrolling under somebody who is reading ahead — or who has scrolled back deliberately — is
  // the fastest way to make a page feel possessed.

  useEffect(() => {
    if (!video.playing || video.paragraph === null) return;
    if (lastScrolled.current === video.paragraph) return;
    lastScrolled.current = video.paragraph;

    const line = proseRef.current?.querySelectorAll('[data-paragraph]')[video.paragraph];
    if (!line) return;

    // Where the video block's bottom edge actually is, right now, in the window. Not its height:
    // the block is pinned below the app header on a wide screen and scrolls with the page on a
    // narrow one, so its height is the same in both and its position is not. Reading the live
    // rectangle is the one measurement that is right in both cases — and it is also why this is
    // not `scrollIntoView({ block: 'center' })`, which puts the line behind the player on any
    // screen where the video is taller than half the window.
    //
    // Floored at the app's own header, which is sticky and covers the top of the window whatever
    // this page does. On a narrow screen the video scrolls away and its bottom edge goes
    // negative, and without the floor the line would be put where the title bar is.
    const shell = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--spacing-header'),
      10,
    );
    const floor = Number.isFinite(shell) ? shell : 0;
    const under = Math.max(floor, headRef.current?.getBoundingClientRect().bottom ?? 0) + 16;
    const top = line.getBoundingClientRect().top + window.scrollY - under;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [video.playing, video.paragraph]);

  if (loading) return <Page />;
  if (!story || gone) {
    return (
      <Page>
        <p className="text-muted-foreground">
          There is no such video in your library.{' '}
          <Link to={videosHref()} className="font-semibold text-primary hover:underline">
            Back to your videos
          </Link>
          .
        </p>
      </Page>
    );
  }

  const nextRate = RATES[(RATES.indexOf(video.rate) + 1) % RATES.length];

  return (
    <Page>
      <Link
        to={videosHref()}
        className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        My videos
      </Link>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{story.title}</h1>
        <Button
          type="button"
          variant={editing ? 'controlOn' : 'control'}
          size="auto-sm"
          className="ml-auto"
          onClick={() => setEditing(on => !on)}
          title="Correct what each word in these subtitles links to"
        >
          <Link2 />
          Edit links
        </Button>

        {confirming ? (
          <span className="flex items-center gap-2 text-sm">
            {/* What goes is more than the video: every word corrected on it goes with it, and
                that is the part worth a moment's pause. */}
            <span className="max-sm:hidden">Delete this and your corrections on it?</span>
            <Button variant="dangerOutline" size="auto-sm" disabled={busy} onClick={() => void remove()}>
              Yes, delete
            </Button>
            <Button variant="control" size="auto-sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="dangerOutline"
            size="icon-sm"
            disabled={busy}
            onClick={() => setConfirming(true)}
            aria-label="Delete this video"
            title="Remove this video from your library"
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {failure && <ErrorLine>{failure}</ErrorLine>}

      {/* Only in the mode it describes. Auto-captions come with no punctuation and a lot of
          proper nouns the dictionary has never heard of, so the two numbers worth having in
          front of you while fixing them are what matched nothing and what was reached by a
          guess. One line rather than the library reader's legend, because it sits above a video
          that is already taking the top of the screen. */}
      {editing && <EditNote story={story} />}

      <div className={cn('flex flex-col gap-5', size.dragging && 'cursor-ns-resize select-none')}>
        {/* Pinned below the app's own header, not to the top of the window — `top-header` is the
            same offset the sidebar sticks at, and it is not decoration. That header is sticky
            too and sits at z-100, so a video stuck at top-0 scrolls up underneath it and loses
            its top third behind the title bar, which is exactly what it looked like.

            Static below `md`. A phone gives about 600px of height, and a pinned 16:9 video plus
            its controls is more than half of that — leaving a slot too short to read a subtitle
            in. On a small screen the video scrolls away and the text gets the room.

            Negative margins and matching padding so the backdrop reaches the full width of the
            column while the video itself stays at a size worth watching: a 16:9 frame stretched
            across a desktop is most of a screen given to something you are meant to be reading
            alongside. */}
        <div
          ref={headRef}
          className="sticky top-header z-20 -mx-4 border-b border-border bg-background/95 px-4 pt-2 pb-3 backdrop-blur max-md:static max-md:mx-0 max-md:border-0 max-md:bg-transparent max-md:px-0 md:-mx-6 md:px-6"
        >
          <div className="mx-auto w-full" style={{ maxWidth: size.width }}>
            {/* The element fullscreen is taken on. It holds the iframe *and* the caption, which is
                why the caption survives going fullscreen — see useFullscreen.ts. Fullscreen sizes
                this to the screen, so the aspect box inside is centred rather than stretched and
                the letterboxing is ours. */}
            <div
              ref={frameWrap}
              className={cn(
                'overflow-hidden border border-border bg-black shadow-card',
                full.on ? 'flex size-full items-center justify-center rounded-none border-0' : 'rounded-lg',
                // A pointer left sitting over a film is a smudge on it. Back the moment it moves.
                full.on && !awake && 'cursor-none',
              )}
            >
              {/* 16:9 without an aspect-ratio on the iframe itself, because the player replaces
                  the element it is given and takes its own attributes with it. */}
              <div
                ref={pictureRef}
                className={cn(
                  'relative',
                  full.on ? 'aspect-video max-h-full w-full max-w-[calc(100vh*16/9)]' : 'w-full pt-[56.25%]',
                )}
              >
                <div ref={video.frameRef} className="absolute inset-0 size-full [&>iframe]:size-full" />

                {/* Over the picture, along the bottom, where a subtitle has always been set.
                    `pointer-events-none` on the band and `auto` on the text, so the parts that
                    are only backdrop do not swallow a click meant for the video while the words
                    themselves stay hoverable. Sized in `vh` so it holds its proportion of the
                    screen on a laptop and on a television alike. */}
                {/* Out of the way when nothing has moved for a moment, back the instant it does.
                    Only the button: the caption stays, because a subtitle that fades after two
                    seconds is one that is missing every time you look up at it. */}
                {full.on && (
                  <div
                    className={cn(
                      'absolute top-0 right-0 z-20 p-[2vh] transition-opacity duration-300',
                      awake ? 'opacity-100' : 'pointer-events-none opacity-0',
                    )}
                  >
                    <button
                      type="button"
                      onClick={full.toggle}
                      aria-label="Leave fullscreen"
                      title="Leave fullscreen (or press Escape)"
                      className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      <X className="size-4" />
                      Exit
                    </button>
                  </div>
                )}

                {full.on && overlaid && (
                  // Placed with plain `left`/`top`, or centred along the bottom with
                  // `left-0 right-0 mx-auto w-fit` when it has never been moved. Both because
                  // neither may use a transform — see the head of useCaptionSpot.ts.
                  <div
                    ref={captionRef}
                    style={spot.style}
                    className={cn(
                      'pointer-events-auto absolute z-10 max-w-[46ch]',
                      !spot.placed && 'right-0 left-0 mx-auto w-fit',
                      spot.dragging && 'select-none',
                    )}
                  >
                    {/* The dark band is a layer of its own behind the words rather than a
                        background on the element holding them, and that is not decoration. A
                        `backdrop-filter` — or any filter — makes an element a containing block
                        for `position: fixed` descendants, and the definition card is fixed and
                        placed in *viewport* coordinates. Put the blur on the box holding the
                        words and the card resolves against the caption instead, lands near the
                        bottom of the screen, and is clipped away by the frame's
                        `overflow-hidden`. The blur belongs to this band alone. */}
                    <div aria-hidden className="absolute inset-0 rounded-lg bg-black/70 backdrop-blur-sm" />

                    {/* The handle. A band dragged by its words would be a band you cannot hover
                        a word in, and hovering a word is the point of it — so the grip is its
                        own strip, and it fades with the rest of the chrome. */}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Move the subtitles"
                      title="Drag to move — double-click to put it back"
                      onPointerDown={spot.onPointerDown}
                      onKeyDown={spot.onKeyDown}
                      onDoubleClick={spot.reset}
                      className={cn(
                        'relative flex h-5 cursor-move touch-none items-center justify-center transition-opacity',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                        awake || spot.dragging ? 'opacity-60 hover:opacity-100' : 'opacity-0',
                      )}
                    >
                      <GripHorizontal className="size-4 text-white" />
                    </div>

                    {/* `text-center` goes on the prose itself and not on this wrapper, and the
                        difference is not cosmetic. `StoryProse` renders the paragraphs and the
                        definition card as two siblings of one fragment, so both land in whatever
                        element wraps it — and `text-align` inherits. Centred here, the card
                        centred with them: its gloss, its level row, its Full entry link, all
                        pulled to the middle of a panel laid out to be read down the left edge.
                        The colour and size overrides above are safe on this wrapper only because
                        they are `[&_p]` descendant selectors, which the card, being a sibling of
                        the prose root rather than inside it, never matches. */}
                    <div className="relative px-5 pb-3">
                      <StoryProse
                        story={overlaid}
                        layout="lines"
                        highlight={false}
                        size="compact"
                        className="text-center [&>div]:border-0 [&>div]:py-0 [&_p]:!text-[clamp(18px,2.4vh,30px)] [&_p]:!leading-snug [&_p]:text-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {video.error && (
              <p className="mt-3 text-sm text-destructive">
                {video.error} The text below still reads, and every word still works.
              </p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <Button
                type="button"
                variant="control"
                size="icon-sm"
                onClick={video.toggle}
                disabled={!video.ready}
                aria-label={video.playing ? 'Pause' : 'Play'}
                title={video.playing ? 'Pause' : 'Play'}
              >
                {video.playing ? <Pause /> : <Play />}
              </Button>
              <Button
                type="button"
                variant="control"
                size="auto-sm"
                className="max-sm:size-8 max-sm:px-0"
                onClick={() => video.skip(-SKIP)}
                disabled={!video.ready}
                aria-label={`Back ${SKIP} seconds`}
                title={`Back ${SKIP} seconds`}
              >
                <RotateCcw />
                <span className="max-sm:hidden">{SKIP}s</span>
              </Button>
              <Button
                type="button"
                variant="control"
                size="auto-sm"
                className="max-sm:size-8 max-sm:px-0"
                onClick={() => video.skip(SKIP)}
                disabled={!video.ready}
                aria-label={`Forward ${SKIP} seconds`}
                title={`Forward ${SKIP} seconds`}
              >
                <RotateCw />
                <span className="max-sm:hidden">{SKIP}s</span>
              </Button>

              {/* Only where the browser will put a plain element fullscreen. iPhone Safari grants
                  it to a <video> and to nothing else, so there the control is absent rather than
                  present and dead — the rest of the page works there unchanged. */}
              {full.supported && (
                <Button
                  type="button"
                  variant="control"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={full.toggle}
                  disabled={!video.ready}
                  aria-label={full.on ? 'Leave fullscreen' : 'Fullscreen, subtitles over the picture'}
                  title={full.on ? 'Leave fullscreen' : 'Fullscreen, subtitles over the picture'}
                >
                  {full.on ? <Minimize /> : <Maximize />}
                </Button>
              )}

              <Button
                type="button"
                variant={video.rate === 1 ? 'control' : 'controlOn'}
                size="xs"
                className={cn('h-8', !full.supported && 'ml-auto')}
                onClick={() => video.setRate(nextRate)}
                disabled={!video.ready}
                aria-label={`Speed ${video.rate}×. Change to ${nextRate}×`}
                title={`Playing at ${video.rate}× — click for ${nextRate}×`}
              >
                {video.rate}×
              </Button>
            </div>

            <div className="mt-2 h-1 overflow-hidden rounded-full bg-border">
              <div ref={video.fillRef} className="h-full w-0 rounded-full bg-primary" />
            </div>
          </div>

          {/* Drag down for a bigger picture, up for more subtitles — the two are one number, and
              this is where it is set. A separator rather than a button, because that is what it
              is: the boundary between two regions that share a fixed amount of room.

              Hidden below `md` along with the pinning. On a phone the video is full width and
              scrolls away with the page, so there is no trade to make and nothing to drag. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Video size"
            aria-valuenow={Math.round(size.width)}
            aria-valuemin={size.min}
            aria-valuemax={Math.round(size.max)}
            tabIndex={0}
            onPointerDown={size.onPointerDown}
            onKeyDown={size.onKeyDown}
            onDoubleClick={size.reset}
            title="Drag to resize the video — double-click to reset"
            className={cn(
              'group mx-auto mt-1.5 flex h-4 w-32 cursor-ns-resize touch-none items-center justify-center rounded',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              'max-md:hidden',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'h-1 w-full rounded-full bg-border transition-colors',
                'group-hover:bg-border-strong',
                size.dragging && 'bg-primary',
              )}
            />
          </div>
        </div>

        {/* The subtitles. `layout="lines"` because that is what this is: one cue per row, each
            its own line of speech, and running them together as a page of prose would lose
            exactly the boundary the video is timed to. */}
        <div ref={proseRef} className="min-w-0">
          <StoryProse
            story={story}
            layout="lines"
            spokenLine={editing ? null : video.lineKey}
            onPlayFrom={paragraph => video.playAt(paragraph)}
            editing={editing}
            onEditWord={(token, paragraph, position) => setEditingToken({ token, paragraph, position })}
          />
        </div>
      </div>

      {editingToken && (
        <Suspense fallback={null}>
          <TokenEditor
            story={story}
            chapter={0}
            paragraph={editingToken.paragraph}
            position={editingToken.position}
            token={editingToken.token}
            onClose={() => setEditingToken(null)}
            onSaved={result => {
              // The server hands back the whole relinked chapter. Showing that rather than
              // patching the one token in place is what keeps the screen and the database
              // agreeing — pinning a spelling "everywhere" changes tokens this panel never saw,
              // and a subtitle track repeats itself far more than prose does, so "everywhere" is
              // the button that gets used here.
              setEdited(result.story);
              replaceStory(result.story);
              setEditingToken(null);
            }}
          />
        </Suspense>
      )}
    </Page>
  );
}

/** What is left to look at, in one line. */
function EditNote({ story }: { story: Story }) {
  const tally = linkTally(story);
  return (
    <p className="mb-4 rounded-md border border-border bg-card px-3 py-2 text-[13.5px] text-muted-foreground">
      Every word is a button — click one to link it to an entry, name it as a proper noun for this
      video only, or mark it as deliberately not a word.{' '}
      <strong className="text-foreground">{tally.unresolved}</strong> matched nothing,{' '}
      <strong className="text-foreground">{tally.guessed}</strong> reached by a guess,{' '}
      <strong className="text-foreground">{tally.pinned}</strong> decided by hand.
    </p>
  );
}
