// What every procedure is built from: the context it gets, and the two middlewares.
//
// `implement(contract)` means the router is checked against the shared contract at compile
// time — a procedure whose output stops matching what the browser was promised is a type
// error here, not a runtime surprise there.

import { ORPCError, implement } from '@orpc/server';
import { contract } from '@georgian/shared/contract';
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
