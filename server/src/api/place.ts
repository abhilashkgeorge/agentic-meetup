/**
 * Where the person is matched from, for the distance map: the point the pool uses -- a city
 * centre, or a Bengaluru neighbourhood's centre (matching/profile.ts) -- the city and the
 * neighbourhood it came from, and how far they said they would go.
 *
 * The map draws its circle around this point, so it must be the pool's own, not a second
 * opinion worked out on the phone. Their own row only, under their own session; the point
 * is already as coarse as anything the app keeps (a city or a neighbourhood, never the
 * phone's fix).
 */
import { Hono } from 'hono';
import { resolveCtx, Unauthorized } from '../auth.js';
import { tenantSession } from '../db/client.js';

export interface MyPlace {
  city: string | null;
  /** A Bengaluru neighbourhood id (shared/areas.ts), or null. */
  area: string | null;
  lat: number | null;
  lon: number | null;
  /** How far they would go, in km; ANYWHERE_KM for "Anywhere"; null when never said. */
  km: number | null;
}

export const placeRoutes = new Hono()
  .get('/v1/me/place', async (c) => {
    let ctx;
    try {
      ctx = await resolveCtx(c.req.header('authorization'));
    } catch (err) {
      if (err instanceof Unauthorized) return c.json({ error: 'unauthorized' }, 401);
      throw err;
    }
    const row = await tenantSession(ctx, async (db) => (await db.query<{
      city: string | null; area: string | null; lat: number | null; lon: number | null; km: string | number | null;
    }>(
      `SELECT traits->>'lives_in' AS city, traits->>'area' AS area, lat, lon, max_distance_km AS km
         FROM match_profile WHERE user_id = $1`, [ctx.userId])).rows[0]);
    const place: MyPlace = {
      city: row?.city ?? null,
      area: row?.area ?? null,
      lat: row?.lat ?? null,
      lon: row?.lon ?? null,
      km: row?.km === null || row?.km === undefined ? null : Number(row.km),
    };
    return c.json(place);
  });
