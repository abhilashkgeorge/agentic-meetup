/**
 * Turn graded answers into eval cases.
 *
 * `mine.ts` has been an empty array for the life of this project, and the rubric is
 * explicit that only real cases carry real signal. The reason it stayed empty is that
 * writing eval cases is a project nobody starts -- so this stops asking anyone to.
 *
 * Every self-test and every round grade is ALREADY a case: a question, the clone's
 * answer, a human verdict, and often a correction saying what the answer should have
 * been. The corpus now fills as a by-product of a screen people want to use.
 *
 * These are VOICE cases, which is a different axis from the supersession matrix in
 * seed.ts. They are written to their own file for that reason; conflating "did it
 * sound like them" with "did the new city retire the old one" would produce a single
 * confident number that means nothing.
 *
 *   npm run corpus:harvest
 */
import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { env } from '../../src/env.js';

interface VoiceCase {
  id: string;
  question: string;
  answer: string;
  soundedRight: boolean;
  /** What the human said they would actually have written. The gold, when present. */
  correction: string | null;
  at: string;
}

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

// Only the owner's own verdicts. Friend grading is gone: the agent is built by its
// owner, so the only person whose judgement of it counts is the one it speaks for.
const rows = await owner.query<VoiceCase>(`
  SELECT 'self-' || id::text AS id, question, answer,
         (verdict = 'me') AS "soundedRight", correction, graded_at::text AS at
    FROM self_tests WHERE verdict IS NOT NULL
  ORDER BY at
`);

await owner.end();

const cases = rows.rows;
const right = cases.filter((c) => c.soundedRight).length;
const withCorrection = cases.filter((c) => c.correction).length;

writeFileSync(
  new URL('../cases/voice.ts', import.meta.url),
  `/**
 * VOICE CORPUS — generated. Do not edit by hand.
 *
 * Written by \`npm run corpus:harvest\` from self-tests and round grades. Every case is
 * a real human verdict on a real generated answer; the corrections are what that human
 * said they would actually have written.
 *
 * ${cases.length} cases · ${right} sounded right (${cases.length ? Math.round((right / cases.length) * 100) : 0}%) · ${withCorrection} with a correction
 *
 * Harvested ${new Date().toISOString().slice(0, 10)}.
 */
import type { VoiceCase } from '../types.js';

export const VOICE_CASES: VoiceCase[] = ${JSON.stringify(cases, null, 2)};
`,
);

console.log(
  `harvested ${cases.length} voice cases ` +
    `(${right} sounded right, ${withCorrection} with corrections) -> evals/cases/voice.ts`,
);
if (cases.length === 0) {
  console.log('Nothing yet. Grade a few self-tests, or send a round to someone.');
}
