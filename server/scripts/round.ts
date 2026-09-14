/**
 * Send one person's agent out, from the command line.
 *
 * The same call the button makes. Kept as a script because the first run of a new
 * matching path wants to be watchable: it is five model conversations and a couple of
 * minutes, and when it goes wrong you want the log, not a spinner.
 */
import { Pool } from 'pg';
import { runRound } from '../src/matching/orchestrator.js';
import { close, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';

const email = process.argv[2];
if (!email) {
  console.error('usage: tsx scripts/round.ts <email>');
  process.exit(1);
}

// The owner connection, because looking somebody up by email is exactly what the
// app role is forbidden to do -- `app_users` only answers to a named id (0004).
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const { rows } = await owner.query<{ id: string }>(
  'SELECT id FROM app_users WHERE email = $1', [email]);
const user = rows[0];
if (!user) {
  console.error(`no such user: ${email}`);
  process.exit(1);
}

const result = await runRound(user.id);
console.log(JSON.stringify(result, null, 2));

await owner.end();
await closeMatchPool();
await close();
