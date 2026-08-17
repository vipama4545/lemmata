// The three things the reader asks for to play a chapter.
//
// Plain Fastify rather than oRPC, and deliberately. One of these answers with audio bytes,
// which is not a shape a typed procedure contract has any business describing, and all three
// want to be ordinary cacheable URLs a browser can put in `<audio src>` and re-fetch from its
// own cache on the second play. Public, because the stories are: see the note on `authed` in
// router/base.ts about the dictionary being readable without an account.
//
// With one exception, which is why `mayHear` exists below. A story somebody wrote for
// themselves is not public, and a URL answering with its sentences one at a time would hand
// over the whole of its prose through a side door. Every route here that reads content checks.
//
//   GET .../audio                      what the chapter is made of. Touches no model.
//   GET .../audio/:p/:s                one line's timings. Synthesises it if it has to.
//   GET .../audio/:p/:s/opus           that line's bytes.
//
// And two that are about the dictionary rather than a story, because the cache underneath is
// keyed on the text alone and does not care which screen wanted it said:
//
//   GET /api/tts/voices                which languages this server can speak.
//   GET /api/tts/word/:wordId          one headword, said.
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
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Lang } from '@georgian/shared/grammar';
import { auth } from '../auth.ts';
import { db, schema } from '../db/index.ts';
import { bytes, line, speechAvailable, spokenLanguages } from './cache.ts';
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

/** The chapter's prose, the language it is in and whose story it is, or null if there is none. */
async function chapterProse(storyId: string, chapter: number) {
  const [row] = await db
    .select({
      lang: schema.stories.lang,
      ownerId: schema.stories.ownerId,
      paragraphs: schema.storyChapters.paragraphs,
    })
    .from(schema.storyChapters)
    .innerJoin(schema.stories, eq(schema.storyChapters.storyId, schema.stories.id))
    .where(and(eq(schema.storyChapters.storyId, storyId), eq(schema.storyChapters.position, chapter)))
    .limit(1);

  return row ?? null;
}

/**
 * Whether this request may hear this chapter.
 *
 * These three routes are plain URLs rather than procedures, which is what lets a browser hand
 * one to an `<audio>` element, so the session check that `content.story` gets from the oRPC
 * context has to be done by hand here. Without it a private story would be readable a sentence
 * at a time by anybody who guessed its id.
 *
 * The session is only looked up when there is something to protect. Published stories are the
 * overwhelming majority of these requests, and they run on every page of a chapter being read
 * aloud; making all of them pay for a cookie lookup to discover that the story is public would
 * tax the common case for the rare one.
 */
async function mayHear(request: FastifyRequest, prose: { ownerId: string | null }): Promise<boolean> {
  if (!prose.ownerId) return true;
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user?.id === prose.ownerId;
}

/** One sentence of one paragraph, with everything needed to say it and place it. */
async function locate(storyId: string, chapter: number, paragraph: number, sentence: number) {
  const prose = await chapterProse(storyId, chapter);
  if (!prose) return null;

  const text = prose.paragraphs[paragraph];
  if (text === undefined) return null;

  const found = sentences(prose.lang as Lang, text)[sentence];
  return found ? { lang: prose.lang as Lang, ownerId: prose.ownerId, ...found } : null;
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
    // "No such chapter" for one that is somebody else's, exactly as `content.story` answers
    // null rather than a refusal: which of the two it is is not this caller's business.
    if (!prose || !(await mayHear(request, prose))) return reply.status(404).send({ error: 'No such chapter.' });

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
    if (!found || !(await mayHear(request, found))) return reply.status(404).send({ error: 'No such line.' });

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
    if (!found || !(await mayHear(request, found))) return reply.status(404).send({ error: 'No such line.' });

    const spoken = await line(found.lang, found.text);
    if (!spoken) return reply.status(503).send({ error: 'No voice for that language.' });

    const audio = await bytes(spoken.key);
    if (!audio) return reply.status(503).send({ error: 'That line could not be read back.' });

    reply.header('content-type', 'audio/ogg');
    reply.header('cache-control', IMMUTABLE);
    return reply.send(audio);
  });

  /* ---------------------------------------------------------------- the dictionary */

  /**
   * Which languages have a voice.
   *
   * The word lists ask this once and draw play buttons only where the answer says there is
   * something to press. A story can afford to find out per chapter, from the manifest it
   * fetches anyway; a page of fifty headwords has no manifest and would otherwise have to
   * choose between fifty buttons that may do nothing and no buttons at all.
   *
   * Touches no model — the voice map is fetched once and kept — so it is as cheap as it needs
   * to be to sit on the load of every list. `no-store` because the answer is about the state
   * of the deployment rather than about content: a speech container that comes up late should
   * start being used on the next page rather than after somebody clears their cache.
   */
  app.get('/api/tts/voices', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { languages: await spokenLanguages() };
  });

  /**
   * One headword, said.
   *
   * Addressed by word id and never by text, which is the same rule the lesson and quiz speech
   * routes follow and for the same reason: a route that synthesised whatever it was handed
   * would be a Georgian voice anybody could put words into, at our expense and under our
   * domain. The only things this can be made to say are things that are in the dictionary.
   *
   * Russian is spoken from `accented` where there is one. That column exists because де́лать is
   * how the word is shown and делать is how it is spelled, searched and matched — and the mark
   * is exactly what tells the voice which syllable to lean on, so the display form is the one
   * worth reading aloud. Georgian has no accents and falls through to the headword.
   *
   * `no-store`, unlike a story's line: this URL names a *row*, and an admin correcting a
   * headword leaves the URL where it was. The synthesis behind it is cached server-side by
   * key, so a replay is a disk read rather than a voice, which is what makes it affordable
   * not to cache in the browser.
   */
  app.get<{ Params: { wordId: string } }>('/api/tts/word/:wordId', async (request, reply) => {
    const [row] = await db
      .select({
        lang: schema.words.lang,
        headword: schema.words.headword,
        accented: schema.words.accented,
        ownerId: schema.words.ownerId,
      })
      .from(schema.words)
      .where(eq(schema.words.id, request.params.wordId))
      .limit(1);

    // Somebody's own entry is said only to them. One word is a small thing to leak and its id
    // has the owner's in it, so this is closer to tidiness than to defence. Still, "private
    // means private" is worth more as a rule with no exceptions than as one with a footnote.
    if (!row || !(await mayHear(request, row))) return reply.status(404).send({ error: 'No such word.' });

    const text = row.accented.trim() || row.headword.trim();
    if (!text) return reply.status(404).send({ error: 'That word has nothing to say.' });

    if (!speechAvailable()) return reply.status(503).send({ error: 'This server has no speech service.' });

    const spoken = await line(row.lang as Lang, text);
    if (!spoken) return reply.status(503).send({ error: 'No voice for that language.' });

    const audio = await bytes(spoken.key);
    if (!audio) return reply.status(503).send({ error: 'That word could not be read back.' });

    reply.header('content-type', 'audio/ogg');
    reply.header('cache-control', 'no-store');
    return reply.send(audio);
  });
}
