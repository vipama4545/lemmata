// Checks the study sync's merge rule against a real database.
//
// The rule is one line — for a given card, the later `updatedAt` wins — but everything that
// makes signing in safe rests on it, and the failure mode is silent: a browser pushes a
// stale copy, the server takes it, and someone's review history quietly goes backwards.
//
// The procedures are called in-process with a fabricated session rather than over HTTP.
// That is the point: this is a test of the merge, not of the cookie, and the HTTP and auth
// layers refuse an anonymous caller before any of this is reached.
//
//     npm run db:verify-sync

import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import type { StudyCardWire } from '@georgian/shared/types';
import { db, schema, sql } from './index.ts';
import { router } from '../router/index.ts';
import type { AppContext } from '../router/base.ts';

const USER_ID = 'verify-sync-user';
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

function card(overrides: Partial<StudyCardWire> & { card: string }): StudyCardWire {
  const [item, side] = overrides.card.split('|');
  return {
    item,
    side: side as StudyCardWire['side'],
    level: 3,
    interval: 2,
    ease: 2.5,
    due: NOW + 86_400_000,
    reps: 1,
    lapses: 0,
    last: NOW,
    created: NOW,
    introduced: 'review',
    deleted: false,
    updatedAt: NOW,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ setup */

await db.delete(schema.studyCards).where(eq(schema.studyCards.userId, USER_ID));
await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
await db.insert(schema.user).values({
  id: USER_ID,
  name: 'verify-sync',
  email: 'verify-sync@example.invalid',
  emailVerified: true,
});

// Better Auth's session type is large and every field of it but the user id is irrelevant
// here, so it is faked and cast rather than constructed. The cast is confined to this line.
const context = {
  session: { user: { id: USER_ID } },
  headers: new Headers(),
} as unknown as AppContext;

const api = createRouterClient(router, { context });

/* ------------------------------------------------------------------ tests */

// 1. A first push, as a browser that has just signed in would send it.
await api.study.push({
  cards: [
    card({ card: 'w:1|ka', level: 3 }),
    card({ card: 'w:1|en', level: 2 }),
    card({ card: 'w:2|ka', level: 5 }),
  ],
});

let pulled = await api.study.pull({});
check('a first push stores every card', pulled.cards.length === 3, `got ${pulled.cards.length}`);

// 2. A newer copy of a card replaces the one on file.
await api.study.push({ cards: [card({ card: 'w:1|ka', level: 5, updatedAt: NOW + 1_000 })] });
pulled = await api.study.pull({});
let one = pulled.cards.find(c => c.card === 'w:1|ka');
check('a newer copy wins', one?.level === 5, `level is ${one?.level}, expected 5`);

// 3. A stale copy — the whole point. This is what a second device pushes after being
//    offline, and taking it would undo work done since.
await api.study.push({ cards: [card({ card: 'w:1|ka', level: 1, updatedAt: NOW - 10_000 })] });
pulled = await api.study.pull({});
one = pulled.cards.find(c => c.card === 'w:1|ka');
check('a stale copy is ignored', one?.level === 5, `level is ${one?.level}, expected 5`);

// 4. `created` keeps the earliest of the two, whichever copy is otherwise winning: when a
//    card first appeared is a fact about that moment, not about the last write.
await api.study.push({
  cards: [card({ card: 'w:1|ka', level: 4, created: NOW - 500_000, updatedAt: NOW + 2_000 })],
});
pulled = await api.study.pull({});
one = pulled.cards.find(c => c.card === 'w:1|ka');
check('created keeps the earlier value', one?.created === NOW - 500_000, `created is ${one?.created}`);

// 5. A tombstone survives a pull, so a device that has not seen the delete learns about it.
await api.study.push({
  cards: [card({ card: 'w:2|ka', deleted: true, updatedAt: NOW + 3_000 })],
});
pulled = await api.study.pull({});
const gone = pulled.cards.find(c => c.card === 'w:2|ka');
check('a delete is a tombstone, not a missing row', gone?.deleted === true, JSON.stringify(gone));

// 6. `since` returns only what changed after it.
const recent = await api.study.pull({ since: NOW + 2_500 });
check(
  'since narrows the pull',
  recent.cards.length === 1 && recent.cards[0].card === 'w:2|ka',
  `got ${recent.cards.map(c => c.card).join(', ')}`,
);

// 7. Reset tombstones everything that was still alive.
const { cleared } = await api.study.reset();
pulled = await api.study.pull({});
check('reset tombstones the live cards', cleared === 2, `cleared ${cleared}, expected 2`);
check('nothing is left alive after a reset', pulled.cards.every(c => c.deleted));

// 8. An undo — the case `updatedAt` exists for. The record's content goes backwards, but
//    the write is happening now, so it must win.
await api.study.push({ cards: [card({ card: 'w:3|ka', level: 4, updatedAt: NOW + 10_000 })] });
await api.study.push({
  cards: [card({ card: 'w:3|ka', level: 2, last: NOW - 99_000, updatedAt: NOW + 11_000 })],
});
pulled = await api.study.pull({});
const undone = pulled.cards.find(c => c.card === 'w:3|ka');
check('an undo with an older `last` still wins', undone?.level === 2, `level is ${undone?.level}`);

/* ---------------------------------------------------------------- teardown */

await db.delete(schema.studyCards).where(eq(schema.studyCards.userId, USER_ID));
await db.delete(schema.user).where(eq(schema.user.id, USER_ID));

console.log(
  failures === 0
    ? '\nThe sync merges the way it says it does.'
    : `\n${failures} check(s) failed.`,
);

process.exitCode = failures === 0 ? 0 : 1;
await sql.end({ timeout: 5 });
