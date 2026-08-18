// Reading a story aloud, and following along.
//
// The chapter is not one recording. It is one file per sentence — see the note in
// apps/server/src/tts/sentences.ts about why — so playing a chapter means playing a queue,
// and every control here is really a question about where in that queue we are. Skipping
// back five seconds from the start of a line lands in the middle of the one before it.
//
// Two things are deliberately kept out of React state, for the same reason. The reader can
// be a thousand word spans and it re-renders whenever this hook's state changes, so state
// here is only what genuinely changes at reading pace: which word is sounding, two or three
// times a second. The playhead moves sixty times a second and drives the progress bar
// through a ref, and the queue position the callbacks read is a ref too, because a callback
// that closed over a stale index would skip from the wrong line.

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AudioLine, Timings } from "../data/storyAudio";
import { audioUrl, manifest, timings } from "../data/storyAudio";

/** What the skip buttons move by. */
const SKIP = 5;

/** Speeds worth offering a learner. 1 is the voice as trained; below it is for shadowing. */
const RATES = [0.75, 1, 1.25];

export interface StoryAudioController {
  /** Whether there is anything to play at all. False hides the bar entirely. */
  available: boolean;
  playing: boolean;
  /**
   * "paragraph:word" of the word sounding now, or null between words and while stopped.
   * The same key the reader builds for each span, so a comparison is all that is needed.
   */
  at: string | null;
  /**
   * The line sounding now.
   */
  line: AudioLine | null;
  /**
   * "paragraph:first:last" while a line with *no* word timings is sounding, and null
   * otherwise — the reader's cue to mark the whole sentence rather than nothing at all.
   *
   * A string rather than the object it describes so that setting it on every animation frame
   * costs nothing: React compares with Object.is and bails out of the render, where a fresh
   * `{ }` each frame would re-render the whole story sixty times a second.
   */
  lineKey: string | null;
  toggle(): void;
  stop(): void;
  skip(seconds: number): void;
  /** Start from a particular word, which is what clicking one in the text does. */
  playFrom(paragraph: number, word: number): void;
  rate: number;
  setRate(rate: number): void;
  /** Set by the bar; read by the playhead loop. */
  fillRef: React.RefObject<HTMLDivElement | null>;
}

/** Seeks, waiting for metadata first if the browser does not have it yet. */
function seek(element: HTMLAudioElement, offset: number): void {
  if (element.readyState >= 1) {
    element.currentTime = offset;
    return;
  }
  element.addEventListener("loadedmetadata", () => void (element.currentTime = offset), { once: true });
}

export function useStoryAudio(storyId: string, chapter: number): StoryAudioController {
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const [line, setLine] = useState<AudioLine | null>(null);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [rate, setRate] = useState(1);

  const element = useRef<HTMLAudioElement | null>(null);
  const lines = useRef<AudioLine[]>([]);
  const known = useRef(new Map<number, Timings>());
  const index = useRef(0);
  const frame = useRef(0);
  const rateRef = useRef(1);
  const fillRef = useRef<HTMLDivElement | null>(null);

  // One element for the whole chapter, made once. Swapping its `src` per line rather than
  // mounting an <audio> per sentence: a chapter can be a hundred lines, and ninety-nine
  // idle media elements is a lot of nothing.
  if (element.current === null && typeof Audio !== "undefined") {
    element.current = new Audio();
    element.current.preload = "auto";
  }

  const timingsFor = useCallback(
    async (position: number): Promise<Timings | null> => {
      const cached = known.current.get(position);
      if (cached) return cached;

      const found = lines.current[position];
      if (!found) return null;

      const fetched = await timings(storyId, chapter, found.paragraph, found.sentence);
      if (fetched) known.current.set(position, fetched);
      return fetched;
    },
    [storyId, chapter],
  );

  const halt = useCallback(() => {
    cancelAnimationFrame(frame.current);
    element.current?.pause();
    setPlaying(false);
    setAt(null);
    setLineKey(null);
  }, []);

  /**
   * The playhead: which word is sounding, and how far through the line we are.
   *
   * `setAt` runs every frame but React bails out when the value has not changed, so this
   * costs a re-render only when the highlight actually moves. The bar's fill is written
   * straight to the DOM, because that *does* change every frame and a story is far too many
   * spans to reconcile sixty times a second for the sake of a moving bar.
   */
  const follow = useCallback(() => {
    const audio = element.current;
    const current = known.current.get(index.current);
    const found = lines.current[index.current];

    if (audio && current && found) {
      const now = audio.currentTime;

      // A line the voice could not be aligned to. Rare — see `_align` in apps/tts/main.py,
      // which reconciles the two tokenisations rather than giving up on them — but when it
      // happens the whole sentence is marked instead. Knowing where the line is and not
      // where in it is worth saying; going dark mid-paragraph reads as a bug, which is
      // exactly how it was reported.
      if (current.words.length === 0) {
        setAt(null);
        setLineKey(`${found.paragraph}:${found.firstWord}:${found.firstWord + found.words - 1}`);
        frame.current = requestAnimationFrame(follow);
        return;
      }
      setLineKey(null);

      // The last word that has begun, rather than the one strictly under the playhead.
      // There are gaps between words — the silence around a comma is nobody's — and
      // highlighting only the exact match blinks the mark off in every one of them. Holding
      // the last word until the next begins reads as a mark that moves along the line, which
      // is what following a recording is supposed to look like.
      let word = null;
      for (const entry of current.words) {
        if (now < entry.start) break;
        word = entry;
      }
      setAt(word ? `${found.paragraph}:${word.index}` : null);

      if (fillRef.current && current.duration > 0) {
        const through = (index.current + Math.min(1, now / current.duration)) / lines.current.length;
        fillRef.current.style.width = `${through * 100}%`;
      }
    }

    frame.current = requestAnimationFrame(follow);
  }, []);

  const start = useCallback(
    async (position: number, offset: number) => {
      const found = lines.current[position];
      const audio = element.current;
      if (!found || !audio) {
        halt();
        return;
      }

      index.current = position;
      setLine(found);

      // Awaited, not fired and forgotten: this is the call that synthesises the line on the
      // server, and seeking into audio that does not exist yet would land nowhere. It is also
      // where the key comes from, which is what keeps the address below in step with the prose
      // — see `audioUrl`.
      const timing = await timingsFor(position);

      const url = audioUrl(storyId, chapter, found.paragraph, found.sentence, timing?.key);
      if (!audio.src.endsWith(url) && audio.src !== url) {
        audio.src = url;
      }
      audio.playbackRate = rateRef.current;
      seek(audio, offset);

      try {
        await audio.play();
      } catch {
        // Autoplay refused, or the source was swapped out from under this call by a second
        // press. Either way the state below is the truth of what is happening.
        halt();
        return;
      }

      setPlaying(true);
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(follow);

      // One line ahead. This is what keeps the queue seamless: by the time the next line is
      // wanted the server has already made it and the browser has already begun fetching it.
      // The same key goes on this URL as will go on the one `start` builds for that line a
      // moment later, or the prefetch warms an address nothing then asks for.
      void timingsFor(position + 1).then(ahead => {
        const next = lines.current[position + 1];
        if (next) {
          new Audio(audioUrl(storyId, chapter, next.paragraph, next.sentence, ahead?.key)).preload = "auto";
        }
      });
    },
    [storyId, chapter, follow, halt, timingsFor],
  );

  /* ------------------------------------------------------------- the manifest */

  useEffect(() => {
    let live = true;
    known.current.clear();
    index.current = 0;
    setAvailable(false);
    setLine(null);

    void manifest(storyId, chapter).then(found => {
      if (!live) return;
      lines.current = found?.lines ?? [];
      setAvailable(Boolean(found?.available) && (found?.lines.length ?? 0) > 0);
    });

    return () => {
      live = false;
      halt();
      // A chapter change while something is playing must not leave the old one sounding
      // over the new page.
      if (element.current) element.current.src = "";
    };
  }, [storyId, chapter, halt]);

  /* ------------------------------------------------------- the end of a line */

  useEffect(() => {
    const audio = element.current;
    if (!audio) return;

    const onEnded = () => {
      const next = index.current + 1;
      if (next >= lines.current.length) {
        halt();
        index.current = 0;
        if (fillRef.current) fillRef.current.style.width = "0%";
        return;
      }
      void start(next, 0);
    };

    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [start, halt]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /* ----------------------------------------------------------------- controls */

  const toggle = useCallback(() => {
    const audio = element.current;
    if (!audio) return;

    if (playing) {
      cancelAnimationFrame(frame.current);
      audio.pause();
      setPlaying(false);
      return;
    }

    // Resumes where it was left, unless nothing has been played yet — a paused line has a
    // source and a position already, and re-starting it would undo the pause.
    if (audio.src && audio.currentTime > 0 && !audio.ended) {
      audio.playbackRate = rateRef.current;
      void audio.play().then(() => {
        setPlaying(true);
        frame.current = requestAnimationFrame(follow);
      });
      return;
    }

    void start(index.current, 0);
  }, [playing, start, follow]);

  const stop = useCallback(() => {
    halt();
    index.current = 0;
    setLine(null);
    if (element.current) element.current.currentTime = 0;
    if (fillRef.current) fillRef.current.style.width = "0%";
  }, [halt]);

  /**
   * Move by a number of seconds, across lines as far as it has to.
   *
   * The queue is separate files, so this walks it: each step consumes one line's duration
   * and moves to its neighbour. A duration is known for any line that has been played or
   * prefetched; where it is not — skipping backwards into a part of the chapter this
   * sitting has never reached — the line is fetched, which is the same call that would have
   * made it anyway.
   */
  const skip = useCallback(
    async (seconds: number) => {
      const audio = element.current;
      if (!audio || lines.current.length === 0) return;

      let position = index.current;
      let target = audio.currentTime + seconds;

      while (target < 0 && position > 0) {
        position -= 1;
        const previous = await timingsFor(position);
        target += previous?.duration ?? 0;
      }

      for (;;) {
        const current = await timingsFor(position);
        const duration = current?.duration ?? 0;
        if (target <= duration || position + 1 >= lines.current.length) break;
        target -= duration;
        position += 1;
      }

      void start(position, Math.max(0, target));
    },
    [start, timingsFor],
  );

  /**
   * Start at one particular word.
   *
   * The line that holds it is the one whose word range covers it — `firstWord` up to
   * `firstWord + words` — and the offset is that word's own start time, so pressing a word
   * begins with that word rather than with the sentence around it.
   */
  const playFrom = useCallback(
    async (paragraph: number, word: number) => {
      const position = lines.current.findIndex(
        found => found.paragraph === paragraph && word >= found.firstWord && word < found.firstWord + found.words,
      );
      if (position < 0) return;

      const found = await timingsFor(position);
      const span = found?.words.find(entry => entry.index === word);
      void start(position, span?.start ?? 0);
    },
    [start, timingsFor],
  );

  const changeRate = useCallback((next: number) => {
    rateRef.current = next;
    setRate(next);
    if (element.current) element.current.playbackRate = next;
  }, []);

  return {
    available,
    playing,
    at,
    line,
    lineKey,
    toggle,
    stop,
    skip: (seconds: number) => void skip(seconds),
    playFrom: (paragraph: number, word: number) => void playFrom(paragraph, word),
    rate,
    setRate: changeRate,
    fillRef,
  };
}

/* ------------------------------------------------------------------ the bar */

/**
 * The controls, fixed to the bottom of the reader.
 *
 * Only ever rendered for a story, only where the server has a voice, and only once the
 * reader has asked for it — reading is the ordinary use of this page and listening is the
 * exception, so the bar is opened rather than dismissed. `onClose` puts it away again and is
 * expected to stop playback with it: a hidden bar that is still talking would leave no
 * control on screen to stop it with.
 *
 * Below `sm` it is the same controls, spelled shorter. Eight items at their desktop size come
 * to well over three hundred pixels of chrome and ran off the side of a phone, so the two skip
 * buttons drop their "5s" captions — the arrows say which way and the title says how far — and
 * the three speed chips collapse to one that cycles. Nothing is taken away: a control a reader
 * cannot reach because it is past the edge of the screen is worse than a shorter label.
 */
export function StoryAudioBar({ audio, onClose }: { audio: StoryAudioController; onClose: () => void }) {
  if (!audio.available) return null;

  // What the one mobile chip moves to. Wraps, so a third tap comes back to where it started —
  // a cycling control that dead-ends at the last value is a control you cannot undo.
  const nextRate = RATES[(RATES.indexOf(audio.rate) + 1) % RATES.length];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 max-sm:p-2">
      <div className="pointer-events-auto flex w-full max-w-[560px] flex-col gap-2 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-card backdrop-blur max-sm:gap-1.5 max-sm:px-2.5 max-sm:py-2">
        <div className="flex items-center gap-2 max-sm:gap-1">
          <Button
            type="button"
            variant="control"
            size="icon-sm"
            onClick={audio.toggle}
            aria-label={audio.playing ? "Pause" : "Play"}
            title={audio.playing ? "Pause" : "Play"}
          >
            {audio.playing ? <Pause /> : <Play />}
          </Button>

          <Button
            type="button"
            variant="control"
            size="icon-sm"
            onClick={audio.stop}
            aria-label="Stop"
            title="Stop and go back to the beginning"
          >
            <Square />
          </Button>

          {/* The caption goes below `sm` and the button becomes a square. `aria-label` and
              `title` carry the whole of what it does either way, so nothing is lost with it. */}
          <Button
            type="button"
            variant="control"
            size="auto-sm"
            className="max-sm:size-8 max-sm:px-0"
            onClick={() => audio.skip(-SKIP)}
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
            onClick={() => audio.skip(SKIP)}
            aria-label={`Forward ${SKIP} seconds`}
            title={`Forward ${SKIP} seconds`}
          >
            <RotateCw />
            <span className="max-sm:hidden">{SKIP}s</span>
          </Button>

          {/* Speed is `playbackRate` in the browser and costs nothing — no second recording
              and no second cache entry, which is why the server always synthesises at one. */}
          <div className="ml-auto flex items-center gap-1 max-sm:hidden">
            {RATES.map(value => (
              <Button
                key={value}
                type="button"
                variant={audio.rate === value ? "controlOn" : "control"}
                size="xs"
                onClick={() => audio.setRate(value)}
                aria-pressed={audio.rate === value}
                title={`Play at ${value}×`}
              >
                {value}×
              </Button>
            ))}
          </div>

          {/* The same three speeds on a phone, one chip instead of three: it reads the speed
              you are at and a tap moves to the next. Three chips side by side are a hundred and
              thirty pixels of a screen that has three hundred and sixty, and two of them are
              always saying what you are *not* listening at. Lit whenever the speed is not 1, so
              a bar that has been left at 0.75× says so at a glance rather than only on
              inspection. */}
          <Button
            type="button"
            variant={audio.rate === 1 ? "control" : "controlOn"}
            size="xs"
            className="ml-auto hidden h-8 max-sm:inline-flex"
            onClick={() => audio.setRate(nextRate)}
            aria-label={`Playback speed: ${audio.rate}×. Change to ${nextRate}×`}
            title={`Playing at ${audio.rate}× — tap for ${nextRate}×`}
          >
            {audio.rate}×
          </Button>

          {/* Set apart from the transport controls by the divider: everything to its left
              acts on the recording, and this one puts the whole thing away. */}
          <Button
            type="button"
            variant="control"
            size="icon-sm"
            className="ml-1 border-l-0 max-sm:ml-0"
            onClick={onClose}
            aria-label="Close the player"
            title="Close the player"
          >
            <X />
          </Button>
        </div>

        {/* Progress through the chapter by line, not by time: the whole chapter's duration is
            not known until every line has been synthesised, and asking for that up front is a
            minute of waiting before anything plays. Written to by the playhead loop rather
            than rendered from state — see the note at the top of this file. */}
        <div className="h-1 overflow-hidden rounded-full bg-border">
          <div ref={audio.fillRef} className={cn("h-full w-0 rounded-full bg-primary transition-[width] duration-100")} />
        </div>
      </div>
    </div>
  );
}
