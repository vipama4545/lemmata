// The stories the reader offers.
//
// The index lists summaries, which ride along in the content snapshot and cost nothing. A
// story's text and its per-occurrence tokens are a different matter — the one story here is
// 120 KB of them — so those are fetched when a story is actually opened, and kept for the
// rest of the session in case the reader goes back to it.
//
// Adding a story no longer means editing this file, or data.d.ts, or anything else in the
// app: drop the .txt in data/stories/, run `npm run build:data`, then `npm run db:seed`.

import { useEffect, useState } from 'react';
import type { Story, StorySummary } from '@georgian/shared/types';
import { api } from '../api/client';
import { storySummaries } from '../content/store';

export function stories(): StorySummary[] {
  return storySummaries();
}

export function storySummary(id: string | undefined): StorySummary | undefined {
  return id ? storySummaries().find(story => story.id === id) : undefined;
}

/**
 * Fetched stories, by id.
 *
 * Nothing expires them, because a story does not change while you read it — with one
 * exception: an admin editing a link in the reader changes exactly this story, and the server
 * hands the whole of it back. `replaceStory` is how that answer gets in here, so leaving the
 * story and coming back shows the correction rather than the copy from before it.
 */
const loaded = new Map<string, Story>();
const inFlight = new Map<string, Promise<Story | null>>();

/** Puts a freshly-linked story in the cache, replacing whatever was there. */
export function replaceStory(story: Story): void {
  loaded.set(story.id, story);
}

function fetchStory(id: string): Promise<Story | null> {
  const already = inFlight.get(id);
  if (already) return already;

  const request = api.content
    .story({ id })
    .then(story => {
      if (story) loaded.set(id, story);
      inFlight.delete(id);
      return story;
    })
    .catch((error: unknown) => {
      inFlight.delete(id);
      throw error;
    });

  inFlight.set(id, request);
  return request;
}

export interface StoryState {
  story: Story | null;
  loading: boolean;
  /** Set when the fetch failed, as opposed to succeeding and finding no such story. */
  error: Error | null;
}

/**
 * One story, fetched on demand.
 *
 * A story already in hand is returned on the first render rather than after an effect, so
 * going back to something you have just read does not blank the page for a frame.
 */
export function useStory(id: string | undefined): StoryState {
  const [state, setState] = useState<StoryState>(() => {
    const have = id ? loaded.get(id) ?? null : null;
    return { story: have, loading: Boolean(id) && !have, error: null };
  });

  useEffect(() => {
    if (!id) {
      setState({ story: null, loading: false, error: null });
      return;
    }

    const have = loaded.get(id);
    if (have) {
      setState({ story: have, loading: false, error: null });
      return;
    }

    let live = true;
    setState({ story: null, loading: true, error: null });

    void fetchStory(id).then(
      story => {
        if (live) setState({ story, loading: false, error: null });
      },
      (error: unknown) => {
        if (live) setState({ story: null, loading: false, error: error as Error });
      },
    );

    return () => {
      live = false;
    };
  }, [id]);

  return state;
}
