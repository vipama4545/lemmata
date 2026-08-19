// How much of the screen the video gets, and therefore how much is left for the subtitles.
//
// The two are one number. The video is pinned above the text and the text scrolls under it, so
// every pixel the frame grows is a pixel fewer of transcript visible at once — and which way
// that trade should go is not something this app can decide. Somebody following a fast talker
// wants three lines of context; somebody watching a cooking video wants to see the pan. So it is
// dragged, and it is remembered.
//
// Width is what is stored, not height. The frame is 16:9 and its height follows from its width,
// so keeping the width is keeping the one free number; storing both would let them disagree.
//
// Remembered across videos rather than per video. The size is a statement about this reader's
// screen and eyesight, not about a particular clip, and having to re-drag it on every import
// would be the kind of small tax that stops people using a feature.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Narrower than this and the controls below the frame start wrapping. */
const MIN = 280;

/** What a video opens at before anybody has dragged one. */
const DEFAULT = 620;

/** Where the preference lives. */
const KEY = 'video.width';

/**
 * Roughly what sits below the frame inside the pinned block: the controls row and the progress
 * bar, with their padding. Only used to work out how large the frame may grow before the
 * transcript has no room, so being a few pixels out costs nothing.
 */
const CONTROLS = 96;

/** The least transcript worth leaving on screen — about three subtitle lines. */
const FLOOR = 180;

function stored(): number {
  try {
    const saved = Number(localStorage.getItem(KEY));
    return Number.isFinite(saved) && saved >= MIN ? saved : DEFAULT;
  } catch {
    // Private browsing, or storage turned off. The default is a perfectly good answer.
    return DEFAULT;
  }
}

/** The app's own sticky header, which covers the top of the window whatever this page does. */
function shellHeader(): number {
  const token = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue(
      '--spacing-header',
    ),
    10,
  );
  return Number.isFinite(token) ? token : 0;
}

/** The column the frame sits in, measured inside its padding. */
function columnWidth(column: HTMLElement | null): number {
  if (!column) return Infinity;
  const style = getComputedStyle(column);
  const inner =
    column.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight);
  return Number.isFinite(inner) && inner > 0 ? inner : Infinity;
}

/**
 * The widest the frame may be drawn.
 *
 * Two limits, and the smaller wins. The first is vertical and is the interesting one: the window
 * is only so tall, and the frame, its controls and a few lines of text have to fit in what is
 * left under the app header — so a short laptop screen caps the video well below the width its
 * column could otherwise afford. That is right. A video with no transcript under it is just a
 * video, and this page is not a video player.
 *
 * The second is the column itself. Without it a tall window yields a ceiling wider than there is
 * room for, and the last part of the drag does nothing visible — the pointer keeps moving, the
 * number keeps rising, and the picture stays where it is, which reads as the control having
 * broken.
 */
function ceiling(column: HTMLElement | null): number {
  if (typeof window === 'undefined') return DEFAULT;
  const room = window.innerHeight - shellHeader() - CONTROLS - FLOOR;
  return Math.max(MIN, Math.min((room * 16) / 9, columnWidth(column)));
}

export interface VideoSize {
  /** The frame's width in pixels, already clamped to what will fit. */
  width: number;
  /** True while a drag is in progress, for the cursor and for suppressing the frame's transition. */
  dragging: boolean;
  /** Put on the grip. Everything the drag needs is bound from here. */
  onPointerDown(event: React.PointerEvent<HTMLElement>): void;
  /** Arrow keys and Home/End, so the grip is not mouse-only. */
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  min: number;
  max: number;
  reset(): void;
}

export function useVideoSize(
  column: React.RefObject<HTMLElement | null>,
): VideoSize {
  const [width, setWidth] = useState(stored);
  const [max, setMax] = useState(DEFAULT);
  const [dragging, setDragging] = useState(false);

  // Where the pointer went down, and how wide the frame was then. Refs rather than state: they
  // are read on every pointer move and none of those reads should cost a render.
  const from = useRef({ y: 0, width: DEFAULT });

  // A window that has been made shorter can leave the frame taller than the room for it, so the
  // ceiling is recomputed and the width brought under it. Turning a phone sideways is the case
  // that makes this visible.
  useEffect(() => {
    const measure = () => {
      const limit = ceiling(column.current);
      setMax(limit);
      setWidth(current => Math.min(current, limit));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [column]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(Math.round(width)));
    } catch {
      // Nothing to do about it, and nothing that depends on it having worked.
    }
  }, [width]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      from.current = { y: event.clientY, width };
      setDragging(true);

      const target = event.currentTarget;
      // Capture, so a fast drag that leaves the four-pixel grip keeps resizing rather than
      // stopping dead the moment the pointer outruns it.
      target.setPointerCapture(event.pointerId);

      const move = (moved: PointerEvent) => {
        // Vertical drag, horizontal result. The grip sits under the frame and the gesture is
        // "pull the bottom edge down", so what the hand does is change the *height* — and the
        // width that produces it is that over nine sixteenths.
        const grew = ((moved.clientY - from.current.y) * 16) / 9;
        setWidth(
          Math.max(
            MIN,
            Math.min(ceiling(column.current), from.current.width + grew),
          ),
        );
      };

      const done = () => {
        setDragging(false);
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', done);
        target.removeEventListener('pointercancel', done);
      };

      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', done);
      target.addEventListener('pointercancel', done);
    },
    [width, column],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      // A separator that only a mouse can move is a control half the people using this app cannot
      // reach. The step is in width, so it is the same unit the drag produces.
      const step = event.shiftKey ? 120 : 40;
      const limit = ceiling(column.current);

      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        setWidth(current => Math.min(limit, current + step));
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setWidth(current => Math.max(MIN, current - step));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setWidth(MIN);
      } else if (event.key === 'End') {
        event.preventDefault();
        setWidth(limit);
      }
    },
    [column],
  );

  const reset = useCallback(
    () => setWidth(Math.min(DEFAULT, ceiling(column.current))),
    [column],
  );

  return { width, dragging, onPointerDown, onKeyDown, min: MIN, max, reset };
}
