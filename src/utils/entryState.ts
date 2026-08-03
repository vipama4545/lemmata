import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';

// A page's own controls, remembered per history entry.
//
// Restoring the scroll position of a page whose contents are gone restores nothing: the
// search page with no search in it is one screen tall, so Back lands at the top of an empty
// page however carefully the position was recorded. The filters have to come back with it.
//
// Remembered against the history entry rather than the route, so that two visits to the
// same list are two different visits: going back finds the filter you left, and following a
// fresh link to the same page starts clean. Kept out of the URL because these are controls
// rather than addresses — the entry a link is aiming at is in the query string, and that is
// the part worth copying.

const remembered = new Map<string, unknown>();

/**
 * Like useState, but the value survives leaving the page and coming back to it. `name`
 * separates one control from another within a page.
 */
export function useEntryState<T>(name: string, initial: T): [T, (value: T) => void] {
  const { key } = useLocation();
  const slot = `${key}:${name}`;

  const [value, setValue] = useState<T>(() => (remembered.has(slot) ? (remembered.get(slot) as T) : initial));

  const set = useCallback((next: T) => {
    remembered.set(slot, next);
    setValue(next);
  }, [slot]);

  return [value, set];
}
