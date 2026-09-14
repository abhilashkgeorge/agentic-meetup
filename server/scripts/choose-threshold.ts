/**
 * Pick the pass bar from a distribution instead of from a round number.
 *
 * WHAT WENT WRONG TWICE. The bar was the phrase "a majority" turned into `> 0.5`,
 * written before anybody had seen a distribution. Under the original assessor, mean
 * agreement was 79.3% across 47 pairs -- a bar below the average passed 36 of them,
 * which is a turnstile rather than a matchmaker. After the assessor was corrected,
 * mean agreement fell to 33.3% and the highest any pair reached was exactly 0.5,
 * which a strict `>` throws away. The same number was far too low and then
 * unreachable, without ever being deliberately set.
 *
 * WHAT THIS PRINTS. For every rate the run lattice can actually produce, how many
 * pairs clear it and what that implies for a person: how many times their agent has
 * to go out before one match arrives, and what that costs at the measured price.
 *
 * IT DOES NOT CHOOSE. The right bar depends on how often somebody wants to hear from
 * their agent, which is a product decision. This makes the consequences of each
 * choice visible so the decision is informed rather than inherited.
 *
 *   tsx scripts/choose-threshold.ts var/fixed-template.json
 */
import { readFileSync } from 'node:fs';
import { RUNS, quorum } from '../src/matching/rendezvous.js';

const FILE = process.argv[2] ?? 'var/fixed-template.json';
const data = JSON.parse(readFileSync(FILE, 'utf8')) as {
  cohort: string; runs: number; pairs: number; spentUsd: number;
  results: { a: string; b: string; bothYes: number; runs: number; costUsd: number }[];
};

const planned = data.runs || RUNS;
const all = data.results.filter((r) => r.runs > 0);
const measured = all.filter((r) => r.runs >= quorum(planned));
const perPair = data.spentUsd / Math.max(1, all.length);

console.log(`\n=== ${data.cohort}: ${all.length} pairs, ${planned} runs planned ===\n`);

// How often the runs actually completed. After the top-up this should be mostly
// `planned`; anything less is inconclusive verdicts, which are a real result.
const lens = new Map<number, number>();
for (const r of all) lens.set(r.runs, (lens.get(r.runs) ?? 0) + 1);
console.log('runs that counted (inconclusive ones do not):');
for (const k of [...lens.keys()].sort((a, b) => a - b)) {
  console.log(`  ${k} of ${planned}  ${'#'.repeat(lens.get(k)!)} ${lens.get(k)}`);
}
console.log(`  below quorum (${quorum(planned)}), so no verdict: ${all.length - measured.length}\n`);

// The distribution the bar has to cut.
console.log('agreement rate, over pairs that reached quorum:');
const rates = measured.map((r) => r.bothYes / r.runs).sort((a, b) => a - b);
const lattice = Array.from({ length: planned + 1 }, (_, i) => i / planned);
for (const v of lattice) {
  const n = rates.filter((r) => Math.abs(r - v) < 1e-9).length;
  console.log(`  ${(100 * v).toFixed(0).padStart(3)}%  ${'#'.repeat(n).padEnd(20)} ${n}`);
}
const mean = rates.length ? rates.reduce((s, x) => s + x, 0) / rates.length : 0;
console.log(`  mean ${(100 * mean).toFixed(1)}%   max ${(100 * Math.max(0, ...rates)).toFixed(0)}%\n`);

// What each reachable bar would mean for a person.
console.log('if the bar were set here:');
console.log('  bar    pass   of quorum   rounds per match   gemini per match');
for (const v of lattice) {
  if (v === 0) continue;
  const pass = rates.filter((r) => r >= v - 1e-9).length;
  const share = measured.length ? pass / measured.length : 0;
  // Rounds counted over ALL pairs, since a pair that never reached quorum still cost
  // money and still did not produce a match.
  const rate = all.length ? pass / all.length : 0;
  const rounds = rate > 0 ? 1 / rate : Infinity;
  const cost = rounds === Infinity ? Infinity : rounds * perPair;
  console.log(
    `  ${(100 * v).toFixed(0).padStart(3)}%  ${String(pass).padStart(4)}  `
    + `${(100 * share).toFixed(0).padStart(9)}%  `
    + `${(rounds === Infinity ? '—' : rounds.toFixed(1)).padStart(16)}  `
    + `${(cost === Infinity ? '—' : '$' + cost.toFixed(2)).padStart(16)}`,
  );
}

console.log(`\nmeasured cost: $${perPair.toFixed(4)} per pair over ${all.length} pairs`);
console.log('\nA bar BELOW the mean is a turnstile. A bar above the observed maximum');
console.log('passes nothing. Somewhere a person would tolerate waiting is the answer.\n');
