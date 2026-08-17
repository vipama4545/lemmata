// Configuration, checked once at boot.
//
// A missing DISCORD_CLIENT_SECRET should stop the process here, with the name of the
// variable, rather than surface half an hour later as a redirect that fails for one user.
// The two exceptions are the Mailgun credentials: without them the server still runs and
// prints what it would have sent, because wiring up a transactional mail account is not a
// thing anyone should have to do before `npm run dev` works.

import { config } from 'dotenv';
import { z } from 'zod';

// The repo root, so one .env at the top covers both apps.
config({ path: new URL('../../../.env', import.meta.url).pathname });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  /** Where this server is reachable. Better Auth builds its callback URLs off it. */
  BETTER_AUTH_URL: z.url(),
  /** At least 32 bytes. `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  /** Where the browser app is served from — the CORS allow-list and the post-login return. */
  WEB_ORIGIN: z.url().default('http://localhost:5173'),

  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),

  /**
   * The Georgian tagger, if one is running — `http://analyser:8000` under compose.
   *
   * Optional on purpose, and the only optional service that is not a pair like Mailgun's.
   * Unset, story linking works exactly as it did before the tagger existed: spellings match
   * against the lexicon and collisions fall back to list order. Set, the resolver gets a
   * part of speech per occurrence and can tell და "and" from და "sister". Nothing else in
   * the app reads it, and nothing fails without it. See story/analyser.ts.
   */
  ANALYSER_URL: z.url().optional(),

  /**
   * The speech service, if one is running — `http://tts:8001` under compose.
   *
   * Optional in exactly the way ANALYSER_URL is. Unset, the story reader is told there is no
   * audio and never shows the player at all; nothing else changes and nothing fails. See
   * tts/client.ts, and apps/tts/ for the service.
   */
  TTS_URL: z.url().optional(),

  /**
   * Where synthesised audio is kept. A directory rather than a table: these are files a
   * browser fetches, and Postgres is the wrong place to stream bytes from and the wrong
   * thing to grow a backup by two gigabytes. The index that says what is in here — sizes,
   * word timings, when each was last played — is in `tts_cache`.
   *
   * The default is absolute and anchored to the repo, not relative to the working directory.
   * `npm run dev:server` runs in apps/server and the container runs in /app, so a relative
   * default would put the cache somewhere different in each and quietly start again from
   * empty when it moved. Production sets this to a volume; see docker-compose.prod.yml.
   */
  TTS_CACHE_DIR: z.string().default(new URL('../../../.tts-cache', import.meta.url).pathname),

  /**
   * How large that directory may get before the least recently played files are dropped.
   *
   * Two gigabytes is about 167 hours of speech at the 24 kbps the service encodes at, which
   * is far more than every story will ever amount to — all four Georgian ones come to about
   * 2.5 MB. What it actually bounds is how much of the 33,762-word dictionary stays warm,
   * which is the part with no natural end to it.
   *
   * Eviction is safe at any size because a key is a hash of the text it was made from: a
   * dropped file is re-synthesised the next time it is asked for, and nothing is lost but
   * the second it takes to make it again.
   */
  TTS_CACHE_MAX_BYTES: z.coerce.number().int().positive().default(2_000_000_000),

  /**
   * Where uploads *used* to be kept — quiz clips, and the pictures and recordings in lessons.
   *
   * Nothing writes here any more. The bytes are columns on `lesson_media` and `quiz_audio` as
   * of migration 0011, because an upload and the row describing it travelling separately meant
   * that moving the database to a new host left every picture and every play button broken on
   * the other side. See the note on the `quiz_audio` table.
   *
   * Still read for two things: `npm run db:media-import`, which is how the files got into the
   * database and is safe to re-run, and the `discard` in each media module, which deletes an
   * old file when its row goes. A deployment that never had files can leave this unset — the
   * default is a directory that simply will not exist, and nothing looks in it.
   *
   * Once `db:media-import` has run and the pictures still draw, the directory and the volume
   * behind it can go. Take a backup of the database first; it is now the only copy.
   */
  MEDIA_DIR: z.string().default(new URL('../../../.media', import.meta.url).pathname),

  /**
   * The largest file that may be uploaded — a quiz clip, or a lesson's picture or recording.
   *
   * Eight megabytes is several minutes of speech at any sensible bitrate and a photograph
   * larger than any page needs. It is a bound on what one admin can put on the disk in one
   * request rather than a judgement about quality.
   */
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(8_000_000),

  // Optional as a pair: both or neither. See mail/mailgun.ts.
  MAILGUN_API_KEY: z.string().min(1).optional(),
  /** The sending domain as Mailgun knows it — `mg.example.com`, not a URL. */
  MAILGUN_DOMAIN: z.string().min(1).optional(),
  /**
   * Which Mailgun region the domain lives in. A domain created in the EU is not reachable
   * on the US host and answers a perfectly well-formed request with "Domain not found", so
   * this is worth setting deliberately rather than discovering.
   */
  MAILGUN_API_BASE: z.url().default('https://api.mailgun.net'),
  /** Must be on MAILGUN_DOMAIN, or Mailgun refuses to send as it. */
  MAIL_FROM_EMAIL: z.email().default('no-reply@localhost'),
  MAIL_FROM_NAME: z.string().default('Georgian Dictionary'),
});

// A variable present but empty is a variable not set. `.env` files are full of
// `MAILGUN_API_KEY=` written out with nothing after it, and treating that as the string ""
// would fail a `.min(1)` that was meant to be optional — or worse, pass one that was not.
const present = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ''),
);

const parsed = schema.safeParse(present);

if (!parsed.success) {
  const lines = parsed.error.issues.map(issue => `  ${issue.path.join('.')}: ${issue.message}`);
  console.error(`Configuration is not usable:\n${lines.join('\n')}\n\nSee .env.example.`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
