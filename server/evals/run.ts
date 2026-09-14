/**
 * `npm run eval` -- the supersession matrix, RUBRIC v2, three arms.
 *
 * Exits non-zero when a gate fails or the decision rule says stop. Both were fixed in
 * the rubric before any arm had ever run.
 */
import { closeRunner, runCase, type CaseResult } from './runner.js';
import { SEED_CASES } from './cases/seed.js';
import { MY_CASES } from './cases/mine.js';
import { factstore } from './arms/factstore.js';
import { rag } from './arms/rag.js';
import { file } from './arms/file.js';
import { graphiti, graphitiAvailable, stopGraphiti } from './arms/graphiti.js';
import type { Arm } from './arms/types.js';
import { close } from '../src/db/client.js';
import { validateRouting } from '../src/llm/index.js';
import type { Axis } from './types.js';

const args = new Set(process.argv.slice(2));
const probes = !args.has('--no-probes');
const axisFilter = process.argv.find((a) => a.startsWith('--axis='))?.slice('--axis='.length);
const only = process.argv.find((a) => a.startsWith('--arms='))?.slice('--arms='.length);

validateRouting();

const ALL_ARMS: Arm[] = [factstore, rag, file];
if (graphitiAvailable()) {
  ALL_ARMS.push(graphiti);
} else {
  console.log(
    'graphiti arm skipped: run evals/arms/graphiti/setup.sh first.\n' +
      'Without it the comparison has no bi-temporal competitor, which is the arm most\n' +
      'likely to match us — so a run without it overstates our position.\n',
  );
}
const arms = only ? ALL_ARMS.filter((a) => only.split(',').includes(a.name)) : ALL_ARMS;

const ALL = [...MY_CASES, ...SEED_CASES];
const cases = axisFilter ? ALL.filter((c) => c.axis === axisFilter) : ALL;

if (MY_CASES.length === 0) {
  console.log(
    'WARNING: mine.ts is EMPTY. Every case below is seed scaffolding that we wrote.\n' +
      'The rubric forbids concluding from these — only real cases carry real ASR output,\n' +
      'and ASR is where hedges die. Treat this run as build verification, not a result.\n',
  );
}
console.log(`${cases.length} cases x ${arms.length} arms${probes ? ' + probes' : ''}\n`);

const results: CaseResult[] = [];
for (const c of cases) {
  const r = await runCase(c, arms, { probes });
  results.push(r);
  const line = r.arms.map((a) => `${a.arm}:${a.pass ? 'ok' : 'FAIL'}`).join('  ');
  console.log(`${c.id.padEnd(26)} ${c.axis.padEnd(20)} ${line}`);
  for (const a of r.arms) for (const f of a.failures) console.log(`    ${a.arm}: ${f}`);
}

// ── per-arm rollup ──────────────────────────────────────────────────────────
const RESTRAINT: Axis[] = [
  'restraint-temporary', 'restraint-anecdote', 'restraint-hedged', 'restraint-confidence',
];
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function rate(armName: string, axes?: Axis[]): number {
  const rs = results
    .filter((r) => !axes || axes.includes(r.axis as Axis))
    .map((r) => r.arms.find((a) => a.arm === armName))
    .filter((a): a is NonNullable<typeof a> => !!a);
  return rs.length ? rs.filter((a) => a.pass).length / rs.length : 1;
}

/**
 * Poisoning = an injection case the arm FAILED, i.e. it believed untrusted content.
 *
 * Returns null when there are NO injection cases. Reporting 0% there would read as
 * "clean" when it means "never tested" -- and G6 is a hard-fail gate, so a vacuous
 * pass on it is the most dangerous number in this table.
 */
function poisoning(armName: string): number | null {
  const rs = results
    .filter((r) => r.axis === 'injection')
    .map((r) => r.arms.find((a) => a.arm === armName))
    .filter((a): a is NonNullable<typeof a> => !!a);
  if (!rs.length) return null;
  return rs.filter((a) => !a.pass).length / rs.length;
}

const injectionCases = results.filter((r) => r.axis === 'injection').length;

function meanLatency(armName: string): number | null {
  const ls = results
    .flatMap((r) => r.arms.filter((a) => a.arm === armName))
    .map((a) => a.supersessionLatency)
    .filter((l): l is number => l !== null);
  return ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : null;
}

function costPerTurn(armName: string): number {
  const as = results.flatMap((r) => r.arms.filter((a) => a.arm === armName));
  const turns = as.reduce((a, b) => a + b.turns, 0);
  return turns ? as.reduce((a, b) => a + b.costUsd, 0) / turns : 0;
}

console.log('\n-- per arm --');
console.log('  arm         overall  restraint  anti-trap  poisoned  $/turn   latency');
for (const a of arms) {
  const lat = meanLatency(a.name);
  console.log(
    `  ${a.name.padEnd(11)} ${pct(rate(a.name)).padStart(6)}  ` +
      `${pct(rate(a.name, RESTRAINT)).padStart(8)}  ` +
      `${pct(rate(a.name, ['anti-trap'])).padStart(8)}  ` +
      `${(poisoning(a.name) === null ? 'n/a' : pct(poisoning(a.name)!)).padStart(8)}  ` +
      `${costPerTurn(a.name).toFixed(5)}  ` +
      `${lat === null ? '   n/a' : lat.toFixed(1).padStart(6)}`,
  );
}
console.log('  (latency = sessions from the change being stated to the arm reporting it)');
if (injectionCases === 0) {
  console.log(
    '  poisoned = n/a: there are NO injection cases in the corpus. G6 is a hard-fail\n' +
      '  gate and it has not been exercised. Do not read this as clean.',
  );
}

// ── the decision rule, fixed in RUBRIC v2 before any of this ran ────────────
const ours = { restraint: rate('factstore', RESTRAINT), poisoned: poisoning('factstore') };
const fileArm = arms.some((a) => a.name === 'file')
  ? { restraint: rate('file', RESTRAINT), poisoned: poisoning('file') }
  : null;

console.log('\n-- decision rule (RUBRIC v2, written before this run) --');
const verdicts: string[] = [];

if (ours.poisoned !== null && ours.poisoned > 0) {
  verdicts.push(`STOP: factstore was poisoned on ${pct(ours.poisoned)} of injection cases. ` +
    `origin_class is the clearest unclaimed mechanism; if it leaks, it is decoration.`);
}
if (injectionCases === 0) {
  verdicts.push(
    'INCONCLUSIVE on G6: no injection cases exist, so the mechanism with the clearest ' +
      'competitive gap (origin_class) is entirely unmeasured.',
  );
}
if (fileArm && fileArm.restraint >= 0.8) {
  verdicts.push(
    `STOP: the well-prompted file arm cleared ${pct(fileArm.restraint)} restraint. ` +
      `Supersession is a feature, not a product. Ship the fallback in ARCHITECTURE.md:793 ` +
      `— verbatim RAG + ~40 deterministic slots + the conflicts queue.`,
  );
}
if (fileArm && ours.restraint - fileArm.restraint < 0.1 && fileArm.restraint < 0.8) {
  verdicts.push(
    `THIN: factstore leads the file arm by only ` +
      `${((ours.restraint - fileArm.restraint) * 100).toFixed(0)} points on a corpus we wrote ` +
      `ourselves. Under ~10 points is not a moat. This is the modal outcome.`,
  );
}
if (!verdicts.length) {
  verdicts.push('Continue: no stop condition met. Check the margin is real on a corpus you did not write.');
}
for (const v of verdicts) console.log(`  ${v}`);

console.log(`\ntotal cost: $${results
  .flatMap((r) => r.arms).reduce((a, b) => a + b.costUsd, 0).toFixed(4)}`);

if (MY_CASES.length === 0) {
  console.log('\nReminder: mine.ts is empty. None of the above is a result.');
}

stopGraphiti();
await closeRunner();
await close();
process.exit(verdicts.some((v) => v.startsWith('STOP')) ? 1 : 0);
