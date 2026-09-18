/**
 * A round that dies gives its claims back.
 *
 * The read phase claims one rendezvous row per pair before the first model call,
 * so two rounds cannot run the same pair at once. Until 0055 a round that then
 * failed -- the day's cap, the model down -- left those rows 'running' for ever:
 * hidden from the matches list (no brief), counted by "a pair meets once", so the
 * person could never be met again, and drawn by the town as a conversation that
 * never ends. This is the founder's own phone on 2026-09-18: a second tap of "Send
 * my agent out" hit the daily turn cap and quietly burned three people.
 *
 * Negative control: remove the `.catch` in runRound that calls releaseClaims -> the
 * running row survives the failed round and the second round finds nobody to meet.
 *
 * The model is stubbed as in labels.test.ts, with a switch that makes it fail.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ calls: 0, fileCalls: 0, down: false, downAtFileCall: 0 }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  llm: {
    complete: async (req: { outputSchema?: unknown; outputSchemaName?: string }) => {
      stub.calls++;
      // The file score is the first call a pair makes, before any talking: failing
      // on the Nth one fails the Nth pair before it starts, with N-1 already written.
      if (req.outputSchemaName === 'file_verdict' && ++stub.fileCalls === stub.downAtFileCall) stub.down = true;
      if (stub.down) throw new Error('model down');
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite', costUsd: 0.0001, latencyMs: 100,
      };
      if (!req.outputSchema) return { text: 'a message', parsed: null, usage };
      if (req.outputSchemaName === 'brief') return { text: '', parsed: { headline: 'Two people', pairs: [], questions: [] }, usage };
      if (req.outputSchemaName === 'file_verdict') return { text: '', parsed: { concern: 'c', score: 0.4 }, usage };
      return { text: '', parsed: { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'x' }, usage };
    },
  },
}));

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { enqueueRound, latestRound, runOneQueuedRound } = await import('../src/matching/rounds.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 180_000 });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string }
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`rr-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `rr-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  const ctx = { tenantId, userId };
  await tenantSession(ctx, (c) => commit(c, ctx, {
    predicate: 'interest', objectText: `thing-${label}`, objectValue: `thing-${label}`,
    stance: 'asserted', originClass: 'owner', sourceQuote: 'x', sourceEpisodeIds: [],
    extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }));
  return ctx;
}

const runningRows = async (me: P) => (await owner.query<{ n: string }>(
  `SELECT count(*) AS n FROM rendezvous WHERE (user_a = $1 OR user_b = $1) AND status = 'running'`,
  [me.userId])).rows[0]!.n;

describe('a round that fails', () => {
  it('releases the pairs it claimed but never talked to, so they can be met next time', async () => {
    const tag = `rr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag] });

    stub.down = true;
    await enqueueRound(me);
    expect(await runOneQueuedRound()).toBe(true);
    const failed = await tenantSession(me, (c) => latestRound(c, me.userId));
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('model down');
    // The claim is gone -- not 'lapsed', not hidden: gone.
    expect(await runningRows(me)).toBe('0');

    // And the same person is still there to be met.
    stub.down = false;
    await enqueueRound(me);
    expect(await runOneQueuedRound()).toBe(true);
    const done = await tenantSession(me, (c) => latestRound(c, me.userId));
    expect(done?.status).toBe('done');
    expect(done?.result?.metAll).toEqual([them.userId]);
    expect(await runningRows(me)).toBe('0');
  });

  it('keeps what it paid for: a pair written before the failure stays', async () => {
    const tag = `rr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const first = await person('first', { intent: [tag] });
    const second = await person('second', { intent: [tag] });

    // Fail on the second pair's first call, once the first pair's write has landed.
    stub.fileCalls = 0; stub.downAtFileCall = 2;
    try {
      await enqueueRound(me);
      expect(await runOneQueuedRound()).toBe(true);
    } finally { stub.down = false; stub.downAtFileCall = 0; }

    const rows = await owner.query<{ status: string; other: string }>(
      `SELECT status, CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS other
         FROM rendezvous WHERE user_a = $1 OR user_b = $1`, [me.userId]);
    // Exactly one pair remains, decided; the other claim was released.
    expect(rows.rows.map((r) => r.status)).toEqual(['decided']);
    expect([first.userId, second.userId]).toContain(rows.rows[0]!.other);
    const failed = await tenantSession(me, (c) => latestRound(c, me.userId));
    expect(failed?.status).toBe('failed');
  });
});
