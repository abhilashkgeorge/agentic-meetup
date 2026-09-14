/**
 * `npm run corpus:status` — how far the corpus is from the rubric.
 *
 * Exists because "write 60 cases" is not an actionable instruction and "you need 8
 * more anti-trap cases" is.
 */
import { SEED_CASES } from '../cases/seed.js';
import { AXIS_HELP, TARGETS, TOTAL_TARGET } from './targets.js';
import type { Axis, EvalCase } from '../types.js';

async function loadMine(): Promise<EvalCase[]> {
  try {
    const m = (await import('../cases/mine.js')) as { MY_CASES?: EvalCase[] };
    return m.MY_CASES ?? [];
  } catch {
    return []; // not written yet
  }
}

const mine = await loadMine();
const all = [...SEED_CASES, ...mine];

const bar = (have: number, need: number): string => {
  const width = 16;
  const filled = Math.min(width, Math.round((have / need) * width));
  return '#'.repeat(filled) + '.'.repeat(width - filled);
};

console.log(`\ncorpus: ${all.length}/${TOTAL_TARGET}   (${mine.length} real, ${SEED_CASES.length} seed scaffolding)\n`);

const gaps: [Axis, number][] = [];
for (const axis of Object.keys(TARGETS) as Axis[]) {
  const real = mine.filter((c) => c.axis === axis).length;
  const seed = SEED_CASES.filter((c) => c.axis === axis).length;
  const need = TARGETS[axis];
  const short = Math.max(0, need - real);
  if (short > 0) gaps.push([axis, short]);
  console.log(
    `  ${axis.padEnd(22)} ${bar(real, need)} ${String(real).padStart(2)}/${need}` +
      (seed ? `  (+${seed} seed)` : ''),
  );
}

if (gaps.length) {
  console.log('\nmost useful next:');
  for (const [axis, short] of gaps.sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    console.log(`  ${short} more ${axis}`);
    console.log(`    ${AXIS_HELP[axis]}`);
  }
  console.log('\n  npm run corpus:scan   — mine your real sessions for candidates');
} else {
  console.log('\ncorpus is at rubric strength. Run: npm run eval');
}

// The seed cases are scaffolding. A matrix made of invented cases produces a
// confident, meaningless number -- the rubric says so explicitly.
if (mine.length < SEED_CASES.length) {
  console.log(
    '\nNote: most cases are still SEED scaffolding, not yours. G0 measured on invented\n' +
      'cases tells you nothing -- the corpus has to come from your own life, and it is\n' +
      'the only corpus that will contain real ASR output.',
  );
}
console.log();
