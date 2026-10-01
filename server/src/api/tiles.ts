/**
 * Map tiles for the distance map ("How far would you travel?"), fetched by the server and
 * passed on. The founder, 2026-10-01: "show an actual map with radius and a slider".
 *
 * WHY THROUGH US, NOT STRAIGHT FROM THE PHONE. A tile request names the square kilometre
 * being looked at, and the app promises that nobody learns where somebody is
 * (app/src/lib/location.ts). Through here the map provider sees this server, once per
 * tile, and never a person. The tiles are kept, so a second person looking at Bengaluru
 * costs the provider nothing -- which is also what OpenStreetMap's tile policy asks of an
 * app: an identifying User-Agent, attribution on the map (the app draws it), and caching
 * rather than re-fetching. For real traffic, point TILE_URL at a paid or self-hosted tile
 * server; nothing else changes.
 *
 * Signed-in callers only, so this is not an open proxy for anybody who finds the address.
 * No model, no database: a tile is not anybody's data.
 */
import { Hono } from 'hono';
import { resolveCtx, Unauthorized } from '../auth.js';
import { env } from '../env.js';
import { log } from '../log.js';

/** {z}/{x}/{y} are filled in. OpenStreetMap's standard tiles unless the host says otherwise. */
const TILE_URL = env.TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** Identifies the app to the tile server, as its policy asks. No personal contact in it. */
export const TILE_USER_AGENT = 'CloneDatingApp/1.0 (beta; distance map)';
/** The closest the map ever zooms: street level, well past any distance choice. */
export const MAX_TILE_ZOOM = 18;
/** Tiles kept in memory, oldest out first: about 60 MB at 20 KB a tile. */
const KEPT = 3000;

const cache = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array | null>>();

/** For tests: forget every kept tile. */
export function forgetTiles(): void {
  cache.clear();
  pending.clear();
}

async function fetchTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const key = `${z}/${x}/${y}`;
  const kept = cache.get(key);
  if (kept) {
    // Used again: to the back of the line.
    cache.delete(key);
    cache.set(key, kept);
    return kept;
  }
  const already = pending.get(key);
  if (already) return already;
  const work = (async () => {
    try {
      const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      const res = await fetch(url, { headers: { 'User-Agent': TILE_USER_AGENT } });
      if (!res.ok) {
        log.warn({ status: res.status, z }, 'map tile refused upstream');
        return null;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (cache.size >= KEPT) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, bytes);
      return bytes;
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'map tile fetch failed');
      return null;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, work);
  return work;
}

/** A whole number in [0, below), or null. */
const index = (raw: string, below: number): number | null => {
  if (!/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return n < below ? n : null;
};

export const tileRoutes = new Hono()
  .get('/v1/tiles/:z/:x/:y', async (c) => {
    try {
      await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }
    const z = index(c.req.param('z'), MAX_TILE_ZOOM + 1);
    if (z === null) return c.json({ error: 'bad tile' }, 400);
    const x = index(c.req.param('x'), 2 ** z);
    const y = index(c.req.param('y').replace(/\.png$/, ''), 2 ** z);
    if (x === null || y === null) return c.json({ error: 'bad tile' }, 400);

    const bytes = await fetchTile(z, x, y);
    if (!bytes) return c.json({ error: 'map unavailable' }, 502);
    return c.body(new Uint8Array(bytes), 200, {
      'content-type': 'image/png',
      // A tile is the same for everybody and changes rarely: the phone may keep it a week.
      'cache-control': 'private, max-age=604800',
      'content-length': String(bytes.byteLength),
      'x-content-type-options': 'nosniff',
    });
  });
