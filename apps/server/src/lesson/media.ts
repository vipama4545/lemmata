// The pictures and recordings a lesson draws and plays.
//
// The same division of labour as quiz/media.ts, and most of it is the same file with images
// added: the upload in `lesson_media.data`, the facts about it in the columns beside, ids
// random rather than content-addressed so that two uploads of one picture are two rows.
//
// It is a second module rather than a `kind` column on the first because of what is *around*
// the storage: a picture has a width, a height and a line of alt text, the "is anything still
// using this" question is answered by looking in lesson bodies rather than by following a
// foreign key, and the two are served under different URLs. See the note on the `lesson_media`
// table. What the two files share — a directory, an id scheme, an order of writes — is a
// paragraph of agreement rather than a function worth extracting.
//
// SVG is deliberately not on the list below, and that is the one refusal here worth explaining:
// an SVG is a document that can carry script, and serving one from this origin would hand
// anyone who can upload a file the ability to run code on the site. Every other picture format
// is inert bytes a decoder looks at.

import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Lang } from '@georgian/shared/grammar';
import { db, schema } from '../db/index.ts';
import { env } from '../env.ts';

/**
 * What may be uploaded, what kind of thing each is, and what it is served back as.
 *
 * An allow-list rather than a check that it starts with `image/`, for the reason quiz/media.ts
 * gives: the answer to "what can this server be made to hand a browser" should be a list
 * somebody wrote down. The served type is taken from here rather than echoed back from the
 * upload, so no request can choose the type its own bytes are later served with.
 */
const TYPES: Record<string, { kind: 'image' | 'audio'; mime: string }> = {
  'image/png': { kind: 'image', mime: 'image/png' },
  'image/jpeg': { kind: 'image', mime: 'image/jpeg' },
  'image/jpg': { kind: 'image', mime: 'image/jpeg' },
  'image/gif': { kind: 'image', mime: 'image/gif' },
  'image/webp': { kind: 'image', mime: 'image/webp' },
  'image/avif': { kind: 'image', mime: 'image/avif' },

  'audio/mpeg': { kind: 'audio', mime: 'audio/mpeg' },
  'audio/mp3': { kind: 'audio', mime: 'audio/mpeg' },
  'audio/ogg': { kind: 'audio', mime: 'audio/ogg' },
  'audio/opus': { kind: 'audio', mime: 'audio/ogg' },
  'audio/wav': { kind: 'audio', mime: 'audio/wav' },
  'audio/x-wav': { kind: 'audio', mime: 'audio/wav' },
  'audio/webm': { kind: 'audio', mime: 'audio/webm' },
  'audio/mp4': { kind: 'audio', mime: 'audio/mp4' },
  'audio/aac': { kind: 'audio', mime: 'audio/aac' },
  'audio/flac': { kind: 'audio', mime: 'audio/flac' },
};

/** What an upload of this type is stored and served as, or null to refuse it. */
export function storedType(uploaded: string): { kind: 'image' | 'audio'; mime: string } | null {
  // Content-Type arrives with parameters on it — `audio/ogg; codecs=opus` — and the parameters
  // are not part of what it is.
  return TYPES[uploaded.split(';')[0].trim().toLowerCase()] ?? null;
}

export function allowedTypes(): string[] {
  return [...new Set(Object.values(TYPES).map(entry => entry.mime))];
}

/**
 * Where one file used to live, and still may.
 *
 * Under a `lesson/` directory of its own inside MEDIA_DIR, so these and the quiz clips stayed
 * separable. Only `discard` and the one-off import read it now — the bytes are a column, and
 * nothing writes a file any more — and it is kept so that deleting something uploaded under the
 * old scheme takes its leftover file with it.
 */
function legacyPathFor(id: string): string {
  return join(env.MEDIA_DIR, 'lesson', id.slice(0, 2), id);
}

/** A 16-character name, which is also the file's. Matches `MEDIA_ID` in shared/lesson.ts. */
function mintId(): string {
  return randomBytes(8).toString('hex');
}

/* --------------------------------------------------------------- how big is it */

/**
 * A picture's size, read out of its header.
 *
 * Four formats parsed by hand rather than a decoding library, because the whole question is
 * "what are the first few dozen bytes", every answer is in a fixed place, and pulling in an
 * image library to read eight bytes would be the largest dependency in this server. Anything it
 * cannot read — AVIF, a truncated upload, something mislabelled — comes back as 0×0, which the
 * column documents and the page treats as "no hint, lay it out when it arrives".
 *
 * It is never trusted for anything but layout. Nothing here decodes pixels, so a malformed
 * header is a wrong number on a CSS property rather than something to defend against.
 */
export function imageSize(bytes: Buffer): { width: number; height: number } {
  const none = { width: 0, height: 0 };

  // PNG: an IHDR chunk at a fixed offset, which is the whole reason PNG is the easy one.
  if (bytes.length > 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  // GIF: little-endian, and the only format here that is.
  if (bytes.length > 10 && bytes.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }

  // JPEG: the size is in a start-of-frame segment somewhere after a run of others, so this is
  // the one that has to walk. The frame markers are C0–CF except C4, C8 and CC, which are
  // Huffman tables and arithmetic-coding conditioning rather than frames.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = bytes[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      }
      // Standalone markers carry no length to skip by; everything else does.
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        at += 2;
        continue;
      }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
    return none;
  }

  // WebP: three containers under one name, and they agree about nothing. VP8X carries the size
  // in 24-bit little-endian minus one, VP8L packs two 14-bit numbers across a bit boundary, and
  // plain VP8 hides it after a three-byte start code.
  if (
    bytes.length > 30 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    const chunk = bytes.subarray(12, 16).toString('latin1');

    if (chunk === 'VP8X') {
      return {
        width: (bytes.readUIntLE(24, 3) & 0xffffff) + 1,
        height: (bytes.readUIntLE(27, 3) & 0xffffff) + 1,
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const packed = bytes.readUInt32LE(21);
      return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') {
      const sync = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
      if (sync !== -1 && sync + 7 < bytes.length) {
        return {
          width: bytes.readUInt16LE(sync + 3) & 0x3fff,
          height: bytes.readUInt16LE(sync + 5) & 0x3fff,
        };
      }
    }
  }

  return none;
}

/* --------------------------------------------------------------------- storing */

export interface StoredFile {
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
 * Writes an uploaded file and records it.
 *
 * One insert, where this used to be a file write followed by a row. The ordering the old
 * version had to get right — bytes first, so that a crash could never leave a lesson with a
 * broken image in it — stops being a question once the picture and the row are the same write.
 *
 * `data` is deliberately not in what comes back: the caller sends this to the browser as the
 * upload's receipt, and returning the bytes would send the picture straight back down the wire.
 */
export async function store(
  lang: Lang,
  type: { kind: 'image' | 'audio'; mime: string },
  name: string,
  alt: string,
  data: Buffer,
): Promise<StoredFile> {
  const size = type.kind === 'image' ? imageSize(data) : { width: 0, height: 0 };
  const row = {
    id: mintId(),
    lang,
    kind: type.kind,
    mime: type.mime,
    bytes: data.byteLength,
    name: name.slice(0, 200),
    width: size.width,
    height: size.height,
    alt: alt.slice(0, 500),
  };

  await db.insert(schema.lessonMedia).values({ ...row, data });
  return row;
}

/**
 * The bytes of one file, or null when the row has outlived them.
 *
 * Null now means the column is null — something uploaded before the bytes moved into the
 * database whose file was already gone by the time the import ran. It used to mean the file
 * would not read. The serving route answers 410 either way.
 */
export async function bytes(id: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ data: schema.lessonMedia.data })
    .from(schema.lessonMedia)
    .where(eq(schema.lessonMedia.id, id))
    .limit(1);

  return row?.data ?? null;
}

/**
 * Tidies up after a file whose row has gone.
 *
 * The bytes left with the row, so there is nothing here to delete that matters. What remains is
 * whatever an older upload left under MEDIA_DIR, removed quietly and on a best effort: the row
 * is already gone, and there is nothing useful to do about a file that will not unlink except
 * leave it.
 */
export async function discard(id: string): Promise<void> {
  await rm(legacyPathFor(id), { force: true }).catch(() => {});
}
