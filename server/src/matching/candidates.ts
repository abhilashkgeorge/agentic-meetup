/**
 * Finding people worth talking to. Pure SQL, no model anywhere.
 *
 * The arithmetic that forces this design: asking a model to look at a 1,000-person
 * pool for ONE user costs about $7. Full pairwise at 10,000 agents is ~50 million
 * pairs, roughly $350,000 a sweep. That is not expensive, it is impossible. The gap
 * between that and a fraction of a cent is entirely how much of the work lives in an
 * index rather than in a prompt.
 *
 * SEVEN FILTERS, and nothing else may exclude anybody. Each is a case where a mismatch
 * wastes an evening for both people rather than merely disappointing one. Everything
 * else is a preference that adds points -- because filters multiply down and reach
 * zero, while points add up and never do.
 *
 * The seventh, blocks, lives in BASE rather than in CLAUSES because it is not a
 * preference anybody chose to have costed in the pool breakdown. It is the one
 * exclusion that must hold whichever clauses are switched on.
 */
import type { PoolClient } from 'pg';

const BASE = `
  FROM match_profile a, match_profile b
 WHERE a.user_id = $1
   AND b.user_id <> a.user_id
   AND a.in_pool AND b.in_pool
   -- Real people see invented ones only while sees_synthetic is on. Migration 0037
   -- made that the DEFAULT for real accounts, so a new person practises against the
   -- invented pool until there are enough real people to switch it off. An invented
   -- profile never sees a real one: the second disjunct requires b to be the invented
   -- side.
   AND (a.is_synthetic = b.is_synthetic OR (a.sees_synthetic AND b.is_synthetic))
   -- A BLOCK IS FINAL, AND IT IS CHECKED HERE, before either agent is sent anywhere.
   -- It used to be checked only once two people would have talked as humans, which
   -- meant somebody could be paired, again, with the person they had blocked -- and
   -- the block did nothing until the reveal. The function is SECURITY DEFINER, so
   -- this role learns one bit and never reads the blocks table.
   AND NOT block_exists(a.user_id, b.user_id)
`;

/**
 * Every clause is SYMMETRIC and every clause passes on NULL.
 *
 * Symmetric because a one-directional filter matches people with someone who would
 * never have accepted them. Null-passing because six of these fields come back empty
 * from an AI memory export by vendor policy rather than by choice -- reading missing
 * as a mismatch would empty the pool before anybody had answered anything.
 */
export const CLAUSES: Record<string, string> = {
  gender: `
   AND (a.seeking_gender = '{}' OR b.gender IS NULL OR b.gender = ANY(a.seeking_gender))
   AND (b.seeking_gender = '{}' OR a.gender IS NULL OR a.gender = ANY(b.seeking_gender))`,

  age: `
   AND (a.age_min IS NULL OR b.age IS NULL OR b.age >= a.age_min)
   AND (a.age_max IS NULL OR b.age IS NULL OR b.age <= a.age_max)
   AND (b.age_min IS NULL OR a.age IS NULL OR a.age >= b.age_min)
   AND (b.age_max IS NULL OR a.age IS NULL OR a.age <= b.age_max)`,

  // The SHORTER of the two willingnesses. Somebody willing to cross a country should
  // not be matched across it with somebody who will not leave their neighbourhood.
  distance: `
   AND (a.lat IS NULL OR b.lat IS NULL OR a.max_distance_km IS NULL OR b.max_distance_km IS NULL
        OR earth_distance(ll_to_earth(a.lat, a.lon), ll_to_earth(b.lat, b.lon))
           <= LEAST(a.max_distance_km, b.max_distance_km) * 1000.0)`,

  intent: `
   AND (a.intent = '{}' OR b.intent = '{}' OR a.intent && b.intent)`,

  // The only place a personal rule excludes anybody. Both directions.
  // `retired_at IS NULL` is spelled out. clone_match's policy already hides retired
  // rows; clone_matchmaker's does not (0028), so without this the pool count and the
  // round that actually sends the agent out disagreed about who was excluded.
  dealbreakers: `
   AND NOT EXISTS (
     SELECT p.id FROM preferences p
      WHERE p.user_id = a.user_id AND p.strength = 'dealbreaker' AND p.retired_at IS NULL
        AND NOT match_pref_satisfied(p.operator, p.value, b.traits -> p.predicate))
   AND NOT EXISTS (
     SELECT p.id FROM preferences p
      WHERE p.user_id = b.user_id AND p.strength = 'dealbreaker' AND p.retired_at IS NULL
        AND NOT match_pref_satisfied(p.operator, p.value, a.traits -> p.predicate))`,

  active: `
   AND b.last_active_at > now() - interval '60 days'`,
};

export const ALL_CLAUSES = ['gender', 'age', 'distance', 'intent', 'dealbreakers', 'active'];

const build = (active: readonly string[]) =>
  `SELECT b.user_id ${BASE} ${active.map((k) => CLAUSES[k] ?? '').join('\n')}`;

export async function candidateIds(
  c: PoolClient,
  userId: string,
  limit = 500,
): Promise<string[]> {
  // ORDERED. Without this the planner handed back whichever 500 rows it liked, and in
  // a pool of five thousand invented profiles the five real people were reachable
  // only by luck. Real before invented, because a real person is the point; most
  // recently active first, because a profile that was here yesterday is likelier to
  // answer than one that was here in June. The partial index in 0048 lets the planner
  // walk this order for the LIMIT rather than sort the pool.
  const { rows } = await c.query<{ user_id: string }>(
    `${build(ALL_CLAUSES)}
     ORDER BY b.is_synthetic ASC, b.last_active_at DESC
     LIMIT $2`, [userId, limit],
  );
  return rows.map((r) => r.user_id);
}

export async function candidateCount(c: PoolClient, userId: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM (${build(ALL_CLAUSES)}) q`, [userId],
  );
  return Number(rows[0]!.n);
}

export interface PoolStep {
  step: string;
  remaining: number;
  /** How many this one rule cost. The number that makes over-filtering visible. */
  cost: number;
}

/**
 * What each filter costs, one at a time.
 *
 * Over-filtering is otherwise invisible: the app simply never matches anybody and the
 * person cannot see why. Shown live during setup, it becomes a choice -- watch the
 * pool fall from 340 to 31 to 2 and decide whether the rule is worth it.
 */
export async function poolBreakdown(c: PoolClient, userId: string): Promise<PoolStep[]> {
  const labels: Record<string, string> = {
    gender: 'who you want to meet',
    age: 'the ages you want',
    distance: 'how far you will travel',
    intent: 'what you are here for',
    dealbreakers: 'your dealbreakers',
    active: 'people still active',
  };

  const out: PoolStep[] = [];
  let previous = Number(
    (await c.query<{ n: string }>(`SELECT count(*) AS n FROM (${build([])}) q`, [userId]))
      .rows[0]!.n,
  );
  out.push({ step: 'everyone', remaining: previous, cost: 0 });

  for (let i = 0; i < ALL_CLAUSES.length; i++) {
    const active = ALL_CLAUSES.slice(0, i + 1);
    const { rows } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM (${build(active)}) q`, [userId],
    );
    const remaining = Number(rows[0]!.n);
    out.push({ step: labels[ALL_CLAUSES[i]!]!, remaining, cost: previous - remaining });
    previous = remaining;
  }
  return out;
}
