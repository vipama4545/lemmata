// The small things both writing routers need: how a request fails, how an id is minted, and
// how a derived count is put right.
//
// Lifted out of admin.ts when readers gained a library of their own. There is nothing new
// here: every function below is the one admin.ts had, moved, and moving them was the
// alternative to a second copy that would have drifted from the first as soon as either was
// corrected. None of them asks which router is calling. What differs between an admin's write
// and a reader's is *what it is allowed to touch*, and that is decided one level up.

import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/server';
import { and, count, eq, inArray, isNull, sql as raw } from 'drizzle-orm';
import { schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';

/** A refusal with a message written to be read on screen. */
export function fail(message: string): never {
  throw new ORPCError('BAD_REQUEST', { message });
}

/**
 * A url-safe id from a piece of English.
 *
 * Only ever used where the natural id is Latin — a verb's paradigm ("abandon-vt") and a
 * story's slug. A *word's* id is not made this way; see `saveWord`.
 */
export function slug(text: string, fallback: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

/**
 * Cyrillic to Latin, for minting a Russian verb id.
 *
 * `slug` above strips everything that is not a–z, which would reduce делать to nothing at
 * all — so Cyrillic is transliterated first rather than discarded. The table is the plain
 * BGN-ish one and its output is never read by anybody; what matters is only that it is
 * *stable*, because an id, once minted, is cited by study records and story tokens.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugCyrillic(text: string): string {
  return [...text.toLowerCase()].map(letter => CYRILLIC[letter] ?? letter).join('');
}

/**
 * Ids a story may not take, because the app's routes spend them on something else.
 *
 * `/stories/category/folk-tales` is a shelf and `/library/stories/new` is the form that makes
 * one, so a story whose slug came out as either would own a URL that already means something,
 * and would lose it, since a static segment outranks `:storyId`. Treated as "taken" rather than
 * refused: the story is called whatever it is called, and `new-2` is a better answer than an
 * error about routing.
 */
const RESERVED_STORY_IDS = new Set(['category', 'new']);

/**
 * `${base}`, then `${base}-2`, until nothing has it.
 *
 * Across the whole table, not per owner, and that is the only sensible reading of it: a story
 * id is a URL, `stories.id` is one flat column, and a reader's own Cinderella and the
 * dictionary's cannot both be `/stories/cinderella`. Whoever asks second gets `cinderella-2`.
 */
export async function freeId(
  tx: Tx,
  table: 'verbs' | 'stories' | 'storyCategories' | 'categories',
  base: string,
): Promise<string> {
  const target =
    table === 'verbs'
      ? schema.kaVerbs
      : table === 'stories'
        ? schema.stories
        : table === 'categories'
          ? schema.categories
          : schema.storyCategories;

  for (let n = 1; n < 500; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (table === 'stories' && RESERVED_STORY_IDS.has(id)) continue;
    const [taken] = await tx.select({ id: target.id }).from(target).where(eq(target.id, id)).limit(1);
    if (!taken) return id;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** The next free position, so a new row lands at the end of the list rather than at 0. */
export async function nextPosition(
  tx: Tx,
  table: typeof schema.words | typeof schema.kaVerbs | typeof schema.ruVerbs,
): Promise<number> {
  const [row] = await tx.select({ max: raw<number | null>`max(${table.position})` }).from(table);
  return (row?.max ?? -1) + 1;
}

/**
 * Recounts the categories named, so the grid's counts stay true.
 *
 * Both the old and the new category have to be recounted when a word moves between them,
 * which is why this takes a list rather than one id.
 *
 * Each is counted in its own ownership, which is all that private vocabulary changed here. A
 * published category counts published words, because that number rides in the shared snapshot
 * and has to mean the same thing to everybody, so a reader filing one of their own words under
 * "Food & drink" leaves it where it was. An owned category counts its owner's words, which is
 * the only kind it can hold. The ownership is read off the row rather than passed in, so no
 * caller can get the pairing wrong.
 */
export async function recountCategories(tx: Tx, categoryIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;

  const rows = await tx
    .select({ id: schema.categories.id, ownerId: schema.categories.ownerId })
    .from(schema.categories)
    .where(inArray(schema.categories.id, ids));

  for (const category of rows) {
    const [row] = await tx
      .select({ total: count() })
      .from(schema.words)
      .where(
        and(
          eq(schema.words.categoryId, category.id),
          category.ownerId ? eq(schema.words.ownerId, category.ownerId) : isNull(schema.words.ownerId),
        ),
      );

    await tx
      .update(schema.categories)
      .set({ wordCount: Number(row?.total ?? 0) })
      .where(eq(schema.categories.id, category.id));
  }
}

/**
 * Recounts the shelves named, so the library's counts stay true. The same job
 * `recountCategories` does for words, and for the same reason: both the shelf a story left
 * and the one it joined have to be counted again.
 *
 * Private stories are never counted, because they are never filed: `stories.category_id` stays
 * null on all of them. See the note on `stories.owner_id`.
 */
export async function recountStoryCategories(tx: Tx, categoryIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;

  const counts = await tx
    .select({ categoryId: schema.stories.categoryId, total: count() })
    .from(schema.stories)
    .where(and(inArray(schema.stories.categoryId, ids), isNull(schema.stories.ownerId)))
    .groupBy(schema.stories.categoryId);

  const byId = new Map(counts.map(row => [row.categoryId, Number(row.total)]));
  for (const id of ids) {
    await tx
      .update(schema.storyCategories)
      .set({ storyCount: byId.get(id) ?? 0 })
      .where(eq(schema.storyCategories.id, id));
  }
}
