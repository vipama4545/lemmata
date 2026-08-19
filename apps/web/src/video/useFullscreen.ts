// Fullscreen, taken on an element of ours rather than on the video.
//
// This is the whole reason the subtitles can be drawn over the picture, and it turns on one
// fact about the Fullscreen API: while something is fullscreen, the browser paints that element
// and its descendants and nothing else on the page. So *which* element is asked matters more
// than anything else here.
//
// Ask the iframe — which is what YouTube's own fullscreen button does from the inside — and the
// iframe is the fullscreen element. It is on another origin, we cannot reach into it, and there
// is no z-index high enough to put a caption over it, because our caption is not in its subtree
// and is therefore not painted at all. That approach cannot be made to work; it is not a matter
// of trying harder.
//
// Ask a wrapper that holds the iframe *and* the overlay, and both are in the subtree, and both
// are painted. That is the trick, and it is the only one.
//
// It follows that YouTube's own button has to go — see `fs: 0` in useVideoTrack. A control that
// silently drops the reader into a mode where the subtitles vanish is worse than no control.

import { useCallback, useEffect, useState } from 'react';

/** How long the pointer sits still before the fullscreen chrome gets out of the way. */
const IDLE = 2500;

/**
 * Vendor-prefixed shapes, only as far as they are used.
 *
 * Safari still exposes the webkit names and nothing else, and the unprefixed methods are absent
 * rather than broken there, so this is a compatibility path rather than belt and braces.
 */
interface Prefixed extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface PrefixedDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
}

/**
 * Whether this browser will put an ordinary element fullscreen at all.
 *
 * Asked of the document rather than of the element, and that is the fix for a real bug rather
 * than a preference. Feature-detecting off `target.current` inside an effect looks equivalent
 * and is not: this page returns early while the story is loading, so on the pass where that
 * effect first ran there was no wrapper in the tree, the ref was null, and the answer came back
 * "unsupported" — for good, because the ref object never changes and the effect never ran again.
 * The button simply never appeared.
 *
 * `fullscreenEnabled` is also the more correct question. It accounts for a permissions policy
 * denying fullscreen to the document, which the presence of a method on an element does not.
 */
function allowed(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as PrefixedDocument;
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false);
}

function current(): Element | null {
  const doc = document as PrefixedDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export interface Fullscreen {
  /** Whether *this* element is the one filling the screen. */
  on: boolean;
  /**
   * False where the browser will not put an ordinary element fullscreen at all.
   *
   * iPhone Safari is the case that matters: it grants fullscreen to a `<video>` and to nothing
   * else, so a wrapper cannot be asked and the button should not be drawn. Everything else on
   * the page still works there — the video plays, the subtitles scroll, the words are still
   * looked up — which is why this is a missing control rather than a broken screen.
   */
  supported: boolean;
  toggle(): void;
}

export function useFullscreen(target: React.RefObject<HTMLElement | null>): Fullscreen {
  const [on, setOn] = useState(false);
  // Once, at first render, and not from an effect. See `allowed`.
  const [supported] = useState(allowed);

  // The event rather than the promise, because fullscreen is left in ways nothing here started:
  // Escape, the browser's own chrome, another tab taking it. State set only from the request
  // would go on claiming to be fullscreen after any of those.
  useEffect(() => {
    const changed = () => setOn(current() === target.current && current() !== null);
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
    };
  }, [target]);

  const toggle = useCallback(() => {
    const element = target.current as Prefixed | null;
    if (!element) return;

    if (current()) {
      const doc = document as PrefixedDocument;
      void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
      return;
    }

    // Refusal is ordinary rather than exceptional — a permissions policy on an embedding page,
    // or a browser that wants a more direct gesture — and the page behind it is still perfectly
    // usable, so it is swallowed rather than surfaced.
    void Promise.resolve(
      element.requestFullscreen ? element.requestFullscreen() : element.webkitRequestFullscreen?.(),
    ).catch(() => undefined);
  }, [target]);

  return { on, supported, toggle };
}

/**
 * Whether the pointer has moved lately — what the fullscreen chrome fades on.
 *
 * Only ever true while `active`, so the timer does not run on a page nobody is watching
 * fullscreen. Leaving fullscreen wakes it and leaves it awake, or the controls would come back
 * to a windowed page already faded out and the reader would have to waggle the mouse at them.
 *
 * Listening on the element rather than the window is deliberate: in fullscreen it is the only
 * thing on screen, and a stray `pointermove` fired somewhere else on the page — a background
 * tab's animation, a scripted event — should not count as somebody being there.
 *
 * What this does *not* touch is the subtitle. A caption that fades out after two seconds is a
 * caption that is missing every time you look up at it; only the buttons go.
 */
export function useAwake(active: boolean, target: React.RefObject<HTMLElement | null>): boolean {
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    if (!active) {
      setAwake(true);
      return;
    }

    const element = target.current;
    if (!element) return;

    let timer = 0;
    const stir = () => {
      setAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAwake(false), IDLE);
    };

    stir();
    element.addEventListener('pointermove', stir);
    element.addEventListener('pointerdown', stir);
    // A key is somebody being there as much as a mouse is, and the controls are reachable by
    // Tab — fading them out from under a keyboard would make them unusable that way.
    element.addEventListener('keydown', stir);

    return () => {
      window.clearTimeout(timer);
      element.removeEventListener('pointermove', stir);
      element.removeEventListener('pointerdown', stir);
      element.removeEventListener('keydown', stir);
    };
  }, [active, target]);

  return awake;
}
