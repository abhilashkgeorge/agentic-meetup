/**
 * /v1/pool reports what is missing TWICE, on purpose, in two shapes.
 *
 * `missing` is the friendly sentences the cards print ("It does not know your
 * gender."). `need` is the raw predicate keys ("gender"), added so the setup wizard
 * can ask ONLY what is still missing instead of re-running all six questions every
 * time -- the "asked twice" and "Finish setup restarts everything" bugs found by
 * driving the app on a phone.
 *
 * Negative control: drop `need` from the /v1/pool response and the first test fails
 * with `need` undefined.
 *
 * No model is called: a person who is not yet in the pool gets an early return.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { pool, closeMatchPool } from '../src/db/client.js';
import { env } from '../src/env.js';
import { datingRoutes } from '../src/api/dating.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

async function bareUser(): Promise<{ tenantId: string; userId: string; token: string }> {
  const t = await owner.query<{ id: string }>(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`pn-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `pn-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const getPool = (token: string) =>
  datingRoutes.request('/v1/pool', {
    headers: { Authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.9' },
  });

describe('/v1/pool need', () => {
  it('lists the missing essentials as RAW KEYS a wizard can filter on', async () => {
    const { token } = await bareUser();
    const res = await getPool(token);
    expect(res.status).toBe(200);
    const body = await res.json() as { inPool: boolean; missing: string[]; need: string[] };

    expect(body.inPool).toBe(false);
    // Raw keys: the fields nobody has answered yet.
    // The missing required fields, plus distance while it is still worth offering.
    expect(body.need).toEqual(expect.arrayContaining(
      ['gender', 'seeking_gender', 'birth_date', 'lives_in', 'max_distance_km']));
    for (const key of body.need) expect(key).toMatch(/^[a-z_]+$/);      // keys, never sentences
    // ...but distance is never on the friendly "still needs" list -- it is optional.
    expect(body.missing.join(' ').toLowerCase()).not.toContain('far');

    // The friendly shape is different: whole sentences with spaces, for the cards.
    expect(body.missing.length).toBeGreaterThan(0);
    expect(body.missing.some((m) => m.includes(' '))).toBe(true);
    expect(body.missing).not.toContain('gender');                       // not a raw key
  });

  it('stops asking distance once it is answered or declined, but keeps required fields', async () => {
    // A fresh user is offered distance...
    const t = await bareUser();
    // Decline it the way the app does: a predicate_status row, no fact.
    await owner.query(
      `INSERT INTO predicate_status (tenant_id, user_id, predicate, state, reason, updated_at)
       VALUES ($1,$2,'max_distance_km','declined','never_mentioned', now())`,
      [t.tenantId, t.userId]);
    const body = await (await getPool(t.token)).json() as { need: string[] };
    // ...but a "prefer not to say" must not be undone -- distance is gone from need,
    // while the still-unanswered required fields remain.
    expect(body.need).not.toContain('max_distance_km');
    expect(body.need).toEqual(expect.arrayContaining(['gender', 'birth_date', 'lives_in']));
  });
});
