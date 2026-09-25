/**
 * A character is saved only as the catalog allows, and read only as the catalog says.
 *
 * WHAT IS BEING GUARDED. The shop's rule -- nothing unpaid is worn -- lives on the
 * server, not in the builder; a look is a fixed set of small integers and nothing
 * else; a
 * person with no row still has a whole, stable character; the match role may read
 * looks (the roster) but not what anybody bought.
 *
 * Negative controls, run by hand and recorded in the commit: drop the `lockedIn`
 * check in PUT -> the 402 test saves a paid hat for free; return the whole row from
 * GET -> the "one key per part" test fails.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { Look, LOOK_PARTS, STARTER, lockedIn } from '@clone/shared';
import { pool, closeMatchPool, matchSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { lookRoutes } from '../src/api/look.js';
import { mintToken, newSessionId } from '../src/tokens.js';

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];

afterAll(async () => {
  if (made.length) await owner.query('DELETE FROM tenants WHERE id = ANY($1)', [made]);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

interface P { tenantId: string; userId: string; token: string }
async function person(label: string): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`lk-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `lk-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const call = (me: P, method: 'GET' | 'PUT', body?: unknown) => lookRoutes.request('/v1/look', {
  method,
  headers: { Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

let me: P, other: P;
beforeAll(async () => { me = await person('me'); other = await person('other'); });

describe('a character', () => {
  it('exists before it is built: free, valid, and the same every time', async () => {
    const a = await (await call(me, 'GET')).json() as { saved: boolean; look: Look; owned: string[] };
    const b = await (await call(me, 'GET')).json() as { look: Look };
    expect(a.saved).toBe(false);
    expect(Look.parse(a.look)).toEqual(a.look);
    expect(lockedIn(a.look, new Set()), 'nothing unpaid before anything is earned').toEqual([]);
    expect(b.look).toEqual(a.look);
    // A different person, a different character (seeded per person, not per viewer).
    const o = await (await call(other, 'GET')).json() as { look: Look };
    expect(o.look).not.toEqual(a.look);
  });

  it('is saved as sent, and read back as one number per part and nothing else', async () => {
    const look: Look = { ...STARTER, skin: 6, head: 2, legs: 2, outfitColor: 5 };
    const res = await call(me, 'PUT', { look });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ look, first: true });
    const got = await (await call(me, 'GET')).json() as { saved: boolean; look: Record<string, unknown> };
    expect(got.saved).toBe(true);
    expect(got.look).toEqual(look);
    expect(Object.keys(got.look).sort()).toEqual([...LOOK_PARTS].sort());
    // Saving again is an update, not a first.
    expect(await (await call(me, 'PUT', { look })).json()).toMatchObject({ first: false });
  });

  it('refuses anything unpaid, and keeps what was saved', async () => {
    const before = await (await call(me, 'GET')).json() as { look: Look };
    const res = await call(me, 'PUT', { look: { ...STARTER, top: 8 } });   // the suit jacket: 120 points
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'locked', items: ['top:8'] });
    const after = await (await call(me, 'GET')).json() as { look: Look };
    expect(after.look).toEqual(before.look);
  });

  it('refuses what the catalog does not have', async () => {
    expect((await call(me, 'PUT', { look: { ...STARTER, top: 10 } })).status).toBe(400);
    expect((await call(me, 'PUT', { look: { ...STARTER, hat: 1 } })).status).toBe(400);
    expect((await call(me, 'PUT', { look: { ...STARTER, skin: 1.5 } })).status).toBe(400);
    expect((await call(me, 'PUT', { nope: true })).status).toBe(400);
  });

  it('is readable by the match role for the roster, while purchases are not', async () => {
    const seen = await matchSession((db) => db.query<{ look: Look }>('SELECT look FROM looks WHERE user_id = $1', [me.userId]));
    expect(seen.rows).toHaveLength(1);
    await expect(matchSession((db) => db.query('SELECT item FROM look_items WHERE user_id = $1', [me.userId])))
      .rejects.toThrow(/permission denied/);
  });
});
