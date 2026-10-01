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
import { CORE_PREDICATES, INTENTS_THAT_MEET } from '@clone/shared';
import { STRENGTH_WEIGHT } from './strength.js';

/**
 * The fields that hold several answers (the field you work in). A must-have on one is
 * read from the tags, which hold every answer -- traits keep only one (0071). Names from
 * the shared vocabulary, so this SQL fragment carries no user input.
 */
const MANY = `ARRAY[${CORE_PREDICATES.filter((p) => p.cardinality === 'multi').map((p) => `'${p.name}'`).join(',')}]::text[]`;
const passes = (other: string) =>
  `(CASE WHEN p.predicate = ANY(${MANY})
         THEN match_pref_satisfied_multi(p.predicate, p.operator, p.value, ${other}.attribute_tags)
         ELSE match_pref_satisfied(p.operator, p.value, ${other}.traits -> p.predicate) END)`;

/** Whether `other` gave an answer the rule can be read against: unknown is never a fit. */
const answered = (other: string) =>
  `(CASE WHEN p.predicate = ANY(${MANY})
         THEN EXISTS (SELECT 1 FROM unnest(coalesce(${other}.attribute_tags, '{}')) t
                       WHERE left(t, length(p.predicate) + 1) = p.predicate || ':')
         ELSE coalesce(jsonb_typeof(${other}.traits -> p.predicate), 'null') <> 'null' END)`;

/**
 * "REALLY WANT" AND "NICE TO HAVE" MOVE PEOPLE UP (the founder, 2026-09-29). The rules
 * screen always said they "move people up the list"; nothing read them but the recorded
 * score, so who a round met did not change at all (docs 15.3 item 12). Now the order a
 * round takes people in counts, for each person, the looker's soft rules they fit --
 * "Really want" 3, "Nice to have" 1 (strength.ts), only on answers they gave -- inside
 * each group: real people still come before invented ones, and recency breaks ties. It is
 * the looker's own wishes, one way; the measured two-way score still only records.
 */
const FITS_MY_WANTS = `
  (SELECT coalesce(sum(CASE p.strength WHEN 'strong' THEN ${STRENGTH_WEIGHT.strong}
                                       WHEN 'mild' THEN ${STRENGTH_WEIGHT.mild} ELSE 0 END), 0)
     FROM preferences p
    WHERE p.user_id = a.user_id AND p.strength IN ('strong', 'mild') AND p.retired_at IS NULL
      AND ${answered('b')} AND ${passes('b')})`;

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

/** INTENTS_THAT_MEET as SQL VALUES rows, both ways round. Only [a-z_] words, checked. */
const INTENT_PAIRS_SQL = INTENTS_THAT_MEET.flatMap(([a, b]) => [[a, b], [b, a]])
  .map(([a, b]) => {
    if (!/^[a-z_]+$/.test(a!) || !/^[a-z_]+$/.test(b!)) throw new Error(`bad intent pair ${a}/${b}`);
    return `('${a}', '${b}')`;
  })
  .join(', ');

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

  // EACH SIDE'S OWN LIMIT, BOTH WAYS -- so the shorter of the two willingnesses wins.
  // Somebody willing to cross a country should not be matched across it with somebody
  // who will not leave their neighbourhood. It used to be one test that passed whenever
  // EITHER side had no limit: a person who never answered "How far would you travel?"
  // switched off the other person's 10 km as well, while every card said "Passes your
  // rules both ways" (docs/END-TO-END.md 15.3, fixed 2026-09-28). Now a missing limit
  // passes only its own side. No point at all still passes: distance cannot be tested.
  distance: `
   AND (a.lat IS NULL OR b.lat IS NULL OR (
        (a.max_distance_km IS NULL
         OR earth_distance(ll_to_earth(a.lat, a.lon), ll_to_earth(b.lat, b.lon)) <= a.max_distance_km * 1000.0)
    AND (b.max_distance_km IS NULL
         OR earth_distance(ll_to_earth(a.lat, a.lon), ll_to_earth(b.lat, b.lon)) <= b.max_distance_km * 1000.0)))`,

  // The same answer meets itself (and a test's made-up tag still meets only itself); a
  // different answer meets when it is a close one (shared INTENTS_THAT_MEET, both ways,
  // the founder 2026-10-01). It was the overlap alone, so "Marriage" never met "Something
  // long-term". The pairs are code constants, written in as literals.
  intent: `
   AND (a.intent = '{}' OR b.intent = '{}' OR a.intent && b.intent OR EXISTS (
        SELECT 1 FROM (VALUES ${INTENT_PAIRS_SQL}) AS ok(x, y)
         WHERE ok.x = ANY(a.intent) AND ok.y = ANY(b.intent)))`,

  // The only place a personal rule excludes anybody. Both directions.
  // `retired_at IS NULL` is spelled out. clone_match's policy already hides retired
  // rows; clone_matchmaker's does not (0028), so without this the pool count and the
  // round that actually sends the agent out disagreed about who was excluded.
  // A field with several answers is read from the tags (0071): "must work in AI" passes
  // somebody in software AND AI, whichever of the two traits happens to hold.
  dealbreakers: `
   AND NOT EXISTS (
     SELECT p.id FROM preferences p
      WHERE p.user_id = a.user_id AND p.strength = 'dealbreaker' AND p.retired_at IS NULL
        AND NOT ${passes('b')})
   AND NOT EXISTS (
     SELECT p.id FROM preferences p
      WHERE p.user_id = b.user_id AND p.strength = 'dealbreaker' AND p.retired_at IS NULL
        AND NOT ${passes('a')})`,

  // A real person away for sixty days is not somebody to send an agent to. A practice
  // profile is never "away": it keeps the date it was seeded as its last visit, so the
  // whole practice pool (5,008, seeded 2026-09-12 to 14) would have left everybody's
  // pool around 2026-11-11 (the founder, 2026-09-28: keep it from expiring). Exempt
  // here rather than reseeded: the seed script deletes and recreates, which would take
  // every open practice card with it.
  active: `
   AND (b.is_synthetic OR b.last_active_at > now() - interval '60 days')`,
};

export const ALL_CLAUSES = ['gender', 'age', 'distance', 'intent', 'dealbreakers', 'active'];

const build = (active: readonly string[]) =>
  `SELECT b.user_id ${BASE} ${active.map((k) => CLAUSES[k] ?? '').join('\n')}`;

/**
 * Of `ids`, the ones this person could still meet on the SAFETY clauses alone -- both in
 * the pool, the practice rule, no block either way -- and none of either person's wants
 * or rules. The square checks its day's sample with this on every look (api/world.ts):
 * a block, a ban or leaving the pool takes somebody out at once, while a rule flipped
 * today changes nothing there until tomorrow -- or flipping one would show whether a
 * stranger you recognise passes it.
 */
export async function stillThere(c: PoolClient, userId: string, ids: readonly string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { rows } = await c.query<{ user_id: string }>(`${build([])} AND b.user_id = ANY($2::uuid[])`, [userId, ids]);
  const ok = new Set(rows.map((r) => r.user_id));
  return ids.filter((id) => ok.has(id));
}

export async function candidateIds(
  c: PoolClient,
  userId: string,
  limit = 500,
): Promise<string[]> {
  // ORDERED. Without this the planner handed back whichever 500 rows it liked, and in
  // a pool of five thousand invented profiles the five real people were reachable
  // only by luck. Real before invented, because a real person is the point; then those
  // who fit more of this person's "Really want" and "Nice to have" (FITS_MY_WANTS); most
  // recently active first after that, because a profile that was here yesterday is
  // likelier to answer than one that was here in June.
  const { rows } = await c.query<{ user_id: string }>(
    `${build(ALL_CLAUSES)}
     ORDER BY b.is_synthetic ASC, ${FITS_MY_WANTS} DESC, b.last_active_at DESC
     LIMIT $2`, [userId, limit],
  );
  return rows.map((r) => r.user_id);
}

/**
 * How many rounds started by OTHER real people one real person may appear in, per
 * rolling week, before picking skips them.
 *
 * WHY A CAP, AND WHY NOW. Picking is real-first (orchestrator.ts): a real person is the
 * point, and before it the ranker buried them under five thousand invented profiles.
 * But real-first in a small pool means the scarce side is picked by EVERY round --
 * Bruch & Newman 2018 found the most-contacted people on dating markets receiving
 * messages at many times the median rate. So the cap ships with real-first rather than
 * after it: a real person is still a candidate for everyone, and is simply not picked
 * again this week once five real people's rounds have already brought them. Invented
 * profiles are never capped; they have no inbox to flood.
 */
export const WEEKLY_REAL_EXPOSURE = Number(process.env.WEEKLY_REAL_EXPOSURE ?? 5);

/**
 * The real people in `ids` who have already appeared WEEKLY_REAL_EXPOSURE times this
 * week in rounds started by other real people. Read from `rounds.result.metAll`, which
 * every finished round records; no migration and no new column.
 */
export async function overExposed(c: PoolClient, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await c.query<{ id: string }>(
    `SELECT mp.user_id AS id
       FROM match_profile mp
      WHERE mp.user_id = ANY($1::uuid[]) AND NOT mp.is_synthetic
        AND (SELECT count(*)
               FROM rounds r
               JOIN match_profile i ON i.user_id = r.user_id AND NOT i.is_synthetic
              WHERE r.requested_at > now() - interval '7 days'
                AND r.user_id <> mp.user_id
                AND r.result -> 'metAll' ? mp.user_id::text) >= $2`,
    [ids, WEEKLY_REAL_EXPOSURE],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * The same pool, nearest first: the square's sample of strangers is the people
 * around this person, so a neighbourhood on the map has neighbours in it. Real
 * before invented still; distance before recency. A person with no point (or a
 * pool with none) falls back to recency, NULLS LAST.
 */
export async function candidateIdsNear(
  c: PoolClient,
  userId: string,
  limit = 40,
): Promise<string[]> {
  const { rows } = await c.query<{ user_id: string }>(
    `${build(ALL_CLAUSES)}
     ORDER BY b.is_synthetic ASC,
              earth_distance(ll_to_earth(a.lat, a.lon), ll_to_earth(b.lat, b.lon)) ASC NULLS LAST,
              b.last_active_at DESC
     LIMIT $2`, [userId, limit],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Could this person's agent meet that one? The whole clause set, exactly -- not "is
 * that id within the first 500 of the ordered list", which would refuse a valid
 * target on a big pool. Blocks are in BASE, so a blocked pair is refused here,
 * before anything is spent.
 */
export async function isCandidate(c: PoolClient, userId: string, otherId: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM (${build(ALL_CLAUSES)} AND b.user_id = $2) q LIMIT 1`, [userId, otherId],
  );
  return rows.length > 0;
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
 * Under this many people, a count is not shown at all -- the person is told "under 20".
 */
export const SHOWN_FLOOR = 20;

/**
 * A pool count as a person may see it: rounded to the nearest ten, and nothing at all
 * under twenty.
 *
 * WHY A COUNT IS A PRIVACY LEAK. Before the core cards no real person had a value on
 * smoking, drinking, kids, monogamy or food, so every rule passed them as unknown and
 * no count moved. Now everybody has one, and an exact count is a question anybody can
 * ask about anybody: set "Let me choose" on a card, flip that rule between must-have
 * and want on /preferences, and the difference in the total is how many people in
 * range hold the excluded values. The invented part of the pool does not change, so the
 * same difference taken a day apart is ONE newly joined real person's answer -- which
 * is exactly what "we never show your smoking to anybody" promises cannot happen. A
 * person joining moves a rounded count only when it happens to sit on a boundary, and
 * below twenty there is nothing to difference at all. The spec's line, verbatim: no
 * real counts below 20, and never how many people a single rule removes.
 *
 * Null is "under 20", not zero. A person whose rules leave nobody is told they leave
 * "under 20", which is true and is still the nudge to loosen one.
 */
export function shownCount(n: number): number | null {
  if (!Number.isFinite(n) || n < SHOWN_FLOOR) return null;
  return Math.round(n / 10) * 10;
}

/** One step of the breakdown as it may be shown: the same rounding, both numbers. */
export interface ShownStep {
  step: string;
  remaining: number | null;
  /**
   * Worked out from the ROUNDED counts either side, never from the exact ones -- the
   * exact difference is precisely the number this exists not to send. When a step
   * takes the pool under twenty, it is shown as costing about everything that was left.
   */
  cost: number | null;
}

export function shownBreakdown(steps: readonly PoolStep[]): ShownStep[] {
  let before: number | null = null;
  return steps.map((s, i) => {
    const remaining = shownCount(s.remaining);
    const cost = i === 0 ? 0
      : before === null ? null
      : remaining === null ? before
      : Math.max(0, before - remaining);
    before = remaining;
    return { step: s.step, remaining, cost };
  });
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
