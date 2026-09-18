/**
 * The queue a tap goes into, and the worker that drains it.
 *
 * WHY. Sending an agent out is several minutes of model calls. It used to run inside
 * the HTTP request that asked for it, which meant the phone held a socket open for
 * as long as five conversations take -- and when that socket gave up, the app showed
 * the timeout as a rejection. With three candidates per round it is nearer five
 * minutes, which no mobile request survives.
 *
 * So a tap writes one row and returns. This worker claims the oldest queued row,
 * runs the round with no request waiting on it, and writes the result back where the
 * app can read it. The app polls the matches list, which already carries the round's
 * state, and shows "your agent is out" until it is not.
 *
 * ONE ACTIVE ROUND PER PERSON, enforced by a unique index rather than by a check --
 * two taps in quick succession must produce one round, and only the database can
 * promise that under concurrency.
 *
 * IN-PROCESS, like the sweeper. A second replica would claim the same row unless
 * `FOR UPDATE SKIP LOCKED` is doing its job, which it is; but the model spend would
 * still be shared across replicas with no coordination. When there is more than one
 * replica this becomes a separate worker, and the claim statement below is already
 * the one it would use.
 */
import { matchmakerSession, tenantSession } from '../db/client.js';
import { BudgetExceeded } from '../metering.js';
import { notify } from './world.js';
import { log } from '../log.js';
import { runRound, type RoundResult } from './orchestrator.js';

export interface RoundRow {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  requestedAt: string;
  finishedAt: string | null;
  result: RoundResult | null;
  error: string | null;
}

/**
 * Ask for a round. Returns the round already in flight if there is one, because the
 * unique index refuses a second and the person did not do anything wrong by tapping
 * twice.
 */
export async function enqueueRound(
  ctx: { tenantId: string; userId: string },
): Promise<RoundRow> {
  return tenantSession(ctx, async (c) => {
    const { rows } = await c.query<{ id: string; status: RoundRow['status']; requested_at: string }>(
      `INSERT INTO rounds (user_id, tenant_id) VALUES ($1, $2)
       ON CONFLICT (user_id) WHERE status IN ('queued', 'running') DO NOTHING
       RETURNING id, status, requested_at`,
      [ctx.userId, ctx.tenantId],
    );
    if (rows[0]) {
      notify(ctx.userId, { type: 'round.queued', roundId: rows[0].id });
      return {
        id: rows[0].id, status: rows[0].status, requestedAt: rows[0].requested_at,
        finishedAt: null, result: null, error: null,
      };
    }
    // Somebody -- this person -- already has one going.
    const active = await latestRound(c, ctx.userId);
    if (!active) throw new Error('round neither created nor found');
    return active;
  });
}

/** The most recent round for this person, whatever state it is in. */
export async function latestRound(
  c: import('pg').PoolClient,
  userId: string,
): Promise<RoundRow | null> {
  const { rows } = await c.query<{
    id: string; status: RoundRow['status']; requested_at: string;
    finished_at: string | null; result: RoundResult | null; error: string | null;
  }>(
    `SELECT id, status, requested_at, finished_at, result, error
       FROM rounds WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, status: r.status, requestedAt: r.requested_at,
    finishedAt: r.finished_at, result: r.result, error: r.error,
  };
}

/**
 * Claim one queued round and run it. Returns whether there was one.
 *
 * The claim is its own short transaction; the round runs with none open (that is the
 * orchestrator's whole design); the result is a second short transaction. A crash
 * between claim and result leaves a row 'running' for ever -- see `reapStale`.
 */
export async function runOneQueuedRound(): Promise<boolean> {
  const claimed = await matchmakerSession(async (c) => {
    const { rows } = await c.query<{ id: string; user_id: string }>(
      `UPDATE rounds SET status = 'running', started_at = now()
        WHERE id = (SELECT id FROM rounds WHERE status = 'queued'
                     ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, user_id`,
    );
    return rows[0] ?? null;
  });
  if (!claimed) return false;

  let result: RoundResult | null = null;
  let error: string | null = null;
  try {
    result = await runRound(claimed.user_id, { roundId: claimed.id });
  } catch (err) {
    // The budget cap is an outcome the person should be told about in plain words,
    // not a failure. Everything else is a failure and is logged as one.
    if (err instanceof BudgetExceeded) {
      error = 'budget_exceeded';
    } else {
      error = (err as Error).message ?? 'round failed';
      log.error({ err, roundId: claimed.id, userId: claimed.user_id }, 'round failed');
    }
  }

  await matchmakerSession((c) =>
    c.query(
      `UPDATE rounds SET status = $2, finished_at = now(), result = $3, error = $4
        WHERE id = $1`,
      [claimed.id, error ? 'failed' : 'done', result ? JSON.stringify(result) : null, error],
    ));
  // After the write, so a poll and the event can never disagree about whether it is over.
  notify(claimed.user_id, {
    type: 'round.done', roundId: claimed.id,
    met: result?.metAll.length ?? 0, skipped: result?.skipped ?? null, error,
  });
  return true;
}

/**
 * A round that has been 'running' for longer than any round takes was orphaned by a
 * restart. Marked failed so the person can ask again, rather than holding their one
 * active slot for ever.
 */
export async function reapStale(olderThanMs = 30 * 60_000): Promise<number> {
  return matchmakerSession(async (c) => {
    const { rows } = await c.query<{ id: string; user_id: string }>(
      `UPDATE rounds SET status = 'failed', finished_at = now(), error = 'orphaned by restart'
        WHERE status = 'running' AND started_at < now() - ($1::int * interval '1 millisecond')
        RETURNING id, user_id`,
      [olderThanMs],
    );
    // The process that claimed this round's pairs is gone, so nobody will release
    // them (see releaseClaims). Any claim of this person's as old as the round is
    // one of them: a running row with no transcript and no brief after half an hour
    // is not a conversation somebody else is having with them right now.
    for (const r of rows) {
      await c.query(
        `DELETE FROM rendezvous r
          WHERE (r.user_a = $1 OR r.user_b = $1) AND r.status = 'running'
            AND r.created_at < now() - ($2::int * interval '1 millisecond')
            AND NOT EXISTS (SELECT 1 FROM rendezvous_runs x WHERE x.rendezvous_id = r.id)
            AND NOT EXISTS (SELECT 1 FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id)`,
        [r.user_id, olderThanMs],
      );
    }
    return rows.length;
  });
}

/** One tick of the worker. Safe to call on a timer; does at most one round per tick. */
export async function roundWorkerTick(): Promise<void> {
  await reapStale();
  await runOneQueuedRound();
}
