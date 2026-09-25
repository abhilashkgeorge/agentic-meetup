/**
 * Spread the synthetic crowd across the thirty neighbourhoods.
 *
 * WHAT WAS WRONG. Every synthetic Bangalore profile in the database sits on one point
 * -- 12.9716, 77.5946, the city centre -- because they were seeded before areas
 * existed. The roster derives the tile an agent stands in from its point
 * (`areaOf` in api/world.ts, `nearestArea(lat, lon) ?? CENTRAL_AREA`), so all of them
 * come back as MG Road and the whole city stands in one square. Measured 2026-09-23:
 * 5,008 synthetics, 2,349 of them on that single point, and 2 profiles in the entire
 * table carrying a `traits.area` at all. The founder saw it on the phone and said so.
 *
 * WHAT THIS DOES, AND WHAT IT REFUSES TO DO. It UPDATES; it never deletes and never
 * inserts, so the crowd, their facts, their voices and their episodes are all left
 * alone -- reseeding would have been the quick way and would have thrown away five
 * thousand rows the founder asked to keep. For each synthetic whose point is already
 * in Bengaluru it picks a neighbourhood weighted exactly the way `makeProfile` does,
 * writes `traits.area`, and moves `lat`/`lon` to that neighbourhood's centre. Both,
 * because the roster reads the point and `rebuildMatchProfile` only keeps the point on
 * the centre while the trait agrees with it.
 *
 * DETERMINISTIC, so it is idempotent and reviewable: the neighbourhood comes from a
 * hash of the user's own id, not from a running counter or the clock. Run it twice and
 * nothing moves the second time. `--dry` prints the distribution and writes nothing.
 *
 * REAL PEOPLE ARE NOT TOUCHED. A person who has answered "Which part of town?" has
 * their own answer, and a person who has not is asked by the chip -- neither is this
 * script's business. Nor is anybody outside Bengaluru: a Mumbai synthetic stays in
 * Mumbai, which is what keeps the distance filter honest.
 *
 * No model is called. It reads and writes the database and nothing else.
 *
 *   npx tsx scripts/backfill-areas.ts --dry
 *   npx tsx scripts/backfill-areas.ts
 */
import { Pool } from 'pg';
import { AREAS, nearestArea } from '@clone/shared';
import { areaForUser } from '../src/matching/area-spread.js';
import { env } from '../src/env.js';

const DRY = process.argv.includes('--dry');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

async function main(): Promise<void> {
  const { rows } = await owner.query<{ user_id: string; lat: number | null; lon: number | null; area: string | null }>(`
    SELECT user_id, lat, lon, traits->>'area' AS area
      FROM match_profile
     WHERE is_synthetic AND lat IS NOT NULL AND lon IS NOT NULL`);

  // Bengaluru by the same test the generator uses: near a neighbourhood centre. A
  // profile already on a neighbourhood centre passes too, which is how a second run
  // finds nothing left to do.
  const mine = rows.filter((r) => nearestArea(r.lat!, r.lon!, 3) !== null);
  console.log(`${rows.length} synthetics with a point, ${mine.length} of them in Bengaluru`);

  const plan = new Map<string, string | null>();
  for (const r of mine) plan.set(r.user_id, areaForUser(r.user_id));

  const count = new Map<string, number>();
  for (const a of plan.values()) count.set(a ?? '(none)', (count.get(a ?? '(none)') ?? 0) + 1);
  const sorted = [...count].sort((a, b) => b[1] - a[1]);
  console.log('\nplanned spread:');
  for (const [a, n] of sorted) console.log(`  ${a.padEnd(18)} ${String(n).padStart(5)}  ${(n / mine.length * 100).toFixed(1)}%`);
  console.log(`  ${sorted.length} distinct, biggest ${(sorted[0]![1] / mine.length * 100).toFixed(1)}%`);

  if (DRY) { console.log('\n--dry: nothing written'); await owner.end(); return; }

  const centre = new Map(AREAS.map((a) => [a.id, a]));
  let moved = 0;
  for (const [userId, area] of plan) {
    if (area === null) continue; // a hole stays where it is: the city centre, unnamed.
    const c = centre.get(area)!;
    await owner.query(
      `UPDATE match_profile
          SET traits = jsonb_set(coalesce(traits, '{}'::jsonb), '{area}', to_jsonb($2::text), true),
              lat = $3, lon = $4
        WHERE user_id = $1 AND is_synthetic`,
      [userId, area, c.lat, c.lon]);
    moved++;
  }
  console.log(`\nmoved ${moved} synthetics onto their own neighbourhood centre`);
  await owner.end();
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
