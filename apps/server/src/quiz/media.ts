// The clips a quiz plays instead of a synthesised voice.
//
// The opposite lifetime to the speech cache, which is why it is a different table and why the
// bytes are kept somewhere different. A synthesised line is disposable because the text can
// make it again, so it lives in a directory nobody backs up; a recording somebody uploaded
// cannot be made again by anything, so it lives in `quiz_audio.data` and travels inside every
// dump. Nothing here is ever evicted, and a delete has to be asked for by name.
//
// These were files under MEDIA_DIR until the database was moved to a new host without them.
// See the note on the `quiz_audio` table for why that is not a mistake worth leaving room to
// repeat.
//
// Ids are random rather than a hash of the contents. Two uploads of the same file are two
// clips, deliberately: content-addressing would silently make them one, and deleting "the
// duplicate" would take the sound out of a question in some other quiz that had come to share
// it.

import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Lang } from '@georgian/shared/grammar';
import { db, schema } from '../db/index.ts';
import { env } from '../env.ts';

/**
 * What may be uploaded, and what each is served back as.
 *
 * An allow-list rather than a check that it starts with `audio/`, because the answer to "what
 * can this server be made to hand a browser" should be a list somebody wrote down. The value is
 * the content type the serving route sends: it is taken from here rather than echoed back from
 * the upload, so no request can choose the type its own bytes are later served with.
 */
const TYPES: Record<string, string> = {
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/ogg': 'audio/ogg',
  'audio/opus': 'audio/ogg',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/webm': 'audio/webm',
  'audio/mp4': 'audio/mp4',
  'audio/aac': 'audio/aac',
  'audio/flac': 'audio/flac',
};

/** The content type a clip of this upload type is stored and served as, or null to refuse. */
export function storedType(uploaded: string): string | null {
  // Content-Type arrives with parameters on it — `audio/ogg; codecs=opus` — and the parameters
  // are not part of what it is.
  return TYPES[uploaded.split(';')[0].trim().toLowerCase()] ?? null;
}

export function allowedTypes(): string[] {
  return [...new Set(Object.values(TYPES))];
}

/**
 * Where one clip used to live, and still may.
 *
 * Only `discard` and the one-off import read this now: the bytes are a column, and nothing
 * writes a file any more. Kept so that deleting a clip uploaded under the old scheme also
 * takes its leftover file with it, rather than leaving the directory to grow orphans that
 * nothing will ever name again.
 */
function legacyPathFor(id: string): string {
  return join(env.MEDIA_DIR, id.slice(0, 2), id);
}

/** A 16-character name, which is also the file's. */
function mintId(): string {
  return randomBytes(8).toString('hex');
}

export interface StoredClip {
  id: string;
  mime: string;
  bytes: number;
  name: string;
}

/**
 * Writes an uploaded clip and records it.
 *
 * One insert, where this used to be a file write followed by a row. The ordering problem the
 * old version had to reason about — a crash between the two leaving bytes nothing names, or a
 * row promising a file that was never written — is not solved here so much as deleted: the
 * bytes and the facts about them are the same row, and the row either lands or it does not.
 *
 * `data` is deliberately not in what comes back. The caller sends that straight to the browser
 * as the upload's receipt, and returning it would echo the whole file back down the wire the
 * moment after it came up.
 */
export async function store(lang: Lang, mime: string, name: string, audio: Buffer): Promise<StoredClip> {
  const clip = { id: mintId(), lang, mime, bytes: audio.byteLength, name: name.slice(0, 200) };
  await db.insert(schema.quizAudio).values({ ...clip, data: audio });

  return clip;
}

/**
 * The bytes of one clip, or null when the row has outlived them.
 *
 * Null now means the column is null — a clip uploaded before the bytes moved into the database
 * whose file was already gone by the time the import ran. It used to mean the file would not
 * read. The serving route answers 410 either way.
 */
export async function bytes(id: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ data: schema.quizAudio.data })
    .from(schema.quizAudio)
    .where(eq(schema.quizAudio.id, id))
    .limit(1);

  return row?.data ?? null;
}

/**
 * Tidies up after a clip whose row has gone.
 *
 * The bytes left with the row, so there is nothing here to delete that matters. What remains is
 * the file some older upload left under MEDIA_DIR, removed quietly and on a best effort: the
 * row is already gone, and there is nothing useful to do about a file that will not unlink
 * except leave it.
 */
export async function discard(id: string): Promise<void> {
  await rm(legacyPathFor(id), { force: true }).catch(() => {});
}
