/**
 * Points are paid once per thing, never for what was answered, never for a practice
 * pair, and are nobody's business but their owner's.
 *
 * Negative controls, run by hand and recorded in the commit: remove ON CONFLICT DO
 * NOTHING from `award` -> the second save throws instead of returning 0; drop the
 * synthetic guard on /met -> the practice pair pays 10.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { STARTER, type Look } from '@clone/shared';
import { pool, closeMatchPool, tenantSession } from '../src/db/client.js';
import { env } from '../src/env.js';
import { lookRoutes } from '../src/api/look.js';
import { datingRoutes } from '../src/api/dating.js';
import { award, balance } from '../src/points/ledger.js';
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
async function person(label: string, over: Record<string, unknown> = {}): Promise<P> {
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`pt-${label}-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id; made.push(tenantId);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id', [tenantId, `pt-${label}-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const cols: Record<string, unknown> = {
    user_id: userId, tenant_id: tenantId, age: 30, gender: 'woman', seeking_gender: ['man'],
    lat: 12.97, lon: 77.59, max_distance_km: 50, intent: ['long_term'],
    in_pool: true, is_synthetic: false, sees_synthetic: true, display_name: label, ...over,
  };
  const keys = Object.keys(cols);
  await owner.query(`INSERT INTO match_profile (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => cols[k]));
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

/** An introduced pair with a brief each, nobody yet asked whether they met. */
async function introduced(a: P, b: P): Promise<string> {
  const [lo, hi] = a.userId < b.userId ? [a, b] : [b, a];
  const r = await owner.query<{ id: string }>(
    `INSERT INTO rendezvous (user_a, user_b, tenant_a, tenant_b, runs_planned, status, first_mover, introduced_at)
     VALUES ($1,$2,$3,$4,5,'introduced',$1, now()) RETURNING id`,
    [lo.userId, hi.userId, lo.tenantId, hi.tenantId]);
  for (const who of [a, b]) {
    await owner.query(
      `INSERT INTO rendezvous_briefs (rendezvous_id, for_user, headline, concern, human_says_yes, decided_at)
       VALUES ($1,$2,'h','c',true, now())`, [r.rows[0]!.id, who.userId]);
  }
  return r.rows[0]!.id;
}

const H = (me: P) => ({ Authorization: `Bearer ${me.token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.12' });
const look = (me: P, method: 'GET' | 'PUT', body?: unknown) =>
  lookRoutes.request('/v1/look', { method, headers: H(me), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const buyItem = (me: P, item: string) =>
  lookRoutes.request('/v1/look/buy', { method: 'POST', headers: H(me), body: JSON.stringify({ item }) });
const met = (me: P, id: string, yes: boolean) =>
  datingRoutes.request(`/v1/matches/${id}/met`, { method: 'POST', headers: H(me), body: JSON.stringify({ yes }) });

describe('points', () => {
  it('pay once for the first character, and never again for saving it', async () => {
    const me = await person('me');
    const first = await (await look(me, 'PUT', { look: STARTER })).json() as { awarded: number; balance: number };
    expect(first).toMatchObject({ awarded: 20, balance: 20 });
    const again = await (await look(me, 'PUT', { look: { ...STARTER, skin: 1 } })).json() as { awarded: number; balance: number };
    expect(again).toMatchObject({ awarded: 0, balance: 20 });
    // The primitive itself: the same (reason, ref) twice is one row.
    await tenantSession(me, async (db) => {
      expect(await award(db, me, 'look', 'self')).toBe(0);
      expect(await balance(db, me.userId)).toBe(20);
    });
  });

  it('refuse a purchase when short, charge once when not, and then let the item be worn', async () => {
    const me = await person('me');
    await look(me, 'PUT', { look: STARTER });                                          // +20
    const short = await buyItem(me, 'face:3');                                          // costs 30
    expect(short.status).toBe(409);
    expect(await short.json()).toEqual({ error: 'not_enough', balance: 20 });
    expect((await owner.query('SELECT 1 FROM look_items WHERE user_id = $1', [me.userId])).rowCount).toBe(0);

    // Fund them the way the product will: a check-in's worth, straight into the ledger.
    await owner.query(
      `INSERT INTO points_ledger (tenant_id, user_id, reason, ref, amount) VALUES ($1, $2, 'checkin', $3, 50)`,
      [me.tenantId, me.userId, '00000000-0000-0000-0000-000000000001']);
    // Two taps at once: one purchase.
    const [a, b] = await Promise.all([buyItem(me, 'face:3'), buyItem(me, 'face:3')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM points_ledger WHERE user_id = $1 AND reason = 'buy'`, [me.userId]);
    expect(rows[0]!.n).toBe('1');
    const state = await (await look(me, 'GET')).json() as { owned: string[]; balance: number };
    expect(state.owned).toEqual(['face:3']);
    expect(state.balance).toBe(40);
    // Wearing it saves now.
    expect((await look(me, 'PUT', { look: { ...STARTER, face: 3 } as Look })).status).toBe(200);
    // Starter and unknown items are not for sale.
    expect((await buyItem(me, 'skin:0')).status).toBe(404);
    expect((await buyItem(me, 'hat:9')).status).toBe(404);
  });

  it('pay the same for "yes we met" and "not yet", and nothing for a practice pair', async () => {
    const me = await person('me', { gender: 'man', seeking_gender: ['woman'] });
    const them = await person('them');
    const ghost = await person('ghost', { is_synthetic: true });
    const real = await introduced(me, them);
    const fake = await introduced(me, ghost);

    expect(await (await met(me, real, false)).json()).toEqual({ ok: true, awarded: 10 });
    expect((await met(me, real, true)).status).toBe(404);                             // first answer stands
    expect(await (await met(them, real, true)).json()).toEqual({ ok: true, awarded: 10 });
    expect(await (await met(me, fake, true)).json()).toEqual({ ok: true, awarded: 0 });
    await tenantSession(me, async (db) => expect(await balance(db, me.userId)).toBe(10));
  });

  it("are nobody else's to read, and not the app's to edit", async () => {
    const me = await person('me');
    const other = await person('other');
    await look(me, 'PUT', { look: STARTER });
    const seen = await tenantSession(other, (db) => db.query('SELECT * FROM points_ledger WHERE user_id = $1', [me.userId]));
    expect(seen.rows).toEqual([]);
    const mine = await (await lookRoutes.request('/v1/points', { headers: H(me) })).json() as { balance: number; ledger: { reason: string; amount: number }[] };
    expect(mine.balance).toBe(20);
    expect(mine.ledger).toEqual([{ reason: 'look', amount: 20, at: expect.any(String) }]);
    await expect(tenantSession(me, (db) => db.query('UPDATE points_ledger SET amount = 999 WHERE user_id = $1', [me.userId])))
      .rejects.toThrow(/permission denied/);
    await expect(tenantSession(me, (db) => db.query('DELETE FROM points_ledger WHERE user_id = $1', [me.userId])))
      .rejects.toThrow(/permission denied/);
  });
});
