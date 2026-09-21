/**
 * The thirty parts of Bengaluru the map is cut into.
 *
 * Names people use, not wards. Each has a centre (the point a person who names it is
 * placed at for distance matching -- about two kilometres of vagueness, where the city
 * centre was twenty) and a weight (how much of the invented pool lives there, and the
 * fallback for building density when OpenStreetMap cannot be asked). The map's tiles
 * are the Voronoi cells of these centres clipped to the city outline
 * (server/scripts/build-map.ts), so adding an area here is adding a tile there.
 *
 * Ids are stable and public: the roster names a stranger's area by id and nothing else.
 *
 * Every centre must sit inside the BBMP outline (build-map.ts refuses otherwise): Electronic
 * City and Sarjapur Road are pulled ~3 km toward town for that reason, since the real
 * places straddle the city limit.
 */
import { placeKey } from './places.js';

export interface Area {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Share of the invented Bangalore pool, roughly proportional to population. Sums to ~1. */
  weight: number;
  /** Other spellings a person might type. */
  aliases?: readonly string[];
}

const A = (id: string, name: string, lat: number, lon: number, weight: number, aliases?: readonly string[]): Area =>
  ({ id, name, lat, lon, weight, ...(aliases ? { aliases } : {}) });

export const AREAS: readonly Area[] = [
  A('mg-road', 'MG Road', 12.976, 77.601, 0.03, ['Cubbon Park', 'Brigade Road', 'Shivajinagar', 'Central']),
  A('koramangala', 'Koramangala', 12.935, 77.625, 0.08),
  A('indiranagar', 'Indiranagar', 12.978, 77.641, 0.06, ['Indira Nagar']),
  A('jayanagar', 'Jayanagar', 12.925, 77.594, 0.05),
  A('whitefield', 'Whitefield', 12.970, 77.750, 0.06),
  A('hsr-layout', 'HSR Layout', 12.912, 77.639, 0.05, ['HSR']),
  A('malleshwaram', 'Malleshwaram', 13.003, 77.564, 0.03, ['Malleswaram']),
  A('basavanagudi', 'Basavanagudi', 12.942, 77.575, 0.03),
  A('rajajinagar', 'Rajajinagar', 12.991, 77.553, 0.03, ['Rajaji Nagar']),
  A('yelahanka', 'Yelahanka', 13.101, 77.596, 0.03),
  A('hebbal', 'Hebbal', 13.045, 77.590, 0.03),
  A('marathahalli', 'Marathahalli', 12.959, 77.697, 0.05, ['Marathalli']),
  A('electronic-city', 'Electronic City', 12.873, 77.654, 0.04, ['E-City', 'Bommasandra']),
  A('btm-layout', 'BTM Layout', 12.917, 77.610, 0.04, ['BTM']),
  A('jp-nagar', 'JP Nagar', 12.906, 77.586, 0.04, ['J.P. Nagar']),
  A('banashankari', 'Banashankari', 12.926, 77.547, 0.03, ['BSK']),
  A('sadashivanagar', 'Sadashivanagar', 13.007, 77.581, 0.01, ['Sadashiva Nagar']),
  A('frazer-town', 'Frazer Town', 12.999, 77.615, 0.02, ['Fraser Town', 'Cooke Town']),
  A('ulsoor', 'Ulsoor', 12.982, 77.621, 0.02, ['Halasuru']),
  A('vijayanagar', 'Vijayanagar', 12.972, 77.533, 0.03, ['Vijaya Nagar']),
  A('kengeri', 'Kengeri', 12.909, 77.483, 0.02),
  A('bellandur', 'Bellandur', 12.926, 77.676, 0.04),
  A('sarjapur-road', 'Sarjapur Road', 12.918, 77.699, 0.03, ['Sarjapur']),
  A('kr-puram', 'KR Puram', 13.010, 77.700, 0.03, ['K.R. Puram', 'Krishnarajapuram']),
  A('mahadevapura', 'Mahadevapura', 12.988, 77.690, 0.03),
  A('bommanahalli', 'Bommanahalli', 12.899, 77.621, 0.03),
  A('hennur', 'Hennur', 13.027, 77.642, 0.03),
  A('rt-nagar', 'RT Nagar', 13.020, 77.598, 0.02, ['R.T. Nagar']),
  A('peenya', 'Peenya', 13.030, 77.520, 0.02),
  A('jalahalli', 'Jalahalli', 13.048, 77.548, 0.02),
];

export const AREA_IDS = AREAS.map((a) => a.id) as [string, ...string[]];
/** Where somebody in Bangalore stands until they say which part of town. */
export const CENTRAL_AREA = 'mg-road';

const byKey = new Map<string, Area>();
for (const a of AREAS) {
  byKey.set(a.id, a);
  byKey.set(placeKey(a.name), a);
  for (const al of a.aliases ?? []) byKey.set(placeKey(al), a);
}

/** By id, name or alias, however it was typed. */
export function findArea(raw: string): Area | null {
  const s = raw.trim();
  if (!s) return null;
  return byKey.get(s.toLowerCase()) ?? byKey.get(placeKey(s)) ?? null;
}

/** The nearest centre within `maxKm`; null further away, so a Mumbai point never lands in Kengeri. */
export function nearestArea(lat: number, lon: number, maxKm = 8): Area | null {
  let best: Area | null = null; let bestKm = Infinity;
  for (const a of AREAS) {
    const r = (d: number) => (d * Math.PI) / 180;
    const x = Math.sin(r(a.lat - lat) / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(a.lat)) * Math.sin(r(a.lon - lon) / 2) ** 2;
    const km = 2 * 6371 * Math.asin(Math.sqrt(x));
    if (km < bestKm) { bestKm = km; best = a; }
  }
  return bestKm <= maxKm ? best : null;
}
