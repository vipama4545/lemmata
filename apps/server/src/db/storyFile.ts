// Reading and writing a story as one file, whichever shape the file is in.
//
// data/<lang>/stories/<id>.json used to be a story with `paragraphs`, `translation` and
// `tokens` at the top of it, because a story was one text. It now holds a `chapters` array.
// `readStoryFile` accepts either: a file written before chapters existed is a story of one
// chapter, which is exactly what the migration made of the rows it described, so the two
// stay in step without anything in data/ being regenerated.
//
// That tolerance is deliberately one-way and lives only here. Nothing else in the server
// knows the old shape, `npm run db:export` writes the new one, and once a file has been
// exported the branch below is dead for it.

import type { Lang, StoryFile, StoryFileChapter, StoryStats, StoryToken } from '@georgian/shared/types';
import { loadStory } from '../router/content.ts';

const EMPTY: StoryStats = {
  tokens: 0,
  distinctForms: 0,
  covered: 0,
  coverage: 0,
  names: 0,
  unresolved: 0,
  flagged: 0,
};

/** The shape a file written before chapters had. Only this module knows about it. */
interface LegacyStoryFile {
  paragraphs?: string[];
  translation?: string[];
  tokens?: StoryToken[][];
}

/**
 * One story out of one file, normalised.
 *
 * `lang` is passed in rather than trusted from the file: the file's own directory is what
 * decides which dictionary it belongs to, and a `lang` field that disagreed with the folder
 * it sits in would be a story seeded into the wrong language.
 */
export function readStoryFile(lang: Lang, raw: unknown): StoryFile {
  const file = raw as Partial<StoryFile> & LegacyStoryFile;

  const chapters: StoryFileChapter[] = file.chapters?.length
    ? file.chapters.map(chapter => ({
        title: chapter.title ?? '',
        titleEnglish: chapter.titleEnglish ?? '',
        stats: chapter.stats ?? EMPTY,
        paragraphs: chapter.paragraphs ?? [],
        translation: chapter.translation ?? [],
        tokens: chapter.tokens ?? [],
      }))
    : [
        {
          // Unnamed, as the migration leaves them: the story's title has not moved, and
          // repeating it as a chapter heading would print it on the page twice.
          title: '',
          titleEnglish: '',
          stats: file.stats ?? EMPTY,
          paragraphs: file.paragraphs ?? [],
          translation: file.translation ?? [],
          tokens: file.tokens ?? [],
        },
      ];

  return {
    note: file.note ?? '',
    id: file.id ?? '',
    lang,
    title: file.title ?? '',
    titleEnglish: file.titleEnglish ?? '',
    level: file.level ?? '',
    source: file.source ?? '',
    categoryId: file.categoryId ?? null,
    category: file.category ?? '',
    stats: file.stats ?? EMPTY,
    chapters,
  };
}

/**
 * A whole story out of the database, assembled chapter by chapter through the same
 * `loadStory` the reader is served by.
 *
 * One query set per chapter rather than one big join, and that is the point rather than a
 * shortcut: `npm run db:export` claims to write what the app shows, and it can only claim
 * that if it goes through the assembly the app is served by. This runs offline, on a few
 * dozen chapters.
 */
export async function loadStoryFile(id: string): Promise<StoryFile | null> {
  const first = await loadStory(id, 0);
  if (!first) return null;

  const chapters: StoryFileChapter[] = [];
  for (const entry of first.chapters) {
    const at = entry.position === 0 ? first : await loadStory(id, entry.position);
    if (!at) continue;
    chapters.push({
      title: at.chapterTitle,
      titleEnglish: at.chapterTitleEnglish,
      stats: entry.stats,
      paragraphs: at.paragraphs,
      translation: at.translation,
      tokens: at.tokens,
    });
  }

  return {
    note: first.note,
    id: first.id,
    lang: first.lang,
    title: first.title,
    titleEnglish: first.titleEnglish,
    level: first.level,
    source: first.source,
    categoryId: first.categoryId,
    category: first.category,
    stats: first.stats,
    chapters,
  };
}
