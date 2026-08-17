// The sound a quiz makes.
//
// Plain Fastify rather than oRPC, for the reasons the story audio is: these answer with bytes,
// and both want to be ordinary URLs a browser can put in `<audio src>`. See tts/routes.ts.
//
//   POST .../api/quiz/audio                    upload a clip. The one admin-only route here.
//   GET  .../api/quiz/audio/:clipId            that clip's bytes. Immutable.
//   GET  .../api/quiz/:quizId/audio/:question           a question's prompt, spoken.
//   GET  .../api/quiz/:quizId/audio/:question/:choice   one option of it, spoken.
//
// The split between the last two and the one above them is the split between the two ways a
// question gets its sound, and the client picks by looking at what the question carries: a
// `clipId` addresses the clip directly, and a `say` addresses the *question*, which the server
// resolves to text and synthesises. Doing both through one coordinate URL would have been
// tidier to call and worse to cache — a clip's bytes can never change and may be kept for a
// year, and a question's can change the moment somebody edits the question.
//
// The GET routes are public, because quizzes are. See the note at the head of router/quiz.ts.

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { isLang, type Lang } from '@georgian/shared/grammar';
import { auth } from '../auth.ts';
import { db, schema } from '../db/index.ts';
import { env } from '../env.ts';
import { isAdminSession } from '../router/base.ts';
import { bytes as spokenBytes, line, speechAvailable } from '../tts/cache.ts';
import { allowedTypes, bytes as clipBytes, storedType, store } from './media.ts';

/** How long a browser may keep one clip. Its bytes are behind an id that names them alone. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

interface QuestionParams {
  quizId: string;
  question: string;
}

interface ChoiceParams extends QuestionParams {
  choice: string;
}

/**
 * What a question's prompt should say, and in what language. Null when there is nothing to say.
 *
 * Returns null for a question whose audio is an uploaded clip as well as for one with no audio
 * at all, and the two are the same answer here on purpose: this route synthesises, the clip has
 * a URL of its own, and a request that reaches this one for a clip-backed question is a client
 * that built the wrong URL rather than something to paper over.
 */
async function promptText(quizId: string, question: number): Promise<{ lang: Lang; text: string } | null> {
  const [row] = await db
    .select({ lang: schema.quizzes.lang, say: schema.quizQuestions.say })
    .from(schema.quizQuestions)
    .innerJoin(schema.quizzes, eq(schema.quizQuestions.quizId, schema.quizzes.id))
    .where(and(eq(schema.quizQuestions.quizId, quizId), eq(schema.quizQuestions.position, question)))
    .limit(1);

  if (!row?.say) return null;
  return { lang: row.lang as Lang, text: row.say };
}

/** The same, for one option of one question. */
async function choiceText(quizId: string, question: number, choice: number): Promise<{ lang: Lang; text: string } | null> {
  const [row] = await db
    .select({ lang: schema.quizzes.lang, say: schema.quizChoices.say })
    .from(schema.quizChoices)
    .innerJoin(schema.quizzes, eq(schema.quizChoices.quizId, schema.quizzes.id))
    .where(
      and(
        eq(schema.quizChoices.quizId, quizId),
        eq(schema.quizChoices.question, question),
        eq(schema.quizChoices.position, choice),
      ),
    )
    .limit(1);

  if (!row?.say) return null;
  return { lang: row.lang as Lang, text: row.say };
}

export function registerQuizRoutes(app: FastifyInstance): void {
  /* ------------------------------------------------------------- uploading */

  // Scoped to its own plugin, exactly as the oRPC routes are and for the same reason: this
  // needs a body parser the rest of the server must not have. Fastify keeps content-type
  // parsers to the scope they were registered in, so `audio/*` arriving anywhere else is still
  // the 415 it should be.
  app.register(async instance => {
    instance.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: env.MEDIA_MAX_BYTES }, (_request, body, done) =>
      done(null, body),
    );

    /**
     * Uploads one clip.
     *
     * Raw bytes with the type in the header rather than a multipart form, which is what saves a
     * dependency here: there is exactly one file and no other fields, so the parts a multipart
     * body exists to separate do not exist. The browser sends the `File` straight from the
     * picker as the body. The name it had comes up in a header of its own, because a filename
     * is not something to read out of a content type and is only ever shown back to the person
     * who uploaded it.
     *
     * Admin only, and the one route in this file that is: everything below is reading, and
     * quizzes are readable by anyone. The session is checked here rather than by a middleware
     * because this is plain Fastify — `adminOnly` guards oRPC procedures and does not run here.
     */
    instance.post<{ Body: Buffer; Querystring: { lang?: string; name?: string } }>(
      '/api/quiz/audio',
      { bodyLimit: env.MEDIA_MAX_BYTES },
      async (request, reply) => {
        const headers = fromNodeHeaders(request.headers);
        const session = await auth.api.getSession({ headers });
        if (!session?.user) return reply.status(401).send({ error: 'Sign in first.' });
        if (!(await isAdminSession({ session, headers }))) {
          return reply.status(403).send({ error: 'That is an administrator action.' });
        }

        const mime = storedType(request.headers['content-type'] ?? '');
        if (!mime) {
          return reply.status(415).send({ error: `That is not audio this server takes. Try: ${allowedTypes().join(', ')}.` });
        }

        const audio = request.body;
        if (!Buffer.isBuffer(audio) || audio.byteLength === 0) {
          return reply.status(400).send({ error: 'That upload was empty.' });
        }

        const lang = isLang(request.query.lang) ? request.query.lang : 'ka';
        // Control characters and path separators out, everything else kept: a clip called
        // "ბაბუა.mp3" should still be called that in the list. Nothing here builds a path
        // from this (a file is named by its id; see media.ts), so the separators go because a
        // name that looks like a path invites somebody later to treat it as one.
        const name = (request.query.name ?? '').replace(/[\u0000-\u001f\u007f\/\\]/g, '').slice(0, 200);

        const clip = await store(lang, mime, name, audio);
        return reply.status(201).send(clip);
      },
    );
  });

  /* --------------------------------------------------------------- playing */

  /**
   * One uploaded clip.
   *
   * Immutable, and here it is simply true: the id names these bytes and nothing else, an edit
   * uploads a new clip with a new id, and there is no sequence of events that puts different
   * audio behind this URL.
   */
  app.get<{ Params: { clipId: string } }>('/api/quiz/audio/:clipId', async (request, reply) => {
    const [row] = await db
      .select({ mime: schema.quizAudio.mime })
      .from(schema.quizAudio)
      .where(eq(schema.quizAudio.id, request.params.clipId))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'No such clip.' });

    const audio = await clipBytes(request.params.clipId);
    if (!audio) return reply.status(410).send({ error: 'That clip is recorded but its file is gone.' });

    // The type stored with the row, never the one the upload claimed. See `storedType`.
    reply.header('content-type', row.mime);
    reply.header('cache-control', IMMUTABLE);
    return reply.send(audio);
  });

  /**
   * A question's prompt, spoken.
   *
   * 503 rather than 404 when there is no voice: the question exists, the speech service is what
   * is missing, and the difference is what tells the player to draw no button rather than to
   * report a broken quiz.
   *
   * `no-store`, unlike the clip above, because this URL names a *position in a quiz* and the
   * text at that position can be edited. The synthesis behind it is cached server-side by the
   * same `tts_cache` the stories use, so a replay is a disk read rather than a voice — which is
   * what makes it affordable not to cache it in the browser.
   */
  app.get<{ Params: QuestionParams }>('/api/quiz/:quizId/audio/:question', async (request, reply) => {
    const question = Number(request.params.question);
    if (!Number.isInteger(question) || question < 0) return reply.status(400).send({ error: 'Bad question.' });

    const found = await promptText(request.params.quizId, question);
    if (!found) return reply.status(404).send({ error: 'That question has nothing to say.' });

    return speak(reply, found.lang, found.text);
  });

  /** One option of one question, spoken. Everything above applies unchanged. */
  app.get<{ Params: ChoiceParams }>('/api/quiz/:quizId/audio/:question/:choice', async (request, reply) => {
    const question = Number(request.params.question);
    const choice = Number(request.params.choice);
    if (!Number.isInteger(question) || question < 0 || !Number.isInteger(choice) || choice < 0) {
      return reply.status(400).send({ error: 'Bad option.' });
    }

    const found = await choiceText(request.params.quizId, question, choice);
    if (!found) return reply.status(404).send({ error: 'That option has nothing to say.' });

    return speak(reply, found.lang, found.text);
  });
}

/** Synthesise a line and send it, or say why there is nothing to send. */
async function speak(reply: FastifyReply, lang: Lang, text: string): Promise<unknown> {
  if (!speechAvailable()) return reply.status(503).send({ error: 'This server has no speech service.' });

  const spoken = await line(lang, text);
  if (!spoken) return reply.status(503).send({ error: 'No voice for that language.' });

  const audio = await spokenBytes(spoken.key);
  if (!audio) return reply.status(503).send({ error: 'That line could not be read back.' });

  reply.header('content-type', 'audio/ogg');
  reply.header('cache-control', 'no-store');
  return reply.send(audio);
}
