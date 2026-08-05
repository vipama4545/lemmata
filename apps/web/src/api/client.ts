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

export const authClient = createAuthClient({ baseURL: `${BASE}/api/auth` });

/** The session hook. Null user until the first fetch comes back, and again when signed out. */
export const useSession = authClient.useSession;

/**
 * Hands off to Discord.
 *
 * `callbackURL` is where Discord's redirect eventually lands the browser back in this app.
 * It is the current page rather than the home page, so signing in from the middle of a
 * story returns you to that story.
 */
export function signInWithDiscord(): Promise<unknown> {
  return authClient.signIn.social({
    provider: 'discord',
    callbackURL: `${globalThis.location.origin}${globalThis.location.pathname}`,
  });
}

export function signOut(): Promise<unknown> {
  return authClient.signOut();
}
