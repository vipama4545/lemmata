// Where a headword's pronunciation comes from, and whether there is one to be had.
//
// Plain URLs and a plain fetch rather than the oRPC client, for the reasons the story, quiz
// and lesson audio are: one of these is bytes for an `<audio>` element, and neither is a shape
// a typed procedure contract has any business describing. See apps/server/src/tts/routes.ts.
//
// A word is addressed by its id and never by its text. The server reads the headword out of
// the row and synthesises that, which is what keeps this from being a Georgian voice anybody
// can put words into — the same rule the lessons and the quizzes follow.
//
// The hook lives here rather than beside the button because "can this be spoken" is a question
// about where the sound comes from, which is this module's whole subject; `AudioButton` is
// deliberately ignorant of it and takes a URL.

import { useEffect, useState } from 'react';
import type { Lang } from '@georgian/shared/grammar';
import { lang } from '../content/store';

const BASE = import.meta.env.VITE_API_URL || globalThis.location.origin;

/** Where to fetch one word's pronunciation. */
export function wordAudioUrl(wordId: string): string {
  return `${BASE}/api/tts/word/${encodeURIComponent(wordId)}`;
}

async function ask(): Promise<Set<Lang>> {
  const response = await fetch(`${BASE}/api/tts/voices`);
  if (!response.ok) throw new Error('no voices');
  const said = (await response.json()) as { languages?: Lang[] };
  return new Set(said.languages ?? []);
}

/**
 * The answer, asked for once and shared.
 *
 * A promise rather than a value, so the several lists that mount together on one page share
 * one call instead of racing to make the same one — the same trick the server plays with its
 * voice map, and for the same reason.
 */
let asked: Promise<Set<Lang>> | null = null;

function spokenLanguages(): Promise<Set<Lang>> {
  asked ??= ask().catch(() => {
    // Deliberately not remembered. A compose stack whose speech container came up second, or a
    // request that simply lost, should start working on the next page rather than leave this
    // tab silent until it is reloaded. Success is remembered; failure is re-asked.
    asked = null;
    return new Set<Lang>();
  });
  return asked;
}

/**
 * Whether the dictionary now loaded can be read aloud — what decides if a play button is
 * drawn at all.
 *
 * False until the answer comes back, so a list paints without buttons and gains them a moment
 * later rather than showing controls that might do nothing. There being no voice is an
 * ordinary state of the world — a development machine that has not started the container, a
 * server deployed without TTS_URL, an image built before this language was added — and a word
 * list must never fail to open because it cannot pronounce anything.
 */
export function useSpeaks(): boolean {
  const [spoken, setSpoken] = useState<Set<Lang> | null>(null);

  useEffect(() => {
    let live = true;
    void spokenLanguages().then(found => {
      if (live) setSpoken(found);
    });
    return () => {
      live = false;
    };
  }, []);

  return spoken?.has(lang()) ?? false;
}
