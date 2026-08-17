// Writing a story: cutting the prose up, linking every word in it, and keeping the counts true.
//
// Every function here was in admin.ts, and every one of them is now called by two routers
// rather than one: `admin`, which publishes, and `library`, which does not. Moving them was not
// a tidy-up. A private story has to be tokenised by the same tokeniser, linked by the same
// resolver and counted by the same tally as a published one, or the two become different kinds
// of thing behind one reader, and the day one is fixed is the day they disagree.
//
// Nothing here knows or asks who is calling. Two arguments carry the whole of the difference:
//
//   `owner` on `relink`: whose vocabulary the resolver may see. Null is the published
//     dictionary; a user id adds that person's own entries. See `buildIndexes`.
//
//   nothing else. Ownership of the *story* is checked by the caller before it gets here,
//     because "may I write this row" is a question about the request, not about the prose.
//
// Two rules from admin.ts still hold and are worth repeating where the code is:
//
//   The tagger is asked *before* any transaction opens. It is an HTTP round trip to a process
//   holding a gigabyte of models, and a transaction held across it would lock the stories table
//   for as long as that takes to answer. See `tagsFor`.
//
//   A relink keeps every hand-made token and recomputes everything else. That is what makes it
//   safe to run again after any change to the lexicon. See `story_tokens.via`.

import { and, asc, eq } from 'drizzle-orm';
import type { StoryLinkResult } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import type { Story, StoryToken } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { analyse, type Tags } from '../story/analyser.ts';
import { buildIndexes, isHandMade, linkStory, pinKey } from '../story/resolve.ts';
import type { Pinned } from '../story/resolve.ts';
import { readLines } from '../story/tokenise.ts';
import { loadStory } from './content.ts';
import { fail } from './shared.ts';

/**
 * Every hand-made token in one chapter, keyed so a relink can put them back.
 *
 * See `story_tokens.via`: a person's decision is a token marked `name` or `override`, and
 * everything else is the resolver's own working. This reads the first kind out before the
 * rows are replaced.
 *
 * Scoped to a chapter because a relink is: the key is `paragraph:position:form`, which two
 * chapters of one story collide on constantly — every chapter has a paragraph 0.
 */
export async function readPinned(tx: Tx, storyId: string, chapter: number): Promise<Pinned> {
  const rows = await tx
    .select()
    .from(schema.storyTokens)
    .where(and(eq(schema.storyTokens.storyId, storyId), eq(schema.storyTokens.chapter, chapter)));
  const pinned: Pinned = new Map();

  for (const row of rows) {
    if (!isHandMade(row.via)) continue;
    const token: StoryToken = { form: row.form, via: row.via };
    if (row.wordId) token.word = row.wordId;
    if (row.sense != null) token.sense = row.sense;
    if (row.gram) token.gram = row.gram;
    if (row.name) token.name = row.name;
    // A hand-made link may still be flagged as a guess, and that flag is as much a decision
    // as the link itself — so it survives a relink alongside it.
    if (row.needsCheck) token.check = true;
    if (row.alts.length) token.alts = row.alts;
    if (row.comment) token.comment = row.comment;
    pinned.set(pinKey(row.paragraph, row.position, row.form), token);
  }

  return pinned;
}

/** One chapter's prose, as everything that links or relinks needs it. */
export interface Chapter {
  position: number;
  paragraphs: string[];
}

/**
 * A story's language, its owner and every chapter's prose, read before any transaction is
 * opened, so the tagger can be asked about it. Fails the request if there is no such story,
 * which is the same check the caller's own transaction repeats against a consistent snapshot.
 *
 * `ownerId` comes back with the rest because every caller in the library router has to know it
 * before it writes, and asking twice would be a second query for a fact already in hand.
 */
export async function storyProse(
  storyId: string,
): Promise<{ lang: Lang; ownerId: string | null; chapters: Chapter[] }> {
  const [story] = await db
    .select({ lang: schema.stories.lang, ownerId: schema.stories.ownerId })
    .from(schema.stories)
    .where(eq(schema.stories.id, storyId))
    .limit(1);
  if (!story) fail('There is no such story.');

  const chapters = await db
    .select({ position: schema.storyChapters.position, paragraphs: schema.storyChapters.paragraphs })
    .from(schema.storyChapters)
    .where(eq(schema.storyChapters.storyId, storyId))
    .orderBy(asc(schema.storyChapters.position));

  return { lang: story.lang, ownerId: story.ownerId, chapters };
}

/**
 * What the tagger makes of a story's words, or null when there is no tagger.
 *
 * Always called *before* `db.transaction`, never inside one. It is an HTTP round trip to a
 * Python process that holds a gigabyte of models, and a transaction left open across it
 * would turn one button press into a lock held on the stories table for as long as a
 * container somewhere else takes to answer. Nothing here needs to be atomic with the write:
 * the tags describe the prose, and if the prose changes underneath them linkStory notices the
 * token counts disagree and links without them.
 */
export async function tagsFor(lang: Lang, paragraphs: string[]): Promise<Tags | null> {
  return analyse(lang, paragraphs);
}

/**
 * A pasted text and its translation, cut into paragraphs and checked against each other.
 *
 * The check is the reason this is one function rather than two calls to `readLines`: the
 * split view pairs the two by position and has no other way to tell which English paragraph
 * belongs to which, so a translation of a different length is not a translation of this
 * text. Refusing here is the only place that can be caught — by the time it is rows, the
 * two are separate columns and nothing looks at them together again.
 */
export function readChapter(
  titled: boolean,
  text: string,
  translation: string,
): { title: string; titleEnglish: string; paragraphs: string[]; translation: string[] } {
  const native = readLines(text, titled);
  const english = translation.trim() ? readLines(translation, titled) : null;

  if (english && english.paragraphs.length !== native.paragraphs.length) {
    fail(
      `The translation has ${english.paragraphs.length} paragraph(s) and the text has ` +
        `${native.paragraphs.length}. The side-by-side view pairs them by position, so they ` +
        'would drift out of step.',
    );
  }

  return {
    title: native.title,
    titleEnglish: english?.title ?? '',
    paragraphs: native.paragraphs,
    translation: english?.paragraphs ?? [],
  };
}

/**
 * Moves a chapter to a position nothing occupies, tokens and all.
 *
 * The tokens move with it in the same breath, and that pairing is the reason there is no
 * foreign key between the two tables — see the note under `storyTokens` in schema.ts. Every
 * caller must leave `to` free: `(story_id, position)` is a primary key, and the update would
 * otherwise fail rather than overwrite.
 */
export async function shiftChapter(tx: Tx, storyId: string, from: number, to: number): Promise<void> {
  await tx
    .update(schema.storyChapters)
    .set({ position: to })
    .where(and(eq(schema.storyChapters.storyId, storyId), eq(schema.storyChapters.position, from)));
  await tx
    .update(schema.storyTokens)
    .set({ chapter: to })
    .where(and(eq(schema.storyTokens.storyId, storyId), eq(schema.storyTokens.chapter, from)));
}

/**
 * The counts of a text with nothing in it.
 *
 * Written on insert rather than left as `{}`, because a story or chapter with no prose yet is
 * a state the screens actually reach — creating a story and uploading its chapters after is
 * the whole point of the two being separate — and every reader of `stats` would otherwise get
 * `undefined` where it expects a number. The index card would say "undefined words" and size
 * its progress bar to `NaN%`.
 */
export const NO_STATS = {
  tokens: 0,
  distinctForms: 0,
  covered: 0,
  coverage: 0,
  names: 0,
  unresolved: 0,
  flagged: 0,
};

/** The two lists a link report hands back, which several signatures below pass around. */
export interface LinkLists {
  unresolved: { form: string; count: number }[];
  flagged: { form: string; count: number }[];
}

/** Merges the reports of several chapters into one, commonest spelling first. */
export function mergeLists(reports: LinkLists[]): LinkLists {
  const gather = (pick: (report: LinkLists) => { form: string; count: number }[]) => {
    const totals = new Map<string, number>();
    for (const report of reports) {
      for (const entry of pick(report)) totals.set(entry.form, (totals.get(entry.form) ?? 0) + entry.count);
    }
    return [...totals]
      .map(([form, count]) => ({ form, count }))
      .sort((a, b) => b.count - a.count || a.form.localeCompare(b.form));
  };

  return { unresolved: gather(report => report.unresolved), flagged: gather(report => report.flagged) };
}

/**
 * Re-resolves one chapter from the lexicon as it now stands, keeping every hand-made token,
 * and writes the result. The caller supplies the paragraphs so this serves both "the text
 * changed" and "the dictionary changed", and the tags because fetching them is not this
 * function's job to do inside a transaction — see `tagsFor`.
 *
 * A chapter at a time, and only the chapter named: relinking chapter 3 must not touch the
 * tokens of chapter 2, and the delete below is scoped accordingly. The story's own stats are
 * not written here — they are every chapter's together, so `recountStory` does it after.
 *
 * `owner` is whose private vocabulary the resolver may draw on, and it must be the story's own
 * owner or null. Handing it somebody else's would put a stranger's gloss in this text.
 */
export async function relink(
  tx: Tx,
  lang: Lang,
  storyId: string,
  chapter: number,
  paragraphs: string[],
  pinned: Pinned,
  tags: Tags | null,
  owner: string | null = null,
): Promise<LinkLists> {
  const indexes = await buildIndexes(lang, owner);
  const report = linkStory(lang, paragraphs, indexes, pinned, tags);

  // A pin may cite a word that has since been deleted. Better a token that falls back to
  // plain text than a write that fails on a foreign key and loses the whole edit.
  const known = new Set(indexes.byId.keys());

  await tx
    .delete(schema.storyTokens)
    .where(and(eq(schema.storyTokens.storyId, storyId), eq(schema.storyTokens.chapter, chapter)));

  if (report.tokens.length) {
    const rows = report.tokens.map(token => ({
      storyId,
      chapter,
      paragraph: token.paragraph,
      position: token.position,
      form: token.form,
      wordId: token.wordId && known.has(token.wordId) ? token.wordId : null,
      sense: token.sense,
      gram: token.gram,
      name: token.name,
      via: token.via,
      needsCheck: token.needsCheck,
      alts: token.alts,
      comment: token.comment,
    }));
    // postgres.js binds one parameter per column per row and a statement may carry 65,535 of
    // them, so a long story goes up in batches, as the seed does.
    for (let index = 0; index < rows.length; index += 2_000) {
      await tx.insert(schema.storyTokens).values(rows.slice(index, index + 2_000));
    }
  }

  await tx
    .update(schema.storyChapters)
    .set({ stats: report.stats })
    .where(and(eq(schema.storyChapters.storyId, storyId), eq(schema.storyChapters.position, chapter)));

  return { unresolved: report.unresolved, flagged: report.flagged };
}

/** The story as the reader wants it, opened at one chapter, plus what linking it turned up. */
export async function linkResult(storyId: string, chapter: number, extra: LinkLists): Promise<StoryLinkResult> {
  const story = await loadStory(storyId, chapter);
  if (!story) fail('That story disappeared while it was being saved.');
  return { story: story as Story, ...extra };
}

/**
 * Recounts the story from its tokens, and every chapter with it.
 *
 * Two reasons this reads the table rather than adding up what a linker just reported. One is
 * that pinning a token is not a relink — the other 975 have not changed and re-deriving them
 * would be a second of work to produce identical rows — so there is no report to add up.
 * The other is `distinctForms`, which does not sum: two chapters share spellings constantly,
 * and adding their counts would claim a story has more distinct words than it has words.
 */
export async function recountStory(tx: Tx, storyId: string): Promise<void> {
  const rows = await tx
    .select({
      chapter: schema.storyTokens.chapter,
      form: schema.storyTokens.form,
      wordId: schema.storyTokens.wordId,
      name: schema.storyTokens.name,
      needsCheck: schema.storyTokens.needsCheck,
    })
    .from(schema.storyTokens)
    .where(eq(schema.storyTokens.storyId, storyId));

  const tally = (of: typeof rows) => {
    const names = of.filter(row => row.name).length;
    const linked = of.filter(row => row.wordId).length;
    const covered = names + linked;
    const total = of.length;
    return {
      tokens: total,
      distinctForms: new Set(of.map(row => row.form)).size,
      covered,
      coverage: total ? Number(((covered / total) * 100).toFixed(1)) : 0,
      names,
      unresolved: total - covered,
      flagged: of.filter(row => row.needsCheck).length,
    };
  };

  await tx.update(schema.stories).set({ stats: tally(rows) }).where(eq(schema.stories.id, storyId));

  // Every chapter, including the ones with no tokens at all: a chapter emptied by an edit
  // has to have its stats cleared, and it has no rows here to be found by.
  const chapters = await tx
    .select({ position: schema.storyChapters.position })
    .from(schema.storyChapters)
    .where(eq(schema.storyChapters.storyId, storyId));

  for (const chapter of chapters) {
    await tx
      .update(schema.storyChapters)
      .set({ stats: tally(rows.filter(row => row.chapter === chapter.position)) })
      .where(
        and(eq(schema.storyChapters.storyId, storyId), eq(schema.storyChapters.position, chapter.position)),
      );
  }
}
