/**
 * Does the rendezvous actually discriminate between pairs?
 *
 * THE QUESTION THIS ANSWERS, AND WHY IT HAD TO BE ASKED. Seven real rounds had been
 * run against the 5,000-person pool and none had passed. Zero out of seven is
 * consistent with three completely different worlds:
 *
 *   the bar is too high     -- `passes` needs bothYes/runs > 0.5, chosen, never fitted
 *   the pool is wrong       -- those seven people were genuinely bad matches
 *   it measures nothing     -- two instances of one model, reliably declining
 *
 * You cannot tell them apart from seven samples, and the threshold cannot honestly be
 * tuned until you have seen the distribution it is supposed to cut. So: run many
 * pairs, record `both_yes` for each, and look at the shape. A spread means the
 * mechanism ranks. A spike at zero means it does not, and no threshold will save it.
 *
 * SYNTHETIC PAIRS, DELIBERATELY. There are three real profiles in this database, so
 * real-versus-real cannot produce fifty pairs at any price. Synthetic dossiers come
 * from templates and are more uniform than real people, which makes this a
 * CONSERVATIVE test of discrimination: if the agents can separate these, they can
 * separate people; if they cannot separate these, that is the answer and it was cheap.
 *
 * COST. Roughly $0.023 a pair at five runs. The ceiling below is a hard stop checked
 * between pairs, because an unfunded project's real catastrophe is a loop that runs
 * all night. Synthetic users have no `tenant_budget` row and `checkBudget` returns
 * early when there is none, so the per-user cap would NOT have fired here -- this
 * script writes one for every user it touches before it spends anything.
 *
 *   tsx scripts/measure-pairs.ts [pairs=50] [ceilingUsd=1.50]
 */
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { runRound } from '../src/matching/orchestrator.js';
import { close, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { RUNS } from '../src/matching/rendezvous.js';

const WANT = Number(process.argv[2] ?? 50);
const CEILING = Number(process.argv[3] ?? 1.5);
const OUT = process.env.MEASURE_OUT ?? 'var/measure-pairs.json';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

// Candidates: synthetic, in the pool, and not yet paired with anybody. Ordered by id
// rather than at random so a re-run continues where it stopped instead of starting a
// fresh sample -- and so this script is reproducible.
const { rows: pool } = await owner.query<{ user_id: string; tenant_id: string }>(
  `SELECT p.user_id, p.tenant_id
     FROM match_profile p
    WHERE p.is_synthetic AND p.in_pool
      AND NOT EXISTS (SELECT 1 FROM rendezvous r
                       WHERE r.user_a = p.user_id OR r.user_b = p.user_id)
    ORDER BY p.user_id
    LIMIT $1`,
  [WANT],
);

if (pool.length < WANT) {
  console.error(`only ${pool.length} unpaired synthetic profiles available; wanted ${WANT}`);
}

// A cap per user before a single token is spent. See the note above: without this the
// budget check is a no-op for these accounts.
for (const p of pool) {
  await owner.query(
    `INSERT INTO tenant_budget (tenant_id, user_id, day, turn_cap, daily_cost_cap)
     VALUES ($1,$2,CURRENT_DATE,10000,$3)
     ON CONFLICT (tenant_id, user_id, day)
       DO UPDATE SET turn_cap = 10000, daily_cost_cap = $3`,
    [p.tenant_id, p.user_id, CEILING],
  );
}

interface Row {
  userId: string; met: string | null; bothYes: number; runs: number;
  passed: boolean; costUsd: number; skipped?: string;
}

const results: Row[] = [];
let spent = 0;
const started = Date.now();

console.log(`measuring ${pool.length} pairs at RUNS=${RUNS}, ceiling $${CEILING.toFixed(2)}\n`);

for (const [i, p] of pool.entries()) {
  if (spent >= CEILING) {
    console.log(`\nSTOPPED at the ceiling after ${i} pairs: $${spent.toFixed(4)}`);
    break;
  }
  try {
    const r = await runRound(p.user_id);
    spent += r.costUsd;
    results.push({
      userId: r.userId, met: r.met, bothYes: r.bothYes, runs: r.runs,
      passed: r.passed, costUsd: r.costUsd, ...(r.skipped ? { skipped: r.skipped } : {}),
    });
    const bar = r.runs ? '#'.repeat(r.bothYes) + '.'.repeat(Math.max(0, r.runs - r.bothYes)) : '-';
    console.log(
      `${String(i + 1).padStart(3)} ${bar.padEnd(RUNS + 1)} `
      + `bothYes ${r.bothYes}/${r.runs}  ${r.passed ? 'PASS' : '    '}  `
      + `$${r.costUsd.toFixed(4)}  total $${spent.toFixed(4)}`
      + (r.skipped ? `  (${r.skipped})` : ''),
    );
  } catch (err) {
    // One bad pair must not end the measurement; a budget refusal must.
    const message = err instanceof Error ? err.message : String(err);
    console.log(`${String(i + 1).padStart(3)} ERROR ${message}`);
    if (message.includes('budget')) break;
  }
}

// ── the shape ────────────────────────────────────────────────────────────────
const counted = results.filter((r) => r.runs > 0);
const hist = new Map<number, number>();
for (const r of counted) hist.set(r.bothYes, (hist.get(r.bothYes) ?? 0) + 1);

console.log(`\n── both_yes distribution over ${counted.length} completed pairs ──`);
for (let k = 0; k <= RUNS; k++) {
  const n = hist.get(k) ?? 0;
  const share = counted.length ? (100 * n / counted.length).toFixed(0) : '0';
  console.log(`${k} of ${RUNS} yes  ${'█'.repeat(n).padEnd(Math.max(20, n))} ${String(n).padStart(3)}  ${share.padStart(3)}%`);
}

const passed = counted.filter((r) => r.passed).length;
const mean = counted.length
  ? counted.reduce((s, r) => s + r.bothYes / r.runs, 0) / counted.length : 0;
console.log(`\npassed the >50%% bar : ${passed} of ${counted.length}`);
console.log(`mean agreement rate  : ${(100 * mean).toFixed(1)}%`);
console.log(`distinct outcomes    : ${hist.size} of ${RUNS + 1} possible`);
console.log(`spent                : $${spent.toFixed(4)}`);
console.log(`elapsed              : ${Math.round((Date.now() - started) / 1000)}s`);

writeFileSync(OUT, JSON.stringify({
  runs: RUNS, pairs: counted.length, passed, mean,
  histogram: Object.fromEntries([...hist].sort((a, b) => a[0] - b[0])),
  spentUsd: spent, results,
}, null, 2));
console.log(`\nwritten to ${OUT}`);

await owner.end();
await closeMatchPool();
await close();
