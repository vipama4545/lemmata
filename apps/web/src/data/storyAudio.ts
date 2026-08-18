// Talking to the audio half of the story API.
//
// Plain fetch rather than the oRPC client, because these are not procedures: one of them
// answers with Opus bytes for an <audio> element, and all three are ordinary URLs the
// browser is meant to cache for itself. See apps/server/src/tts/routes.ts.
//
// Everything here returns null rather than throwing. There being no voice is an ordinary
// state of the world — a development machine that has not started the container, a server
// deployed without TTS_URL — and the reader's answer to all of it is the same: show no
// player. A story must never fail to open because it cannot be read aloud.

const BASE = import.meta.env.VITE_API_URL || globalThis.location.origin;

function root(storyId: string, chapter: number): string {
  return `${BASE}/api/tts/story/${encodeURIComponent(storyId)}/${chapter}/audio`;
}

/** One spoken line of a chapter, and where its words are in the paragraph it came from. */
export interface AudioLine {
  paragraph: number;
  sentence: number;
  /** Position of its first word among the words of the paragraph. */
  firstWord: number;
  /** How many words it holds. */
  words: number;
}

export interface AudioManifest {
  /** False when the server has no speech service configured. No player is drawn. */
  available: boolean;
  lines: AudioLine[];
}

/** When each word of one line is said, in seconds from the start of that line. */
export interface LineTiming {
  /** Position among the words of the *paragraph* — the number the reader keys spans on. */
  index: number;
  start: number;
  end: number;
}

export interface Timings {
  /**
   * The cache key this line resolved to — a hash of the text that was spoken.
   *
   * Passed back to `audioUrl` so that the address of the audio changes whenever the prose
   * does. See the note there.
   */
  key: string;
  duration: number;
  /** Empty when the voice could not be aligned to the text; the reader then lights the line. */
  words: LineTiming[];
}

/** What the chapter is made of. Cheap: a database read, no synthesis. */
export async function manifest(storyId: string, chapter: number): Promise<AudioManifest | null> {
  try {
    const response = await fetch(root(storyId, chapter));
    if (!response.ok) return null;
    return (await response.json()) as AudioManifest;
  } catch {
    return null;
  }
}

/**
 * One line's timings — and, on the server, the synthesis that produces them.
 *
 * This is the call that makes a line exist, which is why the player asks for it one line
 * ahead of what is sounding: by the time the audio URL below is wanted, the file is there
 * and the request is a cache hit.
 */
export async function timings(
  storyId: string,
  chapter: number,
  paragraph: number,
  sentence: number,
): Promise<Timings | null> {
  try {
    const response = await fetch(`${root(storyId, chapter)}/${paragraph}/${sentence}`);
    if (!response.ok) return null;
    return (await response.json()) as Timings;
  } catch {
    return null;
  }
}

/**
 * Where one line's audio is.
 *
 * The key from `timings` goes on the end, and it is not decoration: the path names a position
 * in a chapter rather than the text at it, so an edited paragraph keeps every one of these
 * addresses while changing what should sound at them. The server serves a request that names
 * its key as immutable — which it is, a key being a hash of the text — and one that does not
 * as `no-store`. Without the key in the URL a browser that heard the old sentence goes on
 * playing it for a year, however promptly the server re-synthesises behind it.
 */
export function audioUrl(
  storyId: string,
  chapter: number,
  paragraph: number,
  sentence: number,
  key?: string,
): string {
  const url = `${root(storyId, chapter)}/${paragraph}/${sentence}/opus`;
  return key ? `${url}?v=${encodeURIComponent(key)}` : url;
}
