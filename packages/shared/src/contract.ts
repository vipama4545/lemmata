// The contract between the browser and the server: every call there is, and the shape of
// what goes each way. Both ends import this and neither imports the other, so the client
// gets its types without dragging Fastify and Drizzle into the web app's build.
//
// Inputs are Zod schemas because they arrive from the network and have to be checked.
// Outputs are `type<T>()`, which is a type with no runtime validator behind it: the
// snapshot is four megabytes of data this server generated itself, and re-parsing it on
// the way out would cost more than everything else the request does put together.

import { oc, type } from '@orpc/contract';
import { z } from 'zod';
import type {
  ImageMap,
  MorphemeData,
  Mastery,
  Side,
  Story,
  StorySummary,
  StudyCardWire,
  VerbData,
  WordData,
} from './types.ts';

/* ---------------------------------------------------------------- content */

/**
 * The paradigms, as they cross the wire.
 *
 * `persons`, `screeves` and `series` are missing on purpose: they are fixed facts about
 * Georgian, they live as constants in ./grammar.ts, and the client already has them before
 * it makes a single request. Sending them would be sending the client its own source code.
 * The web app puts the two halves back together into a whole `VerbData`.
 */
export type VerbContent = Omit<VerbData, 'persons' | 'screeves' | 'series'>;

/** Everything the app needs to render anything, minus the stories' own text. */
export interface ContentSnapshot {
  /** Opaque. The client stores it and sends it back; only equality is ever checked. */
  version: string;
  words: WordData;
  verbs: VerbContent;
  morphemes: MorphemeData;
  images: ImageMap;
  categoryImages: ImageMap;
  stories: StorySummary[];
}

/**
 * What `content.snapshot` answers.
 *
 * The client sends the version it has cached and gets four bytes back when nothing has
 * changed, which is the common case for every visit after the first.
 */
export type SnapshotResponse =
  | { upToDate: true; version: string }
  | ({ upToDate: false } & ContentSnapshot);

const contentContract = {
  /** The current version on its own, for a cheap check without the payload. */
  version: oc.output(type<{ version: string }>()),

  snapshot: oc
    .input(z.object({ known: z.string().optional() }))
    .output(type<SnapshotResponse>()),

  /** One story with its text and every token. Null when there is no such story. */
  story: oc.input(z.object({ id: z.string().min(1).max(128) })).output(type<Story | null>()),
};

/* ------------------------------------------------------------------ study */

/** Who you are, as far as the app is concerned. Null when signed out. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

const MASTERY = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]) satisfies z.ZodType<Mastery>;

const SIDE = z.enum(['ka', 'en']) satisfies z.ZodType<Side>;

/**
 * One card on its way up.
 *
 * The bounds are not ceremony. `card` is a key the client makes up, and `interval`, `ease`
 * and `reps` are numbers a modified client could send as anything at all: a card with an
 * interval of 1e308 is a card that never comes round again, which is a quiet way to lose
 * your own vocabulary.
 */
export const studyCardInput = z.object({
  card: z.string().min(3).max(160),
  item: z.string().min(1).max(128),
  side: SIDE,
  level: MASTERY,
  interval: z.number().min(0).max(365),
  ease: z.number().min(1).max(5),
  due: z.number().int(),
  reps: z.number().int().min(0).max(100_000),
  lapses: z.number().int().min(0).max(100_000),
  last: z.number().int(),
  created: z.number().int(),
  introduced: z.enum(['review', 'marked']),
  deleted: z.boolean(),
  updatedAt: z.number().int(),
}) satisfies z.ZodType<StudyCardWire>;

const studyContract = {
  /**
   * This account's cards. `since` asks only for what changed after that instant, which is
   * what every sync after the first one wants.
   */
  pull: oc
    .input(z.object({ since: z.number().int().optional() }))
    .output(type<{ cards: StudyCardWire[]; syncedAt: number }>()),

  /**
   * Cards on their way up. The server keeps whichever copy of a card has the later
   * `updatedAt`, so pushing something stale is a no-op rather than a regression — which is
   * what makes it safe to push the whole local store on first sign-in.
   */
  push: oc
    .input(z.object({ cards: z.array(studyCardInput).max(20_000) }))
    .output(type<{ accepted: number; syncedAt: number }>()),

  /** Forgets everything, on the server. Tombstones rather than deletes, so it syncs down. */
  reset: oc.output(type<{ cleared: number }>()),
};

/* ---------------------------------------------------------------- session */

const sessionContract = {
  me: oc.output(type<SessionUser | null>()),
};

export const contract = {
  content: contentContract,
  study: studyContract,
  session: sessionContract,
};

export type Contract = typeof contract;
