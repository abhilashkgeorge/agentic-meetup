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
 *
 * BUT ONLY FOR THE OPTIONAL TIER. Everything before it is a fixed list, in a fixed
 * order: the three basics, the five core cards, the one sentence. See `nextQuestion`
 * for the bug that made this necessary.
 */
import type { PoolClient } from 'pg';
import { CORE, GATING, OPTIONAL_CARDS, QUESTIONS, coreCardsFor, type Question } from './questions.js';

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
 * ORDER: the three basics, then the five core cards in CORE order, then the one
 * sentence, then optional chips picked by how well they split the pool, then null.
 *
 * Gating questions come first regardless of how well they split, because without them
 * there is no candidate pool to measure against — and a question chosen against an
 * empty pool is chosen at random.
 *
 * THE CORE IS FIXED FOR THE SAME REASON, AND THIS IS THE BUG IT FIXES. After the three
 * basics a new person is still not in the pool -- no birth year, no city, no consent
 * yet -- so the route hands this function an EMPTY candidate list. `splitPower` returns
 * 0 for every chip against an empty list, nothing clears the 0.15 bar, and the old
 * code fell straight through to the sentence and then to null. A new person was asked
 * three questions and told they were done: not one of the five things two people are
 * compared on was ever asked. Entropy cannot choose among questions before there is a
 * pool to measure, so before the optional tier it does not get to choose.
 */
export async function nextQuestion(
  c: PoolClient,
  userId: string,
  answered: ReadonlySet<string>,
  candidateIds: readonly string[],
  /**
   * Questions they were asked and passed on. A skip is recorded as an answer, which
   * is right -- it stops the same question coming back for ever -- but it means
   * `answered` alone cannot tell "they said vegetarian" from "they said nothing".
   */
  skipped: ReadonlySet<string> = new Set(),
): Promise<NextQuestion | null> {
  // The cards this person is asked: not the kids one for somebody here only for something
  // casual or for company (coreCardsFor, the founder 2026-10-01). Read from their own row,
  // which the route has just rebuilt; nothing there yet means all five.
  const { rows: me } = await c.query<{ intent: string[] | null }>(
    'SELECT intent FROM match_profile WHERE user_id = $1', [userId]);
  const cards = new Set(coreCardsFor(me[0]?.intent ?? []).map((k) => k.id));
  const available = QUESTIONS.filter((q) => {
    if (answered.has(q.id)) return false;
    if ((CORE as readonly string[]).includes(q.id) && !cards.has(q.id)) return false;
    // SITUATIONS ARE NEVER ASKED HERE. They exist for other people's wants and arrive
    // as a question of the day when one needs them (matching/want-questions.ts); in the
    // interview they would be a form for its own sake, and count toward "remaining".
    if (q.tier === 'situation') return false;
    // "Would that bother you?" must not arrive before "do you?".
    if (q.after && !answered.has(q.after)) return false;
    // AND IT MUST NOT ARRIVE AFTER A SKIPPED "do you?" EITHER, when the answer would
    // be a strength rather than a value. Such a question has no meaning from somebody
    // who would not answer the fact it hangs off. The bank holds none any more -- the
    // four "same as me" questions were replaced by the core cards, and the one
    // preference left (q-works-pref) is MULTI, names its own values and stands on its
    // own -- so this now only keeps a future one honest.
    if (q.after && !q.multi && skipped.has(q.after)) return false;
    return true;
  });
  if (!available.length) return null;

  const gate = available.find((q) => GATING.includes(q.id));
  if (gate) return { question: gate, splits: 1, remaining: available.length };

  // The five cards, in CORE order, exactly like the basics above: by position, never by
  // score. `splits` is 1 because the pool needs every one of them (profile.ts), not
  // because anything was measured.
  const core = CORE.map((id) => available.find((q) => q.id === id)).find((q) => q !== undefined);
  if (core) return { question: core, splits: 1, remaining: available.length };

  // Then the optional cards (faith), by position: skippable, never a pool condition.
  const extra = OPTIONAL_CARDS.map((id) => available.find((q) => q.id === id)).find((q) => q !== undefined);
  if (extra) return { question: extra, splits: 0.5, remaining: available.length };

  // A FREE question is not scored, and must not be. Entropy is measured against the
  // pool, and the pool holds structured fields -- `dealbreaker` is not one of them, so
  // a sentence question scores zero and would be dropped below the threshold and never
  // asked at all. It comes straight after the core: the person has just answered eight
  // things and is warmed up, and the mapper can only land what they write on one of
  // the five cards they have just seen.
  const free = available.filter((q) => q.kind === 'free');
  if (free.length) return { question: free[0]!, splits: 0, remaining: available.length };

  // ── the optional tier: the only place picking happens ─────────────────────
  //
  // Preference questions are not measured against the pool -- the pool holds what
  // people ARE, not what they want, so entropy says nothing about them. They are
  // asked as soon as their fact is answered, which is also when they make sense.
  const prefs = available.filter((q) => q.kind === 'preference');
  if (prefs.length) return { question: prefs[0]!, splits: 0.5, remaining: available.length };

  const chips = available.filter((q) => q.tier === 'optional');

  const scored = await Promise.all(
    chips.map(async (q) => ({ q, splits: await splitPower(c, q.predicate, candidateIds) })),
  );
  scored.sort((a, b) => b.splits - a.splits);

  const best = scored[0];
  if (best && best.splits >= 0.15) {
    return { question: best.q, splits: best.splits, remaining: available.length };
  }

  // Nothing left divides anybody, so there is genuinely nothing worth asking. More
  // would be a form for its own sake.
  return null;
}
