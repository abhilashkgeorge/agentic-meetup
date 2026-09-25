/**
 * Where somebody is, relative to you, coarsely enough to be safe to send.
 *
 * THE PROBLEM THIS SOLVES. The world has to stop being Bengaluru: 53% of the crowd
 * lives somewhere else and every one of them was standing in the MG Road tile, because
 * `areaOf` falls back to the central tile for any point it does not recognise. The fix
 * is to place people relative to the VIEWER -- so far away, in roughly that direction
 * -- which works in Reykjavik as well as in Koramangala and needs no map of either.
 *
 * THE TRAP IN THAT FIX. `api/world.ts` has one deliberate rule: what a stranger's
 * entry may contain is an id from a fixed public list, NEVER a coordinate. A true
 * bearing and a true distance from a viewer whose own position is known is a
 * coordinate -- a better one than a neighbourhood id, because two viewers triangulate
 * it exactly. So neither number leaves the server as itself.
 *
 * WHAT GOES INSTEAD. A bearing rounded to one of sixteen compass points, and a
 * distance rounded to one of a handful of bands that grow as they go out. "About four
 * kilometres, north-north-east" places somebody in a world. It does not find them:
 * at 4 km a sixteenth of the compass is a wedge about 1.6 km wide, and the band it
 * sits in is a kilometre deep.
 *
 * The renderer turns the pair back into a spot, and jitters within it from the
 * person's own ref -- which adds spread on screen and not one bit of information,
 * because the ref is public and the jitter is the same for every viewer.
 */

/** Sixteen compass points: 22.5 degrees each. */
export const BEARINGS = 16;

/**
 * The far edge of each band, in kilometres.
 *
 * They grow because precision should: being wrong about whether somebody is 1 km or
 * 2 km away matters, and being wrong about 400 km or 600 km does not. The last band
 * is open -- "somewhere else entirely" -- which is where anybody on another continent
 * lands, and is the honest answer for them.
 */
export const BANDS = [0.5, 1, 2, 4, 8, 16, 32, 64, 150, 400, 1200] as const;

export interface Whereabouts {
  /** 0..15, clockwise from north. */
  bearing: number;
  /** Index into BANDS; BANDS.length means "further than the last band". */
  band: number;
}

const R_KM = 6371;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance, in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from the first point to the second, in degrees clockwise from north. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2))
    - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Where that point is from this one, coarse enough to send.
 *
 * Null when either end has no position at all: somebody who has never said where they
 * are is not placed by guesswork, they are placed by the renderer wherever it puts
 * people it knows nothing about.
 */
export function whereaboutsOf(
  from: { lat: number | null; lon: number | null },
  to: { lat: number | null; lon: number | null },
): Whereabouts | null {
  if (from.lat === null || from.lon === null || to.lat === null || to.lon === null) return null;
  const km = distanceKm(from.lat, from.lon, to.lat, to.lon);
  let band = BANDS.findIndex((edge) => km <= edge);
  if (band < 0) band = BANDS.length;
  // Standing on the same point -- which every synthetic in a city does -- has no
  // bearing to speak of, so it gets the one the renderer will spread anyway.
  const deg = km < 1e-6 ? 0 : bearingDeg(from.lat, from.lon, to.lat, to.lon);
  return { bearing: Math.round(deg / (360 / BEARINGS)) % BEARINGS, band };
}

/** The middle of a band, in kilometres: what the renderer draws at. */
export function bandMidKm(band: number): number {
  const inner = band === 0 ? 0 : (BANDS[band - 1] ?? 0);
  const outer = BANDS[band] ?? (BANDS[BANDS.length - 1]! * 2);
  return (inner + outer) / 2;
}

/** Plain words for a whereabouts, for a sheet or a screen reader. */
export function whereaboutsWords(w: Whereabouts | null): string {
  if (!w) return 'somewhere';
  const points = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east',
    'east-south-east', 'south-east', 'south-south-east', 'south', 'south-south-west',
    'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
  const km = bandMidKm(w.bearing >= 0 ? w.band : w.band);
  if (w.band >= BANDS.length) return 'a long way away';
  if (km < 1) return `a few minutes ${points[w.bearing]}`;
  return `about ${km < 10 ? km.toFixed(0) : Math.round(km / 5) * 5} km ${points[w.bearing]}`;
}
