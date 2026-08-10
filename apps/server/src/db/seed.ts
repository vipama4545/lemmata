// Loads the generated files under data/<lang>/ into Postgres.
//
//     npm run db:seed [-- --lang ka] [-- --force]
//
// With no --lang it seeds every language that has a directory under data/. With one it seeds
// that language and leaves the others exactly as they stand.
//
// **Nothing here deletes anything.** Every table is an upsert: a row that is new is inserted,
// a row that already exists is brought up to date, and a row the files no longer mention is
// left alone. Adding Russian therefore cannot touch a Georgian row even by accident, and
// re-running a seed is safe at any moment rather than a window during which the app has no
// content to serve.
//
// The cost of that is worth stating plainly, because it is the one thing this cannot do: a
// word removed from words.json keeps its row. The seed says what exists, never what has
// stopped existing, so retiring an entry is a job for the admin screens.
//
// The content tables may also hold work that exists nowhere else, since the admin screens.
// An upsert still overwrites that, so the guard is unchanged:
//
//   `content_version.source` is 'seed' after this runs and 'admin' after any edit in the
//   browser. Finding 'admin' means the tables and data/<lang>/*.json have diverged and the
//   files are the older of the two. `npm run db:export` is the way to reconcile them;
//   --force is the way to say the files are right and the edits are not wanted.
//
// The authoring pipeline itself has not changed: the scripts under scripts/ still turn the
// spreadsheet, the scrape and the hand-written lexicon into data/ka/*.json.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableColumns, inArray, sql as raw } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { LANGS, LANG_LABELS, isLang } from '@georgian/shared/grammar';
import { RU_CLASS_BY_ID, RU_SLOT_KEYS } from '@georgian/shared/grammar/ru';
import type {
  ImageMap,
  KaMorphemeData,
  KaVerbData,
  Lang,
  RuSlotKey,
  RuVerbData,
  Story,
  WordData,
} from '@georgian/shared/types';
import { db, schema, sql } from './index.ts';

const DATA = fileURLToPath(new URL('../../../../data/', import.meta.url));

function read<T>(lang: Lang, name: string): T {
  return JSON.parse(readFileSync(`${DATA}${lang}/${name}`, 'utf-8')) as T;
}

function has(lang: Lang, name: string): boolean {
  return existsSync(`${DATA}${lang}/${name}`);
}

/** The thing you can run statements on inside `db.transaction`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every column but the key ones, set to whatever the row being inserted carries.
 *
 * Derived from the table rather than written out per call, because writing it out is thirty
 * lines that have to be edited every time a column is added — and the failure mode of
 * forgetting is a column that silently stops being updated by the seed.
 */
function overwriteAll<T extends PgTable>(table: T, keys: string[]): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (keys.includes(property)) continue;
    set[property] = raw`excluded.${raw.identifier(column.name)}`;
  }
  return set;
}

/**
 * Rows go in in batches, because postgres.js binds one parameter per column per row and a
 * statement may carry 65,535 of them. 2,000 rows is comfortably under that for the widest
 * table here and still turns 44,000 verb forms into 22 statements rather than 44,000.
 *
 * An upsert, never a delete. Loading a language adds its rows and updates the ones already
 * there, and touches nothing else — so seeding Russian cannot cost anybody their Georgian
 * dictionary even by accident, and re-running a seed is safe at any moment rather than a
 * window during which the app has no content.
 *
 * The cost of that is real and worth stating: nothing here *removes* anything. A word deleted
 * from words.json keeps its row, its senses and its images until somebody deletes it through
 * the admin screens. The seed can only ever say what exists, not what no longer does.
 */
async function upsertAll<T extends PgTable>(
  tx: Tx,
  label: string,
  table: T,
  rows: InferInsertModel<T>[],
  keys: string[],
  size = 2_000,
): Promise<void> {
  if (!rows.length) return;
  const target = keys.map(key => getTableColumns(table)[key]!);
  const set = overwriteAll(table, keys);

  for (let index = 0; index < rows.length; index += size) {
    await tx
      .insert(table)
      .values(rows.slice(index, index + size))
      .onConflictDoUpdate({ target, set });
  }
  console.log(`  ${label.padEnd(16)} ${rows.length}`);
}

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const force = argv.includes('--force');

function requestedLangs(): Lang[] | string {
  const at = argv.findIndex(a => a === '--lang' || a.startsWith('--lang='));
  if (at < 0) return LANGS.filter(lang => existsSync(`${DATA}${lang}`));
  const value = argv[at]!.includes('=') ? argv[at]!.split('=')[1]! : argv[at + 1];
  return isLang(value) ? [value] : (value ?? '(nothing)');
}

const requested = requestedLangs();

if (typeof requested === 'string') {
  console.error(`--lang must be one of ${LANGS.join(', ')}; got ${requested}`);
  await sql.end({ timeout: 5 });
  process.exit(1);
}

const wanted = requested;

if (!wanted.length) {
  console.error(`No data directories found. Expected at least one of ${LANGS.map(l => `data/${l}/`).join(', ')}`);
  await sql.end({ timeout: 5 });
  process.exit(1);
}

/* ------------------------------------------------------------------ guard */

// Read before anything is written. Nothing below removes a row, but an upsert over an edited
// one still replaces what somebody typed, which is the thing this guard is about.
const live = await db
  .select({
    lang: schema.contentVersion.lang,
    version: schema.contentVersion.version,
    source: schema.contentVersion.source,
  })
  .from(schema.contentVersion)
  .where(inArray(schema.contentVersion.lang, wanted));

const edited = live.filter(row => row.source === 'admin');

if (edited.length && !force) {
  console.error(
    `The ${edited.map(r => r.lang).join(' and ')} content in this database has been edited through the\n` +
      'admin screens, so data/<lang>/*.json is now the older copy. Seeding would replace the\n' +
      'edits with it.\n\n' +
      '  npm run db:export     write the database back out to data/, keeping the edits\n' +
      '  npm run db:seed -- --force   replace the edits with what is in data/\n',
  );
  await sql.end({ timeout: 5 });
  process.exit(1);
}

if (edited.length) {
  console.warn(`Replacing edited ${edited.map(r => r.lang).join(' and ')} content, as --force was given.\n`);
}

/* ------------------------------------------------------------------ write */

// The languages themselves, from the compile-time list rather than from any file: a language
// exists when there is code that knows how to render its verbs, which is what `Lang` records.
// See the head of grammar/index.ts.
await db
  .insert(schema.languages)
  .values(
    LANGS.map((id, position) => ({
      id,
      position,
      name: LANG_LABELS[id].name,
      nativeName: LANG_LABELS[id].nativeName,
      script: LANG_LABELS[id].script,
      enabled: true,
    })),
  )
  .onConflictDoUpdate({
    target: schema.languages.id,
    set: {
      name: raw`excluded.name`,
      nativeName: raw`excluded.native_name`,
      script: raw`excluded.script`,
    },
  });

for (const lang of wanted) await seedLanguage(lang);

console.log('\nDone.');
await sql.end({ timeout: 5 });

/* ------------------------------------------------------------- one language */

async function seedLanguage(lang: Lang): Promise<void> {
  const words = read<WordData>(lang, 'words.json');
  const images = has(lang, 'images.json') ? read<ImageMap>(lang, 'images.json') : {};
  const categoryImages = has(lang, 'categoryImages.json')
    ? read<ImageMap>(lang, 'categoryImages.json')
    : {};

  const storyDir = `${DATA}${lang}/stories`;
  const stories = existsSync(storyDir)
    ? readdirSync(storyDir)
        .filter(name => name.endsWith('.json'))
        .map(name => read<Story>(lang, `stories/${name}`))
    : [];

  const kaVerbs = lang === 'ka' ? read<KaVerbData>(lang, 'verbs.json') : null;
  const kaMorphemes = lang === 'ka' ? read<KaMorphemeData>(lang, 'verbMorphemes.json') : null;
  const ruVerbs = lang === 'ru' ? read<RuVerbData>(lang, 'verbs.json') : null;

  /**
   * The version the client caches against: a digest of exactly what went in.
   *
   * Content-addressed rather than a timestamp, so re-running the seed over unchanged files
   * leaves every browser's cached snapshot valid. That matters more than it sounds — a seed
   * is the sort of thing that gets run twice while someone is checking whether it worked.
   */
  const version = createHash('sha256')
    .update(JSON.stringify([words, kaVerbs, kaMorphemes, ruVerbs, images, categoryImages, stories]))
    .digest('hex')
    .slice(0, 16);

  console.log(`\nSeeding ${lang} — content version ${version}`);

  /* -- rows ------------------------------------------------------------- */

  const categoryRows = words.categories.map((category, index) => ({
    id: category.id,
    lang,
    position: index,
    name: category.name,
    nameNative: category.nameNative ?? '',
    wordCount: category.wordCount ?? 0,
  }));

  const wordRows = words.words.map((word, index) => ({
    id: word.id,
    lang,
    position: index,
    headword: word.headword,
    accented: word.accented ?? '',
    english: word.english ?? '',
    definition: word.definition ?? '',
    level: word.level ?? '',
    partOfSpeech: word.partOfSpeech ?? '',
    category: word.category ?? '',
    categoryId: word.categoryId,
    origin: word.origin ?? 'core',
    defaultSense: word.defaultSense ?? null,
    verbId: word.verbId ?? null,
    needsCheck: word.check === true,
    note: word.note ?? null,
  }));

  const senseRows = words.words.flatMap(word =>
    (word.senses ?? []).map((sense, index) => ({
      wordId: word.id,
      position: index + 1,
      english: sense.english,
    })),
  );

  const wordFormRows = words.words.flatMap(word =>
    (word.forms ?? []).map((form, index) => ({
      wordId: word.id,
      position: index + 1,
      form: form.form,
      gram: form.gram ?? null,
      english: form.english ?? null,
      accented: form.accented ?? '',
    })),
  );

  const ruGrammarRows = words.words
    .filter(word => word.ru != null)
    .map(word => ({
      wordId: word.id,
      gender: word.ru!.gender ?? null,
      animacy: word.ru!.animacy ?? null,
      declension: word.ru!.declension ?? null,
      stressPattern: word.ru!.stressPattern ?? null,
      needsCheck: word.ru!.check === true,
    }));

  const knownWords = new Set(wordRows.map(word => word.id));

  function imageRowsFor(kind: 'word' | 'category', map: ImageMap) {
    return Object.entries(map)
      .filter(([, info]) => info != null)
      .map(([subjectId, info]) => ({
        kind,
        subjectId,
        url: info!.url,
        width: info!.width ?? 0,
        height: info!.height ?? 0,
        title: info!.title ?? '',
        page: info!.page ?? '',
        author: info!.author ?? '',
        license: info!.license ?? '',
        licenseUrl: info!.licenseUrl ?? '',
      }));
  }

  const imageRows = [...imageRowsFor('word', images), ...imageRowsFor('category', categoryImages)];

  const storyRows = stories.map(story => ({
    id: story.id,
    lang,
    title: story.title,
    titleEnglish: story.titleEnglish ?? '',
    level: story.level ?? '',
    source: story.source ?? '',
    note: story.note ?? '',
    stats: (story.stats ?? {}) as Record<string, number>,
    paragraphs: story.paragraphs ?? [],
    translation: story.translation ?? [],
  }));

  const storyTokenRows = stories.flatMap(story =>
    (story.tokens ?? []).flatMap((paragraph, paragraphIndex) =>
      paragraph.map((token, position) => ({
        storyId: story.id,
        paragraph: paragraphIndex,
        position,
        form: token.form,
        // A token may cite a word the lexicon no longer has, if a story was built against an
        // older one. Better a token with no link than a seed that will not run.
        wordId: token.word && knownWords.has(token.word) ? token.word : null,
        sense: token.sense ?? null,
        gram: token.gram ?? null,
        name: token.name ?? null,
        via: token.via ?? '',
        needsCheck: token.check === true,
        alts: token.alts ?? [],
        comment: token.comment ?? null,
      })),
    ),
  );

  const droppedTokenLinks = stories
    .flatMap(story => story.tokens ?? [])
    .flat()
    .filter(token => token.word && !knownWords.has(token.word)).length;

  /* -- Georgian paradigms ----------------------------------------------- */

  const groupRows = (kaVerbs?.groups ?? []).map((group, index) => ({
    id: group.id,
    position: index,
    label: group.label,
    name: group.name ?? '',
    notes: group.notes ?? [],
    verbCount: group.verbCount ?? 0,
  }));

  const knownGroups = new Set(groupRows.map(group => group.id));

  const kaVerbRows = (kaVerbs?.verbs ?? []).map((verb, index) => ({
    id: verb.id,
    position: index,
    english: verb.english ?? '',
    senses: verb.senses ?? [],
    transitivity: verb.transitivity ?? '',
    verbalNoun: verb.verbalNoun ?? '',
    group: verb.group ?? '',
    // A paradigm whose group is not one of the sixteen keeps its display label above and
    // simply has no group row to point at, rather than failing the whole seed.
    groupId: verb.groupId && knownGroups.has(verb.groupId) ? verb.groupId : null,
    present3sg: verb.present3sg ?? '',
    url: verb.url ?? '',
    synonymsEnglish: verb.synonymsEnglish ?? [],
    synonymsGeorgian: verb.synonymsGeorgian ?? [],
  }));

  // Every cell of every paradigm, flattened. The imperative and prohibitive go in under those
  // names alongside the eleven real screeves; the assembly lifts them back out into their own
  // fields, because they are not screeves and the grammar page must not list them as such.
  //
  // A blank cell is kept, not skipped. 245 of these hold the empty string rather than being
  // absent, and the two are not the same claim: a screeve listing all six persons with three
  // of them blank is a paradigm the spreadsheet has a gap in, while a screeve missing those
  // persons is one that does not inflect for them. Dropping the blanks would quietly turn the
  // first into the second, and break the promise types.ts makes that every screeve table holds
  // all six persons.
  const kaVerbFormRows = (kaVerbs?.verbs ?? []).flatMap(verb => {
    const rows: { verbId: string; screeve: string; person: string; form: string }[] = [];

    for (const [screeve, forms] of Object.entries(verb.forms ?? {})) {
      for (const [person, form] of Object.entries(forms ?? {})) {
        if (form != null) rows.push({ verbId: verb.id, screeve, person, form });
      }
    }
    for (const [screeve, forms] of [
      ['imperative', verb.imperative],
      ['prohibitive', verb.prohibitive],
    ] as const) {
      for (const [person, form] of Object.entries(forms ?? {})) {
        if (form != null) rows.push({ verbId: verb.id, screeve, person, form });
      }
    }

    return rows;
  });

  const knownKaVerbs = new Set(kaVerbRows.map(verb => verb.id));

  const morphemeRows = Object.entries(kaMorphemes?.verbs ?? {})
    .filter(([verbId, entry]) => entry != null && knownKaVerbs.has(verbId))
    .map(([verbId, entry]) => ({
      verbId,
      root: entry!.root,
      roots: entry!.roots ?? [],
      pfsf: entry!.pfsf ?? null,
      preverbs: entry!.preverbs ?? [],
      preverbScreeves: entry!.preverbScreeves ?? [],
      version: entry!.version ?? null,
      parsed: entry!.parsed ?? 0,
      needsCheck: entry!.check === true,
    }));

  /* -- Russian rules ----------------------------------------------------- */

  const ruVerbList = ruVerbs?.verbs ?? [];
  const knownRuVerbs = new Set(ruVerbList.map(verb => verb.id));

  // Two things the files could get wrong that nothing downstream would survive: a class that
  // no rule exists for, and a slot the engine has never heard of. Both are caught here rather
  // than left to produce a verb whose paradigm is quietly empty.
  const badClasses = ruVerbList.filter(verb => !RU_CLASS_BY_ID.has(verb.classId));
  if (badClasses.length) {
    throw new Error(
      `data/${lang}/verbs.json: ${badClasses.length} verb(s) claim a conjugation class that does not exist: ` +
        badClasses.map(v => `${v.infinitive} (${v.classId})`).join(', '),
    );
  }

  const slotKeys = new Set<string>(RU_SLOT_KEYS);
  const ruVerbRows = ruVerbList.map((verb, index) => ({
    id: verb.id,
    position: index,
    infinitive: verb.infinitive,
    accented: verb.accented ?? '',
    english: verb.english ?? '',
    senses: verb.senses ?? [],
    aspect: verb.aspect,
    // A pair pointing at a verb this file does not contain is dropped rather than left
    // dangling: the column has no foreign key, so nothing else would catch it.
    pairId: verb.pairId && knownRuVerbs.has(verb.pairId) ? verb.pairId : null,
    classId: verb.classId,
    stemPresent: verb.stemPresent ?? '',
    stemPresent1sg: verb.stemPresent1sg ?? null,
    stemImperative: verb.stemImperative ?? null,
    stemPast: verb.stemPast ?? null,
    stemPastM: verb.stemPastM ?? null,
    stressPresent: verb.stressPresent ?? 'stem',
    stressPast: verb.stressPast ?? 'stem',
    stemStress: verb.stemStress ?? null,
    stressInfinitive: verb.stressInfinitive ?? null,
    reflexive: verb.reflexive === true,
    transitivity: verb.transitivity ?? '',
    government: verb.government ?? [],
    motion: verb.motion ?? '',
    level: verb.level ?? '',
    needsCheck: verb.check === true,
    note: verb.note ?? null,
  }));

  // An empty form is kept, not skipped, and this is load-bearing: it is how the data says
  // "this verb has no such form". мочь has no imperative and ждать no present gerund, and
  // nothing in the rules could know that — so the row exists and holds the empty string, and
  // `conjugate` reads it as a deletion. Dropping these here would put можи and ждя back.
  const ruOverrideRows = ruVerbList.flatMap(verb =>
    Object.entries(verb.overrides ?? {}).map(([slot, form]) => {
      if (!slotKeys.has(slot)) {
        throw new Error(`data/${lang}/verbs.json: ${verb.infinitive} overrides "${slot}", which is not a slot`);
      }
      return { verbId: verb.id, slot: slot as RuSlotKey, form, accented: '' };
    }),
  );

  /* -- write ------------------------------------------------------------- */

  // One transaction for the lot, and not a single delete in it. Parents before children, so
  // that a foreign key never points at a row that has not been written yet — which is the only
  // ordering constraint left once nothing is being removed.
  //
  // A reader arriving halfway through sees the previous content rather than a half-loaded
  // dictionary, and a seed that fails on the last table leaves the previous version serving.
  await db.transaction(async tx => {
    await upsertAll(tx, 'categories', schema.categories, categoryRows, ['id']);
    if (lang === 'ka') {
      await upsertAll(tx, 'verb groups', schema.kaVerbGroups, groupRows, ['id']);
      await upsertAll(tx, 'verbs', schema.kaVerbs, kaVerbRows, ['id']);
      await upsertAll(tx, 'verb forms', schema.kaVerbForms, kaVerbFormRows, ['verbId', 'screeve', 'person'], 5_000);
      await upsertAll(tx, 'morphemes', schema.kaVerbMorphemes, morphemeRows, ['verbId']);
    }
    if (lang === 'ru') {
      await upsertAll(tx, 'verb rules', schema.ruVerbs, ruVerbRows, ['id']);
      await upsertAll(tx, 'verb overrides', schema.ruVerbForms, ruOverrideRows, ['verbId', 'slot']);
    }
    await upsertAll(tx, 'words', schema.words, wordRows, ['id']);
    await upsertAll(tx, 'senses', schema.wordSenses, senseRows, ['wordId', 'position']);
    await upsertAll(tx, 'word forms', schema.wordForms, wordFormRows, ['wordId', 'position']);
    await upsertAll(tx, 'noun grammar', schema.ruWordGrammar, ruGrammarRows, ['wordId']);
    await upsertAll(tx, 'images', schema.images, imageRows, ['kind', 'subjectId']);
    await upsertAll(tx, 'stories', schema.stories, storyRows, ['id']);
    await upsertAll(tx, 'story tokens', schema.storyTokens, storyTokenRows, ['storyId', 'paragraph', 'position'], 5_000);

    // Last, and on purpose: the version is what a running server compares its cached snapshot
    // against, so a reader must not be able to see the new version before the rows behind it.
    await tx
      .insert(schema.contentVersion)
      .values({
        lang,
        version,
        // Back to 'seed': the tables and data/<lang>/*.json agree again, so the guard above
        // has nothing to stop until somebody edits something in the browser.
        source: 'seed',
        meta: {
          words: words.note ?? '',
          verbs: (kaVerbs?.source ?? ruVerbs?.source) ?? '',
          morphemes: kaMorphemes?.note ?? '',
          morphemesSource: kaMorphemes?.source ?? '',
        },
      })
      .onConflictDoUpdate({
        target: schema.contentVersion.lang,
        set: { version, source: 'seed', builtAt: new Date(), meta: raw`excluded.meta` },
      });
  });

  if (droppedTokenLinks > 0) {
    console.warn(
      `\n  ${droppedTokenLinks} story token(s) cite a word id the lexicon no longer has; ` +
        'their links were dropped. Re-run `npm run build:data` to rebuild the stories.',
    );
  }
}
