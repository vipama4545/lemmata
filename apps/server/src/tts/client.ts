// Asking the speech service to say a line, here.
//
// Everything is optional by construction, exactly as story/analyser.ts is. TTS_URL unset,
// container down, request slow, reply the wrong shape, a language the deployed image has no
// voice for: all of them return null, and the reader is told there is no audio and shows no
// player. A voice that is merely absent must never be the reason a story fails to open.
//
// See apps/tts/ for the service, and tts/cache.ts for what happens to what it returns.

import type { Lang } from '@georgian/shared/grammar';
import { env } from '../env.ts';

/** How long to wait for one sentence. Generous: a cold container loads 63 MB first. */
const TIMEOUT_MS = 30_000;

/** How long to wait to be told which languages there are. That call touches no model. */
const VOICES_TIMEOUT_MS = 5_000;

/** One word of the sentence, and when it is said. Seconds from the start of the audio. */
export interface SpokenWord {
  word: string;
  start: number;
  end: number;
}

/** A synthesised line: the bytes, how long they run, and where the words are inside them. */
export interface Spoken {
  audio: Buffer;
  duration: number;
  /**
   * Empty when the service could not group its phonemes into the same number of words its
   * tokeniser found — which is the same tokeniser as ours, so in practice this is empty only
   * if the two ever drift. The audio is still good and still worth caching; only the
   * highlighting falls back to the whole sentence. See apps/tts/main.py.
   */
  words: SpokenWord[];
}

async function ask(path: string, body: unknown, timeout: number): Promise<unknown | null> {
  if (!env.TTS_URL) return null;

  try {
    const response = await fetch(new URL(path, env.TTS_URL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Deliberately silent about which of the several ways it can fail happened. The caller's
    // only choice is the same one either way — offer no audio — and a story opening without
    // a player is not an error worth a line in the log on every request.
    return null;
  }
}

/**
 * Which voice the running image uses for each language, or null if there is no service.
 *
 * Asked before audio is offered at all, for the reason the analyser's /languages is asked:
 * it touches no model and answers in microseconds, and a server newer than its speech
 * container should learn that by being told rather than by waiting out a synthesis that was
 * never going to work.
 *
 * The name and not merely the language, because it goes into the cache key. Swapping which
 * voice a language uses has to invalidate everything already said in it, or a story would
 * read half in the old voice and half in the new one as the cache filled back in — which is
 * the one bug a cache of speech could plausibly introduce that a reader would notice.
 */
export async function voices(): Promise<Record<string, string> | null> {
  const reply = await ask('/voices', undefined, VOICES_TIMEOUT_MS);
  if (!reply || typeof reply !== 'object') return null;

  const map = (reply as { voices?: unknown }).voices;
  if (!map || typeof map !== 'object') return null;

  return map as Record<string, string>;
}

/**
 * One sentence, said.
 *
 * Always at ordinary pace. A reader's speed control is `playbackRate` in the browser, which
 * costs nothing and is instant — where synthesising each speed would multiply every entry in
 * the cache by the number of speeds anyone ever picked, to store audio that differs from
 * what is already there by a number the browser can apply itself.
 */
export async function speak(lang: Lang, text: string): Promise<Spoken | null> {
  const reply = await ask('/speak', { lang, text }, TIMEOUT_MS);
  if (!reply || typeof reply !== 'object') return null;

  const { audio, duration, words } = reply as {
    audio?: unknown;
    duration?: unknown;
    words?: unknown;
  };

  if (typeof audio !== 'string' || typeof duration !== 'number') return null;

  return {
    audio: Buffer.from(audio, 'base64'),
    duration,
    words: Array.isArray(words) ? (words as SpokenWord[]) : [],
  };
}
