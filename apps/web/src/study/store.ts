// The review records, in memory, with every change written through to IndexedDB.
//
// Held as one map rather than queried per word: a story paints 976 words at once and a deck
// filter walks 2,500 items, and neither can be waiting on a database round trip per lookup.
// There is one record per side per *studied* item, so even a finished learner's map is a few
// thousand small objects.
//
// Deliberately not a React context. Two unrelated pages need this, the sidebar wants the due
// count on every route, and a provider wrapping the whole app would have to sit above the
// router and re-render all of it. `useSyncExternalStore` gives the same thing without the
// tree surgery, and lets the non-React helpers below be called from anywhere.

import { useSyncExternalStore } from 'react';
import type { CardRecord, Introduced, Side } from './db';
import { SIDES, cardId, clear, loadAll, remove, save } from './db';
import type { Grade, Mastery, Review } from './mastery';
import { KNOWN, applyGrade, applyLevel, isDue } from './mastery';

export type { Side } from './db';
export type { CardRecord, Introduced } from './db';
export { cardId, splitCardId, SIDES } from './db';

/** What every reader sees. Replaced wholesale on each change, so identity means "changed". */
export interface Progress {
  /** False until the first read of the database has come back. */
  ready: boolean;
  /** Card id → its record. No entry means that side has never been answered. */
  cards: ReadonlyMap<string, CardRecord>;
}

const EMPTY: Progress = { ready: false, cards: new Map() };

let snapshot: Progress = EMPTY;
const listeners = new Set<() => void>();
let started = false;

function publish(cards: Map<string, CardRecord>, ready = snapshot.ready): void {
  snapshot = { ready, cards };
  for (const listener of listeners) listener();
}

/**
 * Brings a record written before there were accounts up to date.
 *
 * Those records have no `updatedAt`. Falling back to `last` dates them to when the card was
 * answered, which is both true and the safest available answer: it is old, so anything the
 * account has for that card is newer and wins — which is the right way round for a browser
 * that has just signed in for the first time.
 */
function adopt(record: CardRecord): CardRecord {
  return record.updatedAt ? record : { ...record, updatedAt: record.last ?? record.created ?? 0 };
}

/** Loads the database once, the first time anything subscribes. */
function start(): void {
  if (started) return;
  started = true;
  void loadAll().then(records => {
    // Anything written while the read was in flight wins: it is newer than the disk.
    const cards = new Map(records.map(record => [record.card, adopt(record)]));
    for (const [key, record] of snapshot.cards) cards.set(key, record);
    publish(cards, true);
  });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Progress {
  return snapshot;
}

/** Everything known about what you know. Re-renders the caller whenever any of it changes. */
export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * The same records, outside React. The review queue is built from these rather than from the
 * rendered value on purpose: it must be rebuilt when the *filters* change and not when an
 * answer changes a record, or the card just answered would vanish and reorder the rest
 * underneath the cursor.
 */
export function progressNow(): Progress {
  start();
  return snapshot;
}

/**
 * Anything that wants to hear about a change — in practice the account sync, which is
 * registered rather than called directly so that this module stays the bottom of the stack
 * and knows nothing about the network.
 */
type Watcher = (changed: CardRecord[], removed: string[]) => void;

const watchers = new Set<Watcher>();

export function watchWrites(watcher: Watcher): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

/** Applies a set of edits to the map and writes them through. */
function write(changed: CardRecord[], removed: string[] = []): void {
  const cards = new Map(snapshot.cards);
  for (const card of removed) cards.delete(card);
  for (const record of changed) cards.set(record.card, record);
  publish(cards);

  // Fire and forget: the map above is the truth the UI reads, and a card whose write fails
  // is a card that comes back on the next reload — not a reason to block the answer.
  void save(changed);
  void remove(removed);

  for (const watcher of watchers) watcher(changed, removed);
}

/**
 * Merges records that came from the account into the local store.
 *
 * Same rule as the server's: for one card, the later `updatedAt` wins. A tombstone deletes
 * the local record outright — nothing here keeps a deleted card, because the outbox in
 * sync.ts is what remembers a deletion long enough to send it.
 */
export function mergeFromAccount(incoming: { record: CardRecord; deleted: boolean }[]): void {
  const cards = new Map(snapshot.cards);
  const changed: CardRecord[] = [];
  const removed: string[] = [];

  for (const { record, deleted } of incoming) {
    const mine = cards.get(record.card);
    if (mine && mine.updatedAt >= record.updatedAt) continue;

    if (deleted) {
      if (!mine) continue;
      cards.delete(record.card);
      removed.push(record.card);
    } else {
      cards.set(record.card, record);
      changed.push(record);
    }
  }

  if (changed.length === 0 && removed.length === 0) return;

  publish(cards);
  void save(changed);
  void remove(removed);
  // Deliberately does not notify the watchers: these records came from the server, and
  // sending them straight back would be a loop that never settles.
}

function build(
  item: string,
  side: Side,
  review: Review,
  previous: CardRecord | undefined,
  introduced: Introduced,
): CardRecord {
  return {
    ...review,
    card: cardId(item, side),
    item,
    side,
    // How and when a card first appeared is a fact about that moment, not about the last
    // time it was answered, so neither is rewritten by a later answer.
    created: previous?.created ?? review.last,
    introduced: previous?.introduced ?? introduced,
    updatedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ reading */

export function cardOf(progress: Progress, item: string, side: Side): CardRecord | undefined {
  return progress.cards.get(cardId(item, side));
}

/** True when neither side of an item has ever been answered — never met, anywhere. */
export function isUnseen(progress: Progress, item: string): boolean {
  return SIDES.every(side => !progress.cards.has(cardId(item, side)));
}

/**
 * The level to show a word at while reading.
 *
 * Reading is recognition, so this is the Georgian→English side's level. It falls back to the
 * other side rather than reporting nothing, so a word you have only ever drilled in the
 * producing direction is not painted as one you have never met.
 */
export function readingMastery(progress: Progress, item: string): Mastery | null {
  return cardOf(progress, item, 'ka')?.level ?? cardOf(progress, item, 'en')?.level ?? null;
}

/** How many cards are wanted right now, across everything. What the sidebar counts. */
export function dueCount(progress: Progress, now: number): number {
  let count = 0;
  for (const record of progress.cards.values()) if (isDue(record, now)) count += 1;
  return count;
}

/** Local midnight. The day the new-card allowance is counted against is a calendar day. */
function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * New cards taken on today, across every deck.
 *
 * The allowance is per day rather than per sitting, so that changing a filter, or coming
 * back after lunch, does not hand out a fresh twenty. It counts records rather than keeping
 * a tally of its own, which means it cannot drift out of step with what was actually
 * studied — and it ignores the ones a story retired, which were never learned.
 */
export function newTodayCount(progress: Progress, now: number): number {
  const since = startOfDay(now);
  let count = 0;
  for (const record of progress.cards.values()) {
    if (record.introduced === 'review' && record.created >= since) count += 1;
  }
  return count;
}

/* ----------------------------------------------------------------- writing */

/**
 * Answers one side of one card. Returns what the record was, so the page can offer an undo
 * — an SRS that cannot take back a misclick teaches you the wrong interval for months.
 */
export function gradeCard(item: string, side: Side, grade: Grade, now = Date.now()): CardRecord | null {
  const previous = cardOf(snapshot, item, side);
  write([build(item, side, applyGrade(previous ?? null, grade, now), previous, 'review')]);
  return previous ?? null;
}

/** Files one side at a level chosen by hand, and schedules it to match. */
export function setCardMastery(item: string, side: Side, level: Mastery, now = Date.now()): void {
  const previous = cardOf(snapshot, item, side);
  write([build(item, side, applyLevel(previous ?? null, level, now), previous, 'marked')]);
}

/**
 * Files both sides at a level. What the level picker in a story sets: you are saying how
 * well you know the *word*, not how well you know one direction of a drill.
 */
export function setItemMastery(item: string, level: Mastery, now = Date.now()): void {
  write(
    SIDES.map(side => {
      const previous = cardOf(snapshot, item, side);
      return build(item, side, applyLevel(previous ?? null, level, now), previous, 'marked');
    }),
  );
}

/** Puts an item back to never-seen. Not the same as marking it known — this forgets it. */
export function forgetItem(item: string): void {
  write([], SIDES.map(side => cardId(item, side)));
}

/**
 * Restores what `gradeCard` returned, undoing one answer.
 *
 * `updatedAt` is stamped afresh rather than restored with the rest. The record's *content*
 * is going back in time, but the act of writing it is happening now, and an account syncing
 * on another device has to see the undo as the newer of the two.
 */
export function undoCard(item: string, side: Side, previous: CardRecord | null): void {
  if (previous) write([{ ...previous, updatedAt: Date.now() }]);
  else write([], [cardId(item, side)]);
}

/**
 * Marks every item that has never been met as known, and leaves the rest alone. What the
 * checkbox at the end of a story ticks: having read the whole thing, the words you never
 * stopped on are the ones you never needed to. Returns how many it retired.
 */
export function markUnseenKnown(items: Iterable<string>, now = Date.now()): number {
  const records: CardRecord[] = [];
  let count = 0;
  for (const item of items) {
    if (!isUnseen(snapshot, item)) continue;
    count += 1;
    for (const side of SIDES) records.push(build(item, side, applyLevel(null, KNOWN, now), undefined, 'marked'));
  }
  write(records);
  return count;
}

/** Forgets everything, here and — if an account is signed in — on it too. */
export function resetProgress(): void {
  const wiped = [...snapshot.cards.keys()];
  publish(new Map());
  void clear();
  for (const watcher of watchers) watcher([], wiped);
}
