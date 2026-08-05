// Better Auth: Discord, or a link mailed to an address.
//
// There is still no password here, and the second option is how it stays that way rather
// than a step towards one. The only thing an account does in this app is hold your review
// records, and a password would mean a reset flow, a hashing policy and a credential to
// leak — all of it in aid of storing which Georgian words you know. A mailed link needs
// none of it: reading the inbox is the proof, the token is single-use and dead in fifteen
// minutes, and a stolen copy of this database contains nothing anyone can sign in with.
//
// Signing up and signing in are the same request. An address with no account behind it
// gets one when the link is followed, which is why the web app has one form and not two.
//
// Adding another provider later is a block in `socialProviders` and a button in the web
// app's sign-in panel; nothing else here assumes there is only one.

import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import * as schema from '@georgian/shared/schema';
import { db } from './db/index.ts';
import { env } from './env.ts';
import { sendMail } from './mail/mailgun.ts';
import { changeEmail, deleteAccount, signInLink, verifyEmail, welcome } from './mail/templates.ts';

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

/**
 * A username for an account that arrived by email, where nobody was asked for one.
 *
 * The local part as written, minus any `+tag`, which is a routing detail its owner did not
 * choose as a name. Not split on a dot to pull a first name out of `nino.beridze` — that
 * guess is wrong for most of the world and reads as prying when it is right. If the result
 * is empty or absurd, the address itself is the name; a blank one is the only bad outcome,
 * because it is what the sidebar would then render.
 */
function usernameFromEmail(email: string): string {
  const local = email.slice(0, email.lastIndexOf('@'));
  const untagged = local.split('+')[0].trim();
  return untagged.length > 0 && untagged.length <= 64 ? untagged : email;
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

  // Still off, and the magic-link plugin below is why it can stay off: an address can sign
  // in here without one ever being set. See the note at the top of this file.
  emailAndPassword: { enabled: false },

  plugins: [
    magicLink({
      // Fifteen minutes. Long enough to walk to another device and open the mail there,
      // short enough that a link left sitting in an inbox is not a standing key to the
      // account. The web app's panel quotes this figure, so the two move together.
      expiresIn: 60 * 15,

      // What is stored against the request is a hash of the token, not the token. The one
      // in the mail is the only usable copy, so read access to `verification` — a backup, a
      // support query, a dump — hands over nothing that can be redeemed.
      storeToken: 'hashed',

      // An address nobody has used before gets an account when the link is followed. This
      // is the "sign up with email" half, and it is the default; it is written out because
      // the alternative is one word and would otherwise look like an oversight.
      disableSignUp: false,

      // Three a minute per address. The endpoint answers the same either way — see below —
      // so the thing worth limiting is not guessing but using this server to post mail at
      // somebody who never asked for it.
      rateLimit: { window: 60, max: 3 },

      /**
       * Note `sendMail` rather than the `trySend` above: here the mail *is* the sign-in.
       * Swallowing a Mailgun failure would leave the panel saying "check your inbox" about
       * a message that was never accepted, and the person waiting on it has no way to tell
       * that from a slow one. Throwing gets a failure onto the screen they are looking at.
       */
      sendMagicLink: async ({ email, url }) => {
        const message = signInLink(url);
        await sendMail({
          to: email,
          // No name to greet them by yet, and asking for one before they are in would be a
          // form standing where a single field should be.
          toName: email,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
      },
    }),
  ],

  socialProviders: {
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      // Discord marks its own addresses as verified, and an address that arrived by magic
      // link proved itself by receiving the link, so neither route leaves anything for us to
      // re-verify at sign-up. The verification mail below is for the change-email flow,
      // which is the one case where an address arrives unproven.

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
      /**
       * `input: false` matters more here than on the two above.
       *
       * Better Auth will happily write any additional field it is handed — by a sign-up
       * body, by `updateUser`, by an OAuth profile mapping. Declaring this one as not an
       * input takes all three routes away, which leaves exactly two ways to become an
       * admin: the CLI on the host, and an existing admin saying so. Both go through
       * Drizzle directly rather than through this library.
       */
      isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
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
        /**
         * Gives an account a name when it arrived without one.
         *
         * The magic-link plugin creates users with `name: ''` unless the sign-in request
         * carried one, and ours never does — the panel is a single email field on purpose.
         * An empty string satisfies the not-null column and then shows up as a blank line
         * in the sidebar where the username goes, so it is filled here rather than left to
         * every reader of `user.name` to cope with.
         *
         * Discord accounts arrive with a name already set by `mapProfileToUser` and fall
         * straight through.
         */
        before: async user => {
          if (user.name?.trim()) return;
          return { data: { name: usernameFromEmail(user.email) } };
        },
        after: async user => {
          await trySend(user.email, user.name, welcome(user.name));
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
