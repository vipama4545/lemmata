// The three things the reader asks for to play a chapter.
//
// Plain Fastify rather than oRPC, and deliberately. One of these answers with audio bytes,
// which is not a shape a typed procedure contract has any business describing, and all three
// want to be ordinary cacheable URLs a browser can put in `<audio src>` and re-fetch from its
// own cache on the second play. Public, because the stories are: see the note on `authed` in
// router/base.ts about the dictionary being readable without an account.
//
//   GET .../audio                      what the chapter is made of. Touches no model.
//   GET .../audio/:p/:s                one line's timings. Synthesises it if it has to.
//   GET .../audio/:p/:s/opus           that line's bytes.
//
// The last is a segment rather than a `.opus` suffix on the one above it so that the two
// cannot be confused for one another by the router — a suffix would make every request for
// timings also a candidate match for audio, and which won would depend on registration order.
//
// The split between the second and the third is what keeps the first fast. Synthesising a
// whole chapter up front is a minute of waiting before anything plays; the manifest is a
// database read, and each line is made as the player reaches it — one ahead of what is
// sounding, so only the very first has anything to wait for.

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Lang } from '@georgian/shared/grammar';
import { db, schema } from '../db/index.ts';
import { bytes, line, speechAvailable } from './cache.ts';
import { sentences } from './sentences.ts';

/** How long a browser may keep one line's audio. They never change: the key is the text. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

interface ChapterParams {
  storyId: string;
  chapter: string;
}

interface LineParams extends ChapterParams {
  paragraph: string;
  sentence: string;
}

/** The chapter's prose and the language it is in, or null if there is no such chapter. */
async function chapterProse(storyId: string, chapter: number) {
  const [row] = await db
    .select({ lang: schema.stories.lang, paragraphs: schema.storyChapters.paragraphs })
    .from(schema.storyChapters)
    .innerJoin(schema.stories, eq(schema.storyChapters.storyId, schema.stories.id))
    .where(and(eq(schema.storyChapters.storyId, storyId), eq(schema.storyChapters.position, chapter)))
    .limit(1);

  return row ?? null;
}

/** One sentence of one paragraph, with everything needed to say it and place it. */
async function locate(storyId: string, chapter: number, paragraph: number, sentence: number) {
  const prose = await chapterProse(storyId, chapter);
  if (!prose) return null;

  const text = prose.paragraphs[paragraph];
  if (text === undefined) return null;

  const found = sentences(prose.lang as Lang, text)[sentence];
  return found ? { lang: prose.lang as Lang, ...found } : null;
}

export function registerTtsRoutes(app: FastifyInstance): void {
  /**
   * What the chapter is made of: every line, in order, and where its words sit.
   *
   * No synthesis and no call to the speech service, so this is as quick as any other read
   * and can be asked for on page load whether or not anyone presses play. `available` is
   * how the reader knows whether to draw a player at all — false when TTS_URL is unset,
   * which is the ordinary state of a development machine that has not started the container.
   */
  app.get<{ Params: ChapterParams }>('/api/tts/story/:storyId/:chapter/audio', async (request, reply) => {
    const chapter = Number(request.params.chapter);
    if (!Number.isInteger(chapter) || chapter < 0) return reply.status(400).send({ error: 'Bad chapter.' });

    const prose = await chapterProse(request.params.storyId, chapter);
    if (!prose) return reply.status(404).send({ error: 'No such chapter.' });

    const lines = prose.paragraphs.flatMap((text, paragraph) =>
      sentences(prose.lang as Lang, text).map((found, sentence) => ({
        paragraph,
        sentence,
        firstWord: found.firstWord,
        words: found.words,
      })),
    );

    // Not cached by the browser: a chapter's prose can be edited in the admin, and a manifest
    // that outlived an edit would point the player at sentences that are no longer there.
    reply.header('cache-control', 'no-store');
    return { available: speechAvailable(), lang: prose.lang, lines };
  });

  /**
   * One line's timings, synthesising it if this is the first time anyone has asked.
   *
   * The word indices are absolute — a position among the words of the paragraph, which is
   * what `story_tokens.position` counts and what the reader keys its spans on. The cache
   * stores them relative to the sentence, for the reason on `ttsCache.words`; the offset is
   * added here, where the sentence's place in the paragraph is known.
   *
   * 503 rather than 404 when there is no audio: the line exists, the voice is what is
   * missing, and the difference decides whether the reader retries later or gives up.
   */
  app.get<{ Params: LineParams }>('/api/tts/story/:storyId/:chapter/audio/:paragraph/:sentence', async (request, reply) => {
    const found = await locate(
      request.params.storyId,
      Number(request.params.chapter),
      Number(request.params.paragraph),
      Number(request.params.sentence),
    );
    if (!found) return reply.status(404).send({ error: 'No such line.' });

    const spoken = await line(found.lang, found.text);
    if (!spoken) return reply.status(503).send({ error: 'No voice for that language.' });

    reply.header('cache-control', 'no-store');
    return {
      duration: spoken.duration,
      words: spoken.words.map((word, position) => ({
        index: found.firstWord + position,
        start: word.start,
        end: word.end,
      })),
    };
  });

  /**
   * One line's audio.
   *
   * Ordinarily a hit: the reader asks for the timings first, and that is the call that makes
   * the file. It synthesises anyway when it has to, so that a URL kept from a previous visit
   * still works after the file it named was evicted.
   *
   * Immutable, because it is: the key this resolves to is a hash of the text, so the bytes
   * behind one URL can never change. Edited prose is a different sentence and a different
   * URL, and the browser is never in a position to serve stale audio for new words.
   */
  app.get<{ Params: LineParams }>('/api/tts/story/:storyId/:chapter/audio/:paragraph/:sentence/opus', async (request, reply) => {
    const found = await locate(
      request.params.storyId,
      Number(request.params.chapter),
      Number(request.params.paragraph),
      Number(request.params.sentence),
    );
    if (!found) return reply.status(404).send({ error: 'No such line.' });

    const spoken = await line(found.lang, found.text);
    if (!spoken) return reply.status(503).send({ error: 'No voice for that language.' });

    const audio = await bytes(spoken.key);
    if (!audio) return reply.status(503).send({ error: 'That line could not be read back.' });

    reply.header('content-type', 'audio/ogg');
    reply.header('cache-control', IMMUTABLE);
    return reply.send(audio);
  });
}
