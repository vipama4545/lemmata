// Following a video the way the story player follows a recording.
//
// This is `useStoryAudio` with the clock swapped and almost nothing else changed, which is the
// whole reason the feature is small: the reader already knows how to be told "light this line
// now", and it does not care whether the thing doing the telling is an <audio> element or an
// iframe on somebody else's origin.
//
// It is in fact the simpler of the two. A chapter read aloud is a queue of one file per
// sentence, so skipping five seconds means walking that queue and subtracting durations as it
// goes; a video is one continuous timeline, so skipping is arithmetic and seeking is a method
// call. Everything `StoryAudio.tsx` does about cache keys, prefetching the next line and
// synthesising on demand has no counterpart here at all.
//
// Two things are kept out of React state, for the reason given at the head of StoryAudio.tsx.
// The playhead moves sixty times a second and writes the progress bar through a ref, and the
// cue index the loop compares against is a ref, because a paragraph is a re-render of a page
// that can be a thousand spans and this must only cost one when the highlight actually moves.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoTrack } from '@georgian/shared/contract';

/** What the skip buttons move by, matching the story player's. */
const SKIP = 5;

/** The speeds YouTube itself offers that are worth a learner's time. */
export const RATES = [0.5, 0.75, 1, 1.25];

/**
 * Just enough of the IFrame API to be honest about what is used.
 *
 * Typed here rather than pulled in as `@types/youtube`: this is four methods and two events out
 * of a large surface, and a dependency whose only job is to describe an object we already know
 * the shape of is a dependency to keep updated for nothing.
 */
interface Player {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  destroy(): void;
}

interface YT {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => Player;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}

declare global {
  interface Window {
    YT?: YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * Loads YouTube's player script, once per page however many videos are opened.
 *
 * The API announces itself by *calling a global*, which is a shape from before promises and
 * does not compose: a second component assigning `onYouTubeIframeAPIReady` would overwrite the
 * first and the first would wait forever. So the global is claimed here, once, and everything
 * afterwards waits on the promise this returns.
 */
let loading: Promise<YT> | null = null;

function loadApi(): Promise<YT> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;

  loading = new Promise<YT>((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('The YouTube player loaded without a player in it.'));
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    // A blocked script — an extension, a network that filters, an offline laptop — must end the
    // wait rather than leave every caller pending on a promise that will never settle.
    tag.onerror = () => reject(new Error('The YouTube player could not be loaded.'));
    document.head.appendChild(tag);
  });

  return loading;
}

export interface VideoController {
  /** Whether the player is up and the timeline is known. False draws no controls. */
  ready: boolean;
  playing: boolean;
  /**
   * "paragraph:first:last" of the line being spoken, or null between cues and while stopped.
   *
   * The same string `StoryProse` takes as `spokenLine`, and a string rather than the object it
   * describes so that writing it on every animation frame costs nothing: React compares with
   * Object.is and bails out, where a fresh object each frame would re-render the whole page
   * sixty times a second.
   */
  lineKey: string | null;
  /** Which paragraph is sounding, for the reader to scroll to. Null when none is. */
  paragraph: number | null;
  /** Set when the player could not be created — a blocked script, or embedding turned off. */
  error: string | null;
  toggle(): void;
  skip(seconds: number): void;
  /** Jump to the line a paragraph was spoken on, which is what clicking a word does. */
  playAt(paragraph: number): void;
  rate: number;
  setRate(rate: number): void;
  /** Where the iframe is put. */
  frameRef: React.RefObject<HTMLDivElement | null>;
  /** Written to directly by the playhead loop, never through state. */
  fillRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * The player, and which line of the transcript it is on.
 *
 * `track` is null until the timeline has been fetched, and passing null is the ordinary state
 * of a page that is still loading rather than an error: nothing is drawn and nothing is played.
 *
 * `words` is how many words each paragraph holds, so a line can be lit end to end. It comes
 * from the chapter's tokens rather than being recounted here — the reader keys its spans on
 * those positions, and counting the words a second way is one more thing that could disagree.
 */
export function useVideoTrack(track: VideoTrack | null, words: number[]): VideoController {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [paragraph, setParagraph] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const player = useRef<Player | null>(null);
  const frame = useRef(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const cues = useRef<VideoTrack['cues']>([]);
  const spans = useRef<number[]>([]);
  // Where the playhead was last found. Almost every frame is in the same cue as the one before
  // it or the one after, so the search starts here and walks — a scan of the whole list sixty
  // times a second is work nobody needs done.
  const cursor = useRef(0);

  cues.current = track?.cues ?? [];
  spans.current = words;

  /**
   * The playhead: which line is being spoken, and how far through the video we are.
   *
   * There is no event for this. The IFrame API reports that playback started and that it
   * stopped, and nothing in between, so the current time is read every frame — which is what
   * the story player already does with `audio.currentTime`, for the same reason.
   */
  const follow = useCallback(() => {
    const found = player.current;
    const list = cues.current;

    if (found && list.length) {
      const now = found.getCurrentTime();

      // Walk from where we were. Backwards as readily as forwards, because seeking is a jump
      // and a reader clicking a line halfway up the page is the ordinary way this moves.
      let at = Math.min(cursor.current, list.length - 1);
      while (at > 0 && now < (list[at]?.start ?? 0)) at -= 1;
      while (at < list.length - 1 && now >= (list[at + 1]?.start ?? Infinity)) at += 1;
      cursor.current = at;

      const cue = list[at];
      // Between two cues nothing is lit. Subtitles have real gaps in them — nobody is speaking
      // — and holding the last line through the silence reads as a highlight that has stuck,
      // which is how it was first reported. The story player holds the last *word* through a
      // gap for the opposite reason: there the gaps are the pauses inside one spoken line.
      const live = cue ? now >= cue.start && now < cue.end : false;
      setParagraph(live ? at : null);
      setLineKey(live ? `${at}:0:${Math.max(0, (spans.current[at] ?? 1) - 1)}` : null);

      if (fillRef.current) {
        const total = found.getDuration();
        if (total > 0) fillRef.current.style.width = `${Math.min(100, (now / total) * 100)}%`;
      }
    }

    frame.current = requestAnimationFrame(follow);
  }, []);

  /* ------------------------------------------------------------------ the player */

  useEffect(() => {
    if (!track) return;

    let live = true;
    setReady(false);
    setError(null);

    void loadApi().then(
      api => {
        if (!live || !frameRef.current) return;
        player.current = new api.Player(frameRef.current, {
          videoId: track.youtubeId,
          // `playsinline` so that a phone does not take the video fullscreen and hide the
          // prose, which is the entire point of the screen. `rel: 0` keeps the end card's
          // suggestions to this channel rather than turning the end of a lesson into a feed.
          // `fs: 0` takes YouTube's own fullscreen button away, and that is load-bearing rather
          // than tidying. Their button fullscreens the iframe from the inside, and a fullscreen
          // cross-origin iframe is the only thing the browser paints — so the subtitles drawn
          // over the picture would simply cease to exist, with no way for this side to know or
          // to stop it. Fullscreen is offered on our own control instead, which takes it on a
          // wrapper that holds the overlay too. See useFullscreen.ts.
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0 },
          events: {
            onReady: () => {
              if (live) setReady(true);
            },
            onStateChange: event => {
              if (!live) return;
              setPlaying(event.data === api.PlayerState.PLAYING);
              if (event.data === api.PlayerState.ENDED) {
                setLineKey(null);
                setParagraph(null);
              }
            },
          },
        });
      },
      (thrown: unknown) => {
        if (live) setError(thrown instanceof Error ? thrown.message : 'The player could not be loaded.');
      },
    );

    return () => {
      live = false;
      cancelAnimationFrame(frame.current);
      // Destroying replaces the element the player was built on, so the ref is dropped with it.
      // Without this, leaving the page while a video plays leaves it playing.
      player.current?.destroy();
      player.current = null;
    };
  }, [track]);

  /**
   * The loop runs only while something is playing.
   *
   * A paused video's time does not move, so a paused reader does not need sixty wake-ups a
   * second to be told so. One last pass is run on stopping, because pausing between two cues
   * would otherwise leave whatever was lit at the moment of the last frame lit forever.
   */
  useEffect(() => {
    if (!ready) return;
    if (playing) {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(follow);
      return () => cancelAnimationFrame(frame.current);
    }
    cancelAnimationFrame(frame.current);
    return;
  }, [ready, playing, follow]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /* -------------------------------------------------------------------- controls */

  const toggle = useCallback(() => {
    const found = player.current;
    if (!found) return;
    if (playing) found.pauseVideo();
    else found.playVideo();
  }, [playing]);

  const skip = useCallback((seconds: number) => {
    const found = player.current;
    if (!found) return;
    // Clamped at both ends: seeking past the end stops the video, and seeking below zero is
    // refused by the player rather than treated as the beginning.
    const to = Math.max(0, Math.min(found.getDuration() || Infinity, found.getCurrentTime() + seconds));
    found.seekTo(to, true);
  }, []);

  /**
   * Jump to where a paragraph is spoken.
   *
   * A hair before the cue rather than exactly on it. Seeking lands on the nearest keyframe,
   * which can be a fraction *after* the requested time, and a landing a tenth of a second late
   * clips the first syllable of the line you asked to hear — which for a learner is the
   * syllable that matters.
   */
  const playAt = useCallback((at: number) => {
    const found = player.current;
    const cue = cues.current[at];
    if (!found || !cue) return;
    found.seekTo(Math.max(0, cue.start - 0.15), true);
    found.playVideo();
  }, []);

  const changeRate = useCallback((next: number) => {
    setRate(next);
    player.current?.setPlaybackRate(next);
  }, []);

  return {
    ready,
    playing,
    lineKey,
    paragraph,
    error,
    toggle,
    skip,
    playAt,
    rate,
    setRate: changeRate,
    frameRef,
    fillRef,
  };
}

export { SKIP };
