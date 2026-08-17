// Where a lesson's pictures and sound come from, and how a file gets uploaded.
//
// Plain URLs and a plain fetch rather than the oRPC client, for the reasons the quiz audio is:
// two of these are bytes for an `<img>` or an `<audio>` element and the third is a file going
// the other way, and none of them is a shape a typed procedure contract has any business
// describing. See apps/server/src/lesson/routes.ts.

import type { LessonAudio } from '@georgian/shared/lesson';
import type { Lang } from '@georgian/shared/grammar';

const BASE = import.meta.env.VITE_API_URL || globalThis.location.origin;

/** Where an uploaded picture or recording is. Immutable — the id names those bytes alone. */
export function mediaUrl(fileId: string): string {
  return `${BASE}/api/lesson/media/${encodeURIComponent(fileId)}`;
}

/**
 * Where to fetch one block's audio, or null when it has none.
 *
 * The recording wins where there is one, which is the same precedence the server applies: a
 * block that has both a recording and a line for a voice to read is one somebody recorded
 * *because* the synthesis was not good enough.
 *
 * The two URLs are shaped differently on purpose, exactly as the quizzes' are. A recording is
 * addressed by its id, so its bytes can never change and the browser may keep them for a year.
 * A synthesised line is addressed by *where it sits in the lesson*, because the server holds
 * the markup — sending the text up would put it in a URL, in a log, and in the hands of anyone
 * who wanted this server to say arbitrary things in a Georgian voice.
 */
export function blockAudioUrl(
  lessonId: string,
  block: number,
  audio: LessonAudio,
  /** Which play button inside the block, for the inline `{say:…}` ones. See `numberAudio`. */
  slot?: number,
): string | null {
  if (audio.clipId) return mediaUrl(audio.clipId);
  if (!audio.say.trim()) return null;

  const root = `${BASE}/api/lesson/${encodeURIComponent(lessonId)}/audio/${block}`;
  return slot === undefined ? root : `${root}/${slot}`;
}

/** What one upload comes back as. The row that was made for it, minus the bookkeeping. */
export interface UploadedFile {
  id: string;
  kind: string;
  mime: string;
  bytes: number;
  name: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Uploads one picture or one recording and returns the row that was made for it.
 *
 * The file goes up as the raw body with its type in the header, which is what the server takes;
 * there is one file and no other fields, so there is nothing for a multipart body to separate.
 * The name and the alt text travel in the query string for the same reason.
 *
 * Throws with the server's message rather than returning null. Somebody picked a file and is
 * waiting, and silence would leave them looking at a list their upload is not in.
 */
export async function uploadMedia(lang: Lang, file: File, alt = ''): Promise<UploadedFile> {
  const query = new URLSearchParams({ lang, name: file.name, alt });
  const response = await fetch(`${BASE}/api/lesson/media?${query.toString()}`, {
    method: 'POST',
    // The session cookie, without which the server has no way to know this is an admin.
    credentials: 'include',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });

  if (!response.ok) {
    const said = await response.json().catch(() => null);
    throw new Error(
      (said as { error?: string } | null)?.error ??
        (response.status === 413 ? 'That file is too large for this server.' : 'That file could not be uploaded.'),
    );
  }

  return (await response.json()) as UploadedFile;
}
