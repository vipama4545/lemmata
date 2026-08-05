// The dictionary, on its way out.
//
// The whole of it goes in one response. That is a deliberate choice rather than a shortcut:
// the app searches 2,096 words as you type, paints 976 tokens of a story at once and filters
// a 2,500-item deck, and none of that survives a round trip per lookup. It used to be
// bundled into the JavaScript, so the bytes are not new — what is new is that they now come
// from a database that can be corrected without a redeploy.
//
// Two things keep that affordable. The assembled snapshot is built once and held in memory,
// because it is the same for every visitor and only changes when the seed runs. And the
// client sends the version it already has, so every visit after the first transfers a
// version string and nothing else.

import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type {
  Category,
  ImageMap,
  MorphemeData,
  PersonKey,
  Sense,
  Story,
  StorySummary,
  StoryToken,
  Verb,
  Word,
  WordData,
  WordForm,
} from '@georgian/shared/types';
import type { ContentSnapshot, VerbContent } from '@georgian/shared/contract';
import { db, schema } from '../db/index.ts';
import type { Tx } from '../db/index.ts';
import { os } from './base.ts';

/* --------------------------------------------------------------- the cache */

let cached: ContentSnapshot | null = null;
let building: Promise<ContentSnapshot> | null = null;

/** The version on its own — one cheap row, and the only thing most requests need. */
async function currentVersion(): Promise<string> {
  const [row] = await db
    .select({ version: schema.contentVersion.version })
    .from(schema.contentVersion)
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
async function snapshot(): Promise<ContentSnapshot> {
  const version = await currentVersion();
  if (cached?.version === version) return cached;
  if (building) return building;

  building = assemble(version).then(
    built => {
      cached = built;
      building = null;
      return built;
    },
    error => {
      building = null;
      throw error;
    },
  );

  return building;
}

// There is deliberately no way to invalidate the cache by hand. It is keyed on the version
// the database reports, and both writers bump that as their last act, so a running server
// picks up new data on the next request without being told and without being restarted.

/**
 * Marks the content as changed, from the last statement of an edit.
 *
 * This one line is the whole of cache invalidation for the admin screens. The server's
 * snapshot is keyed on the version, so a new one rebuilds it on the next request; the
 * browser sends the version it holds, so a new one means it is sent the dictionary again
 * instead of the 55-byte "still current". Nothing else has to know an edit happened.
 *
 * `source` goes to 'admin', which is what `npm run db:seed` looks at before replacing these
 * tables with the contents of data/*.json — see the guard there, and `npm run db:export` for
 * the way back. The version itself is random rather than a digest of the content: the seed's
 * digest exists so re-running it over unchanged files leaves cached snapshots valid, and an
 * edit by definition changed something.
 *
 * Call it inside the same transaction as the write. Bumping the version first, or in a
 * transaction of its own, would let a reader see the new version and then the old rows.
 */
export async function bumpContentVersion(tx: Tx): Promise<string> {
  const version = randomUUID().replaceAll('-', '').slice(0, 16);
  await tx
    .insert(schema.contentVersion)
    .values({ id: 1, version, source: 'admin', builtAt: new Date() })
    .onConflictDoUpdate({
      target: schema.contentVersion.id,
      set: { version, source: 'admin', builtAt: new Date() },
    });
  return version;
}

/**
 * A fresh build, straight from the tables. What `npm run db:verify` compares against the
 * generated files — the assembly has to be the real one for that check to mean anything.
 */
export function buildSnapshotFromDatabase(): Promise<ContentSnapshot> {
  return currentVersion().then(assemble);
}

/* ------------------------------------------------------------- assembling */

async function assemble(version: string): Promise<ContentSnapshot> {
  // One round trip each, in parallel. Grouping happens below, in JavaScript: Postgres could
  // do it with json_agg, but then the shape of the response would live in a SQL string
  // instead of in the types, and this runs once per deploy.
  const [
    metaRow,
    categoryRows,
    wordRows,
    senseRows,
    formRows,
    groupRows,
    verbRows,
    verbFormRows,
    morphemeRows,
    imageRows,
    storyRows,
  ] = await Promise.all([
    db.select().from(schema.contentVersion).limit(1),
    // Ordered explicitly, everywhere it is an array on the way out. A table has no order of
    // its own, and the order these had in the generated files is meaningful — see the note
    // on `categories` in the schema.
    db.select().from(schema.categories).orderBy(asc(schema.categories.position)),
    db.select().from(schema.words).orderBy(asc(schema.words.position)),
    db.select().from(schema.wordSenses).orderBy(asc(schema.wordSenses.position)),
    db.select().from(schema.wordForms).orderBy(asc(schema.wordForms.position)),
    db.select().from(schema.verbGroups).orderBy(asc(schema.verbGroups.position)),
    db.select().from(schema.verbs).orderBy(asc(schema.verbs.position)),
    db.select().from(schema.verbForms),
    db.select().from(schema.verbMorphemes),
    db.select().from(schema.images),
    db.select().from(schema.stories).orderBy(asc(schema.stories.id)),
  ]);

  const meta = metaRow[0]?.meta ?? {};

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
    list.push(form);
    formsByWord.set(row.wordId, list);
  }

  const words: Word[] = wordRows.map(row => {
    const senses = sensesByWord.get(row.id) ?? [];
    const forms = formsByWord.get(row.id);
    const word: Word = {
      id: row.id,
      georgian: row.georgian,
      english: row.english,
      // Exactly the senses as plain text — checked against the generated file, where the
      // two never disagree — so it is derived here rather than stored twice.
      englishFull: senses.map(sense => sense.english),
      georgianDefinition: row.georgianDefinition,
      level: row.level as Word['level'],
      partOfSpeech: row.partOfSpeech,
      category: row.category,
      categoryId: row.categoryId,
      origin: row.origin as Word['origin'],
      senses,
    };
    if (row.defaultSense != null) word.defaultSense = row.defaultSense;
    if (row.verbId) word.verbId = row.verbId;
    if (forms?.length) word.forms = forms;
    if (row.needsCheck) word.check = true;
    if (row.note) word.note = row.note;
    return word;
  });

  const categories: Category[] = categoryRows.map(row => ({
    id: row.id,
    name: row.name,
    nameGeorgian: row.nameGeorgian,
    wordCount: row.wordCount,
  }));

  const wordData: WordData = { note: meta.words ?? '', categories, words };

  /* -- verbs ------------------------------------------------------------- */

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

  const verbs: Verb[] = verbRows.map(row => {
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
      forms: screeveForms as Verb['forms'],
      imperative: imperative ?? null,
      prohibitive: prohibitive ?? null,
      url: row.url,
      synonymsEnglish: row.synonymsEnglish,
      synonymsGeorgian: row.synonymsGeorgian,
    };
  });

  const verbDataOut: VerbContent = {
    source: meta.verbs ?? '',
    groups: groupRows.map(row => ({
      id: row.id,
      label: row.label,
      name: row.name,
      notes: row.notes,
      verbCount: row.verbCount,
    })),
    verbs,
  };

  /* -- morphemes, images ------------------------------------------------- */

  const morphemes: MorphemeData = {
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

  const images: ImageMap = {};
  const categoryImages: ImageMap = {};
  for (const row of imageRows) {
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
    title: row.title,
    titleEnglish: row.titleEnglish,
    level: row.level,
    source: row.source,
    stats: row.stats as Story['stats'],
    translated: row.translation.length > 0,
    excerpt: row.paragraphs[0] ?? '',
  }));

  return {
    version,
    words: wordData,
    verbs: verbDataOut,
    morphemes,
    images,
    categoryImages,
    stories,
  };
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

/* ---------------------------------------------------------------- routes */

export const contentRouter = os.content.router({
  version: os.content.version.handler(async () => ({ version: await currentVersion() })),

  snapshot: os.content.snapshot.handler(async ({ input }) => {
    const version = await currentVersion();
    if (input.known && input.known === version) {
      return { upToDate: true as const, version };
    }
    return { upToDate: false as const, ...(await snapshot()) };
  }),

  story: os.content.story.handler(({ input }) => loadStory(input.id)),
});
