/**
 * "How well does my clone know me?"
 *
 * Three constraints, all deliberate, all from the plan:
 *
 * 1. **Never zero-start.** A 0% meter on the screen meant to make the product feel
 *    effortless is the fastest way to lose someone. There is a floor.
 * 2. **Never counterparty-visible.** This is between the user and their agent. A
 *    completion gauge other people can see turns self-disclosure into a scored
 *    performance, which is a different and worse product.
 * 3. **Not a form.** It is framed as how well the agent knows you, not as a profile
 *    to fill in, and it always names ONE next thing rather than a checklist.
 *
 * Weighting matters: 200 `topic` facts must not max the meter while the agent still
 * does not know where you live. Coverage of durable core predicates dominates.
 */
import type { PoolClient } from 'pg';
import { CORE_PREDICATES } from '@clone/shared';

/**
 * Three tiers, not two, because the dating layer made "hard" too broad to mean
 * anything.
 *
 * Adding the dating predicates took the hard list from 18 to 29, and a flat average
 * over 29 promptly made forty topic facts outrank knowing where somebody lives. The
 * problem was never the weights -- it was that `grew_up_in` and `gender` were being
 * counted as equally important, when only one of them decides whether an agent can
 * leave the house.
 */

/**
 * The five the candidate query asks about. Without ALL of them an agent is not in the
 * pool at all -- it cannot be matched with anybody, at any score. Nothing else in the
 * schema has that property, so nothing else belongs in this tier.
 */
const ESSENTIAL = [
  'gender', 'seeking_gender', 'birth_date', 'lives_in', 'relationship_intent',
] as const;

const ESSENTIAL_SET = new Set<string>(ESSENTIAL);
const HARD_CORE = CORE_PREDICATES.filter(
  (p) => p.durability === 'hard' && !ESSENTIAL_SET.has(p.name),
);
const SOFT_CORE = CORE_PREDICATES.filter((p) => p.durability === 'soft');

/**
 * Weights. The essentials dominate because they are binary in effect: four out of five
 * is the same as zero out of five to the person waiting to be matched.
 */
const W_ESSENTIAL = 0.45;
const W_HARD = 0.25;
const W_SOFT = 0.20;
const W_TEXTURE = 0.10;

/** Enough open-tier facts to count as "knows some texture about me". */
const TEXTURE_TARGET = 40;

/** The floor, so a new account never reads 0. */
const FLOOR = 0.05;

/** Asked in roughly this order — the things an agent most needs to represent someone. */
const ASK_ORDER: { predicate: string; question: string }[] = [
  { predicate: 'preferred_name', question: 'What should I call you?' },
  { predicate: 'lives_in', question: 'Where are you based?' },
  { predicate: 'works_at', question: 'Where do you work these days?' },
  { predicate: 'job_title', question: 'What do you actually do there?' },
  { predicate: 'relationship_status', question: 'Are you seeing anyone?' },
  { predicate: 'allergy', question: 'Anything you are allergic to that I should know?' },
  { predicate: 'dietary_restriction', question: 'Anything you do not eat?' },
  { predicate: 'languages', question: 'What languages do you speak?' },
  { predicate: 'has_children', question: 'Do you have kids?' },
  { predicate: 'grew_up_in', question: 'Where did you grow up?' },
  { predicate: 'interest', question: 'What have you been into lately?' },
  { predicate: 'value', question: 'What matters to you most, honestly?' },
  { predicate: 'goal', question: 'What are you working towards right now?' },
  { predicate: 'dealbreaker', question: 'What could you not put up with in someone?' },
];

export interface Completion {
  /** 0..1. Never 0 for an existing account. */
  score: number;
  /** Coarse label. The number alone reads as a grade; the label reads as a state. */
  band: 'just met' | 'getting to know you' | 'knows you fairly well' | 'knows you well';
  /** The five the candidate query asks about. Four of five is the same as none. */
  essentialCovered: number;
  essentialTotal: number;
  canBeMatched: boolean;
  hardCovered: number;
  hardTotal: number;
  softCovered: number;
  softTotal: number;
  textureFacts: number;
  /** ONE thing to ask next. Never a checklist. */
  nextQuestion: { predicate: string; question: string } | null;
  /** Facts imported but not yet confirmed. Shown as a gentle nudge, not a wall. */
  awaitingConfirmation: number;
}

export async function completion(c: PoolClient, userId: string): Promise<Completion> {
  const { rows } = await c.query<{ predicate: string; n: string }>(
    `SELECT predicate, count(*) AS n FROM facts
      WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL
      GROUP BY predicate`,
    [userId],
  );
  const have = new Map(rows.map((r) => [r.predicate, Number(r.n)]));

  const essentialCovered = ESSENTIAL.filter((p) => have.has(p)).length;
  const hardCovered = HARD_CORE.filter((p) => have.has(p.name)).length;
  const softCovered = SOFT_CORE.filter((p) => have.has(p.name)).length;

  // Open-tier facts are texture: they make the clone sound like you, but they do not
  // make it able to represent you, so they are capped at a modest share.
  const textureFacts = [...have.entries()]
    .filter(([p]) => !CORE_PREDICATES.some((cp) => cp.name === p))
    .reduce((a, [, n]) => a + n, 0);

  const raw =
    W_ESSENTIAL * (essentialCovered / ESSENTIAL.length) +
    W_HARD * (hardCovered / HARD_CORE.length) +
    W_SOFT * (softCovered / SOFT_CORE.length) +
    W_TEXTURE * Math.min(1, textureFacts / TEXTURE_TARGET);

  const score = Math.max(FLOOR, Math.min(1, raw));

  const { rows: pending } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM facts
      WHERE user_id = $1 AND status = 'staged' AND origin_class = 'untrusted'`,
    [userId],
  );

  return {
    score,
    band:
      score >= 0.75 ? 'knows you well'
      : score >= 0.45 ? 'knows you fairly well'
      : score >= 0.2 ? 'getting to know you'
      : 'just met',
    essentialCovered,
    essentialTotal: ESSENTIAL.length,
    /** The one thing that decides whether an agent can go out at all. */
    canBeMatched: essentialCovered === ESSENTIAL.length,
    hardCovered,
    hardTotal: HARD_CORE.length,
    softCovered,
    softTotal: SOFT_CORE.length,
    textureFacts,
    nextQuestion: ASK_ORDER.find((a) => !have.has(a.predicate)) ?? null,
    awaitingConfirmation: Number(pending[0]?.n ?? 0),
  };
}
