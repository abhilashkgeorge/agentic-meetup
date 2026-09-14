/**
 * Which question to ask next.
 *
 * Akinator feels clever because it never asks a question whose answer it can already
 * guess — it asks whichever one best splits what is left. The same rule works here,
 * pointed at a different target: ask the question that most divides the people you
 * could actually be matched with.
 *
 *   "Do you eat meat?"   when 70% of your candidates do   -> splits the pool, ask it
 *   "Do you eat meat?"   when you have already said       -> worth nothing, skip
 *   "Favourite colour?"  splits nobody                    -> never in the bank at all
 *
 * ENTIRELY SQL. No model call decides what to ask, which is what makes a forty-question
 * interview cost nothing. It also means the ordering is inspectable: the reason a
 * question came up is a number somebody can look at.
 *
 * THE MEASURE is how evenly a predicate divides the remaining pool. A field where
 * everybody answers the same way tells us nothing about who to rule in or out, however
 * interesting it sounds. A field that splits the pool near 50/50 is worth a screen.
 */
import type { PoolClient } from 'pg';
import { GATING, QUESTIONS, type Question } from './questions.js';

export interface Asked {
  /** Question ids already answered, including ones declined. */
  answered: Set<string>;
}

/**
 * How much a predicate divides the candidate pool, 0 to 1.
 *
 * Normalised entropy over the values present. 1 means a perfectly even split; 0 means
 * everybody is the same and the question is decoration.
 */
async function splitPower(
  c: PoolClient,
  predicate: string,
  candidateIds: readonly string[],
): Promise<number> {
  if (candidateIds.length < 2) return 0;

  const { rows } = await c.query<{ v: string; n: string }>(
    `SELECT traits ->> $2 AS v, count(*) AS n
       FROM match_profile
      WHERE user_id = ANY($1::uuid[]) AND traits ? $2
      GROUP BY 1`,
    [candidateIds, predicate],
  );
  if (rows.length < 2) return 0;

  const total = rows.reduce((a, r) => a + Number(r.n), 0);
  if (total === 0) return 0;

  // Shannon entropy over the observed values, divided by the maximum for that many
  // values -- so a field with three even values and one with ten even values both
  // score 1, and only the evenness is compared.
  const h = -rows.reduce((a, r) => {
    const p = Number(r.n) / total;
    return a + (p > 0 ? p * Math.log2(p) : 0);
  }, 0);
  const max = Math.log2(rows.length);
  return max > 0 ? h / max : 0;
}

export interface NextQuestion {
  question: Question;
  /** 0-1. Shown in the debugger, never to a person. */
  splits: number;
  /** How many questions are left that are worth asking at all. */
  remaining: number;
}

/**
 * The next question, or null when there is nothing left worth asking.
 *
 * Gating questions come first regardless of how well they split, because without them
 * there is no candidate pool to measure against — and a question chosen against an
 * empty pool is chosen at random.
 */
export async function nextQuestion(
  c: PoolClient,
  userId: string,
  answered: ReadonlySet<string>,
  candidateIds: readonly string[],
): Promise<NextQuestion | null> {
  const available = QUESTIONS.filter((q) => {
    if (answered.has(q.id)) return false;
    // "Would that bother you?" must not arrive before "do you?".
    if (q.after && !answered.has(q.after)) return false;
    return true;
  });
  if (!available.length) return null;

  const gate = available.find((q) => GATING.includes(q.id));
  if (gate) return { question: gate, splits: 1, remaining: available.length };

  // Preference questions are not measured against the pool -- the pool holds what
  // people ARE, not what they want, so entropy says nothing about them. They are
  // asked as soon as their fact is answered, which is also when they make sense.
  const prefs = available.filter((q) => q.kind === 'preference');
  if (prefs.length) return { question: prefs[0]!, splits: 0.5, remaining: available.length };

  // A FREE question is not scored, and must not be. Entropy is measured against the
  // pool, and the pool holds structured fields -- `dealbreaker` is not one of them, so
  // a sentence question scores zero and would be dropped below the threshold and never
  // asked at all. It is held back deliberately and asked LAST, when the chips have run
  // out: that is the moment somebody has answered several things, watched the number
  // move, and will spend a sentence on it.
  const free = available.filter((q) => q.kind === 'free');
  const chips = available.filter((q) => q.kind !== 'free');

  const scored = await Promise.all(
    chips.map(async (q) => ({ q, splits: await splitPower(c, q.predicate, candidateIds) })),
  );
  scored.sort((a, b) => b.splits - a.splits);

  const best = scored[0];
  if (best && best.splits >= 0.15) {
    return { question: best.q, splits: best.splits, remaining: available.length };
  }

  // Nothing left divides anybody, so ask the one that is not about dividing.
  if (free.length) return { question: free[0]!, splits: 0, remaining: free.length };

  // And now there is genuinely nothing worth asking. More would be a form for its own
  // sake.
  return null;
}
