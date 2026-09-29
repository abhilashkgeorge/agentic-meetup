/**
 * The matchmaker reads no profile summary (0081; the founder, 2026-09-29: "Remove the
 * matching role's access to profile summaries").
 *
 * WHAT WAS WRONG: clone_matchmaker, the role every round runs as, could read every row of
 * core_profile -- four blocks of prose written from all of a person's confirmed facts,
 * private ones too -- while the same role sees only public facts in `facts`. And every
 * round DID read the fifth block, the voice (how they write), through it, so taking the
 * table away alone would have failed every round.
 *
 * WHAT IS PINNED, with a real round, conversations switched on (RENDEZVOUS_RUNS=1) and the
 * model stubbed:
 *   - each person's voice still reaches the conversation, read as that person;
 *   - the matchmaker role is refused the table, and holds no privilege on it -- nor do
 *     the matcher, the door or discovery; the app keeps it (the person's own chat).
 * And, as a guard (true before too): no summary block reaches any model call in a round.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the round reading voice through the matchmaker again (orchestrator.ts as before),
 *     with 0081 applied                      -> "still reaches the conversation" fails;
 *   - 0028's grant and policy put back on the tests' database -> "refused" fails.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

const stub = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock('../src/llm/index.js', () => ({
  modelFor: () => 'google:gemini-3.5-flash-lite',
  decideModel: () => null,
  llm: {
    complete: async (req: { instructions?: string; messages?: { content: string }[]; outputSchema?: unknown }) => {
      stub.prompts.push([req.instructions ?? '', ...(req.messages ?? []).map((m) => m.content)].join('\n'));
      const usage = {
        inputTokens: 500, cachedReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60,
        reasoningTokens: 0, provider: 'google', modelId: 'flash-lite', costUsd: 0.0001, latencyMs: 100,
      };
      if (!req.outputSchema) return { text: 'I cycle to Nandi Hills most Sundays', parsed: null, usage };
      return { text: '', usage, parsed: { learned: ['a', 'b', 'c'], concern: '', verdict: 'yes' } };
    },
  },
}));

const { env } = await import('../src/env.js');
// The opt-in, set before rendezvous.ts reads it.
process.env.RENDEZVOUS_RUNS = '1';
const { pool, tenantSession, matchmakerSession, closeMatchPool } = await import('../src/db/client.js');
const { commit } = await import('../src/memory/facts.js');
const { enqueueRound, runOneQueuedRound } = await import('../src/matching/rounds.js');
const { RUNS } = await import('../src/matching/rendezvous.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 180_000 });

afterAll(async () => {
  // Facts have no foreign key to tenants; this file's own fixtures only.
  if (made.length) await owner.query('DELETE FROM facts WHERE tenant_id = ANY($1)', [made]);
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string }
async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [`mns-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `mns-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, in_pool: true, is_synthetic: false,
    sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  const ctx = { tenantId, userId };
  await tenantSession(ctx, (c) => commit(c, ctx, {
    predicate: 'interest', objectText: `thing-${label}`, objectValue: `thing-${label}`,
    stance: 'asserted', originClass: 'owner', sourceQuote: 'x', sourceEpisodeIds: [],
    extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }));
  // All five blocks: four summaries written from every fact, private ones among them,
  // and how they write.
  const blocks: [string, string][] = [
    ['identity', `SUMMARY-${label}: Catholic, does not drink, does not want children`],
    ['situation', `SUMMARY-${label}: between jobs, living with parents`],
    ['preferences', `SUMMARY-${label}: nobody who smokes`],
    ['open_threads', `SUMMARY-${label}: worried about a sister's health`],
    ['voice', `VOICE-${label}: all lowercase, never an emoji`],
  ];
  for (const [block, content] of blocks) {
    await owner.query(`INSERT INTO core_profile (tenant_id, user_id, block_name, content, token_count,
                                                  rendering_model, source_fact_ids)
                       VALUES ($1,$2,$3,$4,10,'t','{}')`, [tenantId, userId, block, content]);
  }
  return ctx;
}

describe('a round, with the conversations on', () => {
  it('still gives each agent how its person writes, read as that person -- and no summary', async () => {
    expect(RUNS).toBe(1);
    const tag = `mns-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    await person('them', { intent: [tag] });

    const round = await enqueueRound(me);
    expect(await runOneQueuedRound(round.id), 'no round was run').toBe(true);
    const all = stub.prompts.join('\n----\n');
    expect(all, 'my voice never reached the conversation').toContain('How they write:\nVOICE-me: all lowercase');
    expect(all, 'their voice never reached the conversation').toContain('How they write:\nVOICE-them: all lowercase');
    expect(all, 'a profile summary reached a model call in a round').not.toContain('SUMMARY-');
  });

  it('runs as a role that is refused the table, as are the matcher, the door and discovery', async () => {
    await expect(matchmakerSession((c) => c.query('SELECT content FROM core_profile LIMIT 1')))
      .rejects.toThrow(/permission denied/);
    const can = async (role: string, priv: string) => (await owner.query<{ ok: boolean }>(
      'SELECT has_table_privilege($1, $2, $3) AS ok', [role, 'core_profile', priv])).rows[0]!.ok;
    for (const role of ['clone_matchmaker', 'clone_match', 'clone_door', 'clone_discovery']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await can(role, priv), `${role} may ${priv}`).toBe(false);
    }
    // The person's own chat still reads it, under their own tenant.
    expect(await can('clone_app', 'SELECT')).toBe(true);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policy WHERE polrelid = 'core_profile'::regclass AND polname = 'core_profile_matchmaker'`);
    expect(rows[0]!.n).toBe('0');
  });
});
