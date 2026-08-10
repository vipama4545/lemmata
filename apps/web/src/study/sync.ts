// Keeping the browser's records and the account's records in step.
//
// The browser is the primary store and stays that way. Signed out, IndexedDB is the only
// copy there is and everything works exactly as it did before there were accounts — you can
// study the whole dictionary and never sign up. Signing in does not switch to a different
// store; it adds a second replica that outlives this laptop.
//
// The merge rule is the same at both ends, and it is the whole design: for one card, the
// copy with the later `updatedAt` wins. Everything awkward falls out of that.
//
//   Signing in for the first time pushes every local record. Nothing can be clobbered,
//   because a stale row loses — so "add what they already have to their account" needs no
//   special case, it is just a push where every local record happens to be the newer one.
//
//   Answering on a phone and again on a laptop converges on the later answer.
//
//   Forgetting a card sends a tombstone rather than nothing, because an absent row and a
//   deliberately-removed one are otherwise indistinguishable to whoever syncs next.

import type { StudyCardWire } from '@georgian/shared/types';
import { api } from '../api/client';
import type { CardRecord } from './db';
import { splitCardId } from './db';
import { mergeFromAccount, progressNow, watchWrites } from './store';
import { lang } from '../content/store';

/** How long to sit on a change before sending it, so a burst of answers is one request. */
const FLUSH_DELAY = 2_000;

/* ------------------------------------------------------------ translation */

function toWire(record: CardRecord): StudyCardWire {
  return {
    card: record.card,
    item: record.item,
    side: record.side,
    lang: record.lang,
    level: record.level,
    interval: record.interval,
    ease: record.ease,
    due: record.due,
    reps: record.reps,
    lapses: record.lapses,
    last: record.last,
    created: record.created,
    introduced: record.introduced,
    deleted: false,
    updatedAt: record.updatedAt,
  };
}

/**
 * A tombstone for a card that is gone.
 *
 * The scheduling fields are filler — nothing will ever read them, because `deleted` is what
 * the other end acts on — but they have to be present and in range, since the contract
 * validates every card the same way whether it is alive or not.
 */
function tombstone(card: string): StudyCardWire {
  const { item, side } = splitCardId(card);
  const now = Date.now();
  return {
    card,
    item,
    side,
    // A tombstone is a claim that a card is gone, and the card key does not say which
    // dictionary it came from. The language currently loaded is the only answer available
    // and is harmless either way: nothing filters a deleted card by language.
    lang: lang(),
    level: 1,
    interval: 0,
    ease: 2.5,
    due: now,
    reps: 0,
    lapses: 0,
    last: now,
    created: now,
    introduced: 'marked',
    deleted: true,
    updatedAt: now,
  };
}

function fromWire(wire: StudyCardWire): { record: CardRecord; deleted: boolean } {
  return {
    deleted: wire.deleted,
    record: {
      card: wire.card,
      item: wire.item,
      side: wire.side,
      lang: wire.lang,
      level: wire.level,
      interval: wire.interval,
      ease: wire.ease,
      due: wire.due,
      reps: wire.reps,
      lapses: wire.lapses,
      last: wire.last,
      created: wire.created,
      introduced: wire.introduced,
      updatedAt: wire.updatedAt,
    },
  };
}

/* ------------------------------------------------------------------ state */

/** Changes waiting to go up, newest per card. Lost on reload — see the note on `signIn`. */
const outbox = new Map<string, StudyCardWire>();

let signedIn = false;
let timer: number | undefined;
let sending: Promise<void> | null = null;
let stopWatching: (() => void) | null = null;

function schedule(): void {
  if (!signedIn || outbox.size === 0) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), FLUSH_DELAY);
}

/**
 * Sends whatever is waiting.
 *
 * The batch is taken out of the outbox before the request, and put back if it fails, so a
 * change made *during* the request is not swallowed by a retry of the batch before it.
 */
async function flush(): Promise<void> {
  if (!signedIn || outbox.size === 0) return;
  if (sending) return sending;

  const batch = [...outbox.values()];
  outbox.clear();

  sending = api.study
    .push({ cards: batch })
    .then(() => undefined)
    .catch((error: unknown) => {
      // Whatever failed goes back, unless something newer for that card has since arrived.
      for (const card of batch) {
        const newer = outbox.get(card.card);
        if (!newer || newer.updatedAt < card.updatedAt) outbox.set(card.card, card);
      }
      console.warn('Could not sync your progress; it will be retried.', error);
    })
    .finally(() => {
      sending = null;
      if (outbox.size > 0) schedule();
    });

  return sending;
}

/* --------------------------------------------------------------- lifecycle */

/**
 * Signs the sync in and reconciles the two stores.
 *
 * Everything local is pushed, then everything remote is pulled — in that order, and both in
 * full. The full push is what carries an anonymous browser's history into a brand-new
 * account, and it is also why losing the outbox on reload costs nothing but a delay: the
 * next sign-in sends the lot again.
 */
async function signIn(): Promise<void> {
  signedIn = true;

  const local = [...progressNow().cards.values()].map(toWire);
  for (const card of local) {
    // Anything already queued is at least as new as the map it came from.
    if (!outbox.has(card.card)) outbox.set(card.card, card);
  }

  await flush();

  try {
    const { cards } = await api.study.pull({});
    mergeFromAccount(cards.map(fromWire));
  } catch (error) {
    console.warn('Could not fetch your saved progress.', error);
  }
}

function signOut(): void {
  signedIn = false;
  window.clearTimeout(timer);
  // The outbox is dropped rather than kept: those changes belong to the account that was
  // signed in, and holding them would push one person's answers into the next person's
  // account on a shared machine.
  outbox.clear();
}

/**
 * Starts or stops syncing as the session changes. Called from the auth UI, which is the
 * only thing that knows whether anyone is signed in.
 *
 * Passing the same user id twice is a no-op, so this is safe to call on every render.
 */
let current: string | null = null;

export function setSyncUser(userId: string | null): void {
  if (userId === current) return;
  current = userId;

  if (!userId) {
    signOut();
    stopWatching?.();
    stopWatching = null;
    return;
  }

  stopWatching ??= watchWrites((changed, removed) => {
    if (!signedIn) return;
    for (const record of changed) outbox.set(record.card, toWire(record));
    for (const card of removed) outbox.set(card, tombstone(card));
    schedule();
  });

  void signIn();
}

/** Sends anything outstanding immediately. Used when the tab is about to go away. */
export function flushNow(): void {
  if (!signedIn || outbox.size === 0) return;
  window.clearTimeout(timer);
  void flush();
}
