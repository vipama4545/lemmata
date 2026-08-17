// The stories the reader offers.
//
// The index lists summaries, which ride along in the content snapshot and cost nothing. A
// chapter's text and its per-occurrence tokens are a different matter — one story here is
// 120 KB of them — so those are fetched when a chapter is actually opened, and kept for the
// rest of the session in case the reader goes back to it.
//
// Adding a story no longer means editing this file, or data.d.ts, or anything else in the
// app: drop the .txt in data/stories/, run `npm run build:data`, then `npm run db:seed`.

import { useEffect, useState } from 'react';
import type { Story, StorySummary } from '@georgian/shared/types';
import { api } from '../api/client';
import { storySummaries } from '../content/store';

export function storySummary(id: string | undefined): StorySummary | undefined {
  return id ? storySummaries().find(story => story.id === id) : undefined;
}

/**
 * Fetched chapters, by story and chapter number.
 *
 * Keyed on the pair rather than on the story, because a chapter is what a request answers
 * with: `Story.paragraphs` is one chapter's prose, and caching them under the story alone
 * would make every page turn overwrite the last. Turning back to chapter 1 is then free,
 * which is what a reader flipping between two of them expects.
 *
 * Nothing expires them, because a story does not change while you read it — with one
 * exception: an admin editing a link in the reader changes exactly this chapter, and the
 * server hands the whole of it back. `replaceStory` is how that answer gets in here, so
 * leaving the story and coming back shows the correction rather than the copy from before it.
 */
const loaded = new Map<string, Story>();
const inFlight = new Map<string, Promise<Story | null>>();

function key(id: string, chapter: number): string {
  return `${id}#${chapter}`;
}

/**
 * Puts a freshly-linked chapter in the cache, replacing whatever was there.
 *
 * The other chapters of the same story are dropped rather than kept. An edit that pinned a
 * spelling "everywhere" reached every one of them, and a cached copy from before it would
 * show the reader the correction on one page and not on the next.
 */
export function replaceStory(story: Story): void {
  for (const cached of [...loaded.keys()]) {
    if (cached.startsWith(`${story.id}#`)) loaded.delete(cached);
  }
  loaded.set(key(story.id, story.chapter), story);
}

/**
 * Drops every cached chapter of one story, so the next visit fetches it again.
 *
 * What editing has to call. The cache is keyed on `id#chapter` and nothing expires it, which
 * was safe while a story could only change under an admin who then reloaded; now the prose is
 * edited two clicks from the reader, and a stale copy means saving a chapter and reading back
 * the version before it. `replaceStory` is the better call where the server has just handed
 * back the chapter in question, because it refills the cache instead of only emptying it.
 */
export function forgetStory(id: string): void {
  for (const cached of [...loaded.keys()]) {
    if (cached.startsWith(`${id}#`)) loaded.delete(cached);
  }
  for (const pending of [...inFlight.keys()]) {
    if (pending.startsWith(`${id}#`)) inFlight.delete(pending);
  }
}

/**
 * Empties the cache. Called when the session changes.
 *
 * Chapters are held for the session, which was safe when every story in here was one anybody
 * could read. A reader's own are not: signing out on a shared laptop and handing it over should
 * not leave somebody's private text one Back button away. After this, opening it again asks the
 * server, and the server answers as if it did not exist.
 *
 * It does not reach a page already on screen. That copy is in component state, and the reader
 * goes on showing it until it navigates. What this buys is that nothing is *re-shown* from
 * memory afterwards, which is the case that matters.
 */
export function forgetStories(): void {
  loaded.clear();
  inFlight.clear();
}

function fetchStory(id: string, chapter: number): Promise<Story | null> {
  const at = key(id, chapter);
  const already = inFlight.get(at);
  if (already) return already;

  const request = api.content
    .story({ id, chapter })
    .then(story => {
      // Filed under the chapter that came back, not the one that was asked for. A request
      // past the end of the book answers with the last chapter, and caching that under the
      // number nobody has would fetch it again on every visit to the same bad URL.
      if (story) loaded.set(key(id, story.chapter), story);
      inFlight.delete(at);
      return story;
    })
    .catch((error: unknown) => {
      inFlight.delete(at);
      throw error;
    });

  inFlight.set(at, request);
  return request;
}

export interface StoryState {
  story: Story | null;
  loading: boolean;
  /** Set when the fetch failed, as opposed to succeeding and finding no such story. */
  error: Error | null;
}

/** A result, and which question it answers. See the guard in `useStory`. */
interface Held extends StoryState {
  /** The `id#chapter` that was asked for — not the one that came back. */
  asked: string;
}

/**
 * One chapter of one story, fetched on demand.
 *
 * A chapter already in hand is returned on the first render rather than after an effect, so
 * going back to something you have just read does not blank the page for a frame — and
 * turning to the next chapter and back again does not either.
 */
export function useStory(id: string | undefined, chapter = 0): StoryState {
  const want = id ? key(id, chapter) : '';

  const [state, setState] = useState<Held>(() => {
    const have = id ? loaded.get(want) ?? null : null;
    return { asked: want, story: have, loading: Boolean(id) && !have, error: null };
  });

  useEffect(() => {
    if (!id) {
      setState({ asked: '', story: null, loading: false, error: null });
      return;
    }

    const at = key(id, chapter);
    const have = loaded.get(at);
    if (have) {
      setState({ asked: at, story: have, loading: false, error: null });
      return;
    }

    let live = true;
    setState({ asked: at, story: null, loading: true, error: null });

    void fetchStory(id, chapter).then(
      story => {
        if (live) setState({ asked: at, story, loading: false, error: null });
      },
      (error: unknown) => {
        if (live) setState({ asked: at, story: null, loading: false, error: error as Error });
      },
    );

    return () => {
      live = false;
    };
  }, [id, chapter, want]);

  // The render between a change of chapter and the effect that answers it still holds the
  // previous page's result, and this is where that is caught rather than in the reader.
  //
  // It is not a cosmetic flash. The reader corrects its own URL from the chapter that came
  // back, so one render of the last page's answer under this page's address is enough to
  // redirect a reader who asked for chapter 3 back to chapter 1 — which is exactly what
  // happened before this guard existed. A component reading it cannot tell a stale answer
  // from a current one, so the answer is never handed over stale.
  if (state.asked !== want) {
    // A chapter already in hand is still returned on the first render, which is the whole
    // point of keeping them: turning back to the chapter before does not blank the page.
    const have = id ? loaded.get(want) ?? null : null;
    return { story: have, loading: Boolean(id) && !have, error: null };
  }

  return state;
}
