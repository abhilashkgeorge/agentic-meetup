/**
 * No model call is free, and forgetting is now loud.
 *
 * THE HOLE THIS CLOSES. `checkBudget` and `record` were correct functions called by
 * hand, so the daily cap only ever saw the spend somebody had remembered to declare.
 * Five call sites declared it; eleven modules call a model. The proof was in the
 * table: after seven real rendezvous there was not one `rendezvous` row in
 * `llm_calls`, because every one of those rounds was launched from a script rather
 * than through the single endpoint that happened to be wired up.
 *
 * The meter is now ambient and enforced at the router, so a call with nothing open
 * throws instead of quietly costing money. These tests are the reason that stays
 * true: the first one fails the moment somebody adds a model call outside a meter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import {
  BudgetExceeded, UnmeteredCall, checkBudget, metered, metering, noteUsage,
} from '../src/metering.js';
import type { Usage } from '../src/llm/port.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
let ctx = { tenantId: '', userId: '' };

const usage = (costUsd: number): Usage => ({
  provider: 'google', modelId: 'test-model',
  inputTokens: 100, cachedReadTokens: 0, cacheWriteTokens: 0,
  outputTokens: 50, reasoningTokens: 0, costUsd, latencyMs: 12,
});

const spent = async (): Promise<number> => {
  const { rows } = await owner.query<{ cost: string | null }>(
    `SELECT sum(cost_usd)::text AS cost FROM llm_calls WHERE user_id = $1`, [ctx.userId]);
  return Number(rows[0]?.cost ?? 0);
};

beforeAll(async () => {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`meter-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `meter-${Date.now()}@example.test`]);
  ctx = { tenantId, userId: u.rows[0]!.id };
});

afterAll(async () => {
  await owner.query('DELETE FROM tenants WHERE id = $1', [ctx.tenantId]);
  await owner.end();
  await pool.end();
});

describe('an unmetered call', () => {
  it('throws rather than quietly costing money', () => {
    expect(metering()).toBe(false);
    expect(() => noteUsage(usage(0.01), 'complete(test)')).toThrow(UnmeteredCall);
  });

  it('names where it happened, so the fix is obvious', () => {
    try {
      noteUsage(usage(0.01), 'complete(google:gemini-3.5-flash-lite)');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('google:gemini-3.5-flash-lite');
      expect((err as Error).message).toContain('metered(');
    }
  });
});

describe('a metered call', () => {
  it('records every call, not one summary row', async () => {
    const before = await spent();
    await metered(ctx, 'rendezvous', async () => {
      // What a round looks like: many calls under one meter.
      noteUsage(usage(0.004), 'a');
      noteUsage(usage(0.004), 'b');
      noteUsage(usage(0.002), 'c');
    });
    expect(await spent()).toBeCloseTo(before + 0.01, 6);

    const { rows } = await owner.query<{ n: string; task: string }>(
      `SELECT count(*) AS n, task FROM llm_calls
        WHERE user_id = $1 AND task = 'rendezvous' GROUP BY task`, [ctx.userId]);
    // Three rows, with real token counts -- not one synthesised row of zeroes that
    // could never be reconciled against a provider invoice.
    expect(Number(rows[0]!.n)).toBe(3);
  });

  it('charges for a call that failed, because the tokens were still bought', async () => {
    const before = await spent();
    await expect(
      metered(ctx, 'extract', async () => {
        noteUsage(usage(0.003), 'a');
        throw new Error('provider blew up after the tokens were spent');
      }),
    ).rejects.toThrow('provider blew up');
    expect(await spent()).toBeCloseTo(before + 0.003, 6);
  });

  it('does not leak out of its own async context', async () => {
    await metered(ctx, 'extract', async () => {
      expect(metering()).toBe(true);
    });
    expect(metering()).toBe(false);
  });
});

describe('the cap', () => {
  it('refuses before the call rather than after the money is gone', async () => {
    await owner.query(
      `INSERT INTO tenant_budget (tenant_id, user_id, day, turns_used, cost_usd,
                                  turn_cap, daily_cost_cap)
       VALUES ($1,$2,CURRENT_DATE,1,99.0,1000,2.0)
       ON CONFLICT (tenant_id, user_id, day)
       DO UPDATE SET cost_usd = 99.0, daily_cost_cap = 2.0`,
      [ctx.tenantId, ctx.userId],
    );

    let ran = false;
    await expect(
      metered(ctx, 'rendezvous', async () => { ran = true; }),
    ).rejects.toThrow(BudgetExceeded);
    // The point of a cap for somebody paying out of pocket: the work never started.
    expect(ran).toBe(false);
  });

  it('is the same check the endpoints used to make by hand', async () => {
    await expect(
      tenantSession(ctx, (c) => checkBudget(c, ctx.tenantId, ctx.userId)),
    ).rejects.toThrow(BudgetExceeded);
  });
});
