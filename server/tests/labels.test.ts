/**
 * The ground truth: every pair carries its scores before the humans look, and the
 * humans' answers afterwards. Without this nothing about the matching can be measured.
 *
 * SINCE 2026-09-23 the default round takes one score, the rank, and no model call:
 * the file score (`llm_file_score`) is no longer taken and `agreement` is NULL unless
 * conversations are switched back on (RENDEZVOUS_RUNS). The stub still answers the file
 * scorer with a fixed number, so a round that took it again would write THAT number
 * and the first test would see it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ fileScore: 0.42, calls: 0 }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  // Off, as it is by default. Without it every round's jevFileScore threw vitest's
  // "no decideModel export" and the orchestrator's catch swallowed it, so a zero call
  // count here passed partly through an error. brief-code-only.test.ts guards the
  // real default.
  decideModel: () => null,
  llm: {
    complete: async (req: { outputSchema?: unknown; outputSchemaName?: string }) => {
      stub.calls++;
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite',
        costUsd: 0.0001, latencyMs: 100,
      };
      if (!req.outputSchema) return { text: 'a message', parsed: null, usage };
      if (req.outputSchemaName === 'brief') {
        return { text: '', parsed: { headline: 'Two people', pairs: [], questions: [] }, usage };
      }
      if (req.outputSchemaName === 'file_verdict') {
        return { text: '', parsed: { concern: 'they might bore each other', score: stub.fileScore }, usage };
      }
      return { text: '', parsed: { verdict: 'yes', learned: ['a', 'b', 'c'], concern: 'x' }, usage };
    },
  },
}));

const { pool, tenantSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { runRound, decide } = await import('../src/matching/orchestrator.js');
const { auc, aucStandardError } = await import('../src/matching/evaluate.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

vi.setConfig({ testTimeout: 180_000 });
beforeEach(() => { stub.calls = 0; });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Ctx = { tenantId: string; userId: string };

async function person(label: string, over: Record<string, unknown> = {}): Promise<Ctx & { token: string }> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`lb-${label}-${Date.now()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `lb-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label,
    ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(
    `INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/**
 * One seeker, one candidate, isolated by a made-up intent.
 *
 * Each gets one public fact, because the file scorer deliberately does not run on
 * two empty dossiers -- there would be nothing to score -- and a profile inserted
 * straight into match_profile has no facts and therefore no dossier.
 */
async function pair() {
  const tag = `lb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
  const them = await person('them', { intent: [tag] });
  const { commit } = await import('../src/memory/facts.js');
  for (const [who, what] of [[me, 'climbing'], [them, 'pottery']] as const) {
    await tenantSession(who, (c) => commit(c, who, {
      predicate: 'interest', objectText: what, objectValue: what,
      stance: 'asserted', originClass: 'owner', sourceQuote: what,
      sourceEpisodeIds: [], extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }));
  }
  return { me, them };
}

const req = (path: string, token: string, method = 'GET', body?: unknown) =>
  datingRoutes.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.5',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('the scores on a pair', () => {
  it('records the rank, and on the default path no file score and no agreement', async () => {
    const { me } = await pair();
    stub.fileScore = 0.42;
    const r = await runRound(me.userId);
    expect(r.metAll.length).toBe(1);
    const { rows } = await owner.query<{ rank_score: number; llm_file_score: number | null; agreement: number | null }>(
      'SELECT rank_score, llm_file_score, agreement FROM rendezvous WHERE user_a = $1 OR user_b = $1',
      [me.userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rank_score).not.toBeNull();
    // Stopped: one call a pair, recorded and never read, and only ever taken on
    // real-vs-invented pairs whose answers say nothing about two real people.
    expect(rows[0]!.llm_file_score).toBeNull();
    expect(rows[0]!.agreement).toBeNull();
    expect(stub.calls, 'model calls in the round').toBe(0);
  });
});

/**
 * The two people of a pair, first mover first: since 2026-09-28 the server takes the
 * answers only in that order (consent first -- the second person answers once the
 * first has shared).
 */
async function inTurn(rzId: string): Promise<[string, string]> {
  const { rows: [r] } = await owner.query<{ first_mover: string; user_a: string; user_b: string }>(
    'SELECT first_mover, user_a, user_b FROM rendezvous WHERE id = $1', [rzId]);
  return [r!.first_mover, r!.first_mover === r!.user_a ? r!.user_b : r!.user_a];
}

describe('the labels', () => {
  it('stamps introduced_at when both humans say yes', async () => {
    const { me, them } = await pair();
    await runRound(me.userId);
    const { rows: [rz] } = await owner.query<{ id: string }>(
      'SELECT id FROM rendezvous WHERE user_a = $1 OR user_b = $1', [me.userId]);
    const [first, second] = await inTurn(rz!.id);
    await decide(first, rz!.id, true);
    let { rows } = await owner.query<{ introduced_at: string | null }>(
      'SELECT introduced_at FROM rendezvous WHERE id = $1', [rz!.id]);
    expect(rows[0]!.introduced_at).toBeNull();                   // one yes is not two
    await decide(second, rz!.id, true);
    ({ rows } = await owner.query('SELECT introduced_at FROM rendezvous WHERE id = $1', [rz!.id]));
    expect(rows[0]!.introduced_at).not.toBeNull();
  });

  it('asks "did you meet" only three days after the introduction, and only once', async () => {
    const { me, them } = await pair();
    await runRound(me.userId);
    const { rows: [rz] } = await owner.query<{ id: string }>(
      'SELECT id FROM rendezvous WHERE user_a = $1 OR user_b = $1', [me.userId]);
    const [first, second] = await inTurn(rz!.id);
    await decide(first, rz!.id, true);
    await decide(second, rz!.id, true);

    // Just introduced: too soon to ask.
    let res = await req(`/v1/matches/${rz!.id}/met`, me.token);
    expect((await res.json() as { askDue: boolean }).askDue).toBe(false);

    // Wind the clock back four days.
    await owner.query(`UPDATE rendezvous SET introduced_at = now() - interval '4 days' WHERE id = $1`, [rz!.id]);
    res = await req(`/v1/matches/${rz!.id}/met`, me.token);
    expect((await res.json() as { askDue: boolean }).askDue).toBe(true);

    // Answer. The other side is untouched and still due to be asked themselves.
    res = await req(`/v1/matches/${rz!.id}/met`, me.token, 'POST', { yes: true });
    expect(res.status).toBe(200);
    res = await req(`/v1/matches/${rz!.id}/met`, me.token);
    expect(await res.json()).toEqual({ askDue: false, met: true });
    res = await req(`/v1/matches/${rz!.id}/met`, them.token);
    expect((await res.json() as { askDue: boolean; met: boolean | null })).toEqual({ askDue: true, met: null });

    // A second answer does not overwrite the first.
    res = await req(`/v1/matches/${rz!.id}/met`, me.token, 'POST', { yes: false });
    expect(res.status).toBe(404);
  });

  it('will not let a stranger answer for a pair they are not in', async () => {
    const { me } = await pair();
    await runRound(me.userId);
    const { rows: [rz] } = await owner.query<{ id: string }>(
      'SELECT id FROM rendezvous WHERE user_a = $1 OR user_b = $1', [me.userId]);
    const stranger = await person('stranger');
    const res = await req(`/v1/matches/${rz!.id}/met`, stranger.token, 'POST', { yes: true });
    expect(res.status).toBe(404);
  });
});

describe('the comparison arithmetic', () => {
  it('scores perfect separation as 1 and reversed as 0', () => {
    const perfect = [
      { score: 0.9, positive: true }, { score: 0.8, positive: true },
      { score: 0.2, positive: false }, { score: 0.1, positive: false },
    ];
    expect(auc(perfect)).toBe(1);
    expect(auc(perfect.map((r) => ({ ...r, positive: !r.positive })))).toBe(0);
  });

  it('scores a constant as exactly a coin', () => {
    // A scorer that returns the same number for everyone must not land somewhere
    // accidental, because "0.5" is the reading that says it knows nothing.
    expect(auc([
      { score: 0.5, positive: true }, { score: 0.5, positive: false },
      { score: 0.5, positive: true }, { score: 0.5, positive: false },
    ])).toBe(0.5);
  });

  it('refuses to say anything with no positives or no negatives', () => {
    expect(auc([{ score: 1, positive: true }])).toBeNull();
    expect(auc([{ score: 1, positive: false }])).toBeNull();
  });

  it('reports a wider error bar on fewer pairs', () => {
    expect(aucStandardError(5, 5)).toBeGreaterThan(aucStandardError(50, 50));
  });
});

