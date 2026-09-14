/**
 * The numbers the architecture is guessing at.
 *
 * Two of the plan's largest open risks are unmeasured assumptions, and both are
 * answered by this query once real usage exists:
 *
 *  - Median session length. The whole prompt-caching model assumes multi-turn
 *    sessions. At exactly one message per session a 5-minute cache costs ~125% of
 *    uncached, because you pay the 1.25x write and never read it back. If the median
 *    is under 2 turns, delete the per-user breakpoints.
 *  - Voice minutes/day. Voice OUTPUT is the real cost cliff, not the model.
 *
 * Instrumented from user #1 rather than at beta, because by beta the architecture is
 * already committed to the assumption.
 */
import type { PoolClient } from 'pg';

export interface Usage7d {
  activeUsers: number;
  sessions: number;
  medianTurnsPerSession: number;
  p90TurnsPerSession: number;
  singleTurnSessionShare: number;
  turnsPerActiveUserPerDay: number;
  voiceShareOfTurns: number;
  cacheReadRatio: number;
  costPerActiveUserPerDay: number;
  totalCostUsd: number;
}

export async function usage7d(c: PoolClient): Promise<Usage7d> {
  const { rows } = await c.query<Record<string, string | null>>(`
    WITH sess AS (
      SELECT user_id, session_id,
             COUNT(*) FILTER (WHERE role = 'user')                    AS turns,
             COUNT(*) FILTER (WHERE source = 'voice' AND role='user') AS voice_turns
        FROM episodes
       WHERE ingested_at > now() - interval '7 days'
       GROUP BY user_id, session_id
    ),
    spend AS (
      SELECT COALESCE(SUM(cost_usd), 0)                                   AS cost,
             COALESCE(SUM(cached_read_tokens), 0)                         AS cached,
             COALESCE(SUM(input_tokens + cached_read_tokens), 0)          AS total_in
        FROM llm_calls
       WHERE at > now() - interval '7 days'
    )
    SELECT
      (SELECT COUNT(DISTINCT user_id) FROM sess)                          AS active_users,
      (SELECT COUNT(*) FROM sess)                                         AS sessions,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY turns) FROM sess) AS median_turns,
      (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY turns) FROM sess) AS p90_turns,
      (SELECT AVG((turns = 1)::int) FROM sess)                            AS single_turn_share,
      (SELECT SUM(turns) FROM sess)                                       AS total_turns,
      (SELECT SUM(voice_turns) FROM sess)                                 AS total_voice_turns,
      (SELECT cost FROM spend)                                            AS cost,
      (SELECT CASE WHEN total_in > 0 THEN cached::numeric / total_in ELSE 0 END FROM spend)
                                                                          AS cache_read_ratio
  `);

  const r = rows[0] ?? {};
  const num = (k: string): number => Number(r[k] ?? 0);
  const users = num('active_users');
  const turns = num('total_turns');

  return {
    activeUsers: users,
    sessions: num('sessions'),
    medianTurnsPerSession: num('median_turns'),
    p90TurnsPerSession: num('p90_turns'),
    singleTurnSessionShare: num('single_turn_share'),
    turnsPerActiveUserPerDay: users ? turns / users / 7 : 0,
    voiceShareOfTurns: turns ? num('total_voice_turns') / turns : 0,
    cacheReadRatio: num('cache_read_ratio'),
    costPerActiveUserPerDay: users ? num('cost') / users / 7 : 0,
    totalCostUsd: num('cost'),
  };
}

/**
 * What people are actually using their clone for, across all users.
 *
 * This is the input to the deferred question: when agent discovery is switched on,
 * which single cluster gets recruited. Generality is the enemy of density, so this
 * has to resolve to ONE answer -- and it should resolve from who showed up, not from
 * a guess made before anyone had.
 */
export async function intentRollup(
  c: PoolClient,
): Promise<{ intent: string; users: number; sessions: number; meanConfidence: number }[]> {
  const { rows } = await c.query<{
    intent: string; users: string; sessions: string; mean_confidence: string;
  }>(
    `SELECT intent,
            count(DISTINCT user_id)    AS users,
            count(DISTINCT session_id) AS sessions,
            avg(confidence)            AS mean_confidence
       FROM intent_signals
      WHERE at > now() - interval '90 days'
      GROUP BY intent
      ORDER BY count(DISTINCT user_id) DESC, avg(confidence) DESC`,
  );
  return rows.map((r) => ({
    intent: r.intent,
    users: Number(r.users),
    sessions: Number(r.sessions),
    meanConfidence: Number(r.mean_confidence),
  }));
}

/** The one-line read on whether the caching design is earning its keep. */
export function cachingVerdict(u: Usage7d): string {
  if (u.sessions < 20) return 'not enough sessions yet to judge caching';
  if (u.medianTurnsPerSession < 2) {
    return 'median session is a single turn: the 5m cache is a ~25% SURCHARGE, not a saving. Drop the per-user breakpoints.';
  }
  if (u.cacheReadRatio < 0.2) {
    return `cache read ratio ${(u.cacheReadRatio * 100).toFixed(0)}%: something is invalidating the prefix. Check for a date or id in the system prompt.`;
  }
  return `caching is working (${(u.cacheReadRatio * 100).toFixed(0)}% of input tokens served from cache)`;
}
