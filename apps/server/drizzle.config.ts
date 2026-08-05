import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// One .env at the repo root covers both apps; drizzle-kit would otherwise look in this
// directory and find nothing.
config({ path: new URL('../../.env', import.meta.url).pathname });

export default defineConfig({
  // The schema lives in the shared package because the contract's types are derived from
  // the same file the server queries through.
  schema: '../../packages/shared/src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
