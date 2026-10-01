/**
 * The distance map's arithmetic, kept apart from the screen so it can be tested without a
 * phone: where a map tile goes, how far to zoom so a radius fits, the slider's scale, and
 * which named place a point is in.
 *
 * WHY NAMED PLACES AND NOT A PIN. The pool keeps a person at a city centre or a Bengaluru
 * neighbourhood's centre -- never closer (lib/location.ts, matching/profile.ts) -- so a
 * custom location is one of those places too: dragging the map lands on the nearest one,
 * and the search lists them. The name and the point always agree, and nothing finer than a
 * neighbourhood is ever stored.
 */
import { AREAS, PLACES, nearestArea, haversineKm } from '@clone/shared';

/** A map tile is 256 px; drawn at 128 dp at a whole zoom, so it stays sharp on a phone screen. */
export const TILE_DP = 128;
export const MIN_KM = 1;
export const MAX_KM = 200;
/** What the slider opens on when nothing was said before. */
export const DEFAULT_KM = 25;
/** How far a dragged point may be from a listed city and still count as in it. */
export const CITY_SNAP_KM = 60;

/** A place the circle can stand on. */
export interface Spot {
  kind: 'area' | 'city';
  /** "Indiranagar", "Mumbai". */
  name: string;
  /** The city it is in: "Bengaluru" for a neighbourhood. */
  city: string;
  lat: number;
  lon: number;
  /** The neighbourhood's id (shared/areas.ts), for an area. */
  area: string | null;
  /**
   * A city the table does not list, found by the phone: sent as the place it is, as
   * "Use my location" on "Where are you now?" does (api/dating.ts resolveLivesIn).
   */
  fix?: { city: string; lat: number; lon: number; precisionKm: number };
}

// ── the map ───────────────────────────────────────────────────────────────────

/** Web Mercator: a point's position at zoom `z`, in tiles. */
export function toTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

/** The inverse of toTile. */
export function fromTile(x: number, y: number, z: number): { lat: number; lon: number } {
  const n = 2 ** z;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    lon: (x / n) * 360 - 180,
  };
}

/** Metres one dp covers at a fractional zoom, at a latitude. */
export const metresPerDp = (zf: number, lat: number): number =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180) * 256) / (TILE_DP * 2 ** zf);

/** The fractional zoom at which `km` is `radiusDp` long: the circle always the same size on screen. */
export function zoomFor(km: number, radiusDp: number, lat: number): number {
  const z = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180) * 256) / (TILE_DP * ((km * 1000) / radiusDp)));
  return Math.min(17, Math.max(2, z));
}

export interface PlacedTile { key: string; z: number; x: number; y: number; left: number; top: number; size: number }

/**
 * The tiles covering a `width` x `height` view centred on a point. Tiles come from the whole
 * zoom below `zf` and are drawn bigger to make up the fraction, so a slider moving between
 * two whole zooms needs no new tiles at all.
 */
export function tilesFor(lat: number, lon: number, zf: number, width: number, height: number): PlacedTile[] {
  const z = Math.floor(zf);
  const size = TILE_DP * 2 ** (zf - z);
  const n = 2 ** z;
  const c = toTile(lat, lon, z);
  const cx = c.x * size;
  const cy = c.y * size;
  const out: PlacedTile[] = [];
  for (let ty = Math.floor((cy - height / 2) / size); ty <= Math.floor((cy + height / 2) / size); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor((cx - width / 2) / size); tx <= Math.floor((cx + width / 2) / size); tx++) {
      const x = ((tx % n) + n) % n;
      out.push({ key: `${z}/${tx}/${ty}`, z, x, y: ty, left: tx * size - cx + width / 2, top: ty * size - cy + height / 2, size });
    }
  }
  return out;
}

/** The point `dx`, `dy` dp away from a centre, at a zoom: where the map is after a drag. */
export function shifted(lat: number, lon: number, zf: number, dx: number, dy: number): { lat: number; lon: number } {
  const z = Math.floor(zf);
  const size = TILE_DP * 2 ** (zf - z);
  const c = toTile(lat, lon, z);
  return fromTile(c.x + dx / size, c.y + dy / size, z);
}

// ── the slider ────────────────────────────────────────────────────────────────

/** Round to a step a person would say: 7 km, 15 km, 60 km, 175 km. */
export function niceKm(km: number): number {
  const k = Math.min(MAX_KM, Math.max(MIN_KM, km));
  if (k < 10) return Math.round(k);
  if (k < 50) return Math.round(k / 5) * 5;
  if (k < 100) return Math.round(k / 10) * 10;
  return Math.round(k / 25) * 25;
}

/** The slider's 0..1 to km, on a log scale: 1 km to 10 km takes as much thumb as 20 to 200. */
export const kmAt = (t: number): number => niceKm(MIN_KM * (MAX_KM / MIN_KM) ** Math.min(1, Math.max(0, t)));

/** km to the slider's 0..1. */
export const positionOf = (km: number): number =>
  Math.log(Math.min(MAX_KM, Math.max(MIN_KM, km)) / MIN_KM) / Math.log(MAX_KM / MIN_KM);

// ── places ────────────────────────────────────────────────────────────────────

/** Where the table lists one city twice ("Bangalore", "Bengaluru"), the name shown. */
const PREFERRED = new Set(['Bengaluru', 'Delhi']);

const areaSpot = (a: (typeof AREAS)[number]): Spot =>
  ({ kind: 'area', name: a.name, city: 'Bengaluru', lat: a.lat, lon: a.lon, area: a.id });

/** Every listed city, once, by its point. */
export const CITY_SPOTS: readonly Spot[] = (() => {
  const byPoint = new Map<string, Spot>();
  for (const p of PLACES) {
    const key = `${p.lat},${p.lon}`;
    const had = byPoint.get(key);
    if (!had || PREFERRED.has(p.city)) byPoint.set(key, { kind: 'city', name: p.city, city: p.city, lat: p.lat, lon: p.lon, area: null });
  }
  return [...byPoint.values()];
})();

/** Bengaluru's neighbourhoods, then the cities: what the search box searches. */
export const ALL_SPOTS: readonly Spot[] = [...AREAS.map(areaSpot), ...CITY_SPOTS];

/** Up to `max` places whose name (or a neighbourhood's other name) contains what was typed. */
export function searchSpots(typed: string, max = 6): Spot[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  const hit = (s: Spot) => s.name.toLowerCase().includes(q)
    || (s.kind === 'area' && (AREAS.find((a) => a.id === s.area)?.aliases ?? []).some((x) => x.toLowerCase().includes(q)));
  return ALL_SPOTS.filter(hit).slice(0, max);
}

/** The named place a point is in: a Bengaluru neighbourhood within 8 km, else a listed city within CITY_SNAP_KM. */
export function nearestSpot(lat: number, lon: number): Spot | null {
  const a = nearestArea(lat, lon, 8);
  if (a) return areaSpot(a);
  let best: Spot | null = null;
  let bestKm = Infinity;
  for (const s of CITY_SPOTS) {
    const km = haversineKm(lat, lon, s.lat, s.lon);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  return bestKm <= CITY_SNAP_KM ? best : null;
}

/** The place the pool has a person at (GET /v1/me/place), as a Spot; null without a point. */
export function spotOf(p: { city: string | null; area: string | null; lat: number | null; lon: number | null }): Spot | null {
  const a = p.area ? AREAS.find((x) => x.id === p.area) : undefined;
  // The pool uses the neighbourhood only while it is in the city (matching/profile.ts).
  if (a && p.lat !== null && p.lon !== null && haversineKm(p.lat, p.lon, a.lat, a.lon) <= 30) return areaSpot(a);
  if (p.lat === null || p.lon === null) return null;
  const listed = CITY_SPOTS.find((s) => Math.abs(s.lat - p.lat!) < 1e-6 && Math.abs(s.lon - p.lon!) < 1e-6);
  return listed ?? { kind: 'city', name: p.city ?? 'Your city', city: p.city ?? 'Your city', lat: p.lat, lon: p.lon, area: null };
}

/**
 * What to save when the circle moved to `to` from `from`: "move you there" (the founder,
 * 2026-10-01) -- you are matched from the new place, both ways. A neighbourhood is the city
 * plus the area; a city is the city alone (an area left from Bengaluru stops counting by
 * itself once it is over 30 km away: matching/profile.ts). Nothing when nothing moved.
 */
export function placeWrites(from: Spot | null, to: Spot): { predicate: 'lives_in' | 'area'; value: string; fix?: Spot['fix'] }[] {
  if (from && from.kind === to.kind && from.name === to.name && from.city === to.city) return [];
  if (to.kind === 'area') {
    return [...(from?.city === 'Bengaluru' ? [] : [{ predicate: 'lives_in' as const, value: 'Bengaluru' }]),
      { predicate: 'area' as const, value: to.area! }];
  }
  return [{ predicate: 'lives_in', value: to.name, ...(to.fix ? { fix: to.fix } : {}) }];
}
