/**
 * "Send my agent over": one person, by their ref, and nobody else.
 *
 * WHAT IS BEING GUARDED. A tap on somebody in the square starts a real
 * conversation (~$0.02), so it is bounded three ways before a row exists: the day's
 * budget, five visits a day counted in the database, and the same candidate rules
 * as an open round -- a block or a filter answers "not here" exactly as it would to
 * a scan of the square. The run itself checks the rules again, because the tap and
 * the run are minutes apart.
 *
 * Fixtures go in through the owner connection; the endpoint is hit through its real
 * route with a real token; the model is stubbed as in labels.test.ts.
 *
 * Negative controls, run by hand and recorded in the commit: drop the count in
 * enqueueRound -> the sixth tap is accepted; drop the isCandidate check in runRound
 * -> the out-of-filter person is met.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  llm: {
    complete: async (req: { outputSchema?: unknown; outputSchemaName?: string }) => {
      stub.calls++;
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
const { latestRound, runOneQueuedRound } = await import('../src/matching/rounds.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { agentRef, TARGETED_PER_DAY } = await import('../src/matching/world.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const hub = await import('../src/messaging/hub.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 180_000 });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`tr-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `tr-${label}-${Date.now()}-${Math.random()}@example.test`]);
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

const tap = (me: P, target?: string) => datingRoutes.request('/v1/matches/run', {
  method: 'POST',
  headers: { Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
  body: JSON.stringify(target ? { target } : {}),
});

const roundsOf = async (me: P) => (await owner.query<{ n: string }>(
  'SELECT count(*) AS n FROM rounds WHERE user_id = $1', [me.userId])).rows[0]!.n;

describe('send my agent over', () => {
  it('meets exactly that person, and the town hears it by ref', async () => {
    const tag = `tr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag] });
    const other = await person('other', { intent: [tag] });    // also eligible; must NOT be met
    const ref = agentRef(me.userId, them.userId);

    const frames: Array<Record<string, unknown>> = [];
    hub.join(me.userId, { readyState: 1, send: (t: string) => { frames.push(JSON.parse(t)); } } as never);

    const res = await tap(me, ref);
    expect(res.status).toBe(202);
    const { roundId } = (await res.json()) as { roundId: string };
    const { rows } = await owner.query<{ target_user_id: string | null }>(
      'SELECT target_user_id FROM rounds WHERE id = $1', [roundId]);
    expect(rows[0]?.target_user_id).toBe(them.userId);

    expect(await runOneQueuedRound(roundId)).toBe(true);
    const done = await tenantSession(me, (c) => latestRound(c, me.userId));
    expect(done?.status).toBe('done');
    expect(done?.result?.metAll).toEqual([them.userId]);
    expect(done?.result?.target).toBe(them.userId);
    expect(done?.result?.metAll).not.toContain(other.userId);

    const types = frames.map((f) => f.type);
    expect(types).toEqual(['round.queued', 'round.met', 'round.talking', 'round.decided', 'round.done']);
    expect(frames.find((f) => f.type === 'round.met')?.agent).toBe(ref);
    expect(JSON.stringify(frames)).not.toContain(them.userId);
  });

  it('answers "not here" for somebody a block or a filter keeps apart, before any row', async () => {
    const tag = `tr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const blocked = await person('blocked', { intent: [tag] });
    await owner.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)', [me.userId, blocked.userId]);
    const wrong = await person('rohan', { intent: [tag], gender: 'man', seeking_gender: ['woman'] });

    for (const who of [blocked, wrong]) {
      const res = await tap(me, agentRef(me.userId, who.userId));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_here' });
    }
    expect(await tap(me, 'deadbeefdeadbeefdeadbeefdeadbeef').then((r) => r.status)).toBe(404);
    expect(await tap(me, 'not-a-ref').then((r) => r.status)).toBe(400);
    expect(await roundsOf(me)).toBe('0');
  });

  it('is refused by the run itself when the rules changed since the tap', async () => {
    const tag = `tr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const wrong = await person('rohan', { intent: [tag], gender: 'man', seeking_gender: ['woman'] });
    const met = await person('met', { intent: [tag] });
    const [lo, hi] = me.userId < met.userId ? [me, met] : [met, me];
    await owner.query(
      `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status)
       VALUES ($1,$2,$3,$4,5,'decided')`, [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);

    const before = stub.calls;
    const a = await runRound(me.userId, { target: wrong.userId });
    expect(a.skipped).toBe('they are not someone your agent can meet');
    const b = await runRound(me.userId, { target: met.userId });
    expect(b.skipped).toBe('your agent has already met them');
    expect(b.target).toBe(met.userId);
    expect(stub.calls, 'nothing was spent').toBe(before);
  });

  it(`refuses the ${TARGETED_PER_DAY + 1}th visit in a day, counted in the database`, async () => {
    const tag = `tr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag] });
    for (let i = 0; i < TARGETED_PER_DAY; i++) {
      await owner.query(
        `INSERT INTO rounds (user_id, tenant_id, status, target_user_id, finished_at)
         VALUES ($1,$2,'done',$3, now())`, [me.userId, me.tenantId, them.userId]);
    }
    const res = await tap(me, agentRef(me.userId, them.userId));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'daily_targets', limit: TARGETED_PER_DAY });
    expect(await roundsOf(me)).toBe(String(TARGETED_PER_DAY));
    // The open round is not the thing being rationed. Run it here (stubbed) rather
    // than leave it queued for the real worker to find.
    const open = await tap(me);
    expect(open.status).toBe(202);
    const { roundId } = (await open.json()) as { roundId: string };
    expect(await runOneQueuedRound(roundId)).toBe(true);
  });

  it('refuses when the day\'s budget is spent, before any row', async () => {
    const tag = `tr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const them = await person('them', { intent: [tag] });
    await owner.query(
      `INSERT INTO tenant_budget (tenant_id, user_id, day, turns_used, cost_usd, turn_cap)
       VALUES ($1,$2, CURRENT_DATE, 0, 0, 0)`, [me.tenantId, me.userId]);
    const res = await tap(me, agentRef(me.userId, them.userId));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'budget_exceeded' });
    expect(await roundsOf(me)).toBe('0');
  });
});
