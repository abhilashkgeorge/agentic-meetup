/**
 * Before real users (the founder's item 4, 2026-09-28): three rules about who meets whom.
 *
 *   - "Practice profiles can never be first mover." The first mover was the busier side,
 *     and a practice profile -- on many people's cards at once -- could be. It never
 *     answers, so the real person waited out three days on "They decide first".
 *     Measured that day: 1 open card with a real person waiting behind a practice
 *     profile (37 more were practice against practice). brief.ts firstMoverOf, and
 *     migration 0074 moved the open one.
 *   - "Make distance truly both ways." The clause passed whenever EITHER side had no
 *     limit, so somebody who never set one switched off the other person's 10 km.
 *   - "Reseed the practice pool so it doesn't expire." Practice profiles keep their seed
 *     date as their last visit, and the 60-day activity rule would have emptied the pool
 *     around 2026-11-11. Exempted instead of reseeded (the seed script deletes).
 *
 * The model is not called: a round here makes none, and the stub throws if it tries.
 *
 * Negative controls, run 2026-09-28, each restored byte-identical:
 *   - saveBriefs back on busierSide                 -> "the real person decides first" fails
 *   - 0074's UPDATE without its "nobody answered" line -> "moves only" fails
 *   - the distance clause back on "either side NULL passes" -> "a limit is kept" fails
 *   - the activity clause without the practice exemption -> "never expires" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

vi.hoisted(() => {
  const DEFAULTED = ['RENDEZVOUS_RUNS', 'ROUND_CANDIDATES', 'DECIDE_MODEL', 'WEEKLY_REAL_EXPOSURE', 'AGENT_TALK',
                     'SYNTHETIC_AUTO_YES'];
  const original = process.loadEnvFile;
  const strip = () => { for (const k of DEFAULTED) delete process.env[k]; };
  process.loadEnvFile = ((...args: Parameters<typeof process.loadEnvFile>) => {
    try { original.apply(process, args); } finally { strip(); }
  }) as typeof process.loadEnvFile;
  strip();
  process.env.AGENT_TALK = 'off';
});

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: { ...real.llm, complete: async () => { throw new Error('no model call here'); } },
  };
});

const { env } = await import('../src/env.js');
const { pool, closeMatchPool, matchSession } = await import('../src/db/client.js');
const { runRound } = await import('../src/matching/orchestrator.js');
const { isCandidate } = await import('../src/matching/candidates.js');

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
    [`bru-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `bru-${label}-${Date.now()}-${Math.random()}@example.test`]);
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

/** An open card between two people, `first` deciding first; `answered` plants a yes. */
async function openCard(first: P, second: P, answered = false): Promise<string> {
  const [lo, hi] = first.userId < second.userId ? [first, second] : [second, first];
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, answer_by)
     VALUES ($1,$2,$3,$4,0,'decided',$5, now() + interval '3 days') RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId, first.userId]);
  for (const who of [first, second]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, human_says_yes, decided_at)
       VALUES ($1,$2,'h','c',$3, CASE WHEN $3::boolean IS NULL THEN NULL ELSE now() END)`,
      [rows[0]!.id, who.userId, answered && who === first ? true : null]);
  }
  return rows[0]!.id;
}
const firstMover = async (id: string) =>
  (await owner.query<{ f: string }>('SELECT first_mover AS f FROM rendezvous WHERE id = $1', [id])).rows[0]!.f;

describe('practice profiles never decide first', () => {
  it('the real person decides first, even when the practice profile is the busier side', async () => {
    const tag = `bru-fm-${Date.now()}`;
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'], intent: [tag], sees_synthetic: true });
    const practice = await person('practice', { intent: [tag], is_synthetic: true });
    // Three open cards the practice profile already holds with other people: by the old
    // rule (the busier side decides first) it would decide first here too.
    for (let i = 0; i < 3; i++) {
      const other = await person(`other${i}`, { gender: 'man', seeking_gender: ['woman'], intent: [`${tag}-x${i}`] });
      await openCard(practice, other);
    }
    const r = await runRound(me.userId);
    expect(r.metAll).toEqual([practice.userId]);
    const { rows } = await owner.query<{ id: string }>(
      'SELECT id FROM rendezvous WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)',
      [me.userId, practice.userId]);
    expect(await firstMover(rows[0]!.id), 'the practice profile decides first and never will').toBe(me.userId);
  });

  it('0074 moves only open cards nobody has answered, from a practice profile to the real person', async () => {
    const real = await person('r0', { gender: 'man', seeking_gender: ['woman'] });
    const practice = await person('p0', { is_synthetic: true });
    const stuck = await openCard(practice, real);
    const answered = await openCard(await person('p1', { is_synthetic: true }), await person('r1', { gender: 'man' }), true);
    const twoReal = await openCard(await person('r2', {}), await person('r3', { gender: 'man' }));
    const before = { answered: await firstMover(answered), twoReal: await firstMover(twoReal) };

    // The migration's own statement, confined to this test's cards: other test files
    // share this database and their fixtures are not this test's to move.
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '0074_real_person_decides_first.sql'), 'utf8')
      .replace(/--[^\n]*/g, '').trim().replace(/;\s*$/, '');
    await owner.query(`${sql} AND r.id = ANY($1::uuid[])`, [[stuck, answered, twoReal]]);

    expect(await firstMover(stuck)).toBe(real.userId);
    expect(await firstMover(answered), 'a card somebody had answered was changed').toBe(before.answered);
    expect(await firstMover(twoReal)).toBe(before.twoReal);
  });
});

describe('distance, both ways', () => {
  it('a limit is kept when the other person set none', async () => {
    const tag = `bru-d-${Date.now()}`;
    // Koramangala and Whitefield: about 14 km apart.
    const near = await person('near', { gender: 'man', seeking_gender: ['woman'], intent: [tag],
                                        lat: 12.935, lon: 77.624, max_distance_km: 10 });
    const far = await person('far', { intent: [tag], lat: 12.970, lon: 77.750, max_distance_km: null });
    const passes = (a: P, b: P) => matchSession((c) => isCandidate(c, a.userId, b.userId));
    expect(await passes(near, far), 'her missing limit switched off his 10 km').toBe(false);
    expect(await passes(far, near), 'the same rule, from her side').toBe(false);

    // Inside his limit, it passes both ways; and with no point at all, distance cannot be tested.
    const close = await person('close', { intent: [tag], lat: 12.94, lon: 77.63, max_distance_km: null });
    expect(await passes(near, close)).toBe(true);
    expect(await passes(close, near)).toBe(true);
    const nowhere = await person('nowhere', { intent: [tag], lat: null, lon: null, max_distance_km: null });
    expect(await passes(near, nowhere)).toBe(true);
  });
});

describe('the practice pool', () => {
  it('never expires; a real person away sixty days still does', async () => {
    const tag = `bru-a-${Date.now()}`;
    const me = await person('me2', { gender: 'man', seeking_gender: ['woman'], intent: [tag], sees_synthetic: true });
    const old = new Date(Date.now() - 90 * 86_400_000);
    const practice = await person('seeded', { intent: [tag], is_synthetic: true, last_active_at: old });
    const away = await person('away', { intent: [tag], last_active_at: old });
    const passes = (b: P) => matchSession((c) => isCandidate(c, me.userId, b.userId));
    expect(await passes(practice), 'the practice profile expired with its seed date').toBe(true);
    expect(await passes(away)).toBe(false);
  });
});
