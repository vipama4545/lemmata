// Editing the dictionary from the browser.
//
// Every procedure here writes to the content tables, which until now were generated-only.
// Three rules run through all of them:
//
//   One transaction per edit, with the version bump as its last statement. `bumpContentVersion`
//   is the whole of cache invalidation — the server's snapshot is keyed on it and so is every
//   browser's — and putting it last means a reader can never see a new version over old rows.
//
//   The lexicon's derived columns are maintained here, not left to the caller. `words.category`
//   follows `category_id`, `categories.word_count` follows the words in it, and `words.english`
//   falls back to the first sense. A screen that had to remember those would eventually forget.
//
//   Deletes are refused when something still points at the row, with a message naming what.
//   The foreign keys would cascade — dropping a word would silently take its story links with
//   it — and a story quietly losing a word months later is not a trade worth making for the
//   convenience of not reading the error.

import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/server';
import { and, asc, count, eq, inArray, ne, sql as raw } from 'drizzle-orm';
import type { RuVerbInput, StoryLinkResult, KaVerbInput, WordInput } from '@georgian/shared/contract';
import type { Lang } from '@georgian/shared/grammar';
import { PERSONS, SCREEVES } from '@georgian/shared/grammar/ka';
import { RU_CLASS_BY_ID, RU_SLOT_KEYS } from '@georgian/shared/grammar/ru';
import type { RuClassId, RuSlotKey, Story, StoryToken } from '@georgian/shared/types';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { analyse, type Tags } from '../story/analyser.ts';
import { buildIndexes, isHandMade, linkStory, pinKey } from '../story/resolve.ts';
import type { Pinned } from '../story/resolve.ts';
import { readLines } from '../story/tokenise.ts';
import { adminOnly, os } from './base.ts';
import { bumpContentVersion, loadStory } from './content.ts';

/* ------------------------------------------------------------------- helpers */

/** The keys grammar.ts pins as real. Anything else in a submitted paradigm is dropped. */
const SCREEVE_KEYS = new Set<string>(SCREEVES.map(screeve => screeve.key));
const PERSON_KEYS = new Set<string>(PERSONS.map(person => person.key));

function fail(message: string): never {
  throw new ORPCError('BAD_REQUEST', { message });
}

/**
 * A url-safe id from a piece of English.
 *
 * Only ever used where the natural id is Latin — a verb's paradigm ("abandon-vt") and a
 * story's slug. A *word's* id is not made this way; see `saveWord`.
 */
function slug(text: string, fallback: string): string {
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

function slugCyrillic(text: string): string {
  return [...text.toLowerCase()].map(letter => CYRILLIC[letter] ?? letter).join('');
}

/**
 * Ids a story may not take, because the reader's routes spend them on something else.
 *
 * `/stories/category/folk-tales` is a shelf, so a story whose slug came out as "category"
 * would own a URL that already means something — and would lose, since a static segment
 * outranks `:storyId`. Treated as "taken" rather than refused: the story is called whatever
 * it is called, and `category-2` is a better answer than an error about routing.
 */
const RESERVED_STORY_IDS = new Set(['category']);

/** `${base}`, then `${base}-2`, until nothing has it. */
async function freeId(tx: Tx, table: 'verbs' | 'stories' | 'storyCategories', base: string): Promise<string> {
  const target =
    table === 'verbs' ? schema.kaVerbs : table === 'stories' ? schema.stories : schema.storyCategories;
  for (let n = 1; n < 500; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (table === 'stories' && RESERVED_STORY_IDS.has(id)) continue;
    const [taken] = await tx.select({ id: target.id }).from(target).where(eq(target.id, id)).limit(1);
    if (!taken) return id;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** The next free position, so a new row lands at the end of the list rather than at 0. */
async function nextPosition(
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
 */
async function recountCategories(tx: Tx, categoryIds: string[]): Promise<void> {
  const ids = [...new Set(categoryIds.filter(Boolean))];
  if (!ids.length) return;

  const counts = await tx
    .select({ categoryId: schema.words.categoryId, total: count() })
    .from(schema.words)
    .where(inArray(schema.words.categoryId, ids))
    .groupBy(schema.words.categoryId);

  const byId = new Map(counts.map(row => [row.categoryId, Number(row.total)]));
  for (const id of ids) {
    await tx
      .update(schema.categories)
      .set({ wordCount: byId.get(id) ?? 0 })
      .where(eq(schema.categories.id, id));
  }
}

/** Recounts a verb group, for the same reason. */
async function recountVerbGroups(tx: Tx, groupIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(groupIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;

  const counts = await tx
    .select({ groupId: schema.kaVerbs.groupId, total: count() })
    .from(schema.kaVerbs)
    .where(inArray(schema.kaVerbs.groupId, ids))
    .groupBy(schema.kaVerbs.groupId);

  const byId = new Map(counts.map(row => [row.groupId, Number(row.total)]));
  for (const id of ids) {
    await tx
      .update(schema.kaVerbGroups)
      .set({ verbCount: byId.get(id) ?? 0 })
      .where(eq(schema.kaVerbGroups.id, id));
  }
}

/* ------------------------------------------------------------------- lexicon */

/**
 * Creates or updates one headword, with its senses and its inflected forms.
 *
 * Senses and forms are replaced wholesale rather than diffed. They are small, ordered, and
 * their order is their identity — a sense's *position* is what a story token cites — so
 * "these are the senses now, in this order" is both simpler and the only version that cannot
 * renumber a sense out from under a story that points at it.
 */
async function writeWord(tx: Tx, input: WordInput): Promise<string> {
  const [category] = await tx
    .select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories)
    .where(eq(schema.categories.id, input.categoryId))
    .limit(1);
  if (!category) fail(`There is no category "${input.categoryId}".`);

  if (input.verbId) {
    const [verb] = await tx
      .select({ id: schema.kaVerbs.id })
      .from(schema.kaVerbs)
      .where(eq(schema.kaVerbs.id, input.verbId))
      .limit(1);
    if (!verb) fail(`There is no paradigm "${input.verbId}".`);
  }

  if (input.defaultSense && input.defaultSense > input.senses.length) {
    fail(`This entry has ${input.senses.length} sense(s), so ${input.defaultSense} cannot be the default.`);
  }

  const existing = input.id
    ? (
        await tx
          .select({ id: schema.words.id, position: schema.words.position, categoryId: schema.words.categoryId })
          .from(schema.words)
          .where(eq(schema.words.id, input.id))
          .limit(1)
      )[0]
    : undefined;

  if (input.id && !existing) fail(`There is no word "${input.id}".`);

  // A new lemma gets `w:<headword>`, which is what scripts/lexicon.json has always minted
  // for a hand-written entry — so a word added here and one added there are indistinguishable
  // afterwards, and re-running the offline pipeline over an exported file finds its own ids.
  // Namespaced per language, because ids are single-column and global: `w:` has always been
  // the Georgian convention and a Russian entry cannot be allowed to collide with it.
  const id = existing?.id ?? `${input.lang === 'ka' ? 'w' : `${input.lang}-w`}:${input.headword.trim()}`;
  if (!existing) {
    const [clash] = await tx.select({ id: schema.words.id }).from(schema.words).where(eq(schema.words.id, id)).limit(1);
    if (clash) fail(`There is already an entry for "${input.headword}". Edit that one instead.`);
  }

  const row = {
    lang: input.lang,
    headword: input.headword,
    accented: input.accented,
    // The headline gloss is the first sense unless somebody typed something else. 2,095 of
    // the 2,096 scraped entries hold exactly that, so defaulting to it is the convention
    // rather than a guess.
    english: input.english || input.senses[0],
    definition: input.definition,
    level: input.level,
    partOfSpeech: input.partOfSpeech,
    category: category.name,
    categoryId: category.id,
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
      // Everything written by hand is 'added'; 'core' means it came out of the scrape, and
      // claiming that for something typed into a form would be a lie the export carries out.
      origin: 'added',
      ...row,
    });
  }

  await tx.delete(schema.wordSenses).where(eq(schema.wordSenses.wordId, id));
  await tx.insert(schema.wordSenses).values(
    input.senses.map((english, index) => ({ wordId: id, position: index + 1, english })),
  );

  await tx.delete(schema.wordForms).where(eq(schema.wordForms.wordId, id));
  if (input.forms.length) {
    // Deduplicated on the spelling: the primary key is (word_id, position), so two rows with
    // the same form would insert happily and then make the form index ambiguous against
    // itself, which is the one contest the resolver cannot report usefully.
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

  // The Russian side table, written whole or removed. A word that stops being Russian — or
  // that never was — must not keep a gender row behind it, so the delete is unconditional
  // and the insert is not.
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

  await recountCategories(tx, [category.id, existing?.categoryId ?? '']);
  return id;
}

/* ------------------------------------------------------------------ paradigms */

/**
 * Creates or updates one paradigm and every cell of it.
 *
 * A blank cell is kept, not skipped, for the reason the seed gives at length: a screeve
 * listing all six persons with three of them blank is a paradigm with a gap in it, while a
 * screeve missing those persons is one that does not inflect for them. Only a screeve with
 * nothing in it at all is dropped, which is how a defective paradigm stays short.
 */
async function writeKaVerb(tx: Tx, input: KaVerbInput): Promise<string> {
  if (input.groupId) {
    const [group] = await tx
      .select({ id: schema.kaVerbGroups.id, label: schema.kaVerbGroups.label })
      .from(schema.kaVerbGroups)
      .where(eq(schema.kaVerbGroups.id, input.groupId))
      .limit(1);
    if (!group) fail(`There is no conjugation group "${input.groupId}".`);
  }

  const existing = input.id
    ? (
        await tx
          .select({ id: schema.kaVerbs.id, groupId: schema.kaVerbs.groupId })
          .from(schema.kaVerbs)
          .where(eq(schema.kaVerbs.id, input.id))
          .limit(1)
      )[0]
    : undefined;

  if (input.id && !existing) fail(`There is no paradigm "${input.id}".`);

  const [group] = input.groupId
    ? await tx
        .select({ label: schema.kaVerbGroups.label })
        .from(schema.kaVerbGroups)
        .where(eq(schema.kaVerbGroups.id, input.groupId))
        .limit(1)
    : [undefined];

  const id = existing?.id ?? (await freeId(tx, 'verbs', slug(input.english, 'verb')));

  const row = {
    english: input.english,
    senses: input.senses,
    transitivity: input.transitivity,
    verbalNoun: input.verbalNoun,
    // The display label follows the group rather than being typed separately: they are one
    // fact, and two fields for one fact drift.
    group: group?.label ?? '',
    groupId: input.groupId,
    present3sg: input.present3sg,
    url: input.url,
    synonymsEnglish: input.synonymsEnglish,
    synonymsGeorgian: input.synonymsGeorgian,
  };

  if (existing) {
    await tx.update(schema.kaVerbs).set(row).where(eq(schema.kaVerbs.id, id));
  } else {
    await tx.insert(schema.kaVerbs).values({ id, position: await nextPosition(tx, schema.kaVerbs), ...row });
  }

  const cells: { verbId: string; screeve: string; person: string; form: string }[] = [];
  const addScreeve = (screeve: string, forms: Record<string, string>) => {
    for (const [person, form] of Object.entries(forms)) {
      if (!PERSON_KEYS.has(person)) continue;
      cells.push({ verbId: id, screeve, person, form });
    }
  };

  for (const [screeve, forms] of Object.entries(input.forms)) {
    if (!SCREEVE_KEYS.has(screeve)) continue;
    addScreeve(screeve, forms);
  }
  // The imperative and prohibitive are not screeves and the grammar page must not list them
  // as such, but they live in the same table under those names — which is where the assembly
  // lifts them back out of.
  addScreeve('imperative', input.imperative);
  addScreeve('prohibitive', input.prohibitive);

  await tx.delete(schema.kaVerbForms).where(eq(schema.kaVerbForms.verbId, id));
  if (cells.length) await tx.insert(schema.kaVerbForms).values(cells);

  await recountVerbGroups(tx, [input.groupId, existing?.groupId ?? null]);
  return id;
}

/* -------------------------------------------------------------------- stories */

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
async function readPinned(tx: Tx, storyId: string, chapter: number): Promise<Pinned> {
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
interface Chapter {
  position: number;
  paragraphs: string[];
}

/**
 * A story's language and every chapter's prose, read before any transaction is opened, so
 * the tagger can be asked about it. Fails the request if there is no such story, which is
 * the same check the caller's own transaction repeats against a consistent snapshot.
 */
async function storyProse(storyId: string): Promise<{ lang: Lang; chapters: Chapter[] }> {
  const [story] = await db
    .select({ lang: schema.stories.lang })
    .from(schema.stories)
    .where(eq(schema.stories.id, storyId))
    .limit(1);
  if (!story) fail('There is no such story.');

  const chapters = await db
    .select({ position: schema.storyChapters.position, paragraphs: schema.storyChapters.paragraphs })
    .from(schema.storyChapters)
    .where(eq(schema.storyChapters.storyId, storyId))
    .orderBy(asc(schema.storyChapters.position));

  return { lang: story.lang, chapters };
}

/**
 * What the tagger makes of a story's words, or null when there is no tagger.
 *
 * Always called *before* `db.transaction`, never inside one. It is an HTTP round trip to a
 * Python process that holds a gigabyte of models, and a transaction left open across it
 * would turn one admin's button press into a lock held on the stories table for as long as
 * a container somewhere else takes to answer. Nothing here needs to be atomic with the
 * write: the tags describe the prose, and if the prose changes underneath them linkStory
 * notices the token counts disagree and links without them.
 */
async function tagsFor(lang: Lang, paragraphs: string[]): Promise<Tags | null> {
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
function readChapter(
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
async function shiftChapter(tx: Tx, storyId: string, from: number, to: number): Promise<void> {
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
const NO_STATS = {
  tokens: 0,
  distinctForms: 0,
  covered: 0,
  coverage: 0,
  names: 0,
  unresolved: 0,
  flagged: 0,
};

/** The two lists a link report hands back, which several signatures below pass around. */
interface LinkLists {
  unresolved: { form: string; count: number }[];
  flagged: { form: string; count: number }[];
}

/** Merges the reports of several chapters into one, commonest spelling first. */
function mergeLists(reports: LinkLists[]): LinkLists {
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
 */
async function relink(
  tx: Tx,
  lang: Lang,
  storyId: string,
  chapter: number,
  paragraphs: string[],
  pinned: Pinned,
  tags: Tags | null,
): Promise<LinkLists> {
  const indexes = await buildIndexes(lang);
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
async function linkResult(storyId: string, chapter: number, extra: LinkLists): Promise<StoryLinkResult> {
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
async function recountStory(tx: Tx, storyId: string): Promise<void> {
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

/**
 * Recounts the shelves named, so the list's counts stay true. The same job
 * `recountCategories` does for words, and for the same reason: both the shelf a story left
 * and the one it joined have to be counted again.
 */
async function recountStoryCategories(tx: Tx, categoryIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;

  const counts = await tx
    .select({ categoryId: schema.stories.categoryId, total: count() })
    .from(schema.stories)
    .where(inArray(schema.stories.categoryId, ids))
    .groupBy(schema.stories.categoryId);

  const byId = new Map(counts.map(row => [row.categoryId, Number(row.total)]));
  for (const id of ids) {
    await tx
      .update(schema.storyCategories)
      .set({ storyCount: byId.get(id) ?? 0 })
      .where(eq(schema.storyCategories.id, id));
  }
}

/* --------------------------------------------------------------------- users */

/**
 * Every account, for the admin user list.
 *
 * `email` is not in the select, and that is the whole of the privacy story here rather than
 * an optimisation. Somebody else's address is not something this app shows — not masked, not
 * partially, not to admins — and a column that is never read cannot be leaked by a screen
 * that forgets to hide it, by whoever opens the network tab, or by a log line downstream.
 *
 * The username identifies the account, and the join date separates two people who chose the
 * same one.
 */
async function listUsers(tx: Tx | typeof db) {
  const rows = await tx
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      isAdmin: schema.user.isAdmin,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt));

  return rows.map(({ createdAt, ...row }) => ({ ...row, createdAt: createdAt.getTime() }));
}

/* ------------------------------------------------------------ Russian verbs */

/**
 * Creates or updates one Russian verb — which is to say one *rule*, plus whatever cells the
 * rule cannot reach.
 *
 * The contrast with `writeKaVerb` above is the whole point of the two-table design. That one
 * writes up to 66 rows and has to reason about which cells the editor left blank; this one
 * writes a single row of stems and a handful of exceptions, and the twenty-odd forms follow
 * from it in the browser. Correcting a Russian paradigm means correcting one stem.
 *
 * `classId` and the slot keys are validated here rather than in the contract's Zod schema, so
 * that grammar/ru.ts stays the only place the closed sets are written down. See the note on
 * `paradigmInput`, which makes the same trade for the Georgian screeves.
 */
async function writeRuVerb(tx: Tx, input: RuVerbInput): Promise<string> {
  if (!RU_CLASS_BY_ID.has(input.classId as RuClassId)) {
    fail(`"${input.classId}" is not a conjugation class. See RU_CLASSES in grammar/ru.ts.`);
  }

  const slots = new Set<string>(RU_SLOT_KEYS);
  for (const slot of Object.keys(input.overrides)) {
    if (!slots.has(slot)) fail(`"${slot}" is not one of this verb's cells.`);
  }

  const [existing] = input.id
    ? await tx.select().from(schema.ruVerbs).where(eq(schema.ruVerbs.id, input.id)).limit(1)
    : [];

  if (input.id && !existing) fail(`There is no verb "${input.id}".`);

  // Slugged from the infinitive and the aspect together, because делать and сделать are two
  // records and would otherwise want the same id.
  const id = existing?.id ?? `ru-${slug(slugCyrillic(input.infinitive), 'verb')}-${input.aspect}`;
  if (!existing) {
    const [clash] = await tx.select({ id: schema.ruVerbs.id }).from(schema.ruVerbs).where(eq(schema.ruVerbs.id, id)).limit(1);
    if (clash) fail(`There is already a ${input.aspect === 'pf' ? 'perfective' : 'imperfective'} "${input.infinitive}".`);
  }

  const row = {
    infinitive: input.infinitive,
    accented: input.accented,
    english: input.english,
    senses: input.senses,
    aspect: input.aspect,
    pairId: input.pairId,
    classId: input.classId,
    stemPresent: input.stemPresent,
    stemPresent1sg: input.stemPresent1sg,
    stemImperative: input.stemImperative,
    stemPast: input.stemPast,
    stemPastM: input.stemPastM,
    stressPresent: input.stressPresent,
    stressPast: input.stressPast,
    stemStress: input.stemStress,
    stressInfinitive: input.stressInfinitive,
    reflexive: input.reflexive,
    transitivity: input.transitivity,
    government: input.government,
    motion: input.motion,
    level: input.level,
    needsCheck: input.check,
    note: input.note,
  };

  if (existing) {
    await tx.update(schema.ruVerbs).set(row).where(eq(schema.ruVerbs.id, id));
  } else {
    await tx.insert(schema.ruVerbs).values({ id, position: await nextPosition(tx, schema.ruVerbs), ...row });
  }

  // The pair is a link in both directions, and the editor only ever names one end of it.
  // Writing the reverse here is what stops сделать from being paired with делать while делать
  // is paired with nothing.
  if (input.pairId) {
    await tx.update(schema.ruVerbs).set({ pairId: id }).where(eq(schema.ruVerbs.id, input.pairId));
  }

  // Replaced wholesale rather than merged: an override the editor removed has to disappear,
  // and there is no other way to say so. An empty string is *kept*, because that is how the
  // data says a verb has no such form at all — see the note in the seed.
  await tx.delete(schema.ruVerbForms).where(eq(schema.ruVerbForms.verbId, id));
  const overrides = Object.entries(input.overrides).map(([slot, form]) => ({
    verbId: id,
    slot: slot as RuSlotKey,
    form,
    accented: '',
  }));
  if (overrides.length) await tx.insert(schema.ruVerbForms).values(overrides);

  return id;
}

/* -------------------------------------------------------------------- routes */

export const adminRouter = os.admin.router({
  /* ---- the lexicon ---- */

  saveWord: os.admin.saveWord.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const id = await writeWord(tx, input);
      return { id, version: await bumpContentVersion(tx, input.lang) };
    }),
  ),

  deleteWord: os.admin.deleteWord.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [word] = await tx
        .select({
          id: schema.words.id,
          lang: schema.words.lang,
          headword: schema.words.headword,
          categoryId: schema.words.categoryId,
        })
        .from(schema.words)
        .where(eq(schema.words.id, input.id))
        .limit(1);
      if (!word) fail('There is no such word.');

      // The foreign key is ON DELETE SET NULL, so this would succeed and quietly unlink every
      // occurrence. Saying which stories, and how many, is what lets somebody decide.
      const citing = await tx
        .select({ storyId: schema.storyTokens.storyId, total: count() })
        .from(schema.storyTokens)
        .where(eq(schema.storyTokens.wordId, input.id))
        .groupBy(schema.storyTokens.storyId);

      if (citing.length) {
        const where = citing.map(row => `${row.storyId} (${row.total})`).join(', ');
        fail(`"${word.headword}" is still used by ${where}. Re-point those words first.`);
      }

      await tx.delete(schema.words).where(eq(schema.words.id, input.id));
      await recountCategories(tx, [word.categoryId]);
      return { version: await bumpContentVersion(tx, word.lang) };
    }),
  ),

  /* ---- the paradigms ---- */

  saveKaVerb: os.admin.saveKaVerb.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const id = await writeKaVerb(tx, input);
      return { id, version: await bumpContentVersion(tx, 'ka') };
    }),
  ),

  saveRuVerb: os.admin.saveRuVerb.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const id = await writeRuVerb(tx, input);
      return { id, version: await bumpContentVersion(tx, 'ru') };
    }),
  ),

  deleteVerb: os.admin.deleteVerb.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      // Whichever language it is, no paradigm may be deleted while a headword still claims
      // it: `words.verb_id` carries no foreign key — it points into two different tables
      // depending on the row's language — so nothing in the database would stop this, and the
      // result would be entries offering a conjugation table that no longer exists.
      const claiming = await tx
        .select({ headword: schema.words.headword })
        .from(schema.words)
        .where(and(eq(schema.words.lang, input.lang), eq(schema.words.verbId, input.id)))
        .limit(5);

      if (claiming.length) {
        fail(
          `${claiming.map(word => word.headword).join(', ')} still claim this paradigm. ` +
            'Clear the paradigm link on those entries first.',
        );
      }

      if (input.lang === 'ka') {
        const [verb] = await tx
          .select({ groupId: schema.kaVerbs.groupId })
          .from(schema.kaVerbs)
          .where(eq(schema.kaVerbs.id, input.id))
          .limit(1);
        if (!verb) fail('There is no such paradigm.');

        await tx.delete(schema.kaVerbs).where(eq(schema.kaVerbs.id, input.id));
        await recountVerbGroups(tx, [verb.groupId]);
      } else {
        const [verb] = await tx
          .select({ id: schema.ruVerbs.id })
          .from(schema.ruVerbs)
          .where(eq(schema.ruVerbs.id, input.id))
          .limit(1);
        if (!verb) fail('There is no such verb.');

        // The other half of the aspect pair keeps a link to this one, and the column has no
        // foreign key to clear it. Cutting it here is what stops делать pointing at a
        // сделать that is gone.
        await tx
          .update(schema.ruVerbs)
          .set({ pairId: null })
          .where(eq(schema.ruVerbs.pairId, input.id));
        await tx.delete(schema.ruVerbs).where(eq(schema.ruVerbs.id, input.id));
      }

      return { version: await bumpContentVersion(tx, input.lang) };
    }),
  ),

  /* ---- the stories ---- */

  saveStory: os.admin.saveStory.use(adminOnly).handler(async ({ input }) => {
    // Prose is a chapter's, and a story that exists has chapters to put it in. Refusing is
    // better than ignoring it: somebody who pasted a chapter into the wrong form should be
    // told, not left believing it saved.
    if (input.id && input.text.trim()) {
      fail('That story already exists. Add the text as a chapter of it.');
    }

    const first = input.text.trim() ? readChapter(true, input.text, input.translation) : null;

    // Before the transaction, and on the text as submitted — this is the one path where the
    // prose is new, so there is nothing in the database to read it from anyway.
    const tags = first ? await tagsFor(input.lang, first.paragraphs) : null;

    const result = await db.transaction(async tx => {
      const existing = input.id
        ? (
            await tx
              .select({ id: schema.stories.id, lang: schema.stories.lang, categoryId: schema.stories.categoryId })
              .from(schema.stories)
              .where(eq(schema.stories.id, input.id))
              .limit(1)
          )[0]
        : undefined;

      if (input.id && !existing) fail('There is no such story.');

      // A story does not change language. Refusing is not pedantry: the tokens are already
      // cut by one language's rules and linked against one language's lexicon, and an edit
      // arriving under the other is a switcher left on the wrong dictionary rather than
      // anything anybody meant.
      if (existing && existing.lang !== input.lang) {
        fail(`That story is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
      }

      if (input.categoryId) {
        const [category] = await tx
          .select({ id: schema.storyCategories.id, lang: schema.storyCategories.lang })
          .from(schema.storyCategories)
          .where(eq(schema.storyCategories.id, input.categoryId))
          .limit(1);
        if (!category) fail('There is no such category.');
        if (category.lang !== input.lang) {
          fail(`That category is ${category.lang} and this story is ${input.lang}.`);
        }
      }

      // The title falls back to the first line of the text, the way a .txt file has always
      // given it, for the one-shot case where a story is created with its prose.
      const title = input.title || first?.title || '';
      const titleEnglish = input.titleEnglish || first?.titleEnglish || '';
      if (!title && !titleEnglish) fail('A story needs a title.');

      // Slugged from the English title where there is one, and otherwise from the story's
      // own — through the transliteration table, because `slug` keeps only a–z and would
      // reduce Колобо́к to nothing at all. Namespaced per language for the same reason a
      // Russian verb id is: story ids are one flat column, and two languages will sooner or
      // later both have a Cinderella.
      const base = titleEnglish || title;
      const stem = input.lang === 'ka' ? slug(base, 'story') : `${input.lang}-${slug(slugCyrillic(base), 'story')}`;
      const id = existing?.id ?? (await freeId(tx, 'stories', stem));

      const row = {
        lang: input.lang,
        title: title || titleEnglish,
        titleEnglish,
        level: input.level,
        source: input.source,
        note: input.note,
        categoryId: input.categoryId,
      };

      if (existing) {
        await tx.update(schema.stories).set(row).where(eq(schema.stories.id, id));
      } else {
        await tx.insert(schema.stories).values({ id, stats: NO_STATS, ...row });
      }

      await recountStoryCategories(tx, [existing?.categoryId ?? null, input.categoryId]);

      let report: LinkLists | null = null;
      if (first) {
        await tx.insert(schema.storyChapters).values({
          storyId: id,
          position: 0,
          // Left unnamed. A story created in one go is a story of one chapter, and its
          // first line was its own title — naming the chapter the same thing would put the
          // title on the page twice.
          title: '',
          titleEnglish: '',
          stats: NO_STATS,
          paragraphs: first.paragraphs,
          translation: first.translation,
        });
        report = await relink(tx, input.lang, id, 0, first.paragraphs, new Map(), tags);
        await recountStory(tx, id);
      }

      const version = await bumpContentVersion(tx, input.lang);
      return { id, report, version };
    });

    return {
      id: result.id,
      version: result.version,
      report: result.report ? await linkResult(result.id, 0, result.report) : null,
    };
  }),

  deleteStory: os.admin.deleteStory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang, categoryId: schema.stories.categoryId })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.id))
        .limit(1);
      if (!story) fail('There is no such story.');

      // The chapters and their tokens cascade, and here that is right: they are this story's
      // and nothing else points at them.
      await tx.delete(schema.stories).where(eq(schema.stories.id, input.id));
      await recountStoryCategories(tx, [story.categoryId]);
      return { version: await bumpContentVersion(tx, story.lang) };
    }),
  ),

  relinkStory: os.admin.relinkStory.use(adminOnly).handler(async ({ input }) => {
    const prose = await storyProse(input.id);
    // One call to the tagger per chapter, and all of them before the transaction opens. See
    // `tagsFor`: a transaction held across an HTTP round trip to the analyser would lock the
    // stories table for as long as a container somewhere else takes to answer, and a book of
    // forty chapters would hold it forty times as long.
    const tags = await Promise.all(prose.chapters.map(chapter => tagsFor(prose.lang, chapter.paragraphs)));

    const report = await db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.id))
        .limit(1);
      if (!story) fail('There is no such story.');

      const reports: LinkLists[] = [];
      for (const [index, chapter] of prose.chapters.entries()) {
        const pinned = await readPinned(tx, input.id, chapter.position);
        reports.push(
          await relink(tx, story.lang, input.id, chapter.position, chapter.paragraphs, pinned, tags[index]),
        );
      }

      await recountStory(tx, input.id);
      await bumpContentVersion(tx, story.lang);
      return mergeLists(reports);
    });

    return linkResult(input.id, 0, report);
  }),

  /* ---- the chapters ---- */

  saveChapter: os.admin.saveChapter.use(adminOnly).handler(async ({ input }) => {
    const chapter = readChapter(input.titled, input.text, input.translation);
    if (!chapter.paragraphs.length) fail('There is no text — a title on its own is not a chapter.');

    const story = await storyProse(input.storyId);
    const tags = await tagsFor(story.lang, chapter.paragraphs);

    const result = await db.transaction(async tx => {
      const [row] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.storyId))
        .limit(1);
      if (!row) fail('There is no such story.');

      const existing = await tx
        .select({ position: schema.storyChapters.position })
        .from(schema.storyChapters)
        .where(eq(schema.storyChapters.storyId, input.storyId))
        .orderBy(asc(schema.storyChapters.position));

      // Appending lands after the last one rather than at `existing.length`: the two agree
      // today, and only one of them stays right if a gap ever appears.
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

      // Pins are read before the tokens are replaced, and re-applied by position *and*
      // spelling — so editing the prose drops the pins the edit moved rather than sliding
      // them onto whatever words now stand in those positions.
      const pinned = replacing ? await readPinned(tx, input.storyId, position) : new Map();

      if (replacing) {
        await tx
          .update(schema.storyChapters)
          .set(values)
          .where(
            and(
              eq(schema.storyChapters.storyId, input.storyId),
              eq(schema.storyChapters.position, position),
            ),
          );
      } else {
        await tx
          .insert(schema.storyChapters)
          .values({ storyId: input.storyId, position, stats: NO_STATS, ...values });
      }

      const report = await relink(tx, row.lang, input.storyId, position, chapter.paragraphs, pinned, tags);
      await recountStory(tx, input.storyId);
      await bumpContentVersion(tx, row.lang);
      return { position, report };
    });

    return linkResult(input.storyId, result.position, result.report);
  }),

  deleteChapter: os.admin.deleteChapter.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.storyId))
        .limit(1);
      if (!story) fail('There is no such story.');

      const chapters = await tx
        .select({ position: schema.storyChapters.position })
        .from(schema.storyChapters)
        .where(eq(schema.storyChapters.storyId, input.storyId))
        .orderBy(asc(schema.storyChapters.position));

      if (!chapters.some(entry => entry.position === input.position)) {
        fail('There is no such chapter.');
      }

      // The tokens first, and by hand: nothing in the database ties them to the chapter row,
      // so this is the statement that stops them being left behind to be inherited by
      // whichever chapter shifts down into that position. See the note in schema.ts.
      await tx
        .delete(schema.storyTokens)
        .where(
          and(eq(schema.storyTokens.storyId, input.storyId), eq(schema.storyTokens.chapter, input.position)),
        );
      await tx
        .delete(schema.storyChapters)
        .where(
          and(
            eq(schema.storyChapters.storyId, input.storyId),
            eq(schema.storyChapters.position, input.position),
          ),
        );

      // Close the gap. Positions are a chapter's identity, so leaving a hole would leave
      // chapter 4 of a three-chapter story — and the reader counts from the list rather
      // than reading the numbers, so it would show as "chapter 3" and link to nothing.
      //
      // Downwards, one at a time: the positions are a primary key, and moving 3→2 while 2
      // still exists would collide. Sorted ascending, each move is into a hole just vacated.
      for (const entry of chapters) {
        if (entry.position <= input.position) continue;
        await shiftChapter(tx, input.storyId, entry.position, entry.position - 1);
      }

      await recountStory(tx, input.storyId);
      return { version: await bumpContentVersion(tx, story.lang) };
    }),
  ),

  moveChapter: os.admin.moveChapter.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.storyId))
        .limit(1);
      if (!story) fail('There is no such story.');

      const chapters = await tx
        .select({ position: schema.storyChapters.position })
        .from(schema.storyChapters)
        .where(eq(schema.storyChapters.storyId, input.storyId))
        .orderBy(asc(schema.storyChapters.position));

      const index = chapters.findIndex(entry => entry.position === input.position);
      if (index === -1) fail('There is no such chapter.');

      const other = chapters[input.direction === 'up' ? index - 1 : index + 1];
      // Not an error. The buttons at the ends of the list are disabled, so this is a double
      // click landing after the list moved, and there is nothing to tell anybody about.
      if (!other) return { version: await bumpContentVersion(tx, story.lang) };

      // Through a position nothing occupies, because `(story_id, position)` is the key and
      // the two rows would otherwise collide half way through the swap. Negative, so it can
      // never be a position a chapter might legitimately take.
      const parked = -1;
      await shiftChapter(tx, input.storyId, input.position, parked);
      await shiftChapter(tx, input.storyId, other.position, input.position);
      await shiftChapter(tx, input.storyId, parked, other.position);

      return { version: await bumpContentVersion(tx, story.lang) };
    }),
  ),

  /* ---- the shelves stories are filed on ---- */

  saveStoryCategory: os.admin.saveStoryCategory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const existing = input.id
        ? (
            await tx
              .select({ id: schema.storyCategories.id, lang: schema.storyCategories.lang })
              .from(schema.storyCategories)
              .where(eq(schema.storyCategories.id, input.id))
              .limit(1)
          )[0]
        : undefined;

      if (input.id && !existing) fail('There is no such category.');
      if (existing && existing.lang !== input.lang) {
        fail(`That category is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
      }

      const row = { lang: input.lang, name: input.name, nameNative: input.nameNative, note: input.note };

      let id = existing?.id ?? '';
      if (existing) {
        await tx.update(schema.storyCategories).set(row).where(eq(schema.storyCategories.id, id));
      } else {
        const stem =
          input.lang === 'ka'
            ? slug(input.name, 'shelf')
            : `${input.lang}-${slug(slugCyrillic(input.name), 'shelf')}`;
        id = await freeId(tx, 'storyCategories', stem);
        const [last] = await tx
          .select({ max: raw<number | null>`max(${schema.storyCategories.position})` })
          .from(schema.storyCategories)
          .where(eq(schema.storyCategories.lang, input.lang));
        await tx
          .insert(schema.storyCategories)
          .values({ id, position: (last?.max ?? -1) + 1, storyCount: 0, ...row });
      }

      return { id, version: await bumpContentVersion(tx, input.lang) };
    }),
  ),

  deleteStoryCategory: os.admin.deleteStoryCategory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [category] = await tx
        .select({ id: schema.storyCategories.id, lang: schema.storyCategories.lang })
        .from(schema.storyCategories)
        .where(eq(schema.storyCategories.id, input.id))
        .limit(1);
      if (!category) fail('There is no such category.');

      // Unlike a word's category, this one is deleted with things still in it. The stories
      // are not deleted and are not moved: `stories.category_id` is `on delete set null`,
      // and they come off the shelf and go back to being unfiled. Nothing is lost, which is
      // why this asks nothing and refuses nothing.
      await tx.delete(schema.storyCategories).where(eq(schema.storyCategories.id, input.id));
      return { version: await bumpContentVersion(tx, category.lang) };
    }),
  ),

  setStoryToken: os.admin.setStoryToken.use(adminOnly).handler(async ({ input }) => {
    await db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.storyId))
        .limit(1);
      if (!story) fail('There is no such story.');

      const [token] = await tx
        .select({ form: schema.storyTokens.form })
        .from(schema.storyTokens)
        .where(
          and(
            eq(schema.storyTokens.storyId, input.storyId),
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
          .select({ id: schema.words.id, lang: schema.words.lang })
          .from(schema.words)
          .where(eq(schema.words.id, input.wordId))
          .limit(1);
        if (!word) fail('There is no such entry in the dictionary.');
        // Reachable only from a picker searching the wrong snapshot, but the failure it
        // prevents is a token in a Russian story pointing at a Georgian headword, which
        // nothing downstream would notice and no reader could make sense of.
        if (word.lang !== story.lang) {
          fail(`That entry is ${word.lang} and this story is ${story.lang}.`);
        }

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
        // The two values that mean "a person decided this" — see the note on the column.
        // Relinking reads them back and leaves these rows exactly as they are.
        via: input.name ? 'name' : input.wordId ? 'override' : 'override: unlinked',
        // Taken from the editor rather than cleared. Deciding something and being sure of it
        // are different, and a pinned link that is still a guess has to be able to say so —
        // otherwise the only way to record the doubt is to leave the wrong link in place.
        needsCheck: input.check,
        comment: input.comment,
      };

      const where = input.everywhere
        ? // Every occurrence of this spelling in this story — the `forms` block of the
          // offline overrides file. და is the conjunction all the way through this story,
          // and the whole of it: no chapter in the `where`. See the note on `everywhere`.
          and(eq(schema.storyTokens.storyId, input.storyId), eq(schema.storyTokens.form, input.form))
        : // This occurrence alone — the `at` block. აბა is "let's" in one line and "just
          // try" in another, and only a position can tell those apart.
          and(
            eq(schema.storyTokens.storyId, input.storyId),
            eq(schema.storyTokens.chapter, input.chapter),
            eq(schema.storyTokens.paragraph, input.paragraph),
            eq(schema.storyTokens.position, input.position),
          );

      await tx.update(schema.storyTokens).set(set).where(where);
      await recountStory(tx, input.storyId);
      await bumpContentVersion(tx, story.lang);
    });

    return linkResult(input.storyId, input.chapter, { unresolved: [], flagged: [] });
  }),

  resetStoryToken: os.admin.resetStoryToken.use(adminOnly).handler(async ({ input }) => {
    const prose = await storyProse(input.storyId);
    // Undoing a pin "everywhere" reaches every chapter, so every chapter is relinked and
    // every chapter needs its tags. Otherwise only the one the word stands in.
    const touching = input.everywhere
      ? prose.chapters
      : prose.chapters.filter(chapter => chapter.position === input.chapter);
    const tags = await Promise.all(touching.map(chapter => tagsFor(prose.lang, chapter.paragraphs)));

    const report = await db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.storyId))
        .limit(1);
      if (!story) fail('There is no such story.');

      // Drop the pin, then relink. The token has to go back through the resolver to find out
      // what it would have been without the decision, and there is no cheaper way to know
      // that than to ask — so this one does re-resolve, unlike setting a pin.
      const reports: LinkLists[] = [];
      for (const [index, chapter] of touching.entries()) {
        const pinned = await readPinned(tx, input.storyId, chapter.position);
        if (input.everywhere) {
          for (const [key, token] of pinned) {
            if (token.form === input.form) pinned.delete(key);
          }
        } else {
          pinned.delete(pinKey(input.paragraph, input.position, input.form));
        }
        reports.push(
          await relink(tx, story.lang, input.storyId, chapter.position, chapter.paragraphs, pinned, tags[index]),
        );
      }

      await recountStory(tx, input.storyId);
      await bumpContentVersion(tx, story.lang);
      return mergeLists(reports);
    });

    return linkResult(input.storyId, input.chapter, report);
  }),

  /* ---- who else may do all this ---- */

  users: os.admin.users.use(adminOnly).handler(async () => ({ users: await listUsers(db) })),

  setAdmin: os.admin.setAdmin.use(adminOnly).handler(async ({ input, context }) => {
    if (input.userId === context.user.id && !input.isAdmin) {
      // Not paternalism: an admin who steps down by accident cannot put themselves back, and
      // if they were the last one nobody can. Signing out is what they want anyway.
      fail('You cannot remove your own admin access. Ask another admin to do it.');
    }

    return db.transaction(async tx => {
      const [target] = await tx
        .select({ id: schema.user.id, isAdmin: schema.user.isAdmin })
        .from(schema.user)
        .where(eq(schema.user.id, input.userId))
        .limit(1);
      if (!target) fail('There is no such account.');

      if (!input.isAdmin) {
        const [remaining] = await tx
          .select({ total: count() })
          .from(schema.user)
          .where(and(eq(schema.user.isAdmin, true), ne(schema.user.id, input.userId)));
        if (Number(remaining?.total ?? 0) === 0) {
          fail('That is the last admin. An installation with none can only be repaired from the host.');
        }
      }

      await tx.update(schema.user).set({ isAdmin: input.isAdmin }).where(eq(schema.user.id, input.userId));
      return { users: await listUsers(tx) };
    });
  }),
});
