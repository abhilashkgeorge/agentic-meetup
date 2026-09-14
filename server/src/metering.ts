/**
 * Spend metering and the per-tenant kill switch.
 *
 * Rule 6: the cap is enforced HERE, before the call. No abstraction layer gives you
 * this, and for an unfunded solo developer the realistic catastrophe is not a dropped
 * cache breakpoint -- it is one looping tenant burning hundreds of dollars overnight.
 *
 * Known limit: a per-DAY cap fires AFTER the money is spent, and a single streaming
 * call can burn maxOutputTokens before any cap re-evaluates. The per-session output
 * ceiling is the second line of defence.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { env } from './env.js';
import type { Usage } from './llm/port.js';

export class BudgetExceeded extends Error {
  constructor(
    readonly kind: 'daily_cost' | 'daily_turns' | 'session_output',
    used: number,
    cap: number,
  ) {
    super(`${kind} budget exceeded: ${used} of ${cap}`);
    this.name = 'BudgetExceeded';
  }
}

/** Called before every LLM request. Throws rather than spending. */
export async function checkBudget(c: PoolClient, tenantId: string, userId: string): Promise<void> {
  const { rows } = await c.query<{
    turns_used: number;
    cost_usd: string;
    turn_cap: number | null;
    daily_cost_cap: string | null;
  }>(
    `SELECT turns_used, cost_usd, turn_cap, daily_cost_cap
       FROM tenant_budget
      WHERE tenant_id = $1 AND user_id = $2 AND day = CURRENT_DATE`,
    [tenantId, userId],
  );

  const row = rows[0];
  if (!row) return;

  const costCap = row.daily_cost_cap ? Number(row.daily_cost_cap) : env.DAILY_COST_CAP_USD;
  const spent = Number(row.cost_usd);
  if (spent >= costCap) throw new BudgetExceeded('daily_cost', spent, costCap);

  if (row.turn_cap !== null && row.turns_used >= row.turn_cap) {
    throw new BudgetExceeded('daily_turns', row.turns_used, row.turn_cap);
  }
}

/**
 * One row per LLM call. There is no unattributed spend in this system.
 * Reconciling this table against the provider invoice to within 3% is a W7
 * definition-of-done: if it drifts, the price table is wrong, not the invoice.
 */
export async function record(
  c: PoolClient,
  tenantId: string,
  userId: string,
  task: string,
  usage: Usage,
): Promise<void> {
  await c.query(
    `INSERT INTO llm_calls (tenant_id, user_id, task, provider, model,
       input_tokens, cached_read_tokens, cache_write_tokens, output_tokens,
       reasoning_tokens, cost_usd, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      tenantId, userId, task, usage.provider, usage.modelId,
      usage.inputTokens, usage.cachedReadTokens, usage.cacheWriteTokens,
      usage.outputTokens, usage.reasoningTokens, usage.costUsd, usage.latencyMs,
    ],
  );

  await c.query(
    `INSERT INTO tenant_budget (tenant_id, user_id, day, turns_used, cost_usd,
                                turn_cap, daily_cost_cap)
     VALUES ($1, $2, CURRENT_DATE, 1, $3, $4, $5)
     ON CONFLICT (tenant_id, user_id, day) DO UPDATE
       SET turns_used = tenant_budget.turns_used + 1,
           cost_usd   = tenant_budget.cost_usd + EXCLUDED.cost_usd`,
    [tenantId, userId, usage.costUsd, env.TRIAL_TURN_CAP_PER_DAY, env.DAILY_COST_CAP_USD],
  );
}

/**
 * ── The meter ─────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS. `checkBudget` and `record` were correct and were called by hand,
 * which meant the cap only saw the spend somebody had remembered to tell it about.
 * Five call sites recorded; eleven modules call a model. The dealbreaker mapper, the
 * profile renderer, the resolver, the chat importer and every round launched from a
 * script spent real money that the daily cap could not see -- and the proof was in
 * the table: after seven real rendezvous there was not one `rendezvous` row in
 * `llm_calls`, because those rounds were run from `scripts/round.ts` rather than
 * through the endpoint that happened to be wired up.
 *
 * A rule enforced by remembering is not a rule. So the meter is now ambient: it is
 * opened once around a logical operation, every model call underneath it is counted
 * without being asked, and a call with no meter above it THROWS rather than
 * proceeding for free. Forgetting is now a loud failure in development and in CI
 * instead of a silent hole in the budget.
 *
 * AsyncLocalStorage rather than a parameter, for one specific reason: the rendezvous
 * runs deliberately hold no database handle at all -- the three-phase orchestrator
 * exists precisely so a transaction is not open across eighteen minutes of model
 * calls. Threading a meter argument down to those call sites would mean giving them
 * back the thing that design removed.
 */

export class UnmeteredCall extends Error {
  constructor(readonly where: string) {
    super(
      `an LLM call was made with no meter open (${where}). Wrap the operation in `
      + `metered({ tenantId, userId }, task, fn) so the spend is counted against `
      + `somebody's daily cap.`,
    );
    this.name = 'UnmeteredCall';
  }
}

interface Meter {
  tenantId: string;
  userId: string;
  task: string;
  /** The caller's transaction, when it has one. Avoids a second connection. */
  db?: PoolClient;
  collected: Usage[];
}

const meters = new AsyncLocalStorage<Meter>();

/**
 * Count one model call against whatever meter is open.
 *
 * Called by the router, not by application code. Throws when nothing is open --
 * see UnmeteredCall.
 */
export function noteUsage(usage: Usage, where: string): void {
  const meter = meters.getStore();
  if (!meter) throw new UnmeteredCall(where);
  meter.collected.push(usage);
}

/** Whether a meter is currently open. For tests and for diagnostics. */
export const metering = (): boolean => meters.getStore() !== undefined;

/**
 * Run an operation with the budget checked before it and the spend recorded after.
 *
 * The check runs FIRST and throws `BudgetExceeded` without spending anything, which
 * is the whole point of a cap for somebody paying out of pocket. The flush runs in a
 * `finally`, so a call that fails halfway is still charged for the tokens it burned
 * -- a failed request costs exactly as much as a successful one.
 *
 * Pass `db` when the caller already holds a transaction: the check and the flush then
 * run on it rather than taking a second connection out of a pool of ten. Leave it out
 * when the caller deliberately holds none, as the rendezvous runs do.
 */
export async function metered<T>(
  who: { tenantId: string; userId: string },
  task: string,
  fn: () => Promise<T>,
  db?: PoolClient,
): Promise<T> {
  const { tenantSession } = await import('./db/client.js');
  const on = async (work: (c: PoolClient) => Promise<void>): Promise<void> => {
    if (db) return work(db);
    return tenantSession(who, work);
  };

  await on((c) => checkBudget(c, who.tenantId, who.userId));

  const meter: Meter = { ...who, task, collected: [], ...(db ? { db } : {}) };
  try {
    return await meters.run(meter, fn);
  } finally {
    if (meter.collected.length) {
      // Best effort. Losing the accounting for a call is bad; losing the caller's
      // result or their error because the accounting failed is worse.
      try {
        await on(async (c) => {
          for (const usage of meter.collected) {
            await record(c, who.tenantId, who.userId, task, usage);
          }
        });
      } catch {
        // Swallowed on purpose, and the row count in llm_calls is the alarm.
      }
    }
  }
}
