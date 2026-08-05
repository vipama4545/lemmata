// Your review records, and the sync that keeps two copies of them agreeing.
//
// The browser is the primary store and always has been. Signed out, IndexedDB is the only
// copy there is; signed in, this is the copy that outlives the laptop. Neither is "the"
// database — they are two replicas of the same set of cards, and the whole of the merge
// rule is: for a given card id, the copy with the later `updatedAt` wins.
//
// That rule is what makes the awkward cases fall out for free. Pushing the whole local
// store on first sign-in cannot clobber anything, because a stale row loses. Answering a
// card on a phone that is offline and again on a laptop converges on the later answer.
// Forgetting a card writes a tombstone rather than deleting the row, because a missing row
// and a deliberately-removed one are otherwise the same thing to whoever syncs next.

import { and, eq, gt, sql } from 'drizzle-orm';
import type { StudyCardWire } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import { authed, os } from './base.ts';

const cards = schema.studyCards;

type Row = typeof cards.$inferSelect;

/** Rows out. Every instant becomes epoch milliseconds, which is what the client deals in. */
function toWire(row: Row): StudyCardWire {
  return {
    card: row.card,
    item: row.item,
    side: row.side as StudyCardWire['side'],
    level: row.level as StudyCardWire['level'],
    interval: row.interval,
    ease: row.ease,
    due: row.due.getTime(),
    reps: row.reps,
    lapses: row.lapses,
    last: row.last.getTime(),
    created: row.created.getTime(),
    introduced: row.introduced as StudyCardWire['introduced'],
    deleted: row.deleted,
    updatedAt: row.updatedAt.getTime(),
  };
}

export const studyRouter = os.study.router({
  /**
   * This account's cards. `since` narrows it to what changed after that instant, which is
   * everything a running client needs after its first sync.
   *
   * Tombstones are included rather than filtered out — a client that has not seen a delete
   * yet needs to be told about it, and one that has will simply drop it again.
   */
  pull: os.study.pull
    .use(authed)
    .handler(async ({ input, context }) => {
      const since = input.since ? new Date(input.since) : null;
      const rows = await db
        .select()
        .from(cards)
        .where(
          since
            ? and(eq(cards.userId, context.user.id), gt(cards.updatedAt, since))
            : eq(cards.userId, context.user.id),
        );

      return { cards: rows.map(toWire), syncedAt: Date.now() };
    }),

  /**
   * Cards on their way up.
   *
   * The `setWhere` is the merge rule, in one line and enforced by the database rather than
   * by a read-then-write here: a row only updates when what arrived is genuinely newer.
   * Two devices pushing at once therefore cannot interleave into a state neither sent.
   */
  push: os.study.push
    .use(authed)
    .handler(async ({ input, context }) => {
      if (input.cards.length === 0) return { accepted: 0, syncedAt: Date.now() };

      const values = input.cards.map(card => ({
        userId: context.user.id,
        card: card.card,
        item: card.item,
        side: card.side,
        level: card.level,
        interval: card.interval,
        ease: card.ease,
        due: new Date(card.due),
        reps: card.reps,
        lapses: card.lapses,
        last: new Date(card.last),
        created: new Date(card.created),
        introduced: card.introduced,
        deleted: card.deleted,
        updatedAt: new Date(card.updatedAt),
      }));

      // Chunked because postgres.js binds one parameter per column per row, and a first
      // sign-in can carry several thousand cards — well past the 65,535 a single statement
      // is allowed.
      const CHUNK = 1_000;
      for (let index = 0; index < values.length; index += CHUNK) {
        await db
          .insert(cards)
          .values(values.slice(index, index + CHUNK))
          .onConflictDoUpdate({
            target: [cards.userId, cards.card],
            set: {
              level: sql`excluded.level`,
              interval: sql`excluded.interval`,
              ease: sql`excluded.ease`,
              due: sql`excluded.due`,
              reps: sql`excluded.reps`,
              lapses: sql`excluded.lapses`,
              last: sql`excluded.last`,
              // How and when a card first appeared is a fact about that moment. The earlier
              // of the two copies is the true one, whichever copy is otherwise winning.
              created: sql`least(${cards.created}, excluded.created)`,
              introduced: sql`excluded.introduced`,
              deleted: sql`excluded.deleted`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`excluded.updated_at > ${cards.updatedAt}`,
          });
      }

      return { accepted: values.length, syncedAt: Date.now() };
    }),

  /**
   * Back to knowing nothing, on every device.
   *
   * Tombstones rather than a DELETE, for the same reason a forgotten card leaves one: a
   * device that syncs tomorrow has to learn that these are gone, and it can only learn that
   * from a row that says so.
   */
  reset: os.study.reset.use(authed).handler(async ({ context }) => {
    const now = new Date();
    const cleared = await db
      .update(cards)
      .set({ deleted: true, updatedAt: now })
      .where(and(eq(cards.userId, context.user.id), eq(cards.deleted, false)))
      .returning({ card: cards.card });

    return { cleared: cleared.length };
  }),
});
