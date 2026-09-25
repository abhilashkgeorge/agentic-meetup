/**
 * The erasure path must cover every table that holds user rows.
 *
 * `USER_TABLES` carried a comment saying to keep it updated, and then five tables --
 * rounds, graders, round_grades, self_tests, device_sessions -- were added without it.
 * Nothing failed. Erasure would have reported success while leaving somebody's weekly
 * rounds, their friends' names, and their live login sessions in the database.
 *
 * A comment is not a mechanism. This was -- and then it missed four tables of its own,
 * because it looked for a column NAMED `user_id`, and messaging names its columns
 * `sender_id`, `blocker_id`, `reporter_id`, `user_a`. A check that depends on a naming
 * convention is a naming convention.
 *
 * So it follows FOREIGN KEYS to `app_users` instead. That is what "holds a user row"
 * means, it cannot be sidestepped by choosing a different column name, and a table
 * that references users without a foreign key is a bug this would rather report than
 * accommodate.
 */
import { afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { ERASED_TABLES } from '../src/memory/erasure.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

/**
 * Tables that hold a user_id and are deliberately NOT erased. Every entry needs a
 * reason, because this list is the only way a real hole can hide from the check.
 */
const KEPT: Record<string, string> = {
  // The proof the erasure happened. Counts only -- no content, no quotes, nothing
  // that could reconstitute the person. Deleting it would mean having no record that
  // a deletion was ever performed, which is the one thing that must outlive it.
  erasure_log: 'survives by design: counts only, and it is the receipt for the erasure',
  // Rows survive with the person's name taken off, which is why they are not in the
  // delete list -- but the erasure DOES clear every reference to them, and its own
  // verification step re-counts these to prove it.
  invites: 'anonymised, not deleted: a spent invite stays spent, used by nobody we name',
  reports: 'anonymised, not deleted: the safety signal about the OTHER person survives',
  // A ban must outlive the account, or erasing it is the way back in. The row loses its
  // user when the account goes (user_id ON DELETE SET NULL, 0064); what keeps it
  // pointing at somebody afterwards is the phone and the device (0065).
  bans: 'survives by design: a ban that erasure lifted would be no ban at all',
};

afterAll(() => owner.end());

it('every table that references a user is erased', async () => {
  // relispartition excludes the 32 hash partitions of episodes: the parent is in the
  // list and a DELETE against it reaches every one of them.
  const { rows } = await owner.query<{ table_name: string; column_name: string }>(
    `SELECT DISTINCT c.relname AS table_name, a.attname AS column_name
       FROM pg_constraint con
       JOIN pg_class      c ON c.oid = con.conrelid
       JOIN pg_namespace  n ON n.oid = c.relnamespace
       JOIN unnest(con.conkey) AS k(attnum) ON true
       JOIN pg_attribute  a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      WHERE con.contype = 'f'
        AND con.confrelid = 'app_users'::regclass
        AND n.nspname = 'public'
        AND NOT c.relispartition
      ORDER BY 1`,
  );

  const covered = new Set<string>(ERASED_TABLES);
  const missing = [...new Set(rows.map((r) => r.table_name))]
    .filter((t) => !covered.has(t) && !(t in KEPT));

  expect(missing, `not erased: ${missing.join(', ')}`).toEqual([]);
});

it('every table named in the list actually exists', async () => {
  // The other direction. A renamed table leaves a dead entry, and a DELETE against a
  // table that is not there throws mid-erasure, which is worse than not listing it.
  const { rows } = await owner.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const real = new Set(rows.map((r) => r.table_name));
  const ghosts = ERASED_TABLES.filter((t) => !real.has(t));
  expect(ghosts, `listed but missing: ${ghosts.join(', ')}`).toEqual([]);
});

it('nothing is silently exempted', () => {
  // An exemption without a reason is a hole with a comment in front of it.
  for (const [table, why] of Object.entries(KEPT)) {
    expect(why.length, `${table} is exempted with no reason`).toBeGreaterThan(20);
  }
});
