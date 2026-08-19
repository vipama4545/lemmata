// Where the caption sits over the picture, and how it is moved.
//
// Subtitles live along the bottom because that is where the picture usually is not. "Usually"
// is the whole problem: a cooking video puts the pan there, a lecture puts the slide's last
// line there, and burned-in captions on a re-upload put somebody else's subtitles there. So the
// band is dragged, and it is remembered.
//
// Stored as fractions of the frame rather than pixels, because the frame is two very different
// sizes in the two modes this page has — a 620px box in the page and the whole screen in
// fullscreen — and a position kept in pixels would put the caption off the edge of one of them
// every time. A fraction means the same place in both.
//
// **Nothing here may set a `transform`.** That is not a style preference, it is the constraint
// the whole file is written around. A transformed element becomes the containing block for
// `position: fixed` descendants, and the definition card that opens when a word is hovered is
// fixed and placed in viewport coordinates. Centre the band with `translateX(-50%)` — the
// obvious way — and the card starts resolving against the band instead of the window, lands
// somewhere near the bottom of the screen and is then clipped away by the frame's
// `overflow-hidden`. The card simply stops appearing. So the default position is centred with
// `left-0 right-0 mx-auto w-fit`, which does the same job with no transform, and a dragged one
// is placed with plain `left`/`top` pixels.

import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'video.caption';

/** How far off the bottom the band sits before anybody has moved it. */
const BOTTOM = 0.06;

/** Arrow-key step, as a fraction of the frame. Shift moves in bigger jumps. */
const STEP = 0.02;

/** The caption's top-left corner, as fractions of the frame. Null until it has been placed. */
interface Spot {
  x: number;
  y: number;
}

function stored(): Spot | null {
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved) return null;
    const held = JSON.parse(saved) as Partial<Spot>;
    if (typeof held.x !== 'number' || typeof held.y !== 'number') return null;
    if (!Number.isFinite(held.x) || !Number.isFinite(held.y)) return null;
    return { x: held.x, y: held.y };
  } catch {
    return null;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export interface CaptionSpot {
  /**
   * What to put on the band. Empty while it has never been moved, which leaves it on the
   * classes that centre it along the bottom — see the note at the head of this file about why
   * those are `mx-auto` and not a transform.
   */
  style: React.CSSProperties;
  /** True while it has a position of its own, so the default classes come off. */
  placed: boolean;
  dragging: boolean;
  onPointerDown(event: React.PointerEvent<HTMLElement>): void;
  onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
  /** Back to the bottom centre. */
  reset(): void;
}

/**
 * Drag the caption anywhere inside the frame.
 *
 * `frame` is the box the picture fills and the band must stay inside; `caption` is the band
 * itself, measured so it cannot be dragged half off the edge.
 */
export function useCaptionSpot(
  frame: React.RefObject<HTMLElement | null>,
  caption: React.RefObject<HTMLElement | null>,
): CaptionSpot {
  const [spot, setSpot] = useState<Spot | null>(stored);
  const [dragging, setDragging] = useState(false);

  // Where in the band the pointer took hold, so it does not jump to put its corner under the
  // cursor the moment a drag begins.
  const grip = useRef({ x: 0, y: 0 });

  useEffect(() => {
    try {
      if (spot) localStorage.setItem(KEY, JSON.stringify(spot));
      else localStorage.removeItem(KEY);
    } catch {
      // Storage refused. The position still works for this sitting, which is most of the value.
    }
  }, [spot]);

  /** The two rectangles every calculation here needs, or null if either is not on screen. */
  const measure = useCallback(() => {
    const outer = frame.current?.getBoundingClientRect();
    const inner = caption.current?.getBoundingClientRect();
    if (!outer || !inner || outer.width === 0 || outer.height === 0) return null;
    return { outer, inner };
  }, [frame, caption]);

  /** Fractions that keep the whole band inside the frame, whatever was asked for. */
  const fit = useCallback(
    (x: number, y: number, outer: DOMRect, inner: DOMRect): Spot => ({
      x: clamp(x, 0, Math.max(0, 1 - inner.width / outer.width)),
      y: clamp(y, 0, Math.max(0, 1 - inner.height / outer.height)),
    }),
    [],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const seen = measure();
      if (!seen) return;

      event.preventDefault();
      event.stopPropagation();
      setDragging(true);

      grip.current = {
        x: event.clientX - seen.inner.left,
        y: event.clientY - seen.inner.top,
      };

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const move = (moved: PointerEvent) => {
        const now = measure();
        if (!now) return;
        const left = moved.clientX - grip.current.x - now.outer.left;
        const top = moved.clientY - grip.current.y - now.outer.top;
        setSpot(fit(left / now.outer.width, top / now.outer.height, now.outer, now.inner));
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
    [measure, fit],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!keys.includes(event.key)) return;

      const seen = measure();
      if (!seen) return;
      event.preventDefault();

      // From wherever it is *now*, which for a band that has never been moved means reading its
      // position off the screen rather than assuming the default — the two agree until the frame
      // is resized, and then only the measurement is right.
      const from = spot ?? {
        x: (seen.inner.left - seen.outer.left) / seen.outer.width,
        y: (seen.inner.top - seen.outer.top) / seen.outer.height,
      };

      const step = event.shiftKey ? STEP * 4 : STEP;
      const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
      const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
      setSpot(fit(from.x + dx, from.y + dy, seen.outer, seen.inner));
    },
    [measure, fit, spot],
  );

  const reset = useCallback(() => setSpot(null), []);

  // A frame that has been resized — dragging the size grip, or entering fullscreen — can leave a
  // band that was flush against one edge slightly over it. Re-fitting costs nothing and is the
  // difference between a caption that is clipped and one that is not.
  useEffect(() => {
    if (!spot) return;
    const settle = () => {
      const seen = measure();
      if (seen) setSpot(current => (current ? fit(current.x, current.y, seen.outer, seen.inner) : current));
    };
    window.addEventListener('resize', settle);
    return () => window.removeEventListener('resize', settle);
  }, [spot, measure, fit]);

  return {
    style: spot ? { left: `${spot.x * 100}%`, top: `${spot.y * 100}%` } : { bottom: `${BOTTOM * 100}%` },
    placed: spot !== null,
    dragging,
    onPointerDown,
    onKeyDown,
    reset,
  };
}
