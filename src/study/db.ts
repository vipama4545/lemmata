// The local store: what you know, kept in the browser's IndexedDB.
//
// Everything else in this app is generated data shipped with the bundle and is the same for
// everyone. This is the one file that is *yours*, so it lives in a real database rather than
// in localStorage: there will eventually be a review record for every word and verb, several
// thousand of them, and a JSON blob reserialised on every button press is the wrong shape
// for that.
//
// Every call resolves rather than rejects. A browser with IndexedDB switched off — private
// windows, some embedded views — should still deal cards; it just forgets them when the tab
// closes, which the store above handles by keeping the same records in memory either way.

import type { Mastery, Review } from './mastery';

const DB_NAME = 'georgian-dict';
const DB_VERSION = 1;
const STORE = 'progress';

/**
 * Which direction of a card a record scores. The two are learned separately — recognising
 * მგელი and producing it from "wolf" are different skills, and Anki would call them two
 * cards off one note — so each carries its own level and its own due date.
 */
export type Side = 'ka' | 'en';

export const SIDES: Side[] = ['ka', 'en'];

/**
 * What first created the record.
 *
 * Only a card you actually sat down and answered counts against the day's allowance of new
 * cards. Retiring a word — the Known button, the level picker over a word in a story, the
 * checkbox at the end of one — also writes a record for a word never met before, and a
 * story finished with 400 unstudied words in it would otherwise use up a fortnight of new
 * cards without a single one having been learned.
 */
export type Introduced = 'review' | 'marked';

/** One side of one item, as it is stored. */
export interface CardRecord extends Review {
  /** `${item}|${side}` — the primary key. */
  card: string;
  /** The study item this scores: `w:6938` for a word, `v:abandon-vt` for a bare paradigm. */
  item: string;
  side: Side;
  level: Mastery;
  /** When the record was first written, epoch ms. */
  created: number;
  introduced: Introduced;
}

/** The key one side of one item is stored under. */
export function cardId(item: string, side: Side): string {
  return `${item}|${side}`;
}

/** The item and side a card id names. The separator is the last one: item keys have colons. */
export function splitCardId(card: string): { item: string; side: Side } {
  const cut = card.lastIndexOf('|');
  return { item: card.slice(0, cut), side: card.slice(cut + 1) as Side };
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
      if (db.objectStoreNames.contains(STORE)) return;
      const store = db.createObjectStore(STORE, { keyPath: 'card' });
      // Both sides of one word, for the story reader's per-word lookup…
      store.createIndex('item', 'item');
      // …and everything wanted before a moment, for the review queue.
      store.createIndex('due', 'due');
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return opening;
}

/** Runs `body` in one transaction and resolves when it has committed, or on any failure. */
async function transact(mode: IDBTransactionMode, body: (store: IDBObjectStore) => void): Promise<boolean> {
  const db = await open();
  if (!db) return false;

  return new Promise(resolve => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch {
      return resolve(false);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
    try {
      body(tx.objectStore(STORE));
    } catch {
      resolve(false);
    }
  });
}

/** Every record there is. Small enough to hold in memory — one per side per studied word. */
export async function loadAll(): Promise<CardRecord[]> {
  const db = await open();
  if (!db) return [];

  return new Promise(resolve => {
    let request: IDBRequest<CardRecord[]>;
    try {
      request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    } catch {
      return resolve([]);
    }
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => resolve([]);
  });
}

/** Writes records, replacing any with the same card id. One transaction for the lot. */
export function save(records: CardRecord[]): Promise<boolean> {
  if (records.length === 0) return Promise.resolve(true);
  return transact('readwrite', store => {
    for (const record of records) store.put(record);
  });
}

/** Forgets cards outright, which is not the same as marking them known. */
export function remove(cards: string[]): Promise<boolean> {
  if (cards.length === 0) return Promise.resolve(true);
  return transact('readwrite', store => {
    for (const card of cards) store.delete(card);
  });
}

/** Back to knowing nothing. */
export function clear(): Promise<boolean> {
  return transact('readwrite', store => store.clear());
}
