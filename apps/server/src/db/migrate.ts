// Applies every migration in drizzle/ that has not run yet, then exits.
//
// A separate process rather than something the server does at boot: two instances starting
// at once would otherwise race to alter the same tables, and a migration that fails should
// stop a deploy rather than leave a server up and serving against a half-changed schema.

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './index.ts';

const folder = new URL('../../drizzle', import.meta.url).pathname;

try {
  await migrate(db, { migrationsFolder: folder });
  console.log('Migrations are up to date.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
