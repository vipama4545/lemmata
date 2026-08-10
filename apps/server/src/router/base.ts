// What every procedure is built from: the context it gets, and the two middlewares.
//
// `implement(contract)` means the router is checked against the shared contract at compile
// time — a procedure whose output stops matching what the browser was promised is a type
// error here, not a runtime surprise there.

import { ORPCError, implement } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { contract } from '@georgian/shared/contract';
import { db, schema } from '../db/index.ts';
import type { auth } from '../auth.ts';

/** What the Fastify handler puts in front of every call. */
export interface AppContext {
  /** The resolved session, or null when signed out. Read once per request, not per call. */
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
  headers: Headers;
}

export const os = implement(contract).$context<AppContext>();

/**
 * Narrows the context to a signed-in one.
 *
 * Everything under `study` uses it. Everything under `content` deliberately does not: the
 * dictionary is readable without an account, which is the whole point of the app working
 * before you sign up.
 */
export const authed = os.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Sign in to sync your progress.' });
  }

  return next({
    context: {
      ...context,
      user: context.session.user,
    },
  });
});

/**
 * Narrows it further, to a signed-in admin.
 *
 * The flag is re-read from the `user` table rather than taken from the session, because the
 * session is cached for thirty seconds (see `cookieCache` in auth.ts) and a revoked admin
 * holding a warm cookie would otherwise keep writing to the dictionary for that long. One
 * indexed primary-key lookup per mutation is nothing next to the writes that follow it.
 *
 * FORBIDDEN rather than UNAUTHORIZED when the user is signed in but not an admin: the two
 * mean different things to a client, and "sign in again" is not the remedy for this one.
 */
export const adminOnly = os.middleware(async ({ context, next }) => {
  const sessionUser = context.session?.user;
  if (!sessionUser) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Sign in first.' });
  }

  if (!(await isAdminSession(context))) {
    throw new ORPCError('FORBIDDEN', { message: 'That is an administrator action.' });
  }

  return next({ context: { ...context, user: sessionUser } });
});

/**
 * Whether the caller is a signed-in administrator, as a question rather than a gate.
 *
 * `adminOnly` refuses; this answers. The content router needs the answer, because being an
 * admin there changes what a procedure *returns* — an unreleased language is served and
 * listed, or it is not — rather than whether the call is allowed at all.
 *
 * Same re-read from the `user` table, and for the same reason: see the note above.
 */
export async function isAdminSession(context: AppContext): Promise<boolean> {
  const sessionUser = context.session?.user;
  if (!sessionUser) return false;

  const [row] = await db
    .select({ isAdmin: schema.user.isAdmin })
    .from(schema.user)
    .where(eq(schema.user.id, sessionUser.id))
    .limit(1);

  return row?.isAdmin === true;
}
