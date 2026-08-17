// The dictionary, once it has arrived.
//
// This app used to `import wordData from './data/words.json'`, which meant every module
// could hold a derived index in a module-level const: the data was there before any code
// ran. Now it arrives over the network, and that guarantee is gone.
//
// Rather than make every consumer async, the whole app is mounted *after* the snapshot has
// loaded — see boot.tsx. Everything below is then a plain synchronous read, exactly as
// before, and the one rule is that nothing may call these at module scope. `derived()` is
// what makes that easy to obey: it takes the build of an index and defers it to first use,
// then holds it until the content itself changes.
//
// Since readers gained a library of their own there are two things arriving rather than one,
// and this file is where they are put together. What the app reads is neither of them on its
// own: it is `snapshot`, composed from the published dictionary and this reader's private
// overlay by `compose()` below. Everything downstream (the search index, the deck, the category
// grid, the export) then works on a word without asking whose it is, which is why private
// vocabulary needed no changes in any of those places. See the note on `compose`.

import { useSyncExternalStore } from 'react';
import type { ContentSnapshot, KaVerbContent, PrivateContent, RuVerbContent } from '@georgian/shared/contract';
import { DEFAULT_LANG, LANG_LABELS, type Lang } from '@georgian/shared/grammar';
import { PERSONS, SCREEVES, SERIES } from '@georgian/shared/grammar/ka';
import type {
  Category,
  ImageMap,
  KaVerb,
  KaVerbData,
  KaVerbGroup,
  Language,
  LessonCategory,
  LessonImageMap,
  LessonSection,
  LessonSummary,
  QuizCategory,
  QuizSummary,
  StoryCategory,
  StorySummary,
  Word,
  WordData,
} from '@georgian/shared/types';
import { api } from '../api/client';
import * as cache from './cache';
import { currentLang, rememberLang, swapLang } from './lang';

/** The published dictionary, exactly as the server sent it. What the cache holds. */
let base: ContentSnapshot | null = null;

/** This reader's own stories and words, or null when signed out. Never cached. */
let overlay: PrivateContent | null = null;

/** The two together. What every screen in the app reads. */
let snapshot: ContentSnapshot | null = null;

/**
 * The loaded snapshot.
 *
 * Throws rather than returning null, because there is no sensible thing for a component to
 * render without it and a null check at 300 call sites would be noise around a case that
 * cannot happen: the router is not mounted until this is set.
 */
export function content(): ContentSnapshot {
  if (!snapshot) {
    throw new Error('The dictionary has not loaded yet. Nothing may read it at module scope.');
  }
  return snapshot;
}

/**
 * The published dictionary and the reader's own, as one object.
 *
 * A composed copy rather than a merge in place, and rather than a second store every consumer
 * has to remember to consult. Three things fall out of doing it here:
 *
 *   Nothing downstream changes. `wordData().words` is every word this reader has, their own
 *   included, so the search box, the flashcard deck, the Anki export and the category grid
 *   picked up private vocabulary without a line of code in any of them.
 *
 *   Every derived index rebuilds by itself. `derived()` keys on the *identity* of this object,
 *   so composing a new one is the whole of invalidation. See the note there.
 *
 *   The cache stays clean. `cache.write` is only ever given `base`, so a browser that syncs a
 *   snapshot to IndexedDB is not quietly storing somebody's private notebook in it.
 *
 * The counts are recomputed rather than carried over, which is the one piece of real work here.
 * A published category's stored `word_count` counts published words, deliberately (see
 * `recountCategories` on the server), so a reader who filed three of their own under "Food &
 * drink" would see a card claiming 45 words above a list of 48. Recounting from the merged list
 * is exact, and costs one pass over the words, only when there is an overlay to merge.
 */
function compose(): ContentSnapshot | null {
  if (!base) return null;

  const mine = overlay && overlay.lang === base.lang ? overlay : null;
  if (!mine || (!mine.words.length && !mine.stories.length && !mine.categories.length)) return base;

  const words = [...base.words.words, ...mine.words];

  const counts = new Map<string, number>();
  for (const word of words) counts.set(word.categoryId, (counts.get(word.categoryId) ?? 0) + 1);

  const categories = [...base.words.categories, ...mine.categories].map(category => ({
    ...category,
    wordCount: counts.get(category.id) ?? 0,
  }));

  return {
    ...base,
    words: { ...base.words, words, categories },
    // Yours last, so the published library keeps the order it was given. Which are yours is on
    // the records themselves, in `story.mine`, rather than implied by where they sit here.
    stories: [...base.stories, ...mine.stories],
  };
}

/**
 * Swaps in this reader's own content and repaints everything that shows any of it.
 *
 * Called at boot, whenever the session changes, and by every library mutation. Those answer
 * with the whole overlay for exactly this reason; see the head of the `library` contract.
 *
 * An overlay for another language is kept rather than discarded: switching to Russian and back
 * should not have to re-fetch what was already in hand. `compose` ignores one that does not
 * match the loaded dictionary, so a mismatch is inert rather than wrong.
 */
export function setPrivateContent(content: PrivateContent | null): void {
  overlay = content;
  snapshot = compose();
  for (const listener of listeners) listener();
}

/** This reader's own content in the loaded language, or empty when there is none. */
export function privateContent(): PrivateContent {
  const here = content();
  return overlay && overlay.lang === here.lang
    ? overlay
    : { lang: here.lang, stories: [], words: [], categories: [] };
}

/**
 * Fetches the dictionary, using the cached copy where it is still current.
 *
 * The cached version is sent up and the server answers "still current" in 55 bytes when
 * nothing has changed, which is every visit but the first and the ones after a re-seed.
 * If the request fails outright but there is a cached copy, that copy is used: a dictionary
 * that is one deploy out of date beats an app that will not open.
 */
export async function loadContent(lang: Lang = currentLang()): Promise<ContentSnapshot> {
  const cached = await cache.read(lang);

  try {
    const response = await api.content.snapshot({ lang, known: cached?.version });

    if (response.upToDate) {
      if (!cached) {
        // The server says we have it and we do not. Only reachable if the cache was cleared
        // between the read above and now, so ask again without claiming to know anything.
        const full = await api.content.snapshot({ lang });
        if (full.upToDate) throw new Error('The server says the dictionary is unchanged, but none was sent.');
        base = stripDiscriminant(full);
      } else {
        base = cached;
      }
    } else {
      base = stripDiscriminant(response);
      // The published half alone. See the note on `compose`.
      void cache.write(base);
    }
  } catch (error) {
    // A dictionary this visitor may not read — Russian, until it is released. Checked before
    // the cached copy is reached for, because the cache is exactly what a refusal has to
    // override: an admin who signs out still has the whole of it in this browser.
    //
    // The remedy is the default dictionary rather than an error screen. Somebody following a
    // link to a page they cannot have should land in the app, not in front of "the dictionary
    // could not be loaded", and the address bar is corrected to say where they actually are.
    if (isRefusal(error) && lang !== DEFAULT_LANG) {
      await cache.drop(lang);
      // Nothing is mounted yet — Boot awaits this — so setting the hash is enough. The router
      // reads it when it starts, and no reload is needed.
      globalThis.location.hash = swapLang(globalThis.location.hash, DEFAULT_LANG);
      return loadContent(DEFAULT_LANG);
    }

    if (!cached) throw error;
    console.warn('Could not reach the server; using the dictionary already in this browser.', error);
    base = cached;
  }

  rememberLang(lang);
  snapshot = compose();
  // Not null: every path above either assigned `base` or threw.
  return snapshot as ContentSnapshot;
}

/**
 * A "no" rather than a "not now".
 *
 * Structural rather than an `instanceof ORPCError`: the shape is what the transport
 * guarantees, and a refusal that arrived as a plain 403 from something in front of the
 * server is the same answer to the same question.
 */
function isRefusal(error: unknown): boolean {
  const thrown = error as { code?: unknown; status?: unknown } | null;
  return thrown?.code === 'FORBIDDEN' || thrown?.status === 403;
}

function stripDiscriminant(response: { upToDate: false } & ContentSnapshot): ContentSnapshot {
  const { upToDate: _upToDate, ...rest } = response;
  return rest;
}

/* ------------------------------------------------------------- staying current */

// Until the admin screens, the dictionary could not change while the app was open: it was
// fetched once at boot and that was the end of it. Editing a word has to reach the screens
// showing that word, so there is now a way to say "it changed" — one subscription, notified
// when the snapshot object is replaced.
//
// Nothing polls. The only thing that can change the content from this browser is an edit
// made in it, and an edit already knows it happened. A *different* admin's edit arrives on
// the next reload, which is the same guarantee everyone had before.

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Re-fetches the dictionary and swaps it in.
 *
 * Deliberately no `known` version: the caller has just changed the content and wants what is
 * there now, and sending the old version would only invite "still current" from a server that
 * had not committed yet. Everything derived rebuilds by itself, because `derived()` keys on
 * the identity of the snapshot object rather than on its version string.
 */
export async function refreshContent(lang: Lang = content().lang): Promise<ContentSnapshot> {
  const response = await api.content.snapshot({ lang });
  if (response.upToDate) throw new Error('The server said the dictionary was unchanged, but none was sent.');

  base = stripDiscriminant(response);
  void cache.write(base);
  snapshot = compose();
  for (const listener of listeners) listener();
  return snapshot as ContentSnapshot;
}

/**
 * Re-renders the caller whenever the dictionary is replaced.
 *
 * `App` uses it, so one call repaints everything below — which is what an edit wants, since
 * a changed word could be on any screen. The snapshot object itself is the store value, so
 * `useSyncExternalStore`'s identity check does the right thing without a version counter.
 */
export function useContent(): ContentSnapshot {
  return useSyncExternalStore(subscribe, content, content);
}

/**
 * An index built from the content, on first use, and kept until the content changes.
 *
 * The identity check is against the snapshot object rather than its version string so that
 * a rebuild is impossible to forget: replace `snapshot` and every index is stale by
 * construction.
 */
export function derived<T>(build: (from: ContentSnapshot) => T): () => T {
  let from: ContentSnapshot | null = null;
  let value: T;

  return () => {
    const current = content();
    if (from !== current) {
      value = build(current);
      from = current;
    }
    return value;
  };
}

/* --------------------------------------------------------------- accessors */

export function wordData(): WordData {
  return content().words;
}

/** Which dictionary is loaded. Every id in the store belongs to this language. */
export function lang(): Lang {
  return content().lang;
}

/** Every language on offer, for the switcher. */
export function languages(): Language[] {
  return content().languages;
}

/**
 * What to call the loaded language in English — "Georgian", "Russian".
 *
 * For the screens that used to have the answer written into them. A label reading "Georgian
 * title" over a field holding Колобо́к is not a cosmetic problem: it is the admin screens
 * telling somebody they are editing the wrong dictionary when they are not.
 *
 * The `languages` row is the answer where there is one, because that is the name an admin
 * can correct; LANG_LABELS is the bootstrap copy, for the moment before the snapshot lands.
 */
export function langName(of: Lang = lang()): string {
  return content().languages.find(entry => entry.id === of)?.name ?? LANG_LABELS[of].name;
}

/**
 * The Georgian paradigms, with the fixed grammar put back.
 *
 * The server sends what is in the database; the six persons, eleven screeves and three
 * series are constants this app already has. Joining them here means every consumer still
 * sees one whole `KaVerbData`, as it did when all of it came out of one JSON file.
 *
 * Empty when another language is loaded, rather than throwing.
 *
 * An earlier version threw, on the reasoning that a Georgian screeve grid asked to render
 * Russian is a routing bug worth hearing about. That was wrong, and wrong in the way that
 * takes a site down: several pages that are *not* verb pages — the home card, the export
 * screen, the admin index — read this in passing to count paradigms or pick a verb of the
 * day, and each one throwing turned "the Russian dictionary has no Georgian verbs in it",
 * which is merely true, into a blank screen.
 *
 * The pages that must not silently render the wrong thing fork on `verbKind()` at the route
 * instead, which is where the decision belongs. See `VerbPage` in App.tsx.
 */
export const kaVerbData = derived<KaVerbData>(from => {
  if (from.verbs.kind !== 'ka') {
    return { source: '', persons: [...PERSONS], screeves: [...SCREEVES], series: [...SERIES], groups: [], verbs: [] };
  }
  return {
    ...from.verbs,
    persons: [...PERSONS],
    screeves: [...SCREEVES],
    series: [...SERIES],
  };
});

/** The Russian verbs — rules rather than paradigms. Empty for any other language, as above. */
export const ruVerbData = derived<RuVerbContent>(from =>
  from.verbs.kind === 'ru' ? from.verbs : { kind: 'ru', source: '', verbs: [] },
);

/** Which of the two is loaded, for the components that can render either. */
export function verbKind(): 'ka' | 'ru' {
  return content().verbs.kind;
}

/**
 * The Georgian paradigms as a plain list, and empty when another language is loaded.
 *
 * The lenient counterpart to `kaVerbData`, which throws. Both are wanted: a Georgian verb
 * *page* asked to render Russian is a routing bug and should say so loudly, but an index
 * built at boot over whatever happens to be loaded should simply be empty. These are the
 * index-builders' accessor.
 */
export function kaVerbsOf(from: ContentSnapshot): KaVerb[] {
  return from.verbs.kind === 'ka' ? from.verbs.verbs : [];
}

/** The Georgian conjugation groups, on the same terms. */
export function kaGroupsOf(from: ContentSnapshot): KaVerbGroup[] {
  return from.verbs.kind === 'ka' ? from.verbs.groups : [];
}

/** The Georgian morpheme breakdowns. Empty for any other language. */
export function morphemeData(): KaVerbContent['morphemes'] {
  const verbs = content().verbs;
  return verbs.kind === 'ka' ? verbs.morphemes : { note: '', source: '', verbs: {} };
}

export function imageMap(): ImageMap {
  return content().images;
}

export function categoryImageMap(): ImageMap {
  return content().categoryImages;
}

/**
 * Every story this reader can open: the library's own, and theirs.
 *
 * One list rather than two, because almost everything that asks wants both. The reader's "what
 * comes after this one", a lesson looking up a passage by id, the index page. The two screens
 * where the distinction matters are the shelves and the "Yours" section under them, and both
 * filter on `story.mine`, which is on the record itself.
 */
export function storySummaries(): StorySummary[] {
  return content().stories;
}

/* ------------------------------------------------- the dictionary, on its own */

/**
 * The published dictionary with no private content in it at all.
 *
 * **Everything under admin/ reads through these two and never through `content()`.** That is a
 * rule rather than a preference. Those screens edit the dictionary, and the dictionary is what
 * everybody sees; a private story of the signed-in admin's own turning up in the story list
 * would be an editing screen offering to publish something that is not theirs to publish, and
 * a private word in the picker would be one pin away from a published token citing a note only
 * one person can read.
 *
 * Read straight off `base` rather than filtered out of the composed snapshot, so it is exactly
 * what the server sent and cannot be got wrong by a missing flag.
 */
function published(): ContentSnapshot {
  if (!base) {
    throw new Error('The dictionary has not loaded yet. Nothing may read it at module scope.');
  }
  return base;
}

/** The dictionary's own stories: what the shelves are built from, and every admin list. */
export function publishedStories(): StorySummary[] {
  return published().stories;
}

/** The dictionary's own words and categories. See `published`. */
export function publishedWordData(): WordData {
  return published().words;
}

/** This reader's own, in the order they were made. */
export function myStories(): StorySummary[] {
  return privateContent().stories;
}

/** This reader's own entries. Already inside `wordData()`; this is for the screens that list them. */
export function myWords(): Word[] {
  return privateContent().words;
}

/** This reader's own shelves. Likewise already inside `wordData().categories`. */
export function myCategories(): Category[] {
  return privateContent().categories;
}

export function storyCategories(): StoryCategory[] {
  return content().storyCategories;
}

/**
 * Every quiz, minus its questions. The index is built from these and never fetches to draw
 * itself; the questions arrive from `quiz.get` when one is opened. See the `Quiz` type.
 */
export function quizSummaries(): QuizSummary[] {
  return content().quizzes;
}

export function quizCategories(): QuizCategory[] {
  return content().quizCategories;
}

/**
 * Every lesson, minus its markup — both reading sections in one list.
 *
 * Filtered by `section` at the two index pages rather than split here, because that is the one
 * place the difference matters. The body arrives from `content.lesson` when one is opened; see
 * the `Lesson` type.
 */
export function lessonSummaries(section?: LessonSection): LessonSummary[] {
  const all = content().lessons;
  return section ? all.filter(lesson => lesson.section === section) : all;
}

export function lessonCategories(section?: LessonSection): LessonCategory[] {
  const all = content().lessonCategories;
  return section ? all.filter(category => category.section === section) : all;
}

/** The size and alt text of every uploaded picture, for the blocks that draw one. */
export function lessonImages(): LessonImageMap {
  return content().lessonImages;
}
