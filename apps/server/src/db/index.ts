// The one connection pool, and the one Drizzle client on top of it.
//
// postgres.js rather than node-postgres: Drizzle supports both, and this one parses to
// JavaScript values without a second layer of type parsers to configure.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@georgian/shared/schema';
import { env, isProduction } from '../env.ts';

/**
 * The pool. Ten is generous for this app — the only heavy query is the snapshot, and that
 * is answered from a cache — but leaves room for the seed to run against a live server.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: isProduction ? 10 : 5,
  // The seed writes a story's tokens in one statement with a few thousand placeholders.
  max_lifetime: 60 * 30,
  onnotice: isProduction ? () => {} : undefined,
});

export const db = drizzle(sql, { schema });

export type Database = typeof db;

export { schema };
