// The snapshot, kept in IndexedDB between visits.
//
// The dictionary is three megabytes of JSON. It used to be part of the bundle, where the
// browser's HTTP cache made the second visit free; now that it comes from an API, something
// has to play that role or every reload would pay for it again.
//
// This is a separate database from the study store on purpose. That one holds the only data
// in this app that cannot be regenerated, and it should not have to be opened at a new
// version — with the migration that implies — because the *dictionary* cache changed shape.
//
// Every call resolves rather than rejects. A browser with IndexedDB switched off still gets
// a working app; it just fetches the snapshot on every visit.

import type { ContentSnapshot } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';

const DB_NAME = 'georgian-dict-content';
const DB_VERSION = 1;
const STORE = 'snapshot';

/**
 * The shape of a cached snapshot. **Bump this whenever `ContentSnapshot` gains or loses a
 * field**, in the same commit that changes it.
 *
 * `content_version` cannot do this job, and the day chapters were added is what proved it.
 * That string says whether the *content* changed — a corrected definition, a new story — and
 * the server answers "still current" whenever it matches, which is exactly right for content
 * and exactly wrong for shape. Add a field to `StorySummary` and every browser holding a
 * cached copy is told it is up to date, keeps a snapshot with no such field in it, and the
 * first screen to read that field throws. It looks like a broken page rather than a stale
 * one, and it is unreachable in testing, because a fresh browser has no cache to be stale.
 *
 * So the shape is part of the key. Bumping it makes every cached copy unreadable rather than
 * wrong, and the next visit re-fetches — one download, once, which is the honest cost of
 * having changed the payload.
 *
 *   1 — the original snapshot
 *   2 — stories gained `chapters`, `categoryId` and `category`; the snapshot gained
 *       `storyCategories`
 */
const SHAPE = 2;

/**
 * One entry per language, so that opening the Russian dictionary does not evict the Georgian
 * one. They are fetched separately and versioned separately; caching them under a single key
 * would mean every switch paid the full download again, which is the whole cost this file
 * exists to avoid.
 */
function keyFor(lang: Lang): string {
  return `snapshot:${SHAPE}:${lang}`;
}

/** True of a key written by some earlier shape of this file — including the very first one. */
function stale(key: IDBValidKey): boolean {
  return typeof key === 'string' && key.startsWith('snapshot') && !key.startsWith(`snapshot:${SHAPE}:`);
}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;

  opening = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return opening;
}

/** The cached snapshot, or null when there is none and when anything at all goes wrong. */
export async function read(lang: Lang): Promise<ContentSnapshot | null> {
  const db = await open();
  if (!db) return null;

  return new Promise(resolve => {
    let request: IDBRequest<ContentSnapshot | undefined>;
    try {
      request = db.transaction(STORE, 'readonly').objectStore(STORE).get(keyFor(lang));
    } catch {
      return resolve(null);
    }
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

/**
 * Forgets one language's copy.
 *
 * Only used when the server refuses to serve that language — an unreleased dictionary this
 * browser was allowed to read last week and is not allowed to read today. Keeping the copy
 * would make the refusal cosmetic.
 */
export async function drop(lang: Lang): Promise<void> {
  const db = await open();
  if (!db) return;

  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
      tx.objectStore(STORE).delete(keyFor(lang));
    } catch {
      resolve();
    }
  });
}

/**
 * Replaces the cached snapshot. Structured-cloned rather than serialised to a string, which
 * is both faster and means the read side hands back objects rather than re-parsing 3 MB.
 *
 * Entries from an earlier `SHAPE` are swept in the same transaction. They can never be read
 * again — the key no longer matches — so leaving them would be three megabytes per language
 * sitting in every returning reader's browser forever, on a schedule of once per shape change
 * and never cleaned up.
 */
export async function write(snapshot: ContentSnapshot): Promise<void> {
  const db = await open();
  if (!db) return;

  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();

      const store = tx.objectStore(STORE);
      store.put(snapshot, keyFor(snapshot.lang));

      // Best-effort, and deliberately not awaited: the write above is the point of this
      // call, and a browser that will not enumerate its own keys should still get a cache.
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) {
          if (stale(key)) store.delete(key);
        }
      };
    } catch {
      resolve();
    }
  });
}
