// Where a quiz's sound comes from, and how a clip gets uploaded.
//
// Plain URLs and a plain fetch rather than the oRPC client, for the reasons the story audio is:
// one of these is bytes for an `<audio>` element and another is a file going the other way, and
// neither is a shape a typed procedure contract has any business describing. See
// apps/server/src/quiz/routes.ts.
//
// `sourceUrl` is the whole of the read side. A question and an option carry the same `QuizAudio`
// shape, so one function addresses both, and the branch inside it is the only place in the app
// that knows an uploaded clip and a synthesised line are reached differently.

import type { QuizAudio } from '@georgian/shared/types';
import type { Lang } from '@georgian/shared/grammar';

const BASE = import.meta.env.VITE_API_URL || globalThis.location.origin;

/**
 * Where to fetch this prompt or option's audio, or null when it has none.
 *
 * The clip wins where there is one, which is the same precedence the server applies — a
 * question that has both a recording and a line of text to read is a question somebody recorded
 * *because* the synthesis was not good enough.
 *
 * The two URLs are shaped differently on purpose. A clip is addressed by its id, so its bytes
 * can never change and the browser may keep them for a year. A synthesised line is addressed by
 * *where it sits in the quiz*, because the server holds the text — sending the text up would put
 * it in a URL, in a log, and in the hands of anyone who wanted the server to say arbitrary
 * things in a Georgian voice.
 */
export function sourceUrl(
  quizId: string,
  question: number,
  audio: QuizAudio,
  choice?: number,
): string | null {
  if (audio.clipId) return `${BASE}/api/quiz/audio/${encodeURIComponent(audio.clipId)}`;
  if (!audio.say) return null;

  const root = `${BASE}/api/quiz/${encodeURIComponent(quizId)}/audio/${question}`;
  return choice === undefined ? root : `${root}/${choice}`;
}

/** Whether there is anything to play at all — what decides if a play button is drawn. */
export function hasAudio(audio: QuizAudio): boolean {
  return Boolean(audio.clipId || audio.say);
}

/**
 * Uploads one clip and returns the row that was made for it.
 *
 * The file goes up as the raw body with its type in the header, which is what the server takes;
 * there is one file and no other fields, so there is nothing for a multipart body to separate.
 * The name travels in the query string rather than the body for the same reason.
 *
 * Throws with the server's message rather than returning null, unlike everything else in this
 * file — the others are asked in passing while a page draws itself and have "then there is no
 * audio" as a sensible answer. This one was asked for by somebody who picked a file and is
 * waiting, and silence would leave them looking at a list their upload is not in.
 */
export async function uploadClip(lang: Lang, file: File): Promise<{ id: string; name: string; bytes: number }> {
  const query = new URLSearchParams({ lang, name: file.name });
  const response = await fetch(`${BASE}/api/quiz/audio?${query.toString()}`, {
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
        (response.status === 413
          ? 'That file is too large for this server.'
          : 'That file could not be uploaded.'),
    );
  }

  return (await response.json()) as { id: string; name: string; bytes: number };
}
