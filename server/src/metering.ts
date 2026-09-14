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
