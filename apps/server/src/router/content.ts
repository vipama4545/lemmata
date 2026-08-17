// The dictionary, on its way out.
//
// The whole of one language goes in one response. That is a deliberate choice rather than a
// shortcut: the app searches thousands of words as you type, paints a story of 976 tokens at
// once and filters a 2,500-item deck, and none of that survives a round trip per lookup. It
// used to be bundled into the JavaScript, so the bytes are not new — what is new is that they
// come from a database that can be corrected without a redeploy.
//
// Three things keep that affordable. The assembled snapshot is built once and held in memory,
// because it is the same for every visitor and only changes when the content does. The client
// sends the version it already has, so every visit after the first transfers a version string
// and nothing else. And the whole of it is *per language* — cache, version and payload — so a
// second dictionary costs a Georgian learner exactly nothing. Nobody downloads a language
// they never open, and a Russian correction does not invalidate a Georgian snapshot.
//
// The Russian verbs are the one place this file does markedly less work than it looks like it
// should. It sends rules, not paradigms: `conjugate()` runs in the browser off class
// definitions already in the bundle, so 500 verbs cross as 500 short records instead of
// 10,000 conjugated strings. See the head of grammar/ru.ts.
//
// **Nothing owned by anybody is in here.** Every query that reads a content table asks for
// `owner_id is null`, because this object is built once per language and handed to every
// visitor and every cache: one row that varied per person would make the whole of it vary per
// person. A reader's own stories and words come from router/library.ts as a small separate
// payload, assembled by the same functions below (`assembleWords`, `summariseStories`), so a
// private word is the same shape of thing as a published one and nothing downstream can tell
// them apart. See the note on `owner_id` in schema.ts.

import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/server';
import { and, asc, eq, inArray, isNull, sql as raw } from 'drizzle-orm';
import type {
  Category,
  ImageMap,
  KaMorphemeData,
  KaVerb,
  Lang,
  Language,
  Lesson,
  LessonCategory,
  LessonImageMap,
  LessonSection,
  LessonSummary,
  PersonKey,
  QuizCategory,
  QuizKind,
  QuizSummary,
  RuSlotKey,
  RuVerb,
  Sense,
  Story,
  StoryCategory,
  StoryChapterSummary,
  StoryStats,
  StorySummary,
  StoryToken,
  Word,
  WordData,
  WordForm,
} from '@georgian/shared/types';
import type { ContentSnapshot, PrivateContent, VerbContent } from '@georgian/shared/contract';
import { QUIZ_KINDS, isQuizKind } from '@georgian/shared/types';
import { lessonExcerpt, lessonHasAudio, lessonQuizIds, parseLesson } from '@georgian/shared/lesson';
import { isAdminOnlyLang } from '@georgian/shared/grammar';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { isAdminSession, os } from './base.ts';
import type { AppContext } from './base.ts';

/* --------------------------------------------------------------- the cache */

const cached = new Map<Lang, ContentSnapshot>();
const building = new Map<Lang, Promise<ContentSnapshot>>();

/** One language's version — one cheap row, and the only thing most requests need. */
async function currentVersion(lang: Lang): Promise<string> {
  const [row] = await db
    .select({ version: schema.contentVersion.version })
    .from(schema.contentVersion)
    .where(eq(schema.contentVersion.lang, lang))
    .limit(1);
  return row?.version ?? 'empty';
}

/**
 * The snapshot, built if it has to be.
 *
 * Concurrent callers share one build rather than each starting their own — on a cold start
 * behind a load balancer, several visitors arrive at once and assembling this four times
 * over would be four times the queries for one identical answer.
 */
async function snapshot(lang: Lang): Promise<ContentSnapshot> {
  const version = await currentVersion(lang);
  const have = cached.get(lang);
  if (have?.version === version) return have;

  const inFlight = building.get(lang);
  if (inFlight) return inFlight;

  const work = assemble(lang, version).then(
    built => {
      cached.set(lang, built);
      building.delete(lang);
      return built;
    },
    error => {
      building.delete(lang);
      throw error;
    },
  );

  building.set(lang, work);
  return work;
}

// There is deliberately no way to invalidate the cache by hand. It is keyed on the version
// the database reports, and both writers bump that as their last act, so a running server
// picks up new data on the next request without being told and without being restarted.

/**
 * Marks one language's content as changed, from the last statement of an edit.
 *
 * This one line is the whole of cache invalidation for the admin screens. The server's
 * snapshot is keyed on the version, so a new one rebuilds it on the next request; the
 * browser sends the version it holds, so a new one means it is sent that dictionary again
 * instead of the small "still current". Nothing else has to know an edit happened.
 *
 * `source` goes to 'admin', which is what `npm run db:seed` looks at before replacing these
 * tables with the contents of data/. See the guard there, and `npm run db:export` for the way
 * back. The version itself is random rather than a digest of the content: the seed's digest
 * exists so re-running it over unchanged files leaves cached snapshots valid, and an edit by
 * definition changed something.
 *
 * Call it inside the same transaction as the write. Bumping the version first, or in a
 * transaction of its own, would let a reader see the new version and then the old rows.
 */
export async function bumpContentVersion(tx: Tx, lang: Lang): Promise<string> {
  const version = randomUUID().replaceAll('-', '').slice(0, 16);
  await tx
    .insert(schema.contentVersion)
    .values({ lang, version, source: 'admin', builtAt: new Date() })
    .onConflictDoUpdate({
      target: schema.contentVersion.lang,
      set: { version, source: 'admin', builtAt: new Date() },
    });
  return version;
}

/**
 * A fresh build, straight from the tables. What `npm run db:verify` compares against the
 * generated files — the assembly has to be the real one for that check to mean anything.
 */
export function buildSnapshotFromDatabase(lang: Lang): Promise<ContentSnapshot> {
  return currentVersion(lang).then(version => assemble(lang, version));
}

/** Every language on offer, which the switcher needs before any dictionary has loaded. */
export async function listLanguages(): Promise<Language[]> {
  const rows = await db.select().from(schema.languages).orderBy(asc(schema.languages.position));
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    nativeName: row.nativeName,
    script: row.script,
    enabled: row.enabled,
  }));
}

/* ------------------------------------------------------------- assembling */

async function assemble(lang: Lang, version: string): Promise<ContentSnapshot> {
  // One round trip each, in parallel. Grouping happens below, in JavaScript: Postgres could
  // do it with json_agg, but then the shape of the response would live in a SQL string
  // instead of in the types, and this runs once per deploy.
  const [
    metaRow,
    languageRows,
    categoryRows,
    wordRows,
    storyRows,
    storyCategoryRows,
    quizRows,
    quizCategoryRows,
    lessonRows,
    lessonCategoryRows,
    lessonImageRows,
  ] = await Promise.all([
    db.select().from(schema.contentVersion).where(eq(schema.contentVersion.lang, lang)).limit(1),
    db.select().from(schema.languages).orderBy(asc(schema.languages.position)),
    // Ordered explicitly, everywhere it is an array on the way out. A table has no order of
    // its own, and the order these had in the generated files is meaningful — see the note
    // on `categories` in the schema.
    db
      .select()
      .from(schema.categories)
      .where(and(eq(schema.categories.lang, lang), isNull(schema.categories.ownerId)))
      .orderBy(asc(schema.categories.position)),
    // `owner_id is null` on these three, and it is the line that keeps one person's private
    // library out of everybody else's dictionary. See the note at the head of this file.
    db
      .select()
      .from(schema.words)
      .where(and(eq(schema.words.lang, lang), isNull(schema.words.ownerId)))
      .orderBy(asc(schema.words.position)),
    db
      .select()
      .from(schema.stories)
      .where(and(eq(schema.stories.lang, lang), isNull(schema.stories.ownerId)))
      .orderBy(asc(schema.stories.id)),
    db
      .select()
      .from(schema.storyCategories)
      .where(eq(schema.storyCategories.lang, lang))
      .orderBy(asc(schema.storyCategories.position)),
    db.select().from(schema.quizzes).where(eq(schema.quizzes.lang, lang)).orderBy(asc(schema.quizzes.position)),
    db
      .select()
      .from(schema.quizCategories)
      .where(eq(schema.quizCategories.lang, lang))
      .orderBy(asc(schema.quizCategories.position)),
    // The bodies come with them, and they are the one thing in this query that is fetched and
    // then thrown away. Four facts on a lesson card — how long it is, whether it has audio, how
    // many quizzes it embeds, what its opening line says — can only be had by parsing the
    // markup, and the alternative is four stored columns that go stale the day the parser
    // learns a new block. Parsing every lesson here costs one pass per *version*, because this
    // whole function runs once and is then cached; a stored column would cost a re-save of
    // every lesson to correct. See `LessonSummary`.
    db
      .select()
      .from(schema.lessons)
      .where(eq(schema.lessons.lang, lang))
      .orderBy(asc(schema.lessons.position)),
    db
      .select()
      .from(schema.lessonCategories)
      .where(eq(schema.lessonCategories.lang, lang))
      .orderBy(asc(schema.lessonCategories.position)),
    // Every language's pictures, not this one's. A photograph of a Georgian street sign
    // uploaded while the Georgian dictionary was open is a perfectly good illustration for a
    // Russian lesson about signage, and `lesson_media.lang` records where it was uploaded
    // rather than who may use it. There are tens of these rows and each is four short fields.
    db
      .select({
        id: schema.lessonMedia.id,
        width: schema.lessonMedia.width,
        height: schema.lessonMedia.height,
        alt: schema.lessonMedia.alt,
      })
      .from(schema.lessonMedia)
      .where(eq(schema.lessonMedia.kind, 'image')),
  ]);

  const meta = metaRow[0]?.meta ?? {};
  const wordIds = wordRows.map(row => row.id);
  const storyIds = storyRows.map(row => row.id);
  const quizIds = quizRows.map(row => row.id);

  // The children of the rows above. Fetched in a second round rather than joined, and scoped
  // by the ids just found: `word_senses` has no `lang` of its own, and getting one would mean
  // a column that could disagree with the word it hangs off.
  const [senseRows, formRows, ruGrammarRows, imageRows, chapterRows, quizKindRows, quizChoiceAudioRows] =
    await Promise.all([
    wordIds.length
      ? db
          .select()
          .from(schema.wordSenses)
          .where(inArray(schema.wordSenses.wordId, wordIds))
          .orderBy(asc(schema.wordSenses.position))
      : [],
    wordIds.length
      ? db
          .select()
          .from(schema.wordForms)
          .where(inArray(schema.wordForms.wordId, wordIds))
          .orderBy(asc(schema.wordForms.position))
      : [],
    lang === 'ru' && wordIds.length
      ? db.select().from(schema.ruWordGrammar).where(inArray(schema.ruWordGrammar.wordId, wordIds))
      : [],
    db.select().from(schema.images),
    // Counted in Postgres rather than fetched and measured here. The snapshot wants how many
    // paragraphs a chapter has and its opening line, not the chapter — and a story with
    // forty of them would otherwise put a whole book in a payload that shows a card.
    chapterCounts(storyIds),
    // What kinds of question each quiz holds, and whether any of them is meant to be heard —
    // aggregated in Postgres, because the alternative is fetching every question of every
    // quiz to derive two badges from them, and the questions carry the answers. A summary
    // that had to read the answers to be built would be one edit away from leaking them.
    quizIds.length
      ? db
          .select({
            quizId: schema.quizQuestions.quizId,
            kind: schema.quizQuestions.kind,
            audible: raw<boolean>`bool_or(${schema.quizQuestions.say} <> '' or ${schema.quizQuestions.audioId} is not null)`,
          })
          .from(schema.quizQuestions)
          .where(inArray(schema.quizQuestions.quizId, quizIds))
          .groupBy(schema.quizQuestions.quizId, schema.quizQuestions.kind)
      : [],
    // The options carry sound of their own — "which of these three did you hear" is audio on
    // every option and none on the prompt — so a quiz is audible if either table says so.
    quizIds.length
      ? db
          .select({
            quizId: schema.quizChoices.quizId,
            audible: raw<boolean>`bool_or(${schema.quizChoices.say} <> '' or ${schema.quizChoices.audioId} is not null)`,
          })
          .from(schema.quizChoices)
          .where(inArray(schema.quizChoices.quizId, quizIds))
          .groupBy(schema.quizChoices.quizId)
      : [],
  ]);

  /* -- words ------------------------------------------------------------- */

  const words = assembleWords(wordRows, senseRows, formRows, ruGrammarRows);
  const categories = categoryRows.map(toCategory);

  const wordData: WordData = { note: meta.words ?? '', lang, categories, words };

  /* -- verbs ------------------------------------------------------------- */

  const verbs = lang === 'ru' ? await assembleRuVerbs(meta) : await assembleKaVerbs(meta);

  /* -- images ------------------------------------------------------------ */

  // The images table carries no `lang`: `subject_id` is a content id, and those are already
  // unique across languages. So the snapshot's share of it is whatever names a subject this
  // language has, which is a set membership test rather than a query.
  const mine = new Set<string>([...wordIds, ...categoryRows.map(row => row.id)]);
  const images: ImageMap = {};
  const categoryImages: ImageMap = {};
  for (const row of imageRows) {
    if (!mine.has(row.subjectId)) continue;
    const info = {
      url: row.url,
      width: row.width,
      height: row.height,
      title: row.title,
      page: row.page,
      author: row.author,
      license: row.license,
      licenseUrl: row.licenseUrl,
    };
    (row.kind === 'category' ? categoryImages : images)[row.subjectId] = info;
  }

  /* -- stories ----------------------------------------------------------- */

  const storyCategories: StoryCategory[] = storyCategoryRows.map(row => ({
    id: row.id,
    lang: row.lang,
    name: row.name,
    nameNative: row.nameNative,
    note: row.note,
    storyCount: row.storyCount,
  }));

  const categoryNames = new Map(storyCategoryRows.map(row => [row.id, row.name]));
  const stories = summariseStories(storyRows, chapterRows, categoryNames);

  /* -- quizzes ----------------------------------------------------------- */

  const quizCategories: QuizCategory[] = quizCategoryRows.map(row => ({
    id: row.id,
    lang: row.lang,
    name: row.name,
    nameNative: row.nameNative,
    note: row.note,
    quizCount: row.quizCount,
  }));

  const quizCategoryNames = new Map(quizCategoryRows.map(row => [row.id, row.name]));

  const kindsByQuiz = new Map<string, QuizKind[]>();
  const audibleQuizzes = new Set<string>();
  for (const row of quizKindRows) {
    if (row.audible) audibleQuizzes.add(row.quizId);
    if (!isQuizKind(row.kind)) continue;
    kindsByQuiz.set(row.quizId, [...(kindsByQuiz.get(row.quizId) ?? []), row.kind]);
  }
  for (const row of quizChoiceAudioRows) {
    if (row.audible) audibleQuizzes.add(row.quizId);
  }

  const quizzes: QuizSummary[] = quizRows.map(row => ({
    id: row.id,
    lang: row.lang,
    title: row.title,
    titleNative: row.titleNative,
    description: row.description,
    level: row.level,
    categoryId: row.categoryId,
    category: row.categoryId ? quizCategoryNames.get(row.categoryId) ?? '' : '',
    passMark: row.passMark,
    questionCount: row.questionCount,
    // In the order QUIZ_KINDS declares rather than the order Postgres grouped them, so the
    // badges on two cards holding the same kinds read the same way round.
    kinds: QUIZ_KINDS.filter(kind => kindsByQuiz.get(row.id)?.includes(kind)),
    hasAudio: audibleQuizzes.has(row.id),
  }));

  /* -- lessons ----------------------------------------------------------- */

  const lessonCategories: LessonCategory[] = lessonCategoryRows.map(row => ({
    id: row.id,
    lang: row.lang,
    section: row.section as LessonSection,
    name: row.name,
    nameNative: row.nameNative,
    note: row.note,
    lessonCount: row.lessonCount,
  }));

  const lessonCategoryNames = new Map(lessonCategoryRows.map(row => [row.id, row.name]));

  const lessons: LessonSummary[] = lessonRows.map(row => summariseLesson(row, lessonCategoryNames));

  const lessonImages: LessonImageMap = Object.fromEntries(
    lessonImageRows.map(row => [row.id, { width: row.width, height: row.height, alt: row.alt }]),
  );

  const languages: Language[] = languageRows.map(row => ({
    id: row.id,
    name: row.name,
    nativeName: row.nativeName,
    script: row.script,
    enabled: row.enabled,
  }));

  return {
    version,
    lang,
    languages,
    words: wordData,
    verbs,
    images,
    categoryImages,
    stories,
    storyCategories,
    quizzes,
    quizCategories,
    lessons,
    lessonCategories,
    lessonImages,
  };
}

/* ------------------------------------------------- words, from rows to records */

type WordRow = typeof schema.words.$inferSelect;
type SenseRow = { wordId: string; position: number; english: string };
type FormRow = typeof schema.wordForms.$inferSelect;
type RuGrammarRow = typeof schema.ruWordGrammar.$inferSelect;

/**
 * Rows to `Word`s: the senses and forms gathered under the entries they belong to.
 *
 * A function rather than a passage inside `assemble`, because the private overlay is built
 * from it too. A word somebody added themselves crosses the wire in the shape a published one
 * does, so the search box, the deck, the story card and the export cannot tell the two apart
 * and none of them needs to. The one field that differs is `mine`, set by the caller that
 * knows. See `loadOwned`.
 */
function assembleWords(
  wordRows: WordRow[],
  senseRows: SenseRow[],
  formRows: FormRow[],
  ruGrammarRows: RuGrammarRow[],
): Word[] {
  const sensesByWord = new Map<string, Sense[]>();
  for (const row of senseRows) {
    const list = sensesByWord.get(row.wordId) ?? [];
    list.push({ id: `${row.wordId}.${row.position}`, english: row.english });
    sensesByWord.set(row.wordId, list);
  }

  const formsByWord = new Map<string, WordForm[]>();
  for (const row of formRows) {
    const list = formsByWord.get(row.wordId) ?? [];
    const form: WordForm = { form: row.form };
    if (row.gram) form.gram = row.gram;
    if (row.english) form.english = row.english;
    if (row.accented) form.accented = row.accented;
    list.push(form);
    formsByWord.set(row.wordId, list);
  }

  const grammarByWord = new Map(ruGrammarRows.map(row => [row.wordId, row]));

  return wordRows.map(row => {
    const senses = sensesByWord.get(row.id) ?? [];
    const forms = formsByWord.get(row.id);
    const word: Word = {
      id: row.id,
      lang: row.lang,
      headword: row.headword,
      english: row.english,
      // Exactly the senses as plain text — checked against the generated file, where the
      // two never disagree — so it is derived here rather than stored twice.
      englishFull: senses.map(sense => sense.english),
      definition: row.definition,
      level: row.level as Word['level'],
      partOfSpeech: row.partOfSpeech,
      category: row.category,
      categoryId: row.categoryId,
      origin: row.origin as Word['origin'],
      senses,
    };
    if (row.accented) word.accented = row.accented;
    if (row.defaultSense != null) word.defaultSense = row.defaultSense;
    if (row.verbId) word.verbId = row.verbId;
    if (forms?.length) word.forms = forms;
    if (row.needsCheck) word.check = true;
    if (row.note) word.note = row.note;
    if (row.ownerId) word.mine = true;

    const grammar = grammarByWord.get(row.id);
    if (grammar) {
      word.ru = {
        ...(grammar.gender ? { gender: grammar.gender } : {}),
        ...(grammar.animacy ? { animacy: grammar.animacy } : {}),
        ...(grammar.declension ? { declension: grammar.declension } : {}),
        ...(grammar.stressPattern ? { stressPattern: grammar.stressPattern } : {}),
        ...(grammar.needsCheck ? { check: true } : {}),
      };
    }
    return word;
  });
}

function toCategory(row: typeof schema.categories.$inferSelect): Category {
  const category: Category = {
    id: row.id,
    lang: row.lang,
    name: row.name,
    nameNative: row.nameNative,
    wordCount: row.wordCount,
  };
  if (row.ownerId) category.mine = true;
  return category;
}

/* ----------------------------------------------- stories, from rows to records */

type StoryRow = typeof schema.stories.$inferSelect;

/** One chapter as the snapshot counts it: measured in Postgres, never fetched whole. */
interface ChapterCount {
  storyId: string;
  position: number;
  title: string;
  titleEnglish: string;
  stats: unknown;
  paragraphs: number;
  translated: boolean;
  opening: string | null;
}

/**
 * Rows to `StorySummary`s. Shared with the private overlay for the reason `assembleWords` is:
 * a story of somebody's own is listed, opened and read by the same components as a published
 * one, so it had better be the same record.
 */
function summariseStories(
  storyRows: StoryRow[],
  chapterRows: ChapterCount[],
  categoryNames: Map<string, string>,
): StorySummary[] {
  const chaptersByStory = new Map<string, StoryChapterSummary[]>();
  for (const row of chapterRows) {
    const list = chaptersByStory.get(row.storyId) ?? [];
    list.push({
      position: row.position,
      title: row.title,
      titleEnglish: row.titleEnglish,
      paragraphs: Number(row.paragraphs),
      translated: row.translated,
      stats: row.stats as StoryStats,
    });
    chaptersByStory.set(row.storyId, list);
  }

  return storyRows.map(row => {
    const chapters = chaptersByStory.get(row.id) ?? [];
    const opening = chapterRows.find(chapter => chapter.storyId === row.id && chapter.position === 0);
    const summary: StorySummary = {
      note: row.note,
      id: row.id,
      lang: row.lang,
      title: row.title,
      titleEnglish: row.titleEnglish,
      level: row.level,
      source: row.source,
      categoryId: row.categoryId,
      category: row.categoryId ? categoryNames.get(row.categoryId) ?? '' : '',
      stats: row.stats as StoryStats,
      chapters,
      // Any chapter's, not the first's: a book whose opening chapter is untranslated still
      // has a translation to offer, and this is what the index badges.
      translated: chapters.some(chapter => chapter.translated),
      excerpt: opening?.opening ?? '',
    };
    if (row.ownerId) summary.mine = true;
    return summary;
  });
}

/** The same chapter measurements the snapshot takes, for a given set of stories. */
function chapterCounts(storyIds: string[]): Promise<ChapterCount[]> {
  if (!storyIds.length) return Promise.resolve([]);
  return db
    .select({
      storyId: schema.storyChapters.storyId,
      position: schema.storyChapters.position,
      title: schema.storyChapters.title,
      titleEnglish: schema.storyChapters.titleEnglish,
      stats: schema.storyChapters.stats,
      paragraphs: raw<number>`jsonb_array_length(${schema.storyChapters.paragraphs})`,
      translated: raw<boolean>`jsonb_array_length(${schema.storyChapters.translation}) > 0`,
      opening: raw<string | null>`${schema.storyChapters.paragraphs}->>0`,
    })
    .from(schema.storyChapters)
    .where(inArray(schema.storyChapters.storyId, storyIds))
    .orderBy(asc(schema.storyChapters.storyId), asc(schema.storyChapters.position));
}

/* ------------------------------------------------------------ private content */

/**
 * One person's own stories, words and shelves in one language: the overlay the browser lays
 * over the snapshot.
 *
 * Every query here is `owner_id = :owner`, and none of them is `or owner_id is null`. What
 * comes back is only the caller's, because the published half is already in hand. That is the
 * whole delivery model: the big shared thing is cached, the small private thing is not, and
 * neither is ever assembled with the other inside it.
 *
 * Cheap enough to answer on every mutation. A person's library is tens of records where the
 * dictionary is tens of thousands, and re-sending the lot saves the browser from merging a
 * patch into an index it built at boot.
 */
export async function loadOwned(owner: string, lang: Lang): Promise<PrivateContent> {
  const [categoryRows, wordRows, storyRows] = await Promise.all([
    db
      .select()
      .from(schema.categories)
      .where(and(eq(schema.categories.lang, lang), eq(schema.categories.ownerId, owner)))
      .orderBy(asc(schema.categories.position)),
    db
      .select()
      .from(schema.words)
      .where(and(eq(schema.words.lang, lang), eq(schema.words.ownerId, owner)))
      .orderBy(asc(schema.words.position)),
    db
      .select()
      .from(schema.stories)
      .where(and(eq(schema.stories.lang, lang), eq(schema.stories.ownerId, owner)))
      .orderBy(asc(schema.stories.id)),
  ]);

  const wordIds = wordRows.map(row => row.id);
  const [senseRows, formRows, ruGrammarRows, chapterRows] = await Promise.all([
    wordIds.length
      ? db
          .select()
          .from(schema.wordSenses)
          .where(inArray(schema.wordSenses.wordId, wordIds))
          .orderBy(asc(schema.wordSenses.position))
      : [],
    wordIds.length
      ? db
          .select()
          .from(schema.wordForms)
          .where(inArray(schema.wordForms.wordId, wordIds))
          .orderBy(asc(schema.wordForms.position))
      : [],
    lang === 'ru' && wordIds.length
      ? db.select().from(schema.ruWordGrammar).where(inArray(schema.ruWordGrammar.wordId, wordIds))
      : [],
    chapterCounts(storyRows.map(row => row.id)),
  ]);

  return {
    lang,
    // No shelf names to look up: a private story is never filed on one. See `stories.owner_id`.
    stories: summariseStories(storyRows, chapterRows, new Map()),
    words: assembleWords(wordRows, senseRows, formRows, ruGrammarRows),
    categories: categoryRows.map(toCategory),
  };
}

/** One `lessons` row, minus its body, with the four facts that need the body worked out. */
type LessonRow = typeof schema.lessons.$inferSelect;

function summariseLesson(row: LessonRow, categoryNames: Map<string, string>): LessonSummary {
  const doc = parseLesson(row.body);

  return {
    id: row.id,
    lang: row.lang,
    section: row.section as LessonSection,
    title: row.title,
    titleNative: row.titleNative,
    summary: row.summary,
    level: row.level,
    categoryId: row.categoryId,
    category: row.categoryId ? categoryNames.get(row.categoryId) ?? '' : '',
    excerpt: lessonExcerpt(doc),
    blocks: doc.blocks.length,
    // Every kind of sound counts — a block read aloud, an uploaded recording, a button inside a
    // table cell — because the reader is being told there is a play button on the page and not
    // which sort of button it is.
    hasAudio: lessonHasAudio(doc),
    quizIds: lessonQuizIds(doc),
    videos: doc.blocks.filter(block => block.kind === 'video').length,
  };
}

/* ---------------------------------------------------------- Georgian verbs */

async function assembleKaVerbs(meta: Record<string, string>): Promise<VerbContent> {
  const [groupRows, verbRows, verbFormRows, morphemeRows] = await Promise.all([
    db.select().from(schema.kaVerbGroups).orderBy(asc(schema.kaVerbGroups.position)),
    db.select().from(schema.kaVerbs).orderBy(asc(schema.kaVerbs.position)),
    db.select().from(schema.kaVerbForms),
    db.select().from(schema.kaVerbMorphemes),
  ]);

  // A verb's paradigm, rebuilt from its cells: screeve → person → form. The imperative and
  // prohibitive live in the same table under those names and are lifted back out here.
  const paradigms = new Map<string, Record<string, Partial<Record<PersonKey, string>>>>();
  for (const row of verbFormRows) {
    let byScreeve = paradigms.get(row.verbId);
    if (!byScreeve) {
      byScreeve = {};
      paradigms.set(row.verbId, byScreeve);
    }
    (byScreeve[row.screeve] ??= {})[row.person as PersonKey] = row.form;
  }

  const verbs: KaVerb[] = verbRows.map(row => {
    const byScreeve = paradigms.get(row.id) ?? {};
    const { imperative, prohibitive, ...screeveForms } = byScreeve;
    return {
      id: row.id,
      english: row.english,
      senses: row.senses,
      transitivity: row.transitivity,
      verbalNoun: row.verbalNoun,
      group: row.group,
      groupId: row.groupId ?? '',
      present3sg: row.present3sg,
      forms: screeveForms as KaVerb['forms'],
      imperative: imperative ?? null,
      prohibitive: prohibitive ?? null,
      url: row.url,
      synonymsEnglish: row.synonymsEnglish,
      synonymsGeorgian: row.synonymsGeorgian,
    };
  });

  const morphemes: KaMorphemeData = {
    note: meta.morphemes ?? '',
    source: meta.morphemesSource ?? '',
    // The three array fields are not treated alike, and that is not an oversight. The
    // segmenter writes `preverbs: []` for a verb that takes none, but leaves `roots` and
    // `preverbScreeves` out entirely rather than writing them empty. A jsonb column cannot
    // tell "absent" from "empty" on its own, so the distinction is restored here — checked
    // against all 599 entries by `npm run db:verify`, which is what caught it.
    verbs: Object.fromEntries(
      morphemeRows.map(row => [
        row.verbId,
        {
          root: row.root,
          ...(row.roots.length ? { roots: row.roots } : {}),
          ...(row.pfsf ? { pfsf: row.pfsf } : {}),
          preverbs: row.preverbs,
          ...(row.preverbScreeves.length ? { preverbScreeves: row.preverbScreeves } : {}),
          ...(row.version ? { version: row.version } : {}),
          parsed: row.parsed,
          ...(row.needsCheck ? { check: true } : {}),
        },
      ]),
    ),
  };

  return {
    kind: 'ka',
    source: meta.verbs ?? '',
    groups: groupRows.map(row => ({
      id: row.id,
      label: row.label,
      name: row.name,
      notes: row.notes,
      verbCount: row.verbCount,
    })),
    verbs,
    morphemes,
  };
}

/* ----------------------------------------------------------- Russian verbs */

async function assembleRuVerbs(meta: Record<string, string>): Promise<VerbContent> {
  const [verbRows, overrideRows] = await Promise.all([
    db.select().from(schema.ruVerbs).orderBy(asc(schema.ruVerbs.position)),
    db.select().from(schema.ruVerbForms),
  ]);

  // The exceptions, gathered per verb. Most verbs get an empty object here and are expanded
  // entirely by rule; быть gets one entry per cell and is expanded not at all.
  const overridesByVerb = new Map<string, Partial<Record<RuSlotKey, string>>>();
  for (const row of overrideRows) {
    const map = overridesByVerb.get(row.verbId) ?? {};
    map[row.slot] = row.form;
    overridesByVerb.set(row.verbId, map);
  }

  const verbs: RuVerb[] = verbRows.map(row => ({
    id: row.id,
    infinitive: row.infinitive,
    accented: row.accented,
    english: row.english,
    senses: row.senses,
    aspect: row.aspect as RuVerb['aspect'],
    pairId: row.pairId,
    classId: row.classId as RuVerb['classId'],
    stemPresent: row.stemPresent,
    stemPresent1sg: row.stemPresent1sg,
    stemImperative: row.stemImperative,
    stemPast: row.stemPast,
    stemPastM: row.stemPastM,
    stressPresent: row.stressPresent as RuVerb['stressPresent'],
    stressPast: row.stressPast as RuVerb['stressPast'],
    stemStress: row.stemStress,
    stressInfinitive: row.stressInfinitive,
    reflexive: row.reflexive,
    transitivity: row.transitivity,
    government: row.government,
    motion: row.motion,
    level: row.level as RuVerb['level'],
    overrides: overridesByVerb.get(row.id) ?? {},
    ...(row.needsCheck ? { check: true } : {}),
    ...(row.note ? { note: row.note } : {}),
  }));

  return { kind: 'ru', source: meta.verbs ?? '', verbs };
}

/* ------------------------------------------------------------ one story */

/**
 * One story, opened at one chapter.
 *
 * Only that chapter's prose and tokens are read. A story is a book now, and the alternative
 * — every chapter in one answer — would mean the reader waiting on chapter forty to paint
 * chapter one, and would put the whole of it through the cache for each page turn.
 *
 * A chapter past the end lands on the last one rather than failing. The number comes out of
 * a URL, and a bookmark to a chapter that has since been deleted should open the book.
 *
 * `viewer` decides one field, `mine`, and no more. This function polices nothing: it will
 * happily assemble a story belonging to somebody else, because the caller is the one that knows
 * whether it should have asked. See the `story` procedure, which refuses first and loads
 * second.
 */
export async function loadStory(id: string, chapter = 0, viewer: string | null = null): Promise<Story | null> {
  const [row] = await db.select().from(schema.stories).where(eq(schema.stories.id, id)).limit(1);
  if (!row) return null;

  const chapterRows = await db
    .select()
    .from(schema.storyChapters)
    .where(eq(schema.storyChapters.storyId, id))
    .orderBy(asc(schema.storyChapters.position));

  const chapters: StoryChapterSummary[] = chapterRows.map(entry => ({
    position: entry.position,
    title: entry.title,
    titleEnglish: entry.titleEnglish,
    paragraphs: entry.paragraphs.length,
    translated: entry.translation.length > 0,
    stats: entry.stats as StoryStats,
  }));

  const at = Math.min(Math.max(chapter, 0), Math.max(chapterRows.length - 1, 0));
  const open = chapterRows[at];

  const categoryName = row.categoryId
    ? (
        await db
          .select({ name: schema.storyCategories.name })
          .from(schema.storyCategories)
          .where(eq(schema.storyCategories.id, row.categoryId))
          .limit(1)
      )[0]?.name ?? ''
    : '';

  const tokenRows = open
    ? await db
        .select()
        .from(schema.storyTokens)
        .where(and(eq(schema.storyTokens.storyId, id), eq(schema.storyTokens.chapter, open.position)))
    : [];

  // One array per paragraph, each in reading order — a token's position in it is the
  // position of the word in the text, so the order is the data and cannot be left to chance.
  const tokens: StoryToken[][] = (open?.paragraphs ?? []).map(() => []);
  for (const token of tokenRows) {
    const paragraph = tokens[token.paragraph];
    if (!paragraph) continue;
    const out: StoryToken = { form: token.form, via: token.via };
    if (token.wordId) out.word = token.wordId;
    if (token.sense != null) out.sense = token.sense;
    if (token.gram) out.gram = token.gram;
    if (token.name) out.name = token.name;
    if (token.needsCheck) out.check = true;
    if (token.alts.length) out.alts = token.alts;
    if (token.comment) out.comment = token.comment;
    paragraph[token.position] = out;
  }

  return {
    note: row.note,
    id: row.id,
    lang: row.lang,
    title: row.title,
    titleEnglish: row.titleEnglish,
    level: row.level,
    source: row.source,
    categoryId: row.categoryId,
    category: categoryName,
    stats: row.stats as StoryStats,
    chapters,
    // Absent unless it really is this reader's, which is what puts the Edit button on the page.
    ...(row.ownerId && row.ownerId === viewer ? { mine: true } : {}),
    // Whatever was actually opened, not what was asked for. The reader corrects its URL
    // from this, so a request for chapter 9 of an eight-chapter story does not leave the
    // address bar claiming a chapter that is not on screen.
    chapter: open?.position ?? 0,
    chapterTitle: open?.title ?? '',
    chapterTitleEnglish: open?.titleEnglish ?? '',
    paragraphs: open?.paragraphs ?? [],
    translation: open?.translation ?? [],
    tokens,
  };
}

/* ------------------------------------------------------------ one lesson */

/**
 * One lesson, with its markup.
 *
 * The only thing this adds to what the snapshot already carries is `body` and `note`, and it is
 * a call of its own for that reason: a section of forty lessons would otherwise put forty
 * documents in a payload that draws a list of cards. The same division the stories and the
 * quizzes make.
 *
 * The summary half is worked out here rather than looked up in the cached snapshot, so that
 * this answers correctly for a language whose snapshot has not been assembled yet and cannot
 * disagree with itself about a lesson somebody has just saved.
 */
export async function loadLesson(id: string): Promise<Lesson | null> {
  const [row] = await db.select().from(schema.lessons).where(eq(schema.lessons.id, id)).limit(1);
  if (!row) return null;

  const names = new Map<string, string>();
  if (row.categoryId) {
    const [category] = await db
      .select({ name: schema.lessonCategories.name })
      .from(schema.lessonCategories)
      .where(eq(schema.lessonCategories.id, row.categoryId))
      .limit(1);
    if (category) names.set(row.categoryId, category.name);
  }

  return { ...summariseLesson(row, names), body: row.body, note: row.note };
}

/* -------------------------------------------------------- who may read what */

// Both dictionaries are open — ADMIN_ONLY_LANGS in grammar/index.ts is empty, so everything
// below is a pair of no-ops today. It stays because it is the half of the gate that cannot be
// done in the browser: the switcher merely stops *offering* an unreleased language, and
// without a refusal here "not offered" would mean nothing more than "not linked", with the
// whole dictionary one typed URL away. The next language to be built will want it.

/**
 * The language a story belongs to and whose it is, without assembling the story to find out.
 *
 * Both facts in one query because both are needed before a word of it is read: one decides
 * whether this dictionary is open to the caller, the other whether this *story* is.
 */
async function storyMeta(id: string): Promise<{ lang: Lang; ownerId: string | null } | null> {
  const [row] = await db
    .select({ lang: schema.stories.lang, ownerId: schema.stories.ownerId })
    .from(schema.stories)
    .where(eq(schema.stories.id, id))
    .limit(1);
  return row ?? null;
}

/** The same, for a lesson — asked before its body is read rather than after. */
async function lessonLang(id: string): Promise<Lang | null> {
  const [row] = await db
    .select({ lang: schema.lessons.lang })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, id))
    .limit(1);
  return row?.lang ?? null;
}

async function assertMayRead(lang: Lang, context: AppContext): Promise<void> {
  if (!isAdminOnlyLang(lang)) return;
  if (await isAdminSession(context)) return;
  throw new ORPCError('FORBIDDEN', { message: 'That dictionary is not open yet.' });
}

/** The switcher's list, with anything unreleased taken out for everybody but an admin. */
function visibleTo(all: Language[], admin: boolean): Language[] {
  return admin ? all : all.filter(entry => !isAdminOnlyLang(entry.id));
}

/* ---------------------------------------------------------------- routes */

export const contentRouter = os.content.router({
  version: os.content.version.handler(async ({ input, context }) => {
    await assertMayRead(input.lang, context);
    return { lang: input.lang, version: await currentVersion(input.lang) };
  }),

  snapshot: os.content.snapshot.handler(async ({ input, context }) => {
    const admin = await isAdminSession(context);
    if (isAdminOnlyLang(input.lang) && !admin) {
      throw new ORPCError('FORBIDDEN', { message: 'That dictionary is not open yet.' });
    }

    const version = await currentVersion(input.lang);
    if (input.known && input.known === version) {
      return { upToDate: true as const, lang: input.lang, version };
    }

    // Spread rather than mutated: the built snapshot is the cached one, shared by every
    // visitor, and only the language list differs between them. The copy is shallow, so the
    // megabytes underneath are not copied — only the handful of fields above them.
    const built = await snapshot(input.lang);
    return { upToDate: false as const, ...built, languages: visibleTo(built.languages, admin) };
  }),

  story: os.content.story.handler(async ({ input, context }) => {
    const story = await storyMeta(input.id);
    if (!story) return null;
    await assertMayRead(story.lang, context);

    // Somebody else's private story answers exactly as one that does not exist, and null
    // rather than FORBIDDEN is the point: a refusal would confirm that a story is filed under
    // that id, which is a thing about another person's library that this reader has no
    // business learning. The reader already renders "that story does not exist".
    const viewer = context.session?.user?.id ?? null;
    if (story.ownerId && story.ownerId !== viewer) return null;

    return loadStory(input.id, input.chapter, viewer);
  }),

  lesson: os.content.lesson.handler(async ({ input, context }) => {
    const lang = await lessonLang(input.id);
    if (!lang) return null;
    await assertMayRead(lang, context);
    return loadLesson(input.id);
  }),

  languages: os.content.languages.handler(async ({ context }) => ({
    languages: visibleTo(await listLanguages(), await isAdminSession(context)),
  })),
});
