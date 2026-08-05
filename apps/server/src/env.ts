// Configuration, checked once at boot.
//
// A missing DISCORD_CLIENT_SECRET should stop the process here, with the name of the
// variable, rather than surface half an hour later as a redirect that fails for one user.
// The two exceptions are the Mailjet credentials: without them the server still runs and
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

  // Optional as a pair: both or neither. See mail/mailjet.ts.
  MAILJET_API_KEY: z.string().min(1).optional(),
  MAILJET_API_SECRET: z.string().min(1).optional(),
  MAIL_FROM_EMAIL: z.email().default('no-reply@localhost'),
  MAIL_FROM_NAME: z.string().default('Georgian Dictionary'),
});

// A variable present but empty is a variable not set. `.env` files are full of
// `MAILJET_API_KEY=` written out with nothing after it, and treating that as the string ""
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
