/**
 * Conversations switched back on still reach nobody.
 *
 * RENDEZVOUS_RUNS is the deliberate opt-in for the old agent-to-agent conversations
 * (off by default; see RUNS in rendezvous.ts). An experiment may want them -- the
 * spec's only road back is a hidden A/B on real pairs judged on see_again -- and what
 * they measure is still recorded where compare-scorers reads it: the runs, and the
 * agreement on the pair. What must NOT happen, even then, is what used to: the
 * assessor's concern written onto the card ("He is a comedy writer" reached a real
 * person that way), the agreement shown as words or used to order the list, or a
 * verdict drawn over two heads in the square.
 *
 * One pair, one run, the model stubbed to say yes with a concern that must go nowhere.
 *
 * Negative control, run by hand: pass the picked concern to saveBriefs again -> the
 * concern assertion fails; put `agreement` back on the round.decided event -> the
 * frame assertion fails.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  decideModel: () => null,
  llm: {
    complete: async (req: { outputSchema?: unknown; outputSchemaName?: string }) => {
      stub.calls++;
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite', costUsd: 0.0001, latencyMs: 100,
      };
      if (!req.outputSchema) return { text: 'I do stand-up at a comedy club every Friday night', parsed: null, usage };
      return { text: '', usage, parsed: { learned: ['a', 'b', 'c'], concern: 'He is a comedy writer', verdict: 'yes' } };
    },
  },
}));

const { env } = await import('../src/env.js');
// The opt-in, set before rendezvous.ts reads it.
process.env.RENDEZVOUS_RUNS = '1';
const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const { enqueueRound, runOneQueuedRound } = await import('../src/matching/rounds.js');
const { RUNS } = await import('../src/matching/rendezvous.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const hub = await import('../src/messaging/hub.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 180_000 });

afterAll(async () => {
  // Facts have no foreign key to tenants, so deleting the tenant alone leaves them
  // behind. This file's own fixtures only.
  if (made.length) await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`co-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `co-${label}-${Date.now()}-${Math.random()}@example.test`]);
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
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

describe('conversations, opted back in', () => {
  it('are recorded for the scorers, and reach neither the card nor the square', async () => {
    expect(RUNS).toBe(1);
    const tag = `co-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    await person('them', { intent: [tag] });

    const frames: Array<Record<string, unknown>> = [];
    hub.join(me.userId, { readyState: 1, send: (t: string) => { frames.push(JSON.parse(t)); } } as never);
    const round = await enqueueRound(me);
    expect(await runOneQueuedRound(round.id)).toBe(true);
    expect(stub.calls, 'the conversation really ran').toBeGreaterThan(0);

    // Recorded where compare-scorers reads it...
    const { rows } = await owner.query<{ agreement: string | null; runs: string; concern: string; a_concern: string }>(
      `SELECT r.agreement,
              (SELECT count(*) FROM rendezvous_runs x WHERE x.rendezvous_id = r.id) AS runs,
              (SELECT b.concern FROM rendezvous_briefs b WHERE b.rendezvous_id = r.id AND b.for_user = $1) AS concern,
              (SELECT x.a_concern FROM rendezvous_runs x WHERE x.rendezvous_id = r.id LIMIT 1) AS a_concern
         FROM rendezvous r WHERE r.user_a = $1 OR r.user_b = $1`, [me.userId]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.agreement)).toBe(1);
    expect(rows[0]!.runs).toBe('1');
    expect(rows[0]!.a_concern).toBe('He is a comedy writer');
    // ...and nowhere a person looks.
    expect(rows[0]!.concern).toBe('');
    const decided = frames.find((f) => f.type === 'round.decided');
    expect(decided).toBeDefined();
    expect(decided).not.toHaveProperty('agreement');

    const res = await datingRoutes.request('/v1/matches', {
      headers: { Authorization: `Bearer ${me.token}`, 'x-forwarded-for': '203.0.113.23' },
    });
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('comedy');
    expect(body).not.toContain('"agreement"');
    expect(body).not.toContain('"concern"');
  });
});
