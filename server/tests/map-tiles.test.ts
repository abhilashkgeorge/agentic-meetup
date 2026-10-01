/**
 * The distance map's two server halves (api/tiles.ts, api/place.ts; the founder,
 * 2026-10-01: "show an actual map with radius and a slider").
 *
 * WHAT IS PINNED, with the tile server stood in by a fake fetch (nothing leaves the machine):
 *   - a tile is fetched once, kept, and served as a PNG to a signed-in caller -- with an
 *     identifying User-Agent, as OpenStreetMap's policy asks;
 *   - nobody signed out gets one (not an open proxy), and a tile outside the world is a 400;
 *   - an upstream refusal is a 502, not a broken image;
 *   - /v1/me/place gives the person's own pool point, neighbourhood and distance.
 *
 * Negative controls, run by hand and recorded in the commit: the cache lookup removed ->
 * "fetched once" fails; the sign-in check removed -> "signed out" fails.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { removeTenants } from './support/cleanup.js';

const upstream = vi.hoisted(() => ({ calls: [] as { url: string; ua: string | null }[], status: 200 }));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const { pool, closeMatchPool } = await import('../src/db/client.js');
const { env } = await import('../src/env.js');
const { tileRoutes, forgetTiles, TILE_USER_AGENT } = await import('../src/api/tiles.js');
const { placeRoutes } = await import('../src/api/place.js');
const { mintToken, newSessionId } = await import('../src/tokens.js');

const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL });
const made: string[] = [];
let token = '';
let userId = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const tag = `mt-${Date.now()}-${Math.random()}`;
  const t = await owner.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [tag]);
  made.push(t.rows[0]!.id);
  const u = await owner.query<{ id: string }>('INSERT INTO app_users (tenant_id, email) VALUES ($1,$2) RETURNING id',
    [t.rows[0]!.id, `${tag}@example.test`]);
  userId = u.rows[0]!.id;
  const sessionId = newSessionId();
  await owner.query(`INSERT INTO device_sessions (id, tenant_id, user_id, label, expires_at)
    VALUES ($1,$2,$3,'t', now() + interval '30 days')`, [sessionId, t.rows[0]!.id, userId]);
  token = mintToken(sessionId);
  await owner.query(
    `INSERT INTO match_profile (user_id, tenant_id, in_pool, lat, lon, max_distance_km, traits)
     VALUES ($1,$2,false,12.978,77.641,25,'{"lives_in":"Bengaluru","area":"indiranagar"}'::jsonb)`,
    [userId, t.rows[0]!.id]);
  vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
    upstream.calls.push({ url: String(url), ua: init?.headers?.['User-Agent'] ?? null });
    return new Response(upstream.status === 200 ? PNG : 'no', { status: upstream.status });
  });
});
beforeEach(() => { upstream.calls.length = 0; upstream.status = 200; forgetTiles(); });
afterAll(async () => {
  vi.stubGlobal('fetch', realFetch);
  await removeTenants(owner, made);
  await owner.end();
  await closeMatchPool();
  await pool.end();
});

const get = (path: string, auth = true) =>
  tileRoutes.request(path, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });

describe('map tiles, through the server', () => {
  it('fetches a tile once, keeps it, and serves it as a PNG with an identifying User-Agent', async () => {
    const a = await get('/v1/tiles/12/2932/1898.png');
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(PNG);
    const b = await get('/v1/tiles/12/2932/1898');
    expect(b.status).toBe(200);
    expect(upstream.calls, 'fetched once').toHaveLength(1);
    expect(upstream.calls[0]!.url).toContain('/12/2932/1898');
    expect(upstream.calls[0]!.ua).toBe(TILE_USER_AGENT);
  });

  it('gives nothing to somebody signed out, and refuses a tile outside the world', async () => {
    expect((await get('/v1/tiles/12/2932/1898', false)).status, 'signed out').toBe(401);
    expect((await get('/v1/tiles/12/4096/0')).status).toBe(400);
    expect((await get('/v1/tiles/19/0/0')).status).toBe(400);
    expect((await get('/v1/tiles/3/-1/0')).status).toBe(400);
    expect(upstream.calls).toHaveLength(0);
  });

  it('says 502 when the tile server refuses, and keeps nothing', async () => {
    upstream.status = 503;
    expect((await get('/v1/tiles/5/22/14')).status).toBe(502);
    upstream.status = 200;
    expect((await get('/v1/tiles/5/22/14')).status).toBe(200);
    expect(upstream.calls).toHaveLength(2);
  });
});

describe('where the person is matched from', () => {
  it('is their own pool point, neighbourhood and distance', async () => {
    const r = await placeRoutes.request('/v1/me/place', { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ city: 'Bengaluru', area: 'indiranagar', lat: 12.978, lon: 77.641, km: 25 });
    expect((await placeRoutes.request('/v1/me/place')).status).toBe(401);
  });
});
