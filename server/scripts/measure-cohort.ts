/**
 * Measure one cohort against itself, so the variable under test is the only one.
 *
 * WHY NOT `measure-pairs.ts`. That script uses `runRound`, which picks a partner by
 * ranking the whole pool -- and every synthetic profile is a candidate for every
 * other one regardless of which tenant it lives in. A rich profile put in front of
 * `runRound` is matched with the template pool, which is precisely the comparison
 * this is trying to avoid.
 *
 * So this pairs within a named cohort and calls `converse` directly. It writes no
 * rendezvous rows and no briefs: it is a measurement, not a round, and leaving
 * `rendezvous` rows behind would permanently consume pairs that a real round could
 * otherwise use (a pair meets once, ever).
 *
 * WHAT IT IS FOR. Over 47 pairs of the template pool the agents agreed 79.3% of the
 * time against a 50% pass mark. The founder -- the only rich, real dossier -- scored
 * about 12% over seven rounds. Two explanations fit and they have opposite
 * consequences: the pool is too bland to disagree with, or specificity is punished
 * and the product's promise is inverted. Running the same code over a hand-written
 * rich cohort and over the template pool separates them.
 *
 *   tsx scripts/measure-cohort.ts rich-pool 8 0.60
 *   tsx scripts/measure-cohort.ts template 12 0.60
 */
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { close, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { RUNS, converse, quorum } from '../src/matching/rendezvous.js';
import { metered } from '../src/metering.js';

const COHORT = process.argv[2] ?? 'rich-pool';
const WANT = Number(process.argv[3] ?? 8);
const CEILING = Number(process.argv[4] ?? 0.6);
const OUT = process.env.COHORT_OUT ?? `var/cohort-${COHORT}.json`;

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

interface Row {
  user_id: string; tenant_id: string; display_name: string;
  gender: string; seeking_gender: string[]; synthetic_dossier: string;
}

// `template` means the generated 5,000; anything else is a tenant name.
const { rows: people } = await owner.query<Row>(
  COHORT === 'template'
    ? `SELECT p.user_id, p.tenant_id, p.display_name, p.gender, p.seeking_gender,
              p.synthetic_dossier
         FROM match_profile p
         JOIN tenants t ON t.id = p.tenant_id
        WHERE p.is_synthetic AND p.in_pool AND p.synthetic_dossier IS NOT NULL
          AND t.name <> 'rich-pool'
        ORDER BY p.user_id LIMIT $1`
    : `SELECT p.user_id, p.tenant_id, p.display_name, p.gender, p.seeking_gender,
              p.synthetic_dossier
         FROM match_profile p
         JOIN tenants t ON t.id = p.tenant_id
        WHERE t.name = $2 AND p.synthetic_dossier IS NOT NULL
        ORDER BY p.display_name LIMIT $1`,
  COHORT === 'template' ? [WANT * 4] : [WANT * 4, COHORT],
);

/** Pair people who would actually be shown each other, so gender is respected. */
const pairs: [Row, Row][] = [];
const used = new Set<string>();
for (const a of people) {
  if (pairs.length >= WANT) break;
  if (used.has(a.user_id)) continue;
  const b = people.find((x) =>
    !used.has(x.user_id) && x.user_id !== a.user_id
    && a.seeking_gender.includes(x.gender) && x.seeking_gender.includes(a.gender));
  if (!b) continue;
  used.add(a.user_id); used.add(b.user_id);
  pairs.push([a, b]);
}

const side = (r: Row) => ({
  userId: r.user_id, tenantId: r.tenant_id, dossier: r.synthetic_dossier, voice: '',
});

console.log(`cohort "${COHORT}": ${pairs.length} pairs, RUNS=${RUNS}, ceiling $${CEILING.toFixed(2)}`);
console.log(`assessor model: ${env.ASSESS_MODEL || '(same as prober)'}\n`);

interface Measured {
  a: string; b: string; bothYes: number; runs: number; costUsd: number;
  /**
   * WHY they said what they said, carried through verbatim.
   *
   * The first run of this script recorded only the counts, and when the rich cohort
   * came back 0-of-4 four times running there was nothing to look at -- the single
   * most interesting result in the project, and the reasons had been thrown away. The
   * verdict is the measurement; the concern is the explanation, and an explanation
   * you have to pay again to obtain is one you will not obtain.
   */
  verdicts: { run: number; a: string; b: string; aConcern: string; bConcern: string }[];
}

const results: Measured[] = [];
let spent = 0;

for (const [i, [a, b]] of pairs.entries()) {
  if (spent >= CEILING) { console.log(`\nSTOPPED at the ceiling after ${i} pairs`); break; }
  try {
    // Metered like everything else. These are synthetic accounts with no budget row,
    // so the per-user cap would not fire; the ceiling above is what stops this.
    const out = await metered({ tenantId: a.tenant_id, userId: a.user_id },
      'measure', () => converse(side(a), side(b)));
    spent += out.costUsd;
    results.push({
      a: a.display_name, b: b.display_name,
      bothYes: out.bothYes, runs: out.counted, costUsd: out.costUsd,
      verdicts: out.results.map((r) => ({
        run: r.runNo, a: r.aVerdict, b: r.bVerdict,
        aConcern: r.aConcern, bConcern: r.bConcern,
      })),
    });
    const bar = out.counted ? '#'.repeat(out.bothYes) + '.'.repeat(out.counted - out.bothYes) : '-';
    const passes = out.counted >= quorum(RUNS) && out.bothYes / out.counted > 0.5;
    console.log(
      `${String(i + 1).padStart(3)} ${bar.padEnd(RUNS + 1)} ${out.bothYes}/${out.counted}`
      + `  ${passes ? 'PASS' : '    '}  $${spent.toFixed(4)}  ${a.display_name} × ${b.display_name}`,
    );
    // One reservation per pair, on screen. A column of zeroes with no reasons beside
    // it is a result nobody can act on.
    const last = out.results[out.results.length - 1];
    if (last) console.log(`      ${a.display_name}: ${last.aConcern}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`${String(i + 1).padStart(3)} ERROR ${message}`);
    if (message.includes('budget')) break;
  }
}

const counted = results.filter((r) => r.runs > 0);
const mean = counted.length
  ? counted.reduce((s, r) => s + r.bothYes / r.runs, 0) / counted.length : 0;
const passed = counted.filter((r) => r.runs >= quorum(RUNS) && r.bothYes / r.runs > 0.5).length;

console.log(`\n── cohort "${COHORT}" over ${counted.length} pairs ──`);
console.log(`mean agreement : ${(100 * mean).toFixed(1)}%`);
console.log(`passed         : ${passed} of ${counted.length}`);
console.log(`spent          : $${spent.toFixed(4)}`);
console.log('\nbaseline, template pool under the OLD assessor: 79.3% mean, 36 of 47 passed');

writeFileSync(OUT, JSON.stringify({
  cohort: COHORT, runs: RUNS, assessModel: env.ASSESS_MODEL || null,
  pairs: counted.length, mean, passed, spentUsd: spent, results,
}, null, 2));
console.log(`\nwritten to ${OUT}`);

await owner.end();
await closeMatchPool();
await close();
