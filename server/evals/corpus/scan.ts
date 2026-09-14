/**
 * `npm run corpus:scan` — turn real sessions into draft eval cases.
 *
 * THE DISCIPLINE THIS TOOL ENFORCES, and the reason it is written the way it is:
 *
 *   RUBRIC.md: "Write the expectation before you run it. A case whose expectation you
 *   decide after seeing the output is not a test."
 *
 * So this prints the TRANSCRIPT and nothing else. It uses fact activity to decide
 * which sessions are worth looking at -- that is what makes it better than scrolling --
 * but it never shows what the fact store actually concluded. You write the expectation
 * from what you remember being true, then the eval tells you whether the system agreed.
 *
 * Showing you the outcome first would turn every case into a description of current
 * behaviour, which measures nothing.
 */
import { writeFile } from 'node:fs/promises';
import { adminSession, close } from '../../src/db/client.js';

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 12);

interface Candidate {
  userId: string;
  sessionId: string;
  turns: string[];
  signal: string;
  score: number;
}

/**
 * Sessions ranked by how likely they are to contain something worth testing.
 * Deliberately selects on the SHAPE of what happened, never on the values.
 */
async function candidates(): Promise<Candidate[]> {
  return adminSession(async (c) => {
    const { rows } = await c.query<{
      user_id: string; session_id: string; turns: string[];
      supersessions: string; conflicts: string; single_valued: string; fact_count: string;
    }>(
      `WITH sess AS (
         SELECT e.user_id, e.session_id,
                array_agg(e.raw_text ORDER BY e.turn_index)
                  FILTER (WHERE e.role = 'user')            AS turns,
                min(e.ingested_at)                          AS started,
                array_agg(DISTINCT e.id)                    AS episode_ids
           FROM episodes e
          GROUP BY e.user_id, e.session_id
       )
       SELECT s.user_id, s.session_id, s.turns,
              (SELECT count(*) FROM facts f
                WHERE f.user_id = s.user_id
                  AND f.source_episode_ids && s.episode_ids
                  AND f.supersedes_id IS NOT NULL)                    AS supersessions,
              (SELECT count(*) FROM fact_conflicts fc
                WHERE fc.user_id = s.user_id
                  AND fc.detected_at >= s.started)                    AS conflicts,
              (SELECT count(*) FROM facts f
                WHERE f.user_id = s.user_id
                  AND f.source_episode_ids && s.episode_ids
                  AND f.is_single_valued)                             AS single_valued,
              (SELECT count(*) FROM facts f
                WHERE f.user_id = s.user_id
                  AND f.source_episode_ids && s.episode_ids)          AS fact_count
         FROM sess s
        WHERE s.turns IS NOT NULL AND array_length(s.turns, 1) > 0
        ORDER BY s.started DESC`,
    );

    return rows
      .map((r) => {
        const sup = Number(r.supersessions);
        const con = Number(r.conflicts);
        const sv = Number(r.single_valued);
        const n = Number(r.fact_count);
        // A supersession or a raised conflict is the most interesting thing that can
        // happen; a single-valued fact is next; bulk extraction is weak signal.
        const score = sup * 10 + con * 8 + sv * 3 + n;
        const signal = sup
          ? 'a fact was superseded here'
          : con
            ? 'a conflict was raised around here'
            : sv
              ? 'a single-valued fact was recorded'
              : 'facts were extracted';
        return { userId: r.user_id, sessionId: r.session_id, turns: r.turns, signal, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT);
  });
}

function stub(c: Candidate, i: number): string {
  const sessions = `[[${c.turns.map((t) => JSON.stringify(t)).join(', ')}]]`;
  return `  // ${c.signal}  ·  session ${c.sessionId.slice(0, 8)}
  // TODO axis:   action-single | action-multi | restraint-temporary | restraint-anecdote
  //              | restraint-hedged | restraint-confidence | anti-trap | mechanical
  //              | confabulation
  // TODO expect: what SHOULD be true after this, from memory. Do not look it up.
  {
    id: 'mine-${String(i + 1).padStart(3, '0')}',
    axis: 'action-single',
    note: 'TODO why this case exists',
    sessions: ${sessions},
    expect: [
      // { kind: 'active',     predicate: 'lives_in', objectText: 'TODO' },
      // { kind: 'superseded', predicate: 'lives_in', objectText: 'TODO' },
      // { kind: 'count-active', predicate: 'lives_in', n: 1 },
    ],
    // probe is optional, and only probed cases count toward G0
    // probe: { question: 'TODO?', correct: 'TODO', drift: 'TODO', distractors: ['TODO'] },
  },`;
}

const found = await candidates();

if (!found.length) {
  console.log(`
No sessions with fact activity yet.

The corpus comes from living with the clone, not from writing it. Talk to it for a
few days, and deliberately act some things out:

  - announce a move three sessions before you "arrive"
  - mention a job you are considering, then take it, then refer to it as past
  - stay somewhere temporarily AND SAY SO
  - change a dietary restriction
  - mention a past employer in the past tense (this is an anti-trap case)

Then run this again.
`);
} else {
  const body = `/**
 * DRAFTS — generated by \`npm run corpus:scan\`. Overwritten on every run.
 *
 * Fill in axis, note and expect from what you REMEMBER being true, then move the
 * finished case into cases/mine.ts. Do not look up what the system concluded first:
 * a case whose expectation you decide after seeing the output is not a test.
 */
import type { EvalCase } from '../types.js';

export const DRAFTS: EvalCase[] = [
${found.map(stub).join('\n\n')}
];
`;
  await writeFile(new URL('../cases/drafts.ts', import.meta.url), body);

  console.log(`\n${found.length} candidate sessions -> evals/cases/drafts.ts\n`);
  for (const c of found) {
    const first = c.turns[0] ?? '';
    console.log(`  ${c.signal.padEnd(34)} "${first.slice(0, 52)}${first.length > 52 ? '…' : ''}"`);
  }
  console.log(`
Next: open evals/cases/drafts.ts, fill in axis/note/expect from memory, move the
finished ones into evals/cases/mine.ts, then \`npm run corpus:status\`.
`);
}

await close();
