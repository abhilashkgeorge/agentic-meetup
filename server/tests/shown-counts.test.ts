/**
 * A pool count is rounded to ten, and under twenty it is not shown at all.
 *
 * THE BUG THIS EXISTS FOR. Before the five core cards, no real person had a value on
 * smoking, drinking, kids, monogamy or food: every rule passed them as unknown and no
 * count ever moved. With the cards, everybody has one -- and an exact count is then a
 * question anybody can ask about anybody. Set "Let me choose" on a card, flip that rule
 * between must-have and want on /preferences, and the difference in the returned total
 * is how many people in range hold the excluded values. The practice profiles do not
 * change, so the same difference taken a day apart is ONE newly joined real person's
 * answer. Found by the phase 1a review; the spec's words: "no real counts below 20, or
 * how many people a single rule removes; counts rounded to the nearest 10".
 *
 * The route tests plant a scene with fewer than twenty real people and read every
 * endpoint that sends a count: /v1/pool (the total and every breakdown step),
 * /v1/preferences/strength, /v1/interview/next and /v1/world. On the old code each of
 * them sent the exact small number.
 *
 * Isolation: the scene is nonbinary people looking for nonbinary people, so the
 * founder's six real users (men looking for women) can never be in it, and the test
 * checks the exact server-side count is under twenty before it asserts anything --
 * otherwise a null would prove nothing.
 *
 * Negative controls, run by hand:
 *   - shownCount returning its input                    -> every test here fails
 *   - /v1/preferences/strength sending the raw total    -> "the strength toggle" fails
 *   - shownBreakdown taking cost from the exact counts  -> "works a step's cost out
 *                                                          from the rounded counts" fails
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/llm/index.js')>();
  return {
    ...real,
    decideModel: () => null,
    llm: {
      ...real.llm,
      complete: async () => { throw new Error('no model in this test'); },
      decide: async () => { throw new Error('no model in this test'); },
    },
  };
});

const { pool, tenantSession, matchSession, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { commit } = await import('../src/memory/facts.js');
const { rebuildMatchProfile } = await import('../src/matching/profile.js');
const { candidateCount, shownCount, shownBreakdown, SHOWN_FLOOR } = await import('../src/matching/candidates.js');
const { interviewRoutes } = await import('../src/api/interview.js');
const { datingRoutes } = await import('../src/api/dating.js');
const { worldRoutes } = await import('../src/api/world.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');
const { CORE } = await import('../src/onboarding/questions.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

type Person = { tenantId: string; userId: string; token: string };

async function person(label: string): Promise<Person> {
  const tag = `sc-${label}-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `${tag}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const headers = (p: Person) => ({
  Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.47',
});

const fact = (p: Person, predicate: string, objectText: string, objectValue?: unknown) =>
  tenantSession(p, (c) => commit(c, p, {
    predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
    stance: 'asserted', originClass: 'owner', sourceQuote: objectText, sourceEpisodeIds: [],
    extractorModel: 't', extractorVersion: '0', promptVersion: '0',
  }));

/** A nonbinary person looking for nonbinary people, basics and all five cards done. */
async function member(label: string, smoking: string[] = [], whoFine: object = { anyone: true }) {
  const p = await person(label);
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, in_pool, sees_synthetic) VALUES ($1,$2,false,false)`,
    [p.userId, p.tenantId]);
  const { REQUIRED } = await import('../src/api/consent.js');
  for (const r of REQUIRED) {
    await owner.query(
      `INSERT INTO consents (tenant_id, user_id, document, version) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [p.tenantId, p.userId, r.document, r.version]);
  }
  await fact(p, 'gender', 'nonbinary');
  await fact(p, 'seeking_gender', 'nonbinary');
  await fact(p, 'relationship_intent', 'long term');
  await fact(p, 'birth_date', '1995', { year: 1995, month: null });
  await fact(p, 'lives_in', 'Bangalore', { city: 'bangalore', lat: 12.97, lon: 77.59, precision_km: 20 });
  for (const id of CORE) {
    const a = id === 'card-smoking' ? { values: smoking, whoFine } : { values: [], whoFine: { anyone: true } };
    const res = await interviewRoutes.request('/v1/interview/answer', {
      method: 'POST', headers: headers(p), body: JSON.stringify({ questionId: id, ...a }),
    });
    expect(res.status, `${id}: ${await res.clone().text()}`).toBe(200);
  }
  const r = await tenantSession(p, (c) => rebuildMatchProfile(c, p));
  expect(r.inPool, `${label} did not reach the pool: ${r.missing.join(', ')}`).toBe(true);
  return p;
}

describe('shownCount', () => {
  it('rounds to ten, and says nothing under twenty', () => {
    expect(SHOWN_FLOOR).toBe(20);
    for (const n of [0, 1, 3, 19]) expect(shownCount(n), String(n)).toBeNull();
    expect(shownCount(20)).toBe(20);
    expect(shownCount(23)).toBe(20);
    expect(shownCount(25)).toBe(30);
    expect(shownCount(4817)).toBe(4820);
    expect(shownCount(Number.NaN)).toBeNull();
  });

  it('works a step\'s cost out from the rounded counts, never the exact ones', () => {
    const steps = shownBreakdown([
      { step: 'everyone', remaining: 343, cost: 0 },
      { step: 'who you want to meet', remaining: 121, cost: 222 },
      { step: 'your dealbreakers', remaining: 117, cost: 4 },
      { step: 'people still active', remaining: 3, cost: 114 },
    ]);
    expect(steps.map((s) => s.remaining)).toEqual([340, 120, 120, null]);
    // 4 people removed by one rule is exactly what may not go out: it is 0 here.
    expect(steps.map((s) => s.cost)).toEqual([0, 220, 0, 120]);
  });
});

describe('every endpoint that sends a count, with fewer than twenty people in range', () => {
  it('sends no exact number anywhere', async () => {
    // A viewer who cannot be with daily smokers, and five people, two of whom smoke daily.
    const me = await member('viewer', ['never'], { only: ['never', 'rarely', 'sometimes', 'often'] });
    for (let i = 0; i < 3; i++) await member(`non${i}`, ['never']);
    for (let i = 0; i < 2; i++) await member(`daily${i}`, ['daily']);

    const exact = await matchSession((c) => candidateCount(c, me.userId));
    expect(exact, 'the scene was not small, so a null here would prove nothing').toBeGreaterThan(0);
    expect(exact).toBeLessThan(SHOWN_FLOOR);

    // /v1/pool: the total, and every step of the breakdown.
    const pool = await (await datingRoutes.request('/v1/pool', { headers: headers(me) })).json() as {
      inPool: boolean; total: number | null; steps: { remaining: number | null; cost: number | null }[];
    };
    expect(pool.inPool).toBe(true);
    expect(pool.total, 'the pool total went out exact').toBeNull();
    for (const s of pool.steps) {
      if (s.remaining !== null) expect(s.remaining % 10).toBe(0);
      if (s.cost !== null) expect(s.cost % 10).toBe(0);
    }

    // The strength toggle -- the differencing attack. Both answers are "under 20".
    const { rows } = await owner.query<{ id: string }>(
      `SELECT id FROM preferences WHERE user_id = $1 AND predicate = 'smoking' AND retired_at IS NULL`, [me.userId]);
    expect(rows.length, 'the viewer has no smoking rule to flip').toBe(1);
    const flip = async (strength: string) => (await (await datingRoutes.request('/v1/preferences/strength', {
      method: 'POST', headers: headers(me), body: JSON.stringify({ id: rows[0]!.id, strength }),
    })).json()) as { ok: boolean; total: number | null };
    const loose = await flip('strong');
    const tight = await flip('dealbreaker');
    expect(loose.ok && tight.ok).toBe(true);
    expect(loose.total, 'the strength toggle sent an exact count').toBeNull();
    expect(tight.total, 'the strength toggle sent an exact count').toBeNull();

    // The interview's "people in range".
    const next = await (await interviewRoutes.request('/v1/interview/next', { headers: headers(me) })).json() as {
      poolSize: number | null;
    };
    expect(next.poolSize, 'the interview sent an exact count').toBeNull();

    // The Home's "people nearby".
    const world = await (await worldRoutes.request('/v1/world', { headers: headers(me) })).json() as {
      pool: { total: number | null };
    };
    expect(world.pool.total, 'the Home sent an exact count').toBeNull();
  });
});
