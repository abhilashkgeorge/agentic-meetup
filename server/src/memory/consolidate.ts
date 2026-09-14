/**
 * P5 (nightly) and P6 (weekly). W7.
 *
 * Batched rather than per-turn on purpose: sleep-time compute measures roughly 5x less
 * test-time compute and ~2.5x lower average cost per query than doing this work in the
 * request path. (That result is from Letta's founders. We rejected Letta the product
 * and adopt Letta the research, and say so because it will be asked.)
 *
 * NOTHING HERE DELETES. Demotion lowers importance; dedupe merges and supersedes.
 * A nightly job that can delete is a nightly job that can silently destroy a profile
 * while nobody is watching -- which is exactly when it runs.
 */
import type { PoolClient } from 'pg';
import { discoverySession, tenantSession, type TenantCtx } from '../db/client.js';
import { log } from '../log.js';

export interface ConsolidationResult {
  merged: number;
  demoted: number;
  conflictsQueued: number;
}

/**
 * P5. Runs for users who spoke that day.
 *
 * Deliberately deterministic: every step here is SQL. An LLM reflection pass is the
 * obvious extension, but it would write facts unsupervised overnight with
 * origin_class='agent', and until G0 says the write path earns its keep, adding a
 * second unsupervised writer is spending reliability we have not yet shown we have.
 */
export async function consolidate(ctx: TenantCtx): Promise<ConsolidationResult> {
  return tenantSession(ctx, async (c) => {
    // 1. Dedupe. Same predicate, identical object text (case/space-insensitive),
    // multiple active rows. Keep the earliest -- it carries the true valid_from --
    // and fold the others into it rather than dropping them.
    const { rows: dupes } = await c.query<{ keep: string; drop: string[]; extra: number }>(
      `WITH grouped AS (
         SELECT lower(btrim(object_text)) AS norm, predicate,
                array_agg(id ORDER BY COALESCE(valid_from, recorded_at)) AS ids,
                sum(corroboration_count) AS total
           FROM facts
          WHERE user_id = $1 AND status = 'active' AND valid_to IS NULL
          GROUP BY 1, 2
         HAVING count(*) > 1
       )
       SELECT ids[1] AS keep, ids[2:] AS drop, total::int AS extra FROM grouped`,
      [ctx.userId],
    );

    let merged = 0;
    for (const d of dupes) {
      await c.query(
        `UPDATE facts SET corroboration_count = $2,
                          source_episode_ids = (
                            SELECT COALESCE(array_agg(DISTINCT e), '{}')
                              FROM facts f2, unnest(f2.source_episode_ids) e
                             WHERE f2.id = ANY($3) OR f2.id = $1)
          WHERE id = $1 AND user_id = $4`,
        [d.keep, d.extra, [d.keep, ...d.drop], ctx.userId],
      );
      const r = await c.query(
        `UPDATE facts SET status = 'superseded', valid_to = now(), invalidated_at = now(),
                          superseded_by_id = $1
          WHERE id = ANY($2) AND user_id = $3 AND status = 'active'`,
        [d.keep, d.drop, ctx.userId],
      );
      merged += r.rowCount ?? 0;
    }

    // 2. Demote soft facts nobody has needed. Never delete: a fact that has not come
    // up in 90 days is uninteresting, not false, and the difference matters.
    const demote = await c.query(
      `UPDATE facts f SET importance = GREATEST(0, COALESCE(f.importance, 50) - 10)
         FROM predicates p
        WHERE p.name = f.predicate AND p.durability = 'soft'
          AND f.user_id = $1 AND f.status = 'active' AND f.valid_to IS NULL
          AND f.retrieval_count = 0
          AND f.recorded_at < now() - interval '90 days'`,
      [ctx.userId],
    );

    // 3. Surface the oldest unanswered conflict again. One at a time -- an agent that
    // interrogates you every session is one you stop talking to.
    const queued = await c.query(
      `UPDATE fact_conflicts SET status = 'open'
        WHERE id = (SELECT id FROM fact_conflicts
                     WHERE user_id = $1 AND status = 'asked'
                       AND asked_at < now() - interval '7 days'
                     ORDER BY detected_at LIMIT 1)`,
      [ctx.userId],
    );

    return {
      merged,
      demoted: demote.rowCount ?? 0,
      conflictsQueued: queued.rowCount ?? 0,
    };
  });
}

/** Users who said something in the last day. P5's working set. */
export async function activeUsers(sinceHours = 24): Promise<TenantCtx[]> {
  const { rows } = await discoverySession((c) =>
    c.query<{ tenant_id: string; user_id: string }>(
      `SELECT DISTINCT tenant_id, user_id FROM episodes
        WHERE ingested_at > now() - ($1::int * interval '1 hour')`,
      [sinceHours],
    ),
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, userId: r.user_id }));
}

export async function consolidateAll(): Promise<{ users: number; merged: number }> {
  const users = await activeUsers();
  let merged = 0;
  for (const ctx of users) {
    try {
      const r = await consolidate(ctx);
      merged += r.merged;
      if (r.merged || r.demoted || r.conflictsQueued) {
        log.info({ userId: ctx.userId, ...r }, 'consolidated');
      }
    } catch (err) {
      // One bad user must not stop the nightly pass.
      log.warn({ err, userId: ctx.userId }, 'consolidation failed; will retry tomorrow');
    }
  }
  return { users: users.length, merged };
}
