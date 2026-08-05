// The two ways this app talks to the server: oRPC for data, Better Auth for who you are.
//
// Both point at the same origin the page was served from. In development Vite proxies /rpc
// and /api through to the server on port 4000, so there is no cross-origin request to make
// and the session cookie is an ordinary first-party one. Set VITE_API_URL if the two ever
// have to be deployed apart — and read the note about cookies in the server's auth.ts
// before you do, because that setup needs more than a URL change.

import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import type { ContractRouterClient } from '@orpc/contract';
import type { contract } from '@georgian/shared/contract';

// Absolute, not relative. Better Auth rejects a relative base URL outright, and an absolute
// one built from the current origin means the proxied development setup and a same-origin
// deployment both work without configuration.
const BASE = import.meta.env.VITE_API_URL || globalThis.location.origin;

const link = new RPCLink({
  url: `${BASE}/rpc`,
  // Without this the session cookie is not sent and every study call is anonymous.
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
});

/**
 * Every procedure the server has, typed from the shared contract rather than from the
 * server's implementation — the web app never imports anything from apps/server, so
 * Fastify and Drizzle stay out of this bundle entirely.
 */
export const api: ContractRouterClient<typeof contract> = createORPCClient(link);

export const authClient = createAuthClient({
  baseURL: `${BASE}/api/auth`,
  // Adds signIn.magicLink. The server has to have the matching plugin for the endpoint to
  // exist at all — see the `plugins` block in apps/server/src/auth.ts.
  plugins: [magicLinkClient()],
});

/** The session hook. Null user until the first fetch comes back, and again when signed out. */
export const useSession = authClient.useSession;

/**
 * Where a sign-in should put the browser back down, for both routes below.
 *
 * The hash matters and is easy to drop: this app routes with HashRouter, so `pathname` is
 * "/" on every screen and the route you were actually on is entirely in `location.hash`.
 * Building the return URL out of the origin and pathname alone would send everyone back to
 * the home page — including someone who signed in from the middle of a story, which is the
 * one case this is here to preserve.
 */
function returnTo(): string {
  const { origin, pathname, hash } = globalThis.location;
  return `${origin}${pathname}${hash}`;
}

/** Hands off to Discord, which sends the browser back to `returnTo()` when it is done. */
export function signInWithDiscord(): Promise<unknown> {
  return authClient.signIn.social({ provider: 'discord', callbackURL: returnTo() });
}

/**
 * Asks the server to mail a sign-in link to `email`.
 *
 * Signing in and signing up are this one call: an address with no account behind it gets
 * one when the link is followed. Nothing here reveals which of the two happened, and that
 * is deliberate — an answer that differed would turn this form into a way of asking the
 * server whether a given person has an account.
 *
 * Better Auth's client resolves with `{ error }` instead of rejecting. This rethrows so
 * that callers have one failure path rather than two.
 */
export async function sendSignInLink(email: string): Promise<void> {
  const { error } = await authClient.signIn.magicLink({ email, callbackURL: returnTo() });
  if (error) {
    throw new Error(
      error.status === 429
        ? 'That is a few too many in a row. Wait a minute and try again.'
        : error.message || 'The link could not be sent. Try again in a moment.',
    );
  }
}

export function signOut(): Promise<unknown> {
  return authClient.signOut();
}

/**
 * Marks the return from a completed deletion.
 *
 * The query string rather than the hash, because HashRouter owns everything after the `#`
 * and would treat a parameter there as part of a route. Account.tsx reads it on mount, the
 * same way it reads `?error=` from a rejected sign-in link, and takes it back out of the URL
 * so a refresh does not re-announce something that happened ten minutes ago.
 */
export const DELETED_FLAG = 'deleted';

function returnAfterDeletion(): string {
  const { origin, pathname, hash } = globalThis.location;
  const params = new URLSearchParams(globalThis.location.search);
  params.set(DELETED_FLAG, '1');
  return `${origin}${pathname}?${params.toString()}${hash}`;
}

/**
 * Asks for the account to be deleted, which sends a link rather than deleting anything.
 *
 * Nothing is gone when this resolves. The link in the mail is what does it, which is the
 * same standard the sign-in uses and the right one here for a stronger reason: this is the
 * only irreversible thing in the app, and a misclick — or somebody else at an unlocked
 * laptop — should not be enough on its own.
 *
 * The link has to be opened in a browser still signed in to the account: the endpoint reads
 * the session to know whose deletion it is confirming, and refuses without one. The dialog
 * says so, because "open it on your phone" is otherwise the obvious thing to do and it
 * fails in a way that reads like a broken link.
 */
export async function requestAccountDeletion(): Promise<void> {
  const { error } = await authClient.deleteUser({ callbackURL: returnAfterDeletion() });
  if (error) {
    throw new Error(
      error.message || 'The confirmation could not be sent. Try again in a moment.',
    );
  }
}
