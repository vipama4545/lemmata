// The dictionary, once it has arrived.
//
// This app used to `import wordData from './data/words.json'`, which meant every module
// could hold a derived index in a module-level const: the data was there before any code
// ran. Now it arrives over the network, and that guarantee is gone.
//
// Rather than make every consumer async, the whole app is mounted *after* the snapshot has
// loaded — see boot.tsx. Everything below is then a plain synchronous read, exactly as
// before, and the one rule is that nothing may call these at module scope. `derived()` is
// what makes that easy to obey: it takes the build of an index and defers it to first use,
// then holds it until the content itself changes.

import type { ContentSnapshot } from '@georgian/shared/contract';
import { PERSONS, SCREEVES, SERIES } from '@georgian/shared/grammar';
import type { ImageMap, MorphemeData, StorySummary, VerbData, WordData } from '@georgian/shared/types';
import { api } from '../api/client';
import * as cache from './cache';

let snapshot: ContentSnapshot | null = null;

/**
 * The loaded snapshot.
 *
 * Throws rather than returning null, because there is no sensible thing for a component to
 * render without it and a null check at 300 call sites would be noise around a case that
 * cannot happen: the router is not mounted until this is set.
 */
export function content(): ContentSnapshot {
  if (!snapshot) {
    throw new Error('The dictionary has not loaded yet. Nothing may read it at module scope.');
  }
  return snapshot;
}

/**
 * Fetches the dictionary, using the cached copy where it is still current.
 *
 * The cached version is sent up and the server answers "still current" in 55 bytes when
 * nothing has changed, which is every visit but the first and the ones after a re-seed.
 * If the request fails outright but there is a cached copy, that copy is used: a dictionary
 * that is one deploy out of date beats an app that will not open.
 */
export async function loadContent(): Promise<ContentSnapshot> {
  const cached = await cache.read();

  try {
    const response = await api.content.snapshot({ known: cached?.version });

    if (response.upToDate) {
      if (!cached) {
        // The server says we have it and we do not. Only reachable if the cache was cleared
        // between the read above and now, so ask again without claiming to know anything.
        const full = await api.content.snapshot({});
        if (full.upToDate) throw new Error('The server says the dictionary is unchanged, but none was sent.');
        snapshot = stripDiscriminant(full);
      } else {
        snapshot = cached;
      }
    } else {
      snapshot = stripDiscriminant(response);
      void cache.write(snapshot);
    }
  } catch (error) {
    if (!cached) throw error;
    console.warn('Could not reach the server; using the dictionary already in this browser.', error);
    snapshot = cached;
  }

  return snapshot;
}

function stripDiscriminant(response: { upToDate: false } & ContentSnapshot): ContentSnapshot {
  const { upToDate: _upToDate, ...rest } = response;
  return rest;
}

/**
 * An index built from the content, on first use, and kept until the content changes.
 *
 * The identity check is against the snapshot object rather than its version string so that
 * a rebuild is impossible to forget: replace `snapshot` and every index is stale by
 * construction.
 */
export function derived<T>(build: (from: ContentSnapshot) => T): () => T {
  let from: ContentSnapshot | null = null;
  let value: T;

  return () => {
    const current = content();
    if (from !== current) {
      value = build(current);
      from = current;
    }
    return value;
  };
}

/* --------------------------------------------------------------- accessors */

export function wordData(): WordData {
  return content().words;
}

/**
 * The paradigms, with the fixed grammar put back.
 *
 * The server sends what is in the database; the six persons, eleven screeves and three
 * series are constants this app already has. Joining them here means every consumer still
 * sees one whole `VerbData`, as it did when all of it came out of one JSON file.
 */
export const verbData = derived<VerbData>(from => ({
  ...from.verbs,
  persons: [...PERSONS],
  screeves: [...SCREEVES],
  series: [...SERIES],
}));

export function morphemeData(): MorphemeData {
  return content().morphemes;
}

export function imageMap(): ImageMap {
  return content().images;
}

export function categoryImageMap(): ImageMap {
  return content().categoryImages;
}

export function storySummaries(): StorySummary[] {
  return content().stories;
}
