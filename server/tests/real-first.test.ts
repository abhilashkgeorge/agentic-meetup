/**
 * Real people are picked first, and no real person is picked by everybody.
 *
 * THE BUG THIS EXISTS FOR -- spec guard (g). The candidate query already put real
 * people first (candidates.ts), and then the round threw that order away: it re-sorted
 * the survivors through rank(), whose re-fetch has no ORDER BY and whose score an
 * invented profile wins on richer tags. With three picks a round and five thousand
 * invented profiles, a real survivor was met only by luck -- in a product whose whole
 * point is the real person. Found reading orchestrator.ts against score.ts:169-172.
 *
 * AND THE CAP THAT HAS TO COME WITH IT. Real-first in a small pool means every round
 * picks the same scarce few (Bruch & Newman 2018: the most-contacted people get many
 * times the median). So a real person brought by five other real people's rounds this
 * week is not picked again this week. Invented profiles are never capped, and rounds
 * started by invented profiles do not count.
 *
 * Negative controls, run by hand:
 *   - picking from rank()'s order again         -> "picks the real person first" fails
 *   - overExposed returning nobody              -> "skips a real person" fails
 *   - the cap counting invented starters too    -> "only real starters count" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

// The settings that change a round are removed between the .env load and env.ts's
// parse, exactly as brief-code-only.test.ts does: three picks, no conversation.
vi.hoisted(() => {
  const DEFAULTED = ['RENDEZVOUS_RUNS', 'ROUND_CANDIDATES', 'DECIDE_MODEL', 'WEEKLY_REAL_EXPOSURE'];
  const original = process.loadEnvFile;
  const strip = () => { for (const k of DEFAULTED) delete process.env[k]; };
  process.loadEnvFile = ((...args: Parameters<typeof process.loadEnvFile>) => {
    try { original.apply(process, args); } finally { strip(); }
  }) as typeof process.loadEnvFile;
  strip();
});

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: {
      ...real.llm,
      complete: async () => { throw new Error('a round makes no model call'); },
      decide: async () => { throw new Error('a round makes no model call'); },
    },
  };
});

const { env } = await import('../src/env.js');
const { pool, closeMatchPool } = await import('../src/db/client.js');
const { runRound, CANDIDATES_PER_ROUND } = await import('../src/matching/orchestrator.js');
const { WEEKLY_REAL_EXPOSURE } = await import('../src/matching/candidates.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
vi.setConfig({ testTimeout: 120_000 });

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string }

async function person(label: string, over: Record<string, unknown>): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id',
    [`rf-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `rf-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50,
    in_pool: true, is_synthetic: false, sees_synthetic: false, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => cols[k]));
  return { tenantId, userId };
}

/** A round somebody else already ran this week, which met `who`. */
async function pastRound(by: P, who: string[]) {
  await owner.query(
    `INSERT INTO rounds (user_id, tenant_id, status, requested_at, result)
     VALUES ($1, $2, 'done', now() - interval '1 day', $3)`,
    [by.userId, by.tenantId, JSON.stringify({ metAll: who })]);
}

const RICH = ['interest:pottery', 'interest:whisky', 'interest:hiking', 'interest:jazz', 'interest:chess'];

describe('who a round picks', () => {
  it('picks the real person first, even when every invented one outranks her', async () => {
    expect(CANDIDATES_PER_ROUND).toBe(3);
    const tag = `rf-g-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag], sees_synthetic: true,
      attribute_tags: RICH });
    // Four invented people who share every interest: rank() scores them far above her.
    for (let i = 0; i < 4; i++) {
      await person(`ghost${i}`, { intent: [tag], is_synthetic: true, attribute_tags: RICH });
    }
    const her = await person('her', { intent: [tag], attribute_tags: [] });

    const r = await runRound(me.userId);
    expect(r.skipped, r.skipped).toBeUndefined();
    expect(r.metAll, 'the real person was never met').toContain(her.userId);
    expect(r.metAll[0]).toBe(her.userId);

    // The score is still recorded on every pair, for compare-scorers -- it just did not pick.
    const { rows } = await owner.query<{ rank_score: number | null }>(
      `SELECT rank_score FROM rendezvous WHERE user_a = $1 OR user_b = $1`, [me.userId]);
    expect(rows.length).toBe(3);
    expect(rows.every((x) => x.rank_score !== null)).toBe(true);
  });

  it('skips a real person five other real people\'s rounds already brought this week', async () => {
    const tag = `rf-cap-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag], sees_synthetic: true });
    const busy = await person('busy', { intent: [tag] });
    const ghost = await person('ghost', { intent: [tag], is_synthetic: true });
    for (let i = 0; i < WEEKLY_REAL_EXPOSURE; i++) {
      await pastRound(await person(`sender${i}`, { gender: 'man', seeking_gender: ['woman'], intent: [`other-${tag}`] }),
        [busy.userId, ghost.userId]);
    }

    const r = await runRound(me.userId);
    expect(r.metAll, 'a real person was picked past the weekly cap').not.toContain(busy.userId);
    // Never capped: an invented profile has no inbox to flood.
    expect(r.metAll).toContain(ghost.userId);
  });

  it('only real starters count toward the cap', async () => {
    const tag = `rf-cap2-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag] });
    const her = await person('her', { intent: [tag] });
    for (let i = 0; i < WEEKLY_REAL_EXPOSURE; i++) {
      await pastRound(await person(`bot${i}`, { is_synthetic: true, intent: [`other-${tag}`] }), [her.userId]);
    }
    const r = await runRound(me.userId);
    expect(r.metAll, 'rounds started by invented profiles capped a real person').toContain(her.userId);
  });
});
