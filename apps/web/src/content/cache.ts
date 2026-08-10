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
 * One entry per language, so that opening the Russian dictionary does not evict the Georgian
 * one. They are fetched separately and versioned separately; caching them under a single key
 * would mean every switch paid the full download again, which is the whole cost this file
 * exists to avoid.
 *
 * The store itself is unchanged and needs no version bump: an old single-key entry under
 * 'current' is simply never read again, and is replaced the first time either language is
 * fetched.
 */
function keyFor(lang: Lang): string {
  return `snapshot:${lang}`;
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
      tx.objectStore(STORE).put(snapshot, keyFor(snapshot.lang));
    } catch {
      resolve();
    }
  });
}
