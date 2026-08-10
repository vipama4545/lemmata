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

import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/server';
import { asc, eq, inArray } from 'drizzle-orm';
import type {
  Category,
  ImageMap,
  KaMorphemeData,
  KaVerb,
  Lang,
  Language,
  PersonKey,
  RuSlotKey,
  RuVerb,
  Sense,
  Story,
  StorySummary,
  StoryToken,
  Word,
  WordData,
  WordForm,
} from '@georgian/shared/types';
import type { ContentSnapshot, VerbContent } from '@georgian/shared/contract';
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
  const [metaRow, languageRows, categoryRows, wordRows, storyRows] = await Promise.all([
    db.select().from(schema.contentVersion).where(eq(schema.contentVersion.lang, lang)).limit(1),
    db.select().from(schema.languages).orderBy(asc(schema.languages.position)),
    // Ordered explicitly, everywhere it is an array on the way out. A table has no order of
    // its own, and the order these had in the generated files is meaningful — see the note
    // on `categories` in the schema.
    db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.lang, lang))
      .orderBy(asc(schema.categories.position)),
    db.select().from(schema.words).where(eq(schema.words.lang, lang)).orderBy(asc(schema.words.position)),
    db.select().from(schema.stories).where(eq(schema.stories.lang, lang)).orderBy(asc(schema.stories.id)),
  ]);

  const meta = metaRow[0]?.meta ?? {};
  const wordIds = wordRows.map(row => row.id);

  // The children of the rows above. Fetched in a second round rather than joined, and scoped
  // by the ids just found: `word_senses` has no `lang` of its own, and getting one would mean
  // a column that could disagree with the word it hangs off.
  const [senseRows, formRows, ruGrammarRows, imageRows] = await Promise.all([
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
  ]);

  /* -- words ------------------------------------------------------------- */

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

  const words: Word[] = wordRows.map(row => {
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

  const categories: Category[] = categoryRows.map(row => ({
    id: row.id,
    lang: row.lang,
    name: row.name,
    nameNative: row.nameNative,
    wordCount: row.wordCount,
  }));

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

  const stories: StorySummary[] = storyRows.map(row => ({
    note: row.note,
    id: row.id,
    lang: row.lang,
    title: row.title,
    titleEnglish: row.titleEnglish,
    level: row.level,
    source: row.source,
    stats: row.stats as Story['stats'],
    translated: row.translation.length > 0,
    excerpt: row.paragraphs[0] ?? '',
  }));

  const languages: Language[] = languageRows.map(row => ({
    id: row.id,
    name: row.name,
    nativeName: row.nativeName,
    script: row.script,
    enabled: row.enabled,
  }));

  return { version, lang, languages, words: wordData, verbs, images, categoryImages, stories };
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

export async function loadStory(id: string): Promise<Story | null> {
  const [row] = await db.select().from(schema.stories).where(eq(schema.stories.id, id)).limit(1);
  if (!row) return null;

  const tokenRows = await db
    .select()
    .from(schema.storyTokens)
    .where(eq(schema.storyTokens.storyId, id));

  // One array per paragraph, each in reading order — a token's position in it is the
  // position of the word in the text, so the order is the data and cannot be left to chance.
  const tokens: StoryToken[][] = row.paragraphs.map(() => []);
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
    stats: row.stats as Story['stats'],
    paragraphs: row.paragraphs,
    translation: row.translation,
    tokens,
  };
}

/* -------------------------------------------------------- who may read what */

// Russian is not released yet — see ADMIN_ONLY_LANGS in grammar/index.ts. The switcher does
// not offer it, and this is the other half of that: hidden in the browser, refused here, the
// same division the admin screens use. Without it "not offered" would mean nothing more than
// "not linked", and the whole dictionary would be one typed URL away.

/** The language a story belongs to, without assembling the story to find out. */
async function storyLang(id: string): Promise<Lang | null> {
  const [row] = await db
    .select({ lang: schema.stories.lang })
    .from(schema.stories)
    .where(eq(schema.stories.id, id))
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
    const lang = await storyLang(input.id);
    if (!lang) return null;
    await assertMayRead(lang, context);
    return loadStory(input.id);
  }),

  languages: os.content.languages.handler(async ({ context }) => ({
    languages: visibleTo(await listLanguages(), await isAdminSession(context)),
  })),
});
