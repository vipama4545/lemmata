import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { focusId, focusSelector } from '../utils/scroll';

// What the page does to the scroll position when the route changes. Three rules, and the
// whole of the app's scrolling behaviour is here rather than spread across the pages:
//
//   back and forward  →  where that entry was left
//   a link naming an entry  →  that entry, under the header
//   anything else  →  the top
//
// All of it instant. A page that animates itself into place after a click is a page you
// have to wait for, and the reader has already decided where they are going.

// How long a navigation keeps correcting itself, in ms. The position to restore is only
// reachable once the page has reached its full height, and a picture that arrives late
// moves everything below it; this is the window in which we keep putting the page back.
const SETTLE_MS = 500;
// The gap left between the sticky header and whatever was scrolled to.
const FOCUS_GAP = 16;
// Taking hold of the wheel, the keyboard or the pointer ends that window early: being
// dragged back to a position you have just left is worse than landing in the wrong place.
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

// Where each history entry was left, keyed by the router's key for it. Module scope rather
// than state: recording a scroll must never re-render anything, and the record has to
// outlive every page it describes.
const positions = new Map<string, number>();

function jump(top: number) {
  window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'instant' });
}

/**
 * The height to keep clear at the top. Measured rather than read from --header-h, because
 * the header wraps to a second row on a narrow screen and is then taller than the variable.
 */
function headerOffset(): number {
  const header = document.querySelector('.header');
  return (header ? header.getBoundingClientRect().height : 0) + FOCUS_GAP;
}

function ScrollManager() {
  const { key, search } = useLocation();
  const navigationType = useNavigationType();
  // The entry the scroll listener credits its readings to. It only moves on in the layout
  // effect below, which runs once the new page is in the DOM — by then everything the old
  // entry did has been recorded against the old key.
  const entry = useRef(key);

  useEffect(() => {
    // The browser's own restoration runs while the page it is leaving is still on screen,
    // before React has rendered the one it is going to, so it aims at the wrong height and
    // is then clamped to whatever the new page happens to be. Ours waits for the render.
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';

    let frame = 0;
    const record = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        positions.set(entry.current, window.scrollY);
      });
    };

    window.addEventListener('scroll', record, { passive: true });
    return () => {
      window.removeEventListener('scroll', record);
      cancelAnimationFrame(frame);
      history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    entry.current = key;

    // Back and forward return to a page the reader has already scrolled; everything else is
    // an arrival. A history entry with nothing recorded against it — the first load, or a
    // reload — is treated as one, which is what makes a pasted link with ?w= still work.
    const restore = navigationType === 'POP' ? positions.get(key) : undefined;
    const target = focusId(search);

    if (restore === undefined && !target) {
      jump(0);
      return undefined;
    }

    let frame = 0;
    const deadline = performance.now() + SETTLE_MS;

    /** Puts the page where this navigation wants it, from wherever it currently is. */
    const apply = () => {
      if (restore !== undefined) {
        // A page not yet tall enough to hold that position is clamped short of it, and the
        // next frame — by which time another row of it has arrived — tries again.
        jump(restore);
        return;
      }
      const element = document.querySelector(focusSelector(target));
      if (element) jump(element.getBoundingClientRect().top + window.scrollY - headerOffset());
    };

    // Re-aimed every frame rather than once, because the page keeps moving underneath a
    // fresh navigation: a picture loading above the target pushes it down, a list still
    // rendering has nowhere to scroll to yet, and an autofocused input drags the top of the
    // page back into view. Each pass is a no-op once the page is already where it belongs.
    const tick = () => {
      frame = 0;
      apply();
      if (performance.now() < deadline) frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      TAKEOVER_EVENTS.forEach(name => window.removeEventListener(name, stop));
    };

    TAKEOVER_EVENTS.forEach(name => window.addEventListener(name, stop, { passive: true }));
    tick();
    return stop;
  }, [key, search, navigationType]);

  return null;
}

export default ScrollManager;
