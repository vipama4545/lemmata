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

/** `${base}`, then `${base}-2`, until nothing has it. */
async function freeId(tx: Tx, table: 'verbs' | 'stories', base: string): Promise<string> {
  const target = table === 'verbs' ? schema.kaVerbs : schema.stories;
  for (let n = 1; n < 500; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
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
 * Every hand-made token in a story, keyed so a relink can put them back.
 *
 * See `story_tokens.via`: a person's decision is a token marked `name` or `override`, and
 * everything else is the resolver's own working. This reads the first kind out before the
 * rows are replaced.
 */
async function readPinned(tx: Tx, storyId: string): Promise<Pinned> {
  const rows = await tx.select().from(schema.storyTokens).where(eq(schema.storyTokens.storyId, storyId));
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

/**
 * A story's language and prose, read before any transaction is opened, so the tagger can be
 * asked about it. Fails the request if there is no such story, which is the same check the
 * caller's own transaction repeats against a consistent snapshot.
 */
async function storyProse(storyId: string): Promise<{ lang: Lang; paragraphs: string[] }> {
  const [story] = await db
    .select({ lang: schema.stories.lang, paragraphs: schema.stories.paragraphs })
    .from(schema.stories)
    .where(eq(schema.stories.id, storyId))
    .limit(1);
  if (!story) fail('There is no such story.');
  return { lang: story.lang, paragraphs: story.paragraphs };
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
 * Re-resolves a story from the lexicon as it now stands, keeping every hand-made token, and
 * writes the result. The caller supplies the paragraphs so this serves both "the text
 * changed" and "the dictionary changed", and the tags because fetching them is not this
 * function's job to do inside a transaction — see `tagsFor`.
 */
async function relink(
  tx: Tx,
  lang: Lang,
  storyId: string,
  paragraphs: string[],
  pinned: Pinned,
  tags: Tags | null,
): Promise<{ unresolved: { form: string; count: number }[]; flagged: { form: string; count: number }[] }> {
  const indexes = await buildIndexes(lang);
  const report = linkStory(lang, paragraphs, indexes, pinned, tags);

  // A pin may cite a word that has since been deleted. Better a token that falls back to
  // plain text than a write that fails on a foreign key and loses the whole edit.
  const known = new Set(indexes.byId.keys());

  await tx.delete(schema.storyTokens).where(eq(schema.storyTokens.storyId, storyId));
  if (report.tokens.length) {
    const rows = report.tokens.map(token => ({
      storyId,
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

  await tx.update(schema.stories).set({ stats: report.stats }).where(eq(schema.stories.id, storyId));

  return { unresolved: report.unresolved, flagged: report.flagged };
}

/** The story as the reader wants it, plus what linking it turned up. */
async function linkResult(
  storyId: string,
  extra: { unresolved: { form: string; count: number }[]; flagged: { form: string; count: number }[] },
): Promise<StoryLinkResult> {
  const story = await loadStory(storyId);
  if (!story) fail('That story disappeared while it was being saved.');
  return { story: story as Story, ...extra };
}

/**
 * Applies one decision to the tokens it covers, in place, without re-resolving anything.
 *
 * Pinning a token is not a relink: the other 975 tokens have not changed and re-deriving
 * them would be a second of work to produce identical rows. The stats are recounted from the
 * table afterwards, because coverage did change.
 */
async function recountStory(tx: Tx, storyId: string, paragraphs: string[]): Promise<void> {
  const rows = await tx
    .select({
      form: schema.storyTokens.form,
      wordId: schema.storyTokens.wordId,
      name: schema.storyTokens.name,
      needsCheck: schema.storyTokens.needsCheck,
    })
    .from(schema.storyTokens)
    .where(eq(schema.storyTokens.storyId, storyId));

  const distinct = new Set(rows.map(row => row.form));
  const names = rows.filter(row => row.name).length;
  const linked = rows.filter(row => row.wordId).length;
  const covered = names + linked;
  const total = rows.length;

  await tx
    .update(schema.stories)
    .set({
      stats: {
        tokens: total,
        distinctForms: distinct.size,
        covered,
        coverage: total ? Number(((covered / total) * 100).toFixed(1)) : 0,
        names,
        unresolved: total - covered,
        flagged: rows.filter(row => row.needsCheck).length,
      },
    })
    .where(eq(schema.stories.id, storyId));

  void paragraphs;
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
    const native = readLines(input.text);
    const paragraphs = native.paragraphs;
    if (!paragraphs.length) fail('There is no story text — a title on its own is not a story.');

    const english = input.translation.trim() ? readLines(input.translation) : null;
    const translation = english?.paragraphs ?? [];
    if (translation.length && translation.length !== paragraphs.length) {
      fail(
        `The translation has ${translation.length} paragraph(s) and the text has ${paragraphs.length}. ` +
          'The side-by-side view pairs them by position, so they would drift out of step.',
      );
    }

    // Before the transaction, and on the text as submitted — this is the one path where the
    // prose is new, so there is nothing in the database to read it from anyway.
    const tags = await tagsFor(input.lang, paragraphs);

    const result = await db.transaction(async tx => {
      const existing = input.id
        ? (await tx.select({ id: schema.stories.id, lang: schema.stories.lang }).from(schema.stories).where(eq(schema.stories.id, input.id)).limit(1))[0]
        : undefined;

      // A story does not change language. Refusing is not pedantry: the tokens are already
      // cut by one language's rules and linked against one language's lexicon, and an edit
      // arriving under the other is a switcher left on the wrong dictionary rather than
      // anything anybody meant.
      if (existing && existing.lang !== input.lang) {
        fail(`That story is ${existing.lang}, not ${input.lang}. Switch language and edit it there.`);
      }

      // The title comes from the first line of the text, the way a .txt file has always
      // given it, unless the form set one explicitly.
      const title = input.title || native.title;
      const titleEnglish = input.titleEnglish || english?.title || '';

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
        title,
        titleEnglish,
        level: input.level,
        source: input.source,
        note: input.note,
        paragraphs,
        translation,
      };

      if (existing) {
        await tx.update(schema.stories).set(row).where(eq(schema.stories.id, id));
      } else {
        await tx.insert(schema.stories).values({ id, stats: {}, ...row });
      }

      // Pins are read before the tokens are replaced, and re-applied by position *and*
      // spelling — so editing the prose drops the pins the edit moved rather than sliding
      // them onto whatever words now stand in those positions.
      const pinned = existing ? await readPinned(tx, id) : new Map();
      const report = await relink(tx, input.lang, id, paragraphs, pinned, tags);
      await bumpContentVersion(tx, input.lang);
      return { id, report };
    });

    return linkResult(result.id, result.report);
  }),

  deleteStory: os.admin.deleteStory.use(adminOnly).handler(async ({ input }) =>
    db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.id))
        .limit(1);
      if (!story) fail('There is no such story.');

      // The tokens cascade, and here that is right: they are this story's and nothing else
      // points at them.
      await tx.delete(schema.stories).where(eq(schema.stories.id, input.id));
      return { version: await bumpContentVersion(tx, story.lang) };
    }),
  ),

  relinkStory: os.admin.relinkStory.use(adminOnly).handler(async ({ input }) => {
    const prose = await storyProse(input.id);
    const tags = await tagsFor(prose.lang, prose.paragraphs);

    const report = await db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang, paragraphs: schema.stories.paragraphs })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.id))
        .limit(1);
      if (!story) fail('There is no such story.');

      const pinned = await readPinned(tx, input.id);
      const result = await relink(tx, story.lang, input.id, story.paragraphs, pinned, tags);
      await bumpContentVersion(tx, story.lang);
      return result;
    });

    return linkResult(input.id, report);
  }),

  setStoryToken: os.admin.setStoryToken.use(adminOnly).handler(async ({ input }) => {
    await db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang, paragraphs: schema.stories.paragraphs })
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
          // offline overrides file. და is the conjunction all the way through this story.
          and(eq(schema.storyTokens.storyId, input.storyId), eq(schema.storyTokens.form, input.form))
        : // This occurrence alone — the `at` block. აბა is "let's" in one line and "just
          // try" in another, and only a position can tell those apart.
          and(
            eq(schema.storyTokens.storyId, input.storyId),
            eq(schema.storyTokens.paragraph, input.paragraph),
            eq(schema.storyTokens.position, input.position),
          );

      await tx.update(schema.storyTokens).set(set).where(where);
      await recountStory(tx, input.storyId, story.paragraphs);
      await bumpContentVersion(tx, story.lang);
    });

    return linkResult(input.storyId, { unresolved: [], flagged: [] });
  }),

  resetStoryToken: os.admin.resetStoryToken.use(adminOnly).handler(async ({ input }) => {
    const prose = await storyProse(input.storyId);
    const tags = await tagsFor(prose.lang, prose.paragraphs);

    const report = await db.transaction(async tx => {
      const [story] = await tx
        .select({ id: schema.stories.id, lang: schema.stories.lang, paragraphs: schema.stories.paragraphs })
        .from(schema.stories)
        .where(eq(schema.stories.id, input.storyId))
        .limit(1);
      if (!story) fail('There is no such story.');

      // Drop the pin, then relink. The token has to go back through the resolver to find out
      // what it would have been without the decision, and there is no cheaper way to know
      // that than to ask — so this one does re-resolve, unlike setting a pin.
      const pinned = await readPinned(tx, input.storyId);
      if (input.everywhere) {
        for (const [key, token] of pinned) {
          if (token.form === input.form) pinned.delete(key);
        }
      } else {
        pinned.delete(pinKey(input.paragraph, input.position, input.form));
      }

      const result = await relink(tx, story.lang, input.storyId, story.paragraphs, pinned, tags);
      await bumpContentVersion(tx, story.lang);
      return result;
    });

    return linkResult(input.storyId, report);
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
