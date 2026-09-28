/**
 * Setting up never uses the day's ten model calls.
 *
 * WHAT THE FOUNDER ASKED FOR (2026-09-28, item 4): "setup and onboarding calls
 * shouldn't count against the 10-calls-a-day limit."
 *
 * WHAT WAS WRONG: one daily count (TRIAL_TURN_CAP_PER_DAY = 10) for every call a person
 * caused. Measured that day: real people's setup took 1 to 4 of the ten on their first
 * day, before any chat or round, and 6 person-days reached ten or more.
 *
 * WHAT IS PINNED HERE:
 *   - a setup call runs when the day's ten are used up, and does not add to them;
 *   - it has its own bound (SETUP_CALLS_PER_DAY), and the cost cap still holds;
 *   - an operation opened inside a setup one is setup too;
 *   - the five setup steps say so. SOURCE SHAPE, on purpose: each route would need its
 *     model stubbed and its screen's state built to be driven here, and the rule is one
 *     word per call site -- so the words are checked, comments stripped.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - checkBudget ignoring `setup`                 -> "runs when the ten are used" fails
 *   - record counting a setup call as a turn        -> "does not add to them" fails
 *   - metered not inheriting an open setup meter    -> "inside a setup one" fails
 *   - tell.ts without `setup: true`                 -> "the five setup steps" fails
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { pool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { BudgetExceeded, metered, noteUsage } from '../src/metering.js';
import type { Usage } from '../src/llm/port.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
const usage: Usage = {
  provider: 'google', modelId: 'test-model', inputTokens: 100, cachedReadTokens: 0, cacheWriteTokens: 0,
  outputTokens: 50, reasoningTokens: 0, costUsd: 0.0006, latencyMs: 12,
};

async function person(): Promise<{ tenantId: string; userId: string }> {
  const tag = `setup-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  made.push(t.rows[0]!.id);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [t.rows[0]!.id, `${tag}@example.test`]);
  return { tenantId: t.rows[0]!.id, userId: u.rows[0]!.id };
}
/** Today's row, as a person who already used `turns` of the ten and `setup` setup calls. */
async function used(who: { tenantId: string; userId: string }, turns: number, setup: number, cost = 0) {
  await owner.query(
    `INSERT INTO tenant_budget (tenant_id, user_id, day, turns_used, setup_used, cost_usd, turn_cap, daily_cost_cap)
     VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,10,2.0)
     ON CONFLICT (tenant_id, user_id, day) DO UPDATE
       SET turns_used = $3, setup_used = $4, cost_usd = $5, turn_cap = 10, daily_cost_cap = 2.0`,
    [who.tenantId, who.userId, turns, setup, cost]);
}
const today = async (who: { userId: string }) => (await owner.query<{ turns_used: number; setup_used: number }>(
  'SELECT turns_used, setup_used FROM tenant_budget WHERE user_id = $1 AND day = CURRENT_DATE', [who.userId])).rows[0]!;

beforeAll(() => { expect(env.SETUP_CALLS_PER_DAY).toBeGreaterThanOrEqual(10); });
afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await pool.end();
});

describe('a setup call', () => {
  it('runs when the day\'s ten are used up, and does not add to them', async () => {
    const who = await person();
    await used(who, 10, 0);
    await expect(metered(who, 'chat', async () => { noteUsage(usage, 'x'); }), 'the ten still stop a chat')
      .rejects.toThrow(BudgetExceeded);

    await metered(who, 'extract', async () => { noteUsage(usage, 'first sentence'); }, { setup: true });
    expect(await today(who)).toMatchObject({ turns_used: 10, setup_used: 1 });
  });

  it('has its own bound, and the cost cap still holds', async () => {
    const who = await person();
    await used(who, 0, env.SETUP_CALLS_PER_DAY);
    await expect(metered(who, 'extract', async () => {}, { setup: true })).rejects.toMatchObject({ kind: 'daily_setup' });
    const spent = await person();
    await used(spent, 0, 0, 99);
    await expect(metered(spent, 'extract', async () => {}, { setup: true })).rejects.toMatchObject({ kind: 'daily_cost' });
  });

  it('an operation opened inside a setup one is setup too', async () => {
    const who = await person();
    await used(who, 10, 0);
    await metered(who, 'extract', async () => {
      await metered(who, 'extract', async () => { noteUsage(usage, 'nested'); });
    }, { setup: true });
    expect(await today(who)).toMatchObject({ turns_used: 10, setup_used: 1 });
  });
});

describe('the five setup steps', () => {
  const said = (rel: string) => readFileSync(join(import.meta.dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  it('each opens its meter as setup', () => {
    const tell = said('src/api/tell.ts');
    expect(tell).toMatch(/metered\(ctx, 'extract', \(\) => extractSessionFacts\([\s\S]*?\), \{ setup: true \}\)/);
    expect(tell).toContain('ensureSheet(ctx, { setup: true })');
    expect(said('src/api/selftest.ts')).toContain("metered(ctx, 'render_profile', () => nextSelfTest(db, ctx), { db, setup: true })");
    expect(said('src/api/interview.ts')).toContain("metered(ctx, 'extract', () => mapDealbreaker(ctx, sentence), { setup: true })");
    const imports = said('src/api/import.ts');
    expect(imports).toContain('parsed.data.source), { db, setup: true })');
    expect(imports).toContain("metered(ctx, 'extract', () => extractVoice(ctx, messages), { setup: true })");
    // And nothing else is: chat, learning from chat and rounds stay on the ten.
    for (const f of ['src/api/chat.ts', 'src/memory/session.ts', 'src/matching/orchestrator.ts']) {
      expect(said(f), f).not.toContain('setup: true');
    }
  });
});
