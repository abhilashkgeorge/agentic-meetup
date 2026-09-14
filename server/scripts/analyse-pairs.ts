/**
 * Read the pair measurement and say what it actually shows.
 *
 * A histogram alone cannot separate "the agents ranked these pairs" from "the pool is
 * too uniform to rank". This asks the second question directly, because the synthetic
 * quotes turned out to be far less varied than 5,000 people implies: 46,346 quote rows
 * carry only 1,965 distinct sentences, one of them repeated 2,249 times, and 73% of
 * random pairs share at least one word-for-word identical sentence.
 *
 * If agreement rises with the number of identical sentences a pair was handed, then
 * what is being measured is the template generator, not the two people -- and the
 * headline pass rate means nothing until synthetic-voice.ts produces variety.
 *
 *   tsx scripts/analyse-pairs.ts [var/measure-pairs.json]
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { env } from '../src/env.js';
import { quorum } from '../src/matching/rendezvous.js';

const FILE = process.argv[2] ?? 'var/measure-pairs.json';
const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

interface Row {
  userId: string; met: string | null; bothYes: number;
  runs: number; passed: boolean; costUsd: number;
}
const data = JSON.parse(readFileSync(FILE, 'utf8')) as {
  runs: number; results: Row[]; spentUsd: number;
};
const planned = data.runs;
const pairs = data.results.filter((r) => r.runs > 0 && r.met);

const pct = (n: number, d: number): string => (d ? `${(100 * n / d).toFixed(0)}%` : '-');
const bar = (n: number): string => '#'.repeat(n);

console.log(`\n=== ${pairs.length} measured pairs, ${planned} runs planned each ===\n`);

// 1. Did the runs even happen?
const lengths = new Map<number, number>();
for (const r of pairs) lengths.set(r.runs, (lengths.get(r.runs) ?? 0) + 1);
console.log('RUNS THAT ACTUALLY COMPLETED');
console.log('  A dropped call is correctly not counted as a no -- but it shrinks the');
console.log('  denominator, and nothing used to check how small it had got.');
for (const k of [...lengths.keys()].sort((a, b) => a - b)) {
  const n = lengths.get(k)!;
  console.log(`  ${k} of ${planned}  ${bar(n).padEnd(26)} ${String(n).padStart(3)}  ${pct(n, pairs.length)}`);
}
const full = lengths.get(planned) ?? 0;
console.log(`  completed all ${planned}: ${full} of ${pairs.length} (${pct(full, pairs.length)})\n`);

// 2. The distribution the threshold is supposed to cut.
console.log('AGREEMENT RATE (bothYes / runs completed)');
const LABELS = ['0-19%', '20-39%', '40-59%', '60-79%', '80-100%'];
const buckets = new Map<string, number>();
for (const r of pairs) {
  const label = LABELS[Math.min(4, Math.floor((r.bothYes / r.runs) * 5))]!;
  buckets.set(label, (buckets.get(label) ?? 0) + 1);
}
for (const label of LABELS) {
  const n = buckets.get(label) ?? 0;
  console.log(`  ${label.padEnd(8)} ${bar(n).padEnd(26)} ${String(n).padStart(3)}  ${pct(n, pairs.length)}`);
}

const oldPass = pairs.filter((r) => r.bothYes / r.runs > 0.5).length;
const newPass = pairs.filter((r) => r.runs >= quorum(planned) && r.bothYes / r.runs > 0.5).length;
console.log(`\n  passed, old rule (any denominator) : ${oldPass} of ${pairs.length}  ${pct(oldPass, pairs.length)}`);
console.log(`  passed, quorum rule               : ${newPass} of ${pairs.length}  ${pct(newPass, pairs.length)}`);
console.log(`  no verdict (too few runs)         : ${pairs.filter((r) => r.runs < quorum(planned)).length}`);

// 3. Is it measuring the pair, or the template generator?
const quotesOf = new Map<string, Set<string>>();
const { rows } = await owner.query<{ user_id: string; texts: string[] }>(
  `SELECT user_id, array_agg(q->>'text') AS texts
     FROM match_profile, jsonb_array_elements(synthetic_quotes) q
    WHERE user_id = ANY($1) GROUP BY user_id`,
  [[...new Set(pairs.flatMap((r) => [r.userId, r.met!]))]],
);
for (const r of rows) quotesOf.set(r.user_id, new Set(r.texts));

const withShared: { shared: number; rate: number }[] = [];
for (const r of pairs) {
  const a = quotesOf.get(r.userId);
  const b = quotesOf.get(r.met!);
  if (!a || !b) continue;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  withShared.push({ shared, rate: r.bothYes / r.runs });
}

console.log('\nIDENTICAL SENTENCES HANDED TO BOTH SIDES, vs how often they agreed');
console.log('  The quotes are generated from templates. Two people who "both said" the');
console.log('  same sentence did not: one generator wrote it twice.');
const byShared = new Map<number, number[]>();
for (const w of withShared) {
  if (!byShared.has(w.shared)) byShared.set(w.shared, []);
  byShared.get(w.shared)!.push(w.rate);
}
for (const k of [...byShared.keys()].sort((a, b) => a - b)) {
  const rates = byShared.get(k)!;
  const mean = rates.reduce((s, x) => s + x, 0) / rates.length;
  console.log(`  ${k} shared  n=${String(rates.length).padStart(3)}  mean agreement ${(100 * mean).toFixed(0)}%`);
}

// Pearson, stated plainly. n is small; this is a direction, not a p-value.
if (withShared.length > 2) {
  const xs = withShared.map((w) => w.shared);
  const ys = withShared.map((w) => w.rate);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0),
  );
  const r = den === 0 ? 0 : num / den;
  console.log(`\n  correlation (shared sentences vs agreement): r = ${r.toFixed(2)}  over n = ${withShared.length}`);
  console.log('  Small n. A direction, not a p-value.');
}

console.log(`\nspent: $${data.spentUsd.toFixed(4)}  ($${(data.spentUsd / pairs.length).toFixed(4)} per pair)\n`);
await owner.end();
