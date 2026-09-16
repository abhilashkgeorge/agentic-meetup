/**
 * A number in a spend column is not money unless something was actually spent.
 *
 * WHAT WAS FOUND. 1,441 rows in `llm_calls` carried a cost with zero input tokens,
 * zero output tokens and zero latency: $4.25 of a $6.69 ledger, and very nearly the
 * whole Anthropic line. A call that used no tokens and took no time did not happen.
 *
 * The founder asked a simple question -- "did the clone-to-clone meetings use my real
 * Gemini credits?" -- and answering it honestly meant discovering that most of the
 * table could not be trusted. That is the failure mode worth guarding: not a crash,
 * but a figure that reads as authoritative and is not, in the one table whose entire
 * purpose is to be reconcilable against an invoice.
 *
 * Those rows came from metering that used to live at eleven call sites and recorded a
 * computed guess. It now lives at the router's choke point and records what the
 * provider reported, and `computeCost` returns exactly 0 for an all-zero usage -- so
 * the current path cannot produce one. These tests exist so a future refactor cannot
 * bring it back, at both layers, because either one alone can be edited away.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { computeCost } from '../src/llm/port.js';
import { capabilities } from '../src/llm/caps.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });

afterAll(async () => {
  await owner.end();
  await pool.end();
});

describe('the cost function', () => {
  it('charges nothing for a call that used nothing', () => {
    // The property the whole guard rests on. If this ever returns a positive number
    // for an empty usage, phantom rows come back on their own.
    const caps = capabilities('google:gemini-3.5-flash-lite');
    expect(computeCost(caps, {
      inputTokens: 0, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
    })).toBe(0);
  });

  it('charges something for a call that used something', () => {
    // The negative control for the test above: a guard that always reports zero would
    // pass it and mean nothing.
    const caps = capabilities('google:gemini-3.5-flash-lite');
    expect(computeCost(caps, {
      inputTokens: 1000, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500,
    })).toBeGreaterThan(0);
  });
});

describe('the database', () => {
  it('REFUSES a cost with no tokens behind it', async () => {
    // The lock that does not depend on any application code being correct.
    const t = await owner.query<{ id: string }>(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`spend-${Date.now()}`]);
    const tenantId = t.rows[0]!.id;
    const u = await owner.query<{ id: string }>(
      'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
      [tenantId, `spend-${Date.now()}@example.test`]);
    try {
      await expect(owner.query(
        `INSERT INTO llm_calls (tenant_id, user_id, task, provider, model,
           input_tokens, cached_read_tokens, cache_write_tokens, output_tokens,
           reasoning_tokens, cost_usd, latency_ms)
         VALUES ($1,$2,'extract','anthropic','made-up',0,0,0,0,0,0.99,0)`,
        [tenantId, u.rows[0]!.id],
      )).rejects.toThrow(/llm_calls_cost_needs_tokens/);
    } finally {
      await owner.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
  });

  it('still accepts an honest row', async () => {
    // The negative control: a constraint that rejects everything would pass the test
    // above and break the product.
    const t = await owner.query<{ id: string }>(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`spend2-${Date.now()}`]);
    const tenantId = t.rows[0]!.id;
    const u = await owner.query<{ id: string }>(
      'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
      [tenantId, `spend2-${Date.now()}@example.test`]);
    try {
      await owner.query(
        `INSERT INTO llm_calls (tenant_id, user_id, task, provider, model,
           input_tokens, cached_read_tokens, cache_write_tokens, output_tokens,
           reasoning_tokens, cost_usd, latency_ms)
         VALUES ($1,$2,'extract','google','gemini-3.5-flash-lite',900,0,0,50,0,0.0004,700)`,
        [tenantId, u.rows[0]!.id],
      );
      const { rows } = await owner.query<{ n: string }>(
        'SELECT count(*) n FROM llm_calls WHERE tenant_id = $1', [tenantId]);
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      await owner.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
  });
});

describe('the history', () => {
  it('has every phantom row marked, and none left counted as spend', async () => {
    const { rows } = await owner.query<{ unmarked: string }>(
      `SELECT count(*) AS unmarked FROM llm_calls
        WHERE cost_usd > 0 AND NOT estimated
          AND input_tokens + output_tokens + cached_read_tokens + cache_write_tokens = 0`);
    expect(Number(rows[0]!.unmarked)).toBe(0);
  });

  it('kept the rows rather than deleting them', async () => {
    // A guess that was recorded is part of how this project was built. The fix is to
    // stop it being counted as money, not to pretend it never happened.
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*) AS n FROM llm_calls WHERE estimated');
    expect(Number(rows[0]!.n)).toBeGreaterThan(1000);
  });
});

describe('the application layer', () => {
  it('refuses before the database has to', async () => {
    // Failing here names the task and the model; a constraint violation names only a
    // table. Both locks are wanted, and this is the one that explains itself.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'metering.ts'), 'utf8');
    expect(src).toMatch(/refusing to book/);
    expect(src).toMatch(/usage\.costUsd > 0 && tokens === 0/);
  });
});
