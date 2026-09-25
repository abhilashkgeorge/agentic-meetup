/**
 * The age range a person wants, through the door that was shut.
 *
 * WHAT WAS WRONG. The candidate query tests age both ways -- your age inside my range,
 * my age inside yours -- and `rebuildMatchProfile` already reads `age_range_sought`
 * into age_min/age_max. But nothing a real person could reach wrote that fact: the
 * essentials endpoint pushed every value through String(), so a {min,max} committed as
 * the text "[object Object]" with no value, and age_min/age_max stayed NULL. NULL
 * passes everybody, so for every real user the age filter ran one way only.
 *
 * Fixtures through the owner pool; the endpoint and the candidate check run through
 * the real routes and roles. No model anywhere on this path.
 *
 * Negative control, run by hand: with the age_range_sought branch removed from POST
 * /v1/essentials, "stores the range and the matcher reads it" and "filters both ways"
 * both fail.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ageFromYear } from '@clone/shared';
import { Pool } from 'pg';
import { pool, tenantSession, matchSession, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { commit } from '../src/memory/facts.js';
import { rebuildMatchProfile } from '../src/matching/profile.js';
import { isCandidate } from '../src/matching/candidates.js';
import { datingRoutes } from '../src/api/dating.js';
import { mintToken, newSessionId } from '../src/tokens.js';
import { CORE } from '../src/onboarding/questions.js';
import { log } from '../src/log.js';

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
  const tag = `ar-${label}-${Date.now()}-${Math.random()}`;
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

const fact = (p: Person, predicate: string, objectText: string, objectValue?: unknown) =>
  tenantSession(p, (c) =>
    commit(c, p, {
      predicate, objectText, ...(objectValue !== undefined ? { objectValue } : {}),
      stance: 'asserted', originClass: 'owner', sourceQuote: objectText, sourceEpisodeIds: [],
      extractorModel: 't', extractorVersion: '0', promptVersion: '0',
    }),
  );

/** In the pool, with no range of their own, among real people only. */
async function ready(p: Person, o: { gender: string; seeking: string; birthYear: number }) {
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, in_pool, sees_synthetic) VALUES ($1,$2,false,false)
     ON CONFLICT (user_id) DO UPDATE SET sees_synthetic = false`, [p.userId, p.tenantId]);
  const { REQUIRED } = await import('../src/api/consent.js');
  for (const r of REQUIRED) {
    await owner.query(
      `INSERT INTO consents (tenant_id, user_id, document, version) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [p.tenantId, p.userId, r.document, r.version]);
  }
  // The five cards, done and "anyone": no rule on any of them, so age is the only
  // thing that can keep these two apart.
  for (const id of CORE) {
    await owner.query(
      `INSERT INTO question_answers (tenant_id, user_id, question_id, answer, skipped)
       VALUES ($1,$2,$3,'{"values":[],"whoFine":{"anyone":true}}'::jsonb, true)`,
      [p.tenantId, p.userId, id]);
  }
  await fact(p, 'gender', o.gender);
  await fact(p, 'seeking_gender', o.seeking);
  await fact(p, 'relationship_intent', 'long term');
  await fact(p, 'birth_date', `${o.birthYear}`, { year: o.birthYear, month: null });
  await fact(p, 'lives_in', 'Bangalore', { city: 'bangalore', lat: 12.97, lon: 77.59, precision_km: 20 });
  const r = await tenantSession(p, (c) => rebuildMatchProfile(c, p));
  expect(r.inPool, JSON.stringify(r.missing)).toBe(true);
}

const essential = (p: Person, predicate: string, value: unknown) =>
  datingRoutes.request('/v1/essentials', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.41',
    },
    body: JSON.stringify({ predicate, value }),
  });

const range = async (p: Person) =>
  (await owner.query<{ age_min: number | null; age_max: number | null }>(
    'SELECT age_min, age_max FROM match_profile WHERE user_id = $1', [p.userId])).rows[0];

describe('POST /v1/essentials with age_range_sought', () => {
  it('stores the range and the matcher reads it', async () => {
    const me = await person('store');
    await ready(me, { gender: 'woman', seeking: 'man', birthYear: 1996 });

    const res = await essential(me, 'age_range_sought', { min: 26, max: 34 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await range(me)).toEqual({ age_min: 26, age_max: 34 });

    const { rows } = await owner.query<{ object_text: string; object_value: unknown }>(
      `SELECT object_text, object_value FROM facts
        WHERE user_id = $1 AND predicate = 'age_range_sought' AND status = 'active'`, [me.userId]);
    expect(rows).toEqual([{ object_text: '26-34', object_value: { min: 26, max: 34 } }]);

    // Changing it supersedes, as every single-valued answer does.
    expect((await essential(me, 'age_range_sought', { min: 28, max: 40 })).status).toBe(200);
    expect(await range(me)).toEqual({ age_min: 28, age_max: 40 });
  });

  it('refuses a range that is not two whole ages from 18 to 120, youngest first', async () => {
    const me = await person('bad');
    for (const value of [
      { min: 17, max: 30 }, { min: 40, max: 30 }, { min: 26, max: 121 },
      { min: 26 }, { min: '26', max: '34' }, { min: 26.5, max: 34 },
      { min: 26, max: 34, extra: 1 }, 26, [26, 34], '26-34',
    ]) {
      const res = await essential(me, 'age_range_sought', value);
      expect(res.status, JSON.stringify(value)).toBe(400);
    }
    const { rows } = await owner.query(
      `SELECT 1 FROM facts WHERE user_id = $1 AND predicate = 'age_range_sought'`, [me.userId]);
    expect(rows, 'a refused range was stored anyway').toHaveLength(0);
  });

  it('filters both ways once it is set', async () => {
    const me = await person('thirty');
    await ready(me, { gender: 'woman', seeking: 'man', birthYear: 1996 });
    const older = await person('older');
    await ready(older, { gender: 'man', seeking: 'woman', birthYear: 1981 });

    const meets = (a: Person, b: Person) => matchSession((c) => isCandidate(c, a.userId, b.userId));
    // Nobody has a range: nothing keeps them apart, in either direction.
    expect(await meets(me, older)).toBe(true);
    expect(await meets(older, me)).toBe(true);

    expect((await essential(me, 'age_range_sought', { min: 26, max: 34 })).status).toBe(200);
    expect(await meets(me, older), 'my range did not reach my own candidates').toBe(false);
    expect(await meets(older, me), 'my range did not protect me from their side').toBe(false);
  });

  it('logs whether the pre-fill was kept, as a yes or no and never the ages', async () => {
    // The spec asks how often the own-age-±5 default is accepted unchanged. The app
    // posts only {min,max}, so the server works it out from the birth year. Two people:
    // a 30-something who keeps it and then changes it, and a 20-year-old whose default
    // is clamped at the floor (18, not 15) -- so the clamp is the app's, not a guess.
    const spy = vi.spyOn(log, 'info');
    try {
      const thirty = await person('kept');
      await ready(thirty, { gender: 'woman', seeking: 'man', birthYear: 1996 });
      const age = ageFromYear(1996);
      expect((await essential(thirty, 'age_range_sought', { min: age - 5, max: age + 5 })).status).toBe(200);
      expect((await essential(thirty, 'age_range_sought', { min: age - 3, max: age + 5 })).status).toBe(200);

      const year20 = new Date().getUTCFullYear() - 20;
      const twenty = await person('floor');
      await ready(twenty, { gender: 'woman', seeking: 'man', birthYear: year20 });
      const a20 = ageFromYear(year20);
      expect((await essential(twenty, 'age_range_sought', { min: 18, max: a20 + 5 })).status).toBe(200);

      const lines = (p: Person) => spy.mock.calls
        .filter(([o, msg]) => msg === 'essential set' && (o as { userId?: string }).userId === p.userId)
        .map(([o]) => o as Record<string, unknown>);
      expect(lines(thirty).map((l) => l.ageRangeKept)).toEqual([true, false]);
      expect(lines(twenty).map((l) => l.ageRangeKept)).toEqual([true]);
      // Never the ages: exactly these fields on the line.
      for (const l of [...lines(thirty), ...lines(twenty)]) {
        expect(Object.keys(l).sort()).toEqual(['ageRangeKept', 'declined', 'predicate', 'userId']);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('records a decline as a decline, with no range', async () => {
    const me = await person('decline');
    expect((await essential(me, 'age_range_sought', null)).status).toBe(200);
    const { rows } = await owner.query<{ state: string }>(
      `SELECT state FROM predicate_status WHERE user_id = $1 AND predicate = 'age_range_sought'`, [me.userId]);
    expect(rows[0]?.state).toBe('declined');
    expect(await range(me)).toEqual({ age_min: null, age_max: null });
  });
});
