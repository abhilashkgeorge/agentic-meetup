/**
 * "Which part of town?" -- the one question the map adds, and what it changes.
 *
 * Before it, everybody in Bangalore stood on one point (the city centre), so two
 * people in Koramangala and Whitefield were 0 km apart and the 10 km setting meant
 * nothing. A named neighbourhood moves the person's point to that neighbourhood's
 * centre; the reveal may print it as a trait; nothing may filter on it; the roster
 * places the agent in it.
 *
 * Fixtures go in through the real endpoint with a real token; the profile is read
 * back through the owner connection. No model is called (essentials never do).
 *
 * Negative controls, run by hand and recorded in the commit: comment out the
 * lat/lon override in rebuildMatchProfile -> both people sit at 12.9716, 77.5946 and
 * the distance test fails; drop 'area' from ROUTED_ELSEWHERE -> canFilterOn passes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { AREAS, canFilterOn, haversineKm } from '@clone/shared';
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
    'INSERT INTO tenants (name) VALUES ($1) RETURNING id', [`ap-${Date.now()}-${Math.random()}`]);
  const tenantId = t.rows[0]!.id;
  made.push(tenantId);
  const u = await owner.query<{ id: string }>(
    'INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [tenantId, `ap-${Date.now()}-${Math.random()}@example.test`]);
  const userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(
    `INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
     VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, tenantId, userId]);
  return { tenantId, userId, token: mintToken(sessionId) };
}

const essential = (token: string, predicate: string, value: unknown) =>
  datingRoutes.request('/v1/essentials', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.4' },
    body: JSON.stringify({ predicate, value }),
  });

const profile = async (userId: string) => (await owner.query<{
  lat: number | null; lon: number | null; traits: Record<string, unknown>; attribute_tags: string[];
}>('SELECT lat, lon, traits, attribute_tags FROM match_profile WHERE user_id = $1', [userId])).rows[0]!;

const centre = (id: string) => AREAS.find((a) => a.id === id)!;

describe('the neighbourhood', () => {
  it('moves the person\'s point from the city centre to the neighbourhood centre, as a trait and never a tag', async () => {
    const k = await bareUser(); const w = await bareUser();
    for (const p of [k, w]) expect((await essential(p.token, 'lives_in', 'Bangalore')).status).toBe(200);
    // Both in Bangalore, both on the city centre: 0 km apart.
    const before = [await profile(k.userId), await profile(w.userId)];
    expect(haversineKm(before[0]!.lat!, before[0]!.lon!, before[1]!.lat!, before[1]!.lon!)).toBeLessThan(0.01);

    expect((await essential(k.token, 'area', 'Koramangala')).status).toBe(200);   // by name
    expect((await essential(w.token, 'area', 'whitefield')).status).toBe(200);    // by id
    const after = [await profile(k.userId), await profile(w.userId)];
    expect([after[0]!.lat, after[0]!.lon]).toEqual([centre('koramangala').lat, centre('koramangala').lon]);
    expect([after[1]!.lat, after[1]!.lon]).toEqual([centre('whitefield').lat, centre('whitefield').lon]);
    expect(haversineKm(after[0]!.lat!, after[0]!.lon!, after[1]!.lat!, after[1]!.lon!)).toBeGreaterThan(10);
    expect(after[0]!.traits.area).toBe('koramangala');
    expect(after[1]!.traits.area).toBe('whitefield');
    for (const p of after) expect(p.attribute_tags.some((t) => t.startsWith('area:'))).toBe(false);
  });

  it('keeps the city\'s point when the neighbourhood is from another city', async () => {
    const m = await bareUser();
    expect((await essential(m.token, 'area', 'hebbal')).status).toBe(200);
    expect((await essential(m.token, 'lives_in', 'Mumbai')).status).toBe(200);
    const p = await profile(m.userId);
    expect(p.traits.area).toBe('hebbal');
    expect(Math.abs(p.lat! - 19.076)).toBeLessThan(0.1);   // still Mumbai
  });

  it('refuses a part of town the map does not know, with a sentence', async () => {
    const u = await bareUser();
    const res = await essential(u.token, 'area', 'Narnia');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown_area' });
  });

  it('is never something a dealbreaker can filter on', () => {
    expect(canFilterOn('area')).toBe(false);
    expect(canFilterOn('smoking')).toBe(true);
  });
});
