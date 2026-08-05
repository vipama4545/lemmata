// Better Auth: Discord and nothing else.
//
// There is no password here on purpose. The only thing an account does in this app is hold
// your review records, and a password would mean a reset flow, a hashing policy and a
// credential to leak — all of it in aid of storing which Georgian words you know. Discord
// is where the people this is for already are, so it does the identifying.
//
// Adding another provider later is a block in `socialProviders` and a button in the web
// app's sign-in panel; nothing else here assumes there is only one.

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import * as schema from '@georgian/shared/schema';
import { db } from './db/index.ts';
import { env } from './env.ts';
import { sendMail } from './mail/mailjet.ts';
import { changeEmail, deleteAccount, verifyEmail, welcome } from './mail/templates.ts';

/**
 * Whether the browser and this server are on different origins.
 *
 * In development they are not: Vite proxies /api and /rpc through to here, so the browser
 * only ever talks to its own origin and the session cookie is a plain first-party one. Set
 * them to different hosts in production and the cookie has to be marked SameSite=None,
 * which browsers only honour on a secure connection — hence Secure going along with it.
 */
const crossSite = new URL(env.BETTER_AUTH_URL).origin !== new URL(env.WEB_ORIGIN).origin;

/** Mail that fails must not take the request down with it. */
async function trySend(to: string, name: string, message: { subject: string; text: string; html: string }) {
  try {
    await sendMail({ to, toName: name, subject: message.subject, text: message.text, html: message.html });
  } catch (error) {
    console.error(`Could not send "${message.subject}" to ${to}:`, error);
  }
}

export const auth = betterAuth({
  appName: 'Georgian Dictionary',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),

  // Origins allowed to start a sign-in and receive the redirect back.
  trustedOrigins: [env.WEB_ORIGIN],

  emailAndPassword: { enabled: false },

  socialProviders: {
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      // Discord marks its own addresses as verified, and it is the only way in, so there is
      // nothing for us to re-verify at sign-up. The verification mail below is for the
      // change-email flow, which is the one case where an address arrives unproven.

      /**
       * `name` is a username and nothing else.
       *
       * Discord hands over a display name and a username; this takes the username. There is
       * no first name and no last name anywhere in this app, and nowhere that one is asked
       * for — an app that stores which Georgian words you know has no business knowing what
       * your family calls you. `global_name` is a display name the user chose, so it is
       * preferred where it exists, with the account handle behind it.
       */
      mapProfileToUser: profile => ({
        name: profile.global_name || profile.username,
      }),
    },
  },

  user: {
    additionalFields: {
      // Set by us, never by the client — hence input: false.
      locale: { type: 'string', required: false, defaultValue: 'en', input: false },
      marketingOptIn: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
    changeEmail: {
      enabled: true,
      // Sent to the address on file, not the new one: the person who can read the current
      // inbox is the one entitled to approve the move away from it.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await trySend(user.email, user.name, changeEmail(url, newEmail));
      },
    },
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        await trySend(user.email, user.name, deleteAccount(url));
      },
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await trySend(user.email, user.name, verifyEmail(url));
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      // Every oRPC call reads the session. Thirty seconds of cache turns that from a query
      // per call into a signature check, and is short enough that signing out elsewhere
      // takes effect while you are still looking at the page.
      maxAge: 30,
    },
  },

  advanced: {
    defaultCookieAttributes: crossSite
      ? { sameSite: 'none', secure: true, httpOnly: true }
      : { sameSite: 'lax', secure: env.NODE_ENV === 'production', httpOnly: true },
  },

  databaseHooks: {
    user: {
      create: {
        after: async user => {
          await trySend(user.email, user.name, welcome(user.name));
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
