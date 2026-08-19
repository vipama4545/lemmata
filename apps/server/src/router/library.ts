// A reader's own library: stories they wrote or pasted in, and words they added.
//
// This is admin.ts with the authority removed and the ownership put in, and reading the two
// side by side is the fastest way to understand either. Every procedure here writes the same
// tables `admin` writes, through the same functions in storyWrite.ts, and differs in exactly
// three ways, and each of those is a rule rather than a detail:
//
//   **Everything written carries `owner_id`, and everything read is filtered by it.** Not one
//   query below trusts an id from the browser to be the caller's. `ownStory` and `ownWord` are
//   the only ways a row is reached, they take the session's user id rather than anything sent,
//   and they answer "there is no such story" for somebody else's, which is the same answer as
//   for one that does not exist. Which of the two it is is not this caller's business.
//
//   **Nothing bumps the content version.** `bumpContentVersion` is cache invalidation for the
//   shared snapshot, and this content is not in it. One person adding a word must not make
//   every other reader re-download the dictionary.
//
//   **The resolver is given the owner.** Linking a private story sees the published lexicon
//   *and* that person's own entries, which is the whole reward for adding one: you write down
//   a word you met, and the next text you paste in lights it up. See `loadLexicon`.
//
// What is deliberately absent is any way to touch published content. There is no `lang`
// argument that could point a write at the dictionary, no id that reaches a row without an
// owner, and no flag that turns one of these into the other. A reader cannot edit the
// dictionary's stories, and the way they get an editable one is `copyStory`.

import { and, asc, count, eq } from 'drizzle-orm';
import type { MyWordInput, PrivateContent } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { pinKey } from '../story/resolve.ts';
import { authed, os } from './base.ts';
import { loadOwned } from './content.ts';
import { fail, freeId, nextPosition, recountCategories, slug, slugCyrillic } from './shared.ts';
import {
  NO_STATS,
  linkResult,
  mergeLists,
  readChapter,
  readPinned,
  recountStory,
  relink,
  shiftChapter,
  storyProse,
  tagsFor,
  type LinkLists,
} from './storyWrite.ts';

/* ------------------------------------------------------------------ how much */

// What one account may keep, per language. Not a tier and not a business rule, just a ceiling,
// so that a script pointed at these endpoints cannot fill the disk or spend the machine's
// evening in the resolver. They sit an order of magnitude above what anybody doing this by hand
// would reach. Somebody who has genuinely written two hundred stories deserves a conversation
// rather than a silent failure, which is why the message says to get in touch.
const MAX_STORIES = 200;
const MAX_WORDS = 5_000;
const MAX_CATEGORIES = 50;

async function assertRoom(
  tx: Tx,
  table: typeof schema.stories | typeof schema.words | typeof schema.categories,
  owner: string,
  lang: Lang,
  limit: number,
  what: string,
): Promise<void> {
  const [row] = await tx
    .select({ total: count() })
    .from(table)
    .where(and(eq(table.ownerId, owner), eq(table.lang, lang)));

  if (Number(row?.total ?? 0) >= limit) {
    fail(`Your library already holds ${limit} ${what}, which is as many as one account may keep. Get in touch.`);
  }
}

/* --------------------------------------------------------------- finding yours */

/** One of your stories, by id. Somebody else's answers exactly as one that is not there. */
async function ownStory(tx: Tx, id: string, owner: string) {
  const [row] = await tx
    .select({ id: schema.stories.id, lang: schema.stories.lang, ownerId: schema.stories.ownerId })
    .from(schema.stories)
    .where(eq(schema.stories.id, id))
    .limit(1);

  if (!row || row.ownerId !== owner) fail('There is no such story in your library.');
  return row;
}

/** One of your entries, by id, on the same terms. */
async function ownWord(tx: Tx, id: string, owner: string) {
  const [row] = await tx
    .select({
      id: schema.words.id,
      lang: schema.words.lang,
      ownerId: schema.words.ownerId,
      categoryId: schema.words.categoryId,
    })
    .from(schema.words)
    .where(eq(schema.words.id, id))
    .limit(1);

  if (!row || row.ownerId !== owner) fail('There is no such word in your library.');
  return row;
}

/* --------------------------------------------------------------------- shelves */

/**
 * The shelf a private word is filed on: the one asked for, or "My words", made on demand.
 *
 * Three cases, and the middle one is the interesting one:
 *
 *   a shelf of your own:      used as it is.
 *   one of the dictionary's:  also used as it is, deliberately. Filing бабушка under "Family"
 *                             is the obvious thing to want and it costs nothing. The category's
 *                             stored count keeps counting published words only (see
 *                             `recountCategories`), so the shared snapshot does not move, and
 *                             the browser adds your own in when it lays the overlay over it.
 *   nothing at all:           "My words" is made, once, the first time you add a word.
 *
 * The lazily-made shelf is why the overlay carries categories at all. Without it there would
 * be nowhere to put the first word: `words.category_id` is not null.
 */
async function shelfFor(tx: Tx, owner: string, lang: Lang, wanted: string): Promise<{ id: string; name: string }> {
  if (wanted) {
    const [row] = await tx
      .select({
        id: schema.categories.id,
        name: schema.categories.name,
        lang: schema.categories.lang,
        ownerId: schema.categories.ownerId,
      })
      .from(schema.categories)
      .where(eq(schema.categories.id, wanted))
      .limit(1);

    if (!row || (row.ownerId && row.ownerId !== owner)) fail('There is no such category.');
    if (row.lang !== lang) fail(`That category is ${row.lang} and this word is ${lang}.`);
    return { id: row.id, name: row.name };
  }

  const [existing] = await tx
    .select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories)
    .where(and(eq(schema.categories.ownerId, owner), eq(schema.categories.lang, lang)))
    .orderBy(asc(schema.categories.position))
    .limit(1);
  if (existing) return existing;

  return makeShelf(tx, owner, lang, 'My words', '');
}

/** Mints a private shelf. Its id carries the owner, because ids are one flat column. */
async function makeShelf(
  tx: Tx,
  owner: string,
  lang: Lang,
  name: string,
  nameNative: string,
): Promise<{ id: string; name: string }> {
  await assertRoom(tx, schema.categories, owner, lang, MAX_CATEGORIES, 'categories');

  const stem = lang === 'ka' ? slug(name, 'words') : slug(slugCyrillic(name), 'words');
  const id = await freeId(tx, 'categories', `u-${owner.slice(0, 12)}-${stem}`);

  // Behind the ones this person already has. A count rather than `max(position) + 1`, which is
  // the same number here and needs no null case: these rows are only ever appended, and the one
  // screen that lists them draws them in the order they were made.
  const [existing] = await tx
    .select({ total: count() })
    .from(schema.categories)
    .where(and(eq(schema.categories.ownerId, owner), eq(schema.categories.lang, lang)));

  await tx.insert(schema.categories).values({
    id,
    lang,
    position: Number(existing?.total ?? 0),
    name,
    nameNative,
    wordCount: 0,
    ownerId: owner,
  });

  return { id, name };
}

/* ----------------------------------------------------------------------- words */

/**
 * The id a private entry is minted under.
 *
 * The published convention with the owner appended: `w:კატა` becomes `w:კატა@<user>`, and the
 * Russian `ru-w:` prefix is kept for the same reason it exists there: ids are one flat column
 * across both languages. Two readers may both add кот, and those are two entries.
 *
 * Headword-derived rather than random, so that deleting an entry and adding it again lands on
 * the same id and picks its review record back up. Clamped to 60 characters because this id
 * ends up inside `study_cards.item`, which is 128: prefix (5) + headword (60) + '@' (1) + a
 * Better Auth id (32) leaves room to spare, and a 60-character headword is a sentence.
 */
function mintWordId(lang: Lang, headword: string, owner: string): string {
  const prefix = lang === 'ka' ? 'w' : `${lang}-w`;
  return `${prefix}:${headword.trim().slice(0, 60)}@${owner}`;
}

/**
 * Creates or updates one private entry, with its senses and its inflected forms.
 *
 * The shape of `admin.saveWord`'s `writeWord`, and the differences are worth naming: the shelf
 * may be made on demand, the paradigm it may claim is checked against the right table for the
 * language, and every row written carries the owner. Senses and forms are replaced wholesale
 * because their order is their identity: a sense's position is what a story token cites.
 */
async function writeOwnWord(tx: Tx, input: MyWordInput, owner: string): Promise<string> {
  const shelf = await shelfFor(tx, owner, input.lang, input.categoryId);

  if (input.verbId) {
    const table = input.lang === 'ka' ? schema.kaVerbs : schema.ruVerbs;
    const [verb] = await tx.select({ id: table.id }).from(table).where(eq(table.id, input.verbId)).limit(1);
    if (!verb) fail(`There is no paradigm "${input.verbId}".`);
  }

  if (input.defaultSense && input.defaultSense > input.senses.length) {
    fail(`This entry has ${input.senses.length} sense(s), so ${input.defaultSense} cannot be the default.`);
  }

  const existing = input.id ? await ownWord(tx, input.id, owner) : undefined;
  if (existing && existing.lang !== input.lang) {
    fail(`That entry is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
  }

  const id = existing?.id ?? mintWordId(input.lang, input.headword, owner);
  if (!existing) {
    await assertRoom(tx, schema.words, owner, input.lang, MAX_WORDS, 'words');
    const [clash] = await tx.select({ id: schema.words.id }).from(schema.words).where(eq(schema.words.id, id)).limit(1);
    if (clash) fail(`You already have an entry for "${input.headword}". Edit that one instead.`);
  }

  const row = {
    lang: input.lang,
    headword: input.headword,
    accented: input.accented,
    // The headline gloss is the first sense unless something else was typed, which is the
    // convention the published lexicon follows.
    english: input.english || input.senses[0],
    definition: input.definition,
    level: input.level,
    partOfSpeech: input.partOfSpeech,
    category: shelf.name,
    categoryId: shelf.id,
    defaultSense: input.defaultSense,
    verbId: input.verbId,
    needsCheck: input.check,
    note: input.note,
  };

  if (existing) {
    await tx.update(schema.words).set(row).where(eq(schema.words.id, id));
  } else {
    await tx.insert(schema.words).values({
      id,
      position: await nextPosition(tx, schema.words),
      origin: 'added',
      ownerId: owner,
      ...row,
    });
  }

  await tx.delete(schema.wordSenses).where(eq(schema.wordSenses.wordId, id));
  await tx
    .insert(schema.wordSenses)
    .values(input.senses.map((english, index) => ({ wordId: id, position: index + 1, english })));

  await tx.delete(schema.wordForms).where(eq(schema.wordForms.wordId, id));
  if (input.forms.length) {
    // Deduplicated on the spelling: the key is (word_id, position), so two rows with the same
    // form would insert happily and then make the form index ambiguous against itself.
    const seen = new Set<string>();
    const rows = input.forms
      .filter(form => !seen.has(form.form) && seen.add(form.form))
      .map((form, index) => ({
        wordId: id,
        position: index + 1,
        form: form.form,
        gram: form.gram || null,
        english: form.english || null,
        accented: form.accented,
      }));
    if (rows.length) await tx.insert(schema.wordForms).values(rows);
  }

  await tx.delete(schema.ruWordGrammar).where(eq(schema.ruWordGrammar.wordId, id));
  if (input.lang === 'ru' && input.ru) {
    await tx.insert(schema.ruWordGrammar).values({
      wordId: id,
      gender: input.ru.gender || null,
      animacy: input.ru.animacy || null,
      declension: input.ru.declension || null,
      stressPattern: input.ru.stressPattern || null,
      needsCheck: input.ru.check,
    });
  }

  await recountCategories(tx, [shelf.id, existing?.categoryId]);
  return id;
}

/**
 * Puts the stats right on every story of yours that cited a word, after it stopped existing.
 *
 * `story_tokens.word_id` is `on delete set null`, so deleting an entry silently unlinks it
 * everywhere. The tokens survive as plain text, which is the right outcome, but the stored
 * coverage would go on claiming links that are no longer there. This is the one delete in the
 * app that has to recount something it did not write.
 */
async function recountCiting(tx: Tx, storyIds: string[]): Promise<void> {
  for (const id of [...new Set(storyIds)]) await recountStory(tx, id);
}

/* --------------------------------------------------------------------- routes */

/** The overlay as it now stands. Every mutation below answers with it; see the contract. */
function mine(owner: string, lang: Lang): Promise<PrivateContent> {
  return loadOwned(owner, lang);
}

export const libraryRouter = os.library.router({
  /**
   * Everything of yours in one language.
   *
   * Not behind `authed`, unlike everything else here, and that is deliberate rather than an
   * oversight: the app asks for this at boot, before it knows whether anybody is signed in, and
   * "nothing" is the true answer for a visitor with no account rather than an error worth
   * showing them. Every *write* below is authed, so there is nothing to reach this way.
   */
  mine: os.library.mine.handler(async ({ input, context }) => {
    const owner = context.session?.user?.id;
    if (!owner) return { lang: input.lang, stories: [], words: [], categories: [] };
    return mine(owner, input.lang);
  }),

  /* ---- your stories ---- */

  saveStory: os.library.saveStory.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    // Prose belongs to a chapter, and a story that exists has chapters to put it in. Refusing
    // beats ignoring: somebody who pasted a chapter into the wrong box should be told.
    if (input.id && input.text.trim()) {
      fail('That story already exists. Add the text as a chapter of it.');
    }

    const first = input.text.trim() ? readChapter(true, input.text, input.translation) : null;
    // Before the transaction, always. See `tagsFor`.
    const tags = first ? await tagsFor(input.lang, first.paragraphs) : null;

    const result = await db.transaction(async tx => {
      const existing = input.id ? await ownStory(tx, input.id, owner) : undefined;

      // A story does not change language: its tokens are cut by one language's rules and
      // linked against one language's lexicon.
      if (existing && existing.lang !== input.lang) {
        fail(`That story is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
      }

      const title = input.title || first?.title || '';
      const titleEnglish = input.titleEnglish || first?.titleEnglish || '';
      if (!title && !titleEnglish) fail('A story needs a title.');

      const row = {
        lang: input.lang,
        title: title || titleEnglish,
        titleEnglish,
        level: input.level,
        source: input.source,
        note: input.note,
        // Never filed. The shelves are the dictionary's; see the note on `stories.owner_id`.
        categoryId: null,
      };

      let id: string;
      if (existing) {
        id = existing.id;
        await tx.update(schema.stories).set(row).where(eq(schema.stories.id, id));
      } else {
        await assertRoom(tx, schema.stories, owner, input.lang, MAX_STORIES, 'stories');
        const base = titleEnglish || title;
        const stem =
          input.lang === 'ka' ? slug(base, 'story') : `${input.lang}-${slug(slugCyrillic(base), 'story')}`;
        // Across the whole table, so a private story and a published one can never claim one
        // URL. Whoever asks second gets `-2`. See `freeId`.
        id = await freeId(tx, 'stories', stem);
        await tx.insert(schema.stories).values({ id, stats: NO_STATS, ownerId: owner, ...row });
      }

      let report: LinkLists | null = null;
      if (first) {
        await tx.insert(schema.storyChapters).values({
          storyId: id,
          position: 0,
          title: '',
          titleEnglish: '',
          stats: NO_STATS,
          paragraphs: first.paragraphs,
          translation: first.translation,
        });
        report = await relink(tx, input.lang, id, 0, first.paragraphs, new Map(), tags, owner);
        await recountStory(tx, id);
      }

      return { id, report };
    });

    return {
      id: result.id,
      report: result.report ? await linkResult(result.id, 0, result.report) : null,
      content: await mine(owner, input.lang),
    };
  }),

  deleteStory: os.library.deleteStory.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;
    const lang = await db.transaction(async tx => {
      const story = await ownStory(tx, input.id, owner);
      // The chapters and their tokens cascade, and here that is right: they are this story's
      // and nothing else points at them.
      await tx.delete(schema.stories).where(eq(schema.stories.id, story.id));
      return story.lang;
    });

    return { content: await mine(owner, lang) };
  }),

  copyStory: os.library.copyStory.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    const result = await db.transaction(async tx => {
      const [source] = await tx
        .select()
        .from(schema.stories)
        .where(eq(schema.stories.id, input.id))
        .limit(1);

      // Published, or already yours. Somebody else's private story cannot be copied for the
      // same reason it cannot be read.
      if (!source || (source.ownerId && source.ownerId !== owner)) fail('There is no such story.');

      await assertRoom(tx, schema.stories, owner, source.lang, MAX_STORIES, 'stories');

      const base = source.titleEnglish || source.title;
      const stem =
        source.lang === 'ka' ? slug(base, 'story') : `${source.lang}-${slug(slugCyrillic(base), 'story')}`;
      const id = await freeId(tx, 'stories', `${stem}-mine`);

      await tx.insert(schema.stories).values({
        id,
        lang: source.lang,
        title: source.title,
        titleEnglish: source.titleEnglish,
        level: source.level,
        // Where it came from, kept as a line of prose rather than a key. The copy is a copy:
        // correcting the original afterwards will not reach it, which is the point of taking
        // one, and a foreign key would suggest otherwise.
        source: source.source || `Copied from “${source.title}”`,
        note: source.note,
        categoryId: null,
        stats: source.stats,
        ownerId: owner,
      });

      const chapters = await tx
        .select()
        .from(schema.storyChapters)
        .where(eq(schema.storyChapters.storyId, source.id))
        .orderBy(asc(schema.storyChapters.position));

      if (chapters.length) {
        await tx.insert(schema.storyChapters).values(
          chapters.map(chapter => ({
            storyId: id,
            position: chapter.position,
            title: chapter.title,
            titleEnglish: chapter.titleEnglish,
            stats: chapter.stats,
            paragraphs: chapter.paragraphs,
            translation: chapter.translation,
          })),
        );
      }

      // The tokens come too, rather than the copy being relinked from scratch. Two reasons: it
      // opens as good as the original instead of as an unlinked wall of text, and the hand-made
      // decisions in it (the names glossed, the senses somebody pinned) are carried over. No
      // amount of re-resolving could reproduce those.
      const tokens = await tx
        .select()
        .from(schema.storyTokens)
        .where(eq(schema.storyTokens.storyId, source.id));

      for (let index = 0; index < tokens.length; index += 2_000) {
        await tx.insert(schema.storyTokens).values(
          tokens.slice(index, index + 2_000).map(token => ({ ...token, storyId: id })),
        );
      }

      return { id, lang: source.lang };
    });

    return { id: result.id, content: await mine(owner, result.lang) };
  }),

  relinkStory: os.library.relinkStory.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;
    const prose = await storyProse(input.id);
    if (prose.ownerId !== owner) fail('There is no such story in your library.');

    // Every chapter's tags, and all of them before the transaction opens. See `tagsFor`.
    const tags = await Promise.all(prose.chapters.map(chapter => tagsFor(prose.lang, chapter.paragraphs)));

    const report = await db.transaction(async tx => {
      const story = await ownStory(tx, input.id, owner);
      const reports: LinkLists[] = [];
      for (const [index, chapter] of prose.chapters.entries()) {
        const pinned = await readPinned(tx, story.id, chapter.position);
        reports.push(
          await relink(tx, story.lang, story.id, chapter.position, chapter.paragraphs, pinned, tags[index], owner),
        );
      }
      await recountStory(tx, story.id);
      return mergeLists(reports);
    });

    return { result: await linkResult(input.id, 0, report), content: await mine(owner, prose.lang) };
  }),

  /* ---- your chapters ---- */

  saveChapter: os.library.saveChapter.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;
    const chapter = readChapter(input.titled, input.text, input.translation);
    if (!chapter.paragraphs.length) fail('There is no text: a title on its own is not a chapter.');

    const story = await storyProse(input.storyId);
    if (story.ownerId !== owner) fail('There is no such story in your library.');
    const tags = await tagsFor(story.lang, chapter.paragraphs);

    const result = await db.transaction(async tx => {
      const row = await ownStory(tx, input.storyId, owner);

      const existing = await tx
        .select({ position: schema.storyChapters.position })
        .from(schema.storyChapters)
        .where(eq(schema.storyChapters.storyId, row.id))
        .orderBy(asc(schema.storyChapters.position));

      const last = existing.length ? existing[existing.length - 1].position : -1;
      const position = input.position ?? last + 1;
      const replacing = existing.some(entry => entry.position === position);

      if (!replacing && position !== last + 1) {
        fail(`Chapter ${position + 1} does not exist yet, and chapters cannot skip a number.`);
      }

      const values = {
        title: input.title || chapter.title,
        titleEnglish: input.titleEnglish || chapter.titleEnglish,
        paragraphs: chapter.paragraphs,
        translation: chapter.translation,
      };

      // Read before the tokens are replaced, and re-applied by position *and* spelling, so
      // editing the prose drops the pins the edit moved rather than sliding them onto whatever
      // words now stand in those positions.
      const pinned = replacing ? await readPinned(tx, row.id, position) : new Map();

      if (replacing) {
        await tx
          .update(schema.storyChapters)
          .set(values)
          .where(and(eq(schema.storyChapters.storyId, row.id), eq(schema.storyChapters.position, position)));
      } else {
        await tx
          .insert(schema.storyChapters)
          .values({ storyId: row.id, position, stats: NO_STATS, ...values });
      }

      const report = await relink(tx, row.lang, row.id, position, chapter.paragraphs, pinned, tags, owner);
      await recountStory(tx, row.id);
      return { position, report };
    });

    return {
      result: await linkResult(input.storyId, result.position, result.report),
      content: await mine(owner, story.lang),
    };
  }),

  deleteChapter: os.library.deleteChapter.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    const lang = await db.transaction(async tx => {
      const story = await ownStory(tx, input.storyId, owner);

      const chapters = await tx
        .select({ position: schema.storyChapters.position })
        .from(schema.storyChapters)
        .where(eq(schema.storyChapters.storyId, story.id))
        .orderBy(asc(schema.storyChapters.position));

      if (!chapters.some(entry => entry.position === input.position)) fail('There is no such chapter.');

      // The tokens first, and by hand: nothing in the database ties them to the chapter row,
      // so this is the statement that stops them being inherited by whichever chapter shifts
      // down into that position. See the note in schema.ts.
      await tx
        .delete(schema.storyTokens)
        .where(and(eq(schema.storyTokens.storyId, story.id), eq(schema.storyTokens.chapter, input.position)));
      await tx
        .delete(schema.storyChapters)
        .where(
          and(eq(schema.storyChapters.storyId, story.id), eq(schema.storyChapters.position, input.position)),
        );

      // Close the gap, downwards and one at a time: positions are a primary key, so each move
      // has to be into a hole just vacated.
      for (const entry of chapters) {
        if (entry.position <= input.position) continue;
        await shiftChapter(tx, story.id, entry.position, entry.position - 1);
      }

      await recountStory(tx, story.id);
      return story.lang;
    });

    return { content: await mine(owner, lang) };
  }),

  moveChapter: os.library.moveChapter.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    const lang = await db.transaction(async tx => {
      const story = await ownStory(tx, input.storyId, owner);

      const chapters = await tx
        .select({ position: schema.storyChapters.position })
        .from(schema.storyChapters)
        .where(eq(schema.storyChapters.storyId, story.id))
        .orderBy(asc(schema.storyChapters.position));

      const index = chapters.findIndex(entry => entry.position === input.position);
      if (index === -1) fail('There is no such chapter.');

      const other = chapters[input.direction === 'up' ? index - 1 : index + 1];
      // Not an error: the buttons at the ends of the list are disabled, so this is a double
      // click landing after the list moved.
      if (!other) return story.lang;

      // Through a position nothing occupies, because `(story_id, position)` is the key.
      const parked = -1;
      await shiftChapter(tx, story.id, input.position, parked);
      await shiftChapter(tx, story.id, other.position, input.position);
      await shiftChapter(tx, story.id, parked, other.position);
      return story.lang;
    });

    return { content: await mine(owner, lang) };
  }),

  /* ---- the links in them ---- */

  setStoryToken: os.library.setStoryToken.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    const lang = await db.transaction(async tx => {
      const story = await ownStory(tx, input.storyId, owner);

      const [token] = await tx
        .select({ form: schema.storyTokens.form })
        .from(schema.storyTokens)
        .where(
          and(
            eq(schema.storyTokens.storyId, story.id),
            eq(schema.storyTokens.chapter, input.chapter),
            eq(schema.storyTokens.paragraph, input.paragraph),
            eq(schema.storyTokens.position, input.position),
          ),
        )
        .limit(1);

      if (!token) fail('There is no word in that position.');
      // The screen may have been open while the prose was edited underneath it. Refusing is
      // the only safe answer: the position now names a different word.
      if (token.form !== input.form) {
        fail(`That position holds "${token.form}" now, not "${input.form}". Reload the story.`);
      }

      if (input.name && input.wordId) {
        fail('A word is either a dictionary entry or a name in this story, not both.');
      }

      if (input.wordId) {
        const [word] = await tx
          .select({ id: schema.words.id, lang: schema.words.lang, ownerId: schema.words.ownerId })
          .from(schema.words)
          .where(eq(schema.words.id, input.wordId))
          .limit(1);
        if (!word) fail('There is no such entry in the dictionary.');
        // Published, or one of your own. Pinning somebody else's private gloss into your story
        // would be reading their notebook through a word picker.
        if (word.ownerId && word.ownerId !== owner) fail('There is no such entry in the dictionary.');
        if (word.lang !== story.lang) fail(`That entry is ${word.lang} and this story is ${story.lang}.`);

        const [senses] = await tx
          .select({ total: count() })
          .from(schema.wordSenses)
          .where(eq(schema.wordSenses.wordId, input.wordId));
        const total = Number(senses?.total ?? 0);
        if (input.sense && input.sense > total) {
          fail(`That entry has ${total} sense(s), so ${input.sense} is not one of them.`);
        }
      }

      const set = {
        wordId: input.wordId,
        sense: input.wordId ? (input.sense ?? 1) : null,
        gram: input.gram || null,
        name: input.name,
        // The two values that mean "a person decided this". A relink leaves these rows alone.
        via: input.name ? 'name' : input.wordId ? 'override' : 'override: unlinked',
        needsCheck: input.check,
        comment: input.comment,
      };

      const where = input.everywhere
        ? and(eq(schema.storyTokens.storyId, story.id), eq(schema.storyTokens.form, input.form))
        : and(
            eq(schema.storyTokens.storyId, story.id),
            eq(schema.storyTokens.chapter, input.chapter),
            eq(schema.storyTokens.paragraph, input.paragraph),
            eq(schema.storyTokens.position, input.position),
          );

      await tx.update(schema.storyTokens).set(set).where(where);
      await recountStory(tx, story.id);
      return story.lang;
    });

    return {
      result: await linkResult(input.storyId, input.chapter, { unresolved: [], flagged: [] }),
      // Pinning a word moves the story's coverage, and that figure is on the card in My library.
      // Every mutation here answers with the overlay for exactly this sort of reason.
      content: await mine(owner, lang),
    };
  }),

  resetStoryToken: os.library.resetStoryToken.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;
    const prose = await storyProse(input.storyId);
    if (prose.ownerId !== owner) fail('There is no such story in your library.');

    const touching = input.everywhere
      ? prose.chapters
      : prose.chapters.filter(chapter => chapter.position === input.chapter);
    const tags = await Promise.all(touching.map(chapter => tagsFor(prose.lang, chapter.paragraphs)));

    const report = await db.transaction(async tx => {
      const story = await ownStory(tx, input.storyId, owner);

      // Drop the pin, then relink: the token has to go back through the resolver to find out
      // what it would have been without the decision.
      const reports: LinkLists[] = [];
      for (const [index, chapter] of touching.entries()) {
        const pinned = await readPinned(tx, story.id, chapter.position);
        if (input.everywhere) {
          for (const [key, token] of pinned) {
            if (token.form === input.form) pinned.delete(key);
          }
        } else {
          pinned.delete(pinKey(input.paragraph, input.position, input.form));
        }
        reports.push(
          await relink(tx, story.lang, story.id, chapter.position, chapter.paragraphs, pinned, tags[index], owner),
        );
      }

      await recountStory(tx, story.id);
      return mergeLists(reports);
    });

    return {
      result: await linkResult(input.storyId, input.chapter, report),
      content: await mine(owner, prose.lang),
    };
  }),

  /* ---- your words ---- */

  saveWord: os.library.saveWord.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;
    const id = await db.transaction(tx => writeOwnWord(tx, input, owner));
    return { id, content: await mine(owner, input.lang) };
  }),

  deleteWord: os.library.deleteWord.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    const lang = await db.transaction(async tx => {
      const word = await ownWord(tx, input.id, owner);

      // Which of your stories cite it, read before the row goes: after the delete the key has
      // already cleared itself and there would be nothing left to find them by.
      const citing = await tx
        .selectDistinct({ storyId: schema.storyTokens.storyId })
        .from(schema.storyTokens)
        .where(eq(schema.storyTokens.wordId, word.id));

      // Never refused, unlike `admin.deleteWord`. The tokens that cite it go back to being
      // plain text, which is where they came from; adding the entry again and relinking brings
      // them back. Nothing published can be citing it, because nothing published can see it.
      await tx.delete(schema.words).where(eq(schema.words.id, word.id));
      await recountCategories(tx, [word.categoryId]);
      await recountCiting(tx, citing.map(row => row.storyId));
      return word.lang;
    });

    return { content: await mine(owner, lang) };
  }),

  /* ---- videos ---- */

  importVideo: os.library.importVideo.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    // One paragraph per cue, in order — the pairing `story_videos.cues` depends on. A cue whose
    // text holds no word at all is kept rather than dropped: a paragraph removed here would
    // shift every cue after it against its prose, and "[Music]" is a line of the video whether
    // or not it is a line of the language.
    const paragraphs = input.cues.map(cue => cue.text);

    // A cue that does not end after it begins is repaired rather than refused, and it is worth
    // saying why there is anything to repair. Auto-generated tracks carry lines with a duration
    // of zero, and hand-made ones occasionally carry an end before the start; the reader lights
    // a paragraph while the playhead is inside its span, so either one is a line that is never
    // lit — the video plays past it and the page sits still. "Until the next line starts" is
    // what a zero-length cue means, and the last one is given a couple of seconds because there
    // is no next line for it to run to.
    const cues = input.cues.map((cue, at) => ({
      start: cue.start,
      end: cue.end > cue.start ? cue.end : (input.cues[at + 1]?.start ?? cue.start + 2),
    }));

    // Before the transaction, always. See `tagsFor`: it is a round trip to a container holding a
    // gigabyte of models, and a lock on the stories table has no business being open across it.
    const tags = await tagsFor(input.lang, paragraphs);

    const result = await db.transaction(async tx => {
      await assertRoom(tx, schema.stories, owner, input.lang, MAX_STORIES, 'stories');

      const stem =
        input.lang === 'ka'
          ? slug(input.title, 'video')
          : `${input.lang}-${slug(slugCyrillic(input.title), 'video')}`;
      const id = await freeId(tx, 'stories', stem);

      await tx.insert(schema.stories).values({
        id,
        lang: input.lang,
        title: input.title,
        titleEnglish: '',
        level: '',
        // Where it came from, in the field that already means that. A video story outliving its
        // video — deleted, made private, region-locked — is still a readable story, and this is
        // then the only thing left saying what it was.
        source: `https://www.youtube.com/watch?v=${input.youtubeId}`,
        note: '',
        categoryId: null,
        stats: NO_STATS,
        ownerId: owner,
      });

      await tx.insert(schema.storyChapters).values({
        storyId: id,
        position: 0,
        title: '',
        titleEnglish: '',
        stats: NO_STATS,
        paragraphs,
        translation: [],
      });

      // No pins to keep: the story is one statement old.
      const report = await relink(tx, input.lang, id, 0, paragraphs, new Map(), tags, owner);
      await recountStory(tx, id);

      await tx.insert(schema.storyVideos).values({ storyId: id, youtubeId: input.youtubeId, cues });

      return { id, report };
    });

    return {
      id: result.id,
      report: await linkResult(result.id, 0, result.report),
      content: await mine(owner, input.lang),
    };
  }),

  videos: os.library.videos.use(authed).handler(async ({ input, context }) => {
    const rows = await db
      .select({
        storyId: schema.storyVideos.storyId,
        youtubeId: schema.storyVideos.youtubeId,
        title: schema.stories.title,
        lang: schema.stories.lang,
        stats: schema.stories.stats,
        cues: schema.storyVideos.cues,
      })
      .from(schema.storyVideos)
      .innerJoin(schema.stories, eq(schema.stories.id, schema.storyVideos.storyId))
      // Both halves matter. The owner filter is what makes this list yours; the language filter
      // is what keeps a Russian video off the Georgian shelf.
      .where(and(eq(schema.stories.ownerId, context.user.id), eq(schema.stories.lang, input.lang)));

    return rows.map(row => ({
      storyId: row.storyId,
      youtubeId: row.youtubeId,
      title: row.title,
      lang: row.lang,
      paragraphs: row.cues.length,
      coverage: Number(row.stats.coverage ?? 0),
    }));
  }),

  video: os.library.video.use(authed).handler(async ({ input, context }) => {
    const [row] = await db
      .select({
        youtubeId: schema.storyVideos.youtubeId,
        cues: schema.storyVideos.cues,
        ownerId: schema.stories.ownerId,
      })
      .from(schema.storyVideos)
      .innerJoin(schema.stories, eq(schema.stories.id, schema.storyVideos.storyId))
      .where(eq(schema.storyVideos.storyId, input.storyId))
      .limit(1);

    // Somebody else's, or no such story: one answer for both, so that this cannot be used to
    // find out which. The same rule `ownStory` follows, reached without a throw because the
    // reader asks this about every story it opens.
    if (!row || row.ownerId !== context.user.id) return null;
    return { youtubeId: row.youtubeId, cues: row.cues };
  }),

  /* ---- your shelves ---- */

  saveCategory: os.library.saveCategory.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    const id = await db.transaction(async tx => {
      if (!input.id) return (await makeShelf(tx, owner, input.lang, input.name, input.nameNative)).id;

      const [existing] = await tx
        .select({ id: schema.categories.id, lang: schema.categories.lang, ownerId: schema.categories.ownerId })
        .from(schema.categories)
        .where(eq(schema.categories.id, input.id))
        .limit(1);
      if (!existing || existing.ownerId !== owner) fail('There is no such category in your library.');
      if (existing.lang !== input.lang) {
        fail(`That category is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
      }

      await tx
        .update(schema.categories)
        .set({ name: input.name, nameNative: input.nameNative })
        .where(eq(schema.categories.id, existing.id));

      // `words.category` is the shelf's name copied onto the word, which is what every card
      // renders rather than joining for it. A rename that stopped here would leave every entry
      // on the shelf displaying the old one.
      await tx
        .update(schema.words)
        .set({ category: input.name })
        .where(eq(schema.words.categoryId, existing.id));

      return existing.id;
    });

    return { id, content: await mine(owner, input.lang) };
  }),

  deleteCategory: os.library.deleteCategory.use(authed).handler(async ({ input, context }) => {
    const owner = context.user.id;

    const lang = await db.transaction(async tx => {
      const [existing] = await tx
        .select({ id: schema.categories.id, lang: schema.categories.lang, ownerId: schema.categories.ownerId })
        .from(schema.categories)
        .where(eq(schema.categories.id, input.id))
        .limit(1);
      if (!existing || existing.ownerId !== owner) fail('There is no such category in your library.');

      // Refused while it holds anything, which is the opposite of what deleting a story shelf
      // does. A story comes off a shelf and is simply unfiled; a word cannot be, because
      // `words.category_id` is not null. There is nowhere for them to fall back to, so the only
      // safe answer is to say so.
      const [held] = await tx
        .select({ total: count() })
        .from(schema.words)
        .where(eq(schema.words.categoryId, existing.id));
      const total = Number(held?.total ?? 0);
      if (total > 0) {
        fail(`That category still holds ${total} word(s). Move them to another one first.`);
      }

      await tx.delete(schema.categories).where(eq(schema.categories.id, existing.id));
      return existing.lang;
    });

    return { content: await mine(owner, lang) };
  }),
});
