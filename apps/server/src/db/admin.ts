// Granting the first admin.
//
//     npm run admin -- list
//     npm run admin -- grant nino@example.com
//     npm run admin -- revoke nino@example.com
//
// `user.is_admin` is the only thing that grants access to the editing screens — there is no
// list of addresses in the environment, and nothing in Better Auth can set the column, which
// is what `input: false` in auth.ts is for. So a fresh database has no admins at all, and
// this is how the first one is made: from a shell on the host, by whoever can already reach
// the database. Every one after that can be promoted from the admin screens.
//
// In Portainer there is no `compose run`, so do it the way seeding is done — Containers →
// lemmata-server-1 → Console → /bin/sh:
//
//     node --import tsx apps/server/src/db/admin.ts grant nino@example.com

import { asc, eq } from 'drizzle-orm';
import { db, schema, sql } from './index.ts';

const [action, email] = process.argv.slice(2);

function usage(message?: string): never {
  if (message) console.error(`${message}\n`);
  console.error('Usage:\n  npm run admin -- list\n  npm run admin -- grant <email>\n  npm run admin -- revoke <email>');
  process.exit(1);
}

async function list(): Promise<void> {
  const users = await db
    .select({
      name: schema.user.name,
      email: schema.user.email,
      isAdmin: schema.user.isAdmin,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(asc(schema.user.createdAt));

  if (!users.length) {
    console.log('No accounts yet. Sign in through the app first, then grant that address.');
    return;
  }

  const width = Math.max(...users.map(user => user.email.length));
  for (const user of users) {
    console.log(`  ${user.isAdmin ? 'admin' : '     '}  ${user.email.padEnd(width)}  ${user.name}`);
  }

  const admins = users.filter(user => user.isAdmin).length;
  console.log(`\n${users.length} account(s), ${admins} admin(s).`);
}

async function setAdmin(address: string, isAdmin: boolean): Promise<void> {
  // Addresses are stored as they were given. Lower-casing the needle and comparing against a
  // lower-cased column is the difference between this working and it reporting "no account"
  // for somebody who signed up as Nino@example.com.
  const [user] = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, isAdmin: schema.user.isAdmin })
    .from(schema.user)
    .where(eq(schema.user.email, address))
    .limit(1);

  if (!user) {
    const near = await db.select({ email: schema.user.email }).from(schema.user);
    const match = near.find(row => row.email.toLowerCase() === address.toLowerCase());
    if (match) {
      console.error(`No account for "${address}". Did you mean "${match.email}"? Addresses are stored as given.`);
    } else {
      console.error(`No account for "${address}". They have to sign in once before they can be granted anything.`);
    }
    process.exit(1);
  }

  if (user.isAdmin === isAdmin) {
    console.log(`${user.email} is already ${isAdmin ? 'an admin' : 'not an admin'}. Nothing to do.`);
    return;
  }

  await db.update(schema.user).set({ isAdmin }).where(eq(schema.user.id, user.id));
  console.log(`${user.email} (${user.name}) is ${isAdmin ? 'now an admin' : 'no longer an admin'}.`);

  if (!isAdmin) {
    const remaining = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.isAdmin, true));
    if (!remaining.length) {
      console.warn('\nThere are now no admins at all. Grant one before the editing screens are reachable again.');
    }
  }
}

switch (action) {
  case 'list':
    await list();
    break;
  case 'grant':
  case 'revoke':
    if (!email) usage(`"${action}" needs an email address.`);
    await setAdmin(email, action === 'grant');
    break;
  default:
    usage(action ? `Unknown command "${action}".` : undefined);
}

await sql.end({ timeout: 5 });
