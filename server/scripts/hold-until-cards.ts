/**
 * Take every real person who is in the pool without their five core cards out of it.
 *
 * WHAT WAS WRONG. The five cards (kids, one person or open, smoking, drinking, food)
 * became a pool condition in code. `in_pool` is a stored flag, so everybody who set up
 * before the cards kept `in_pool = true` with no card on file. Measured 2026-09-23,
 * read-only: all six real users. The Home and "send my agent out" now re-check it
 * (poolNow in matching/profile.ts), but only for somebody who opens the app. A person
 * who does not stays in other people's candidate lists, with none of the five answered,
 * until the sixty-day activity filter drops them.
 *
 * WHAT THIS DOES, AND WHAT IT REFUSES TO DO. It sets `in_pool = false` on real
 * profiles that are in the pool with fewer than five card answers, and nothing else.
 * It deletes nothing and rebuilds nothing: a rebuild would stamp `last_active_at`, and
 * a script run is not the person being here. Invented profiles are never touched --
 * they carry no cards and need none. The next time a person opens the app, their
 * profile is rebuilt from their own facts and the missing cards are named, and the
 * "needs a few more things" card on Matches takes them to answer them.
 *
 * Idempotent: a second run finds nobody. `--dry` prints how many it would hold and
 * writes nothing. It prints counts only, never who.
 *
 * No model is called. It reads and writes the database and nothing else.
 *
 *   npx tsx scripts/hold-until-cards.ts --dry
 *   npx tsx scripts/hold-until-cards.ts
 */
import { Pool } from 'pg';
import { holdUntilCardsDone } from '../src/matching/profile.js';
import { env } from '../src/env.js';

const DRY = process.argv.includes('--dry');

// The owner connection, as backfill-areas.ts uses: this reads and writes across tenants.
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

async function main(): Promise<void> {
  const { rows } = await owner.query<{ n: string }>(
    'SELECT count(*) AS n FROM match_profile WHERE NOT is_synthetic AND in_pool');
  console.log(`${rows[0]!.n} real profiles are in the pool`);

  const c = await owner.connect();
  try {
    const held = await holdUntilCardsDone(c, { dry: DRY });
    console.log(DRY
      ? `${held.length} of them have fewer than five cards and would leave the pool.\n--dry: nothing written`
      : `${held.length} of them had fewer than five cards and are out of the pool until they answer them.`);
  } finally {
    c.release();
  }
  await owner.end();
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
