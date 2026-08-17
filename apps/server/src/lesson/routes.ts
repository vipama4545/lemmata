// What a lesson shows and what it sounds like.
//
// Plain Fastify rather than oRPC, for the reasons the story and quiz audio are: these answer
// with bytes, and all of them want to be ordinary URLs a browser can put in `<img src>` or
// `<audio src>`. See tts/routes.ts.
//
//   POST .../api/lesson/media                  upload a picture or a recording. Admin only.
//   GET  .../api/lesson/media/:fileId          that file's bytes. Immutable.
//   GET  .../api/lesson/:lessonId/audio/:block         that block of the lesson, spoken.
//   GET  .../api/lesson/:lessonId/audio/:block/:slot   one play button inside that block.
//
// The split between the last two is the split between the two ways a block gets its sound, and
// the client picks by looking at what the block carries: a `::clip` addresses the file
// directly, and a `::say` addresses *a position in the lesson*, which the server resolves to
// text and synthesises.
//
// That the text is never sent up is the point of the second URL rather than an accident of it.
// The server parses the stored body and reads block four out of it, so the only things this
// server can be made to say are things somebody wrote into a lesson. A route that synthesised
// whatever text it was handed would be a Georgian voice anybody could put words into, at our
// expense and under our domain.
//
// The GET routes are public, because lessons are.

import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { isLang, type Lang } from '@georgian/shared/grammar';
import { parseLesson, spokenText } from '@georgian/shared/lesson';
import { auth } from '../auth.ts';
import { db, schema } from '../db/index.ts';
import { env } from '../env.ts';
import { isAdminSession } from '../router/base.ts';
import { bytes as spokenBytes, line, speechAvailable } from '../tts/cache.ts';
import { allowedTypes, bytes as fileBytes, storedType, store } from './media.ts';

/** How long a browser may keep one file. Its bytes are behind an id that names them alone. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * What block `index` of this lesson should say, and in what language. Null when nothing.
 *
 * Null for a block whose audio is an uploaded recording as well as for one with no audio at
 * all, and the two are one answer here on purpose: this route synthesises, a recording has a
 * URL of its own, and a request landing here for one is a client that built the wrong URL
 * rather than something to paper over. `spokenText` makes that distinction; see it.
 */
async function blockText(
  lessonId: string,
  index: number,
  slot?: number,
): Promise<{ lang: Lang; text: string } | null> {
  const [row] = await db
    .select({ lang: schema.lessons.lang, body: schema.lessons.body })
    .from(schema.lessons)
    .where(eq(schema.lessons.id, lessonId))
    .limit(1);

  if (!row) return null;
  const text = spokenText(parseLesson(row.body), index, slot);
  return text ? { lang: row.lang as Lang, text } : null;
}

export function registerLessonRoutes(app: FastifyInstance): void {
  /* ------------------------------------------------------------- uploading */

  // Scoped to its own plugin, exactly as the quiz upload is and for the same reason: this needs
  // body parsers the rest of the server must not have. Fastify keeps content-type parsers to
  // the scope they were registered in, so an `image/png` body arriving anywhere else is still
  // the 415 it should be.
  app.register(async instance => {
    for (const pattern of [/^image\//, /^audio\//]) {
      instance.addContentTypeParser(
        pattern,
        { parseAs: 'buffer', bodyLimit: env.MEDIA_MAX_BYTES },
        (_request, body, done) => done(null, body),
      );
    }

    /**
     * Uploads one picture or one recording.
     *
     * Raw bytes with the type in the header rather than a multipart form, as the quiz upload
     * is: there is exactly one file, so the parts a multipart body exists to separate do not
     * exist. The browser sends the `File` straight from the picker as the body, and the name it
     * had — plus the alt text, where it is a picture — travels in the query string.
     *
     * Admin only, and the one route in this file that is. The session is checked here rather
     * than by a middleware because this is plain Fastify: `adminOnly` guards oRPC procedures
     * and does not run here.
     */
    instance.post<{ Body: Buffer; Querystring: { lang?: string; name?: string; alt?: string } }>(
      '/api/lesson/media',
      { bodyLimit: env.MEDIA_MAX_BYTES },
      async (request, reply) => {
        const headers = fromNodeHeaders(request.headers);
        const session = await auth.api.getSession({ headers });
        if (!session?.user) return reply.status(401).send({ error: 'Sign in first.' });
        if (!(await isAdminSession({ session, headers }))) {
          return reply.status(403).send({ error: 'That is an administrator action.' });
        }

        const type = storedType(request.headers['content-type'] ?? '');
        if (!type) {
          return reply
            .status(415)
            .send({ error: `That is not a file this server takes. Try: ${allowedTypes().join(', ')}.` });
        }

        const data = request.body;
        if (!Buffer.isBuffer(data) || data.byteLength === 0) {
          return reply.status(400).send({ error: 'That upload was empty.' });
        }

        const lang = isLang(request.query.lang) ? request.query.lang : 'ka';
        // Control characters and path separators out, everything else kept: a picture called
        // "ანბანი.png" should still be called that in the list. Nothing here builds a path from
        // it — a file is named by its id, see media.ts — so the separators go because a name
        // that looks like a path invites somebody later to treat it as one.
        const clean = (value: string | undefined, limit: number) =>
          (value ?? '').replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0, limit);

        const file = await store(lang, type, clean(request.query.name, 200), clean(request.query.alt, 500), data);
        return reply.status(201).send(file);
      },
    );
  });

  /* --------------------------------------------------------------- showing */

  /**
   * One uploaded file.
   *
   * Immutable, and here it is simply true: the id names these bytes and nothing else, an edit
   * uploads a new file with a new id, and there is no sequence of events that puts a different
   * picture behind this URL.
   */
  app.get<{ Params: { fileId: string } }>('/api/lesson/media/:fileId', async (request, reply) => {
    const [row] = await db
      .select({ mime: schema.lessonMedia.mime })
      .from(schema.lessonMedia)
      .where(eq(schema.lessonMedia.id, request.params.fileId))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'No such file.' });

    const data = await fileBytes(request.params.fileId);
    if (!data) return reply.status(410).send({ error: 'That file is recorded but its bytes are gone.' });

    // The type stored with the row, never the one the upload claimed. See `storedType`.
    reply.header('content-type', row.mime);
    reply.header('cache-control', IMMUTABLE);
    // Belt and braces on a route that serves bytes somebody uploaded: nothing here is ever
    // meant to be *interpreted* by the browser as a document, only decoded as a picture or
    // played as sound, and this says so even if the allow-list is one day widened carelessly.
    reply.header('x-content-type-options', 'nosniff');
    reply.header('content-security-policy', "default-src 'none'; sandbox");
    return reply.send(data);
  });

  /**
   * One block of a lesson, spoken.
   *
   * 503 rather than 404 when there is no voice: the block exists, the speech service is what is
   * missing, and the difference is what tells the page to draw no button rather than to report
   * a broken lesson.
   *
   * `no-store`, unlike the file above, because this URL names *a position in a lesson* and the
   * text at that position can be edited. The synthesis behind it is cached server-side by the
   * same `tts_cache` the stories use, so a replay is a disk read rather than a voice — which is
   * what makes it affordable not to cache it in the browser.
   */
  app.get<{ Params: { lessonId: string; block: string; slot?: string } }>(
    '/api/lesson/:lessonId/audio/:block/:slot?',
    async (request, reply) => {
      const block = Number(request.params.block);
      if (!Number.isInteger(block) || block < 0) return reply.status(400).send({ error: 'Bad block.' });

      // Absent addresses the block's own audio; present addresses one of the play buttons
      // standing in its text, numbered in reading order. A table has both.
      const raw = request.params.slot;
      const slot = raw === undefined ? undefined : Number(raw);
      if (slot !== undefined && (!Number.isInteger(slot) || slot < 0)) {
        return reply.status(400).send({ error: 'Bad play button.' });
      }

      const found = await blockText(request.params.lessonId, block, slot);
      if (!found) return reply.status(404).send({ error: 'That block has nothing to say.' });

      if (!speechAvailable()) return reply.status(503).send({ error: 'This server has no speech service.' });

      const spoken = await line(found.lang, found.text);
      if (!spoken) return reply.status(503).send({ error: 'No voice for that language.' });

      const audio = await spokenBytes(spoken.key);
      if (!audio) return reply.status(503).send({ error: 'That line could not be read back.' });

      return sendOgg(reply, audio);
    },
  );
}

function sendOgg(reply: FastifyReply, audio: Buffer): unknown {
  reply.header('content-type', 'audio/ogg');
  reply.header('cache-control', 'no-store');
  return reply.send(audio);
}
