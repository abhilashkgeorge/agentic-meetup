/**
 * Turning a typed city name into coordinates.
 *
 * The distance filter needs a point. Somebody typing "Bangalore" gives us a word, and
 * every path from one to the other has a cost: a geocoding API is a key, a bill and a
 * network round trip on a setup screen; the OS geocoder needs a native module and, on
 * some Android builds, a permission prompt in the middle of onboarding.
 *
 * So a bundled table, offline and free. It will not know every town, and that is
 * handled rather than hidden: an unknown city still commits as a fact, simply without
 * coordinates, and the distance clause is skipped for that person instead of excluding
 * them. Missing is never a mismatch.
 *
 * Coordinates are the city centre and are stored as such. This is a "within N km"
 * filter, not a map — a person's actual address is never asked for and never held.
 */
export interface Place {
  city: string;
  lat: number;
  lon: number;
  country: string;
}

/** Normalised the same way on both sides, so "New Delhi" and "new delhi" agree. */
export const placeKey = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, ' ');

const P = (city: string, lat: number, lon: number, country: string): Place =>
  ({ city, lat, lon, country });

/**
 * Deliberately India-heavy, because that is where the first users are, plus the
 * English-speaking cities people most often move between. Extending it is adding a
 * line; nothing else in the system needs to change.
 */
export const PLACES: readonly Place[] = [
  // India
  P('Bangalore', 12.9716, 77.5946, 'IN'), P('Bengaluru', 12.9716, 77.5946, 'IN'),
  P('Mumbai', 19.076, 72.8777, 'IN'), P('Delhi', 28.6139, 77.209, 'IN'),
  P('New Delhi', 28.6139, 77.209, 'IN'), P('Gurgaon', 28.4595, 77.0266, 'IN'),
  P('Noida', 28.5355, 77.391, 'IN'), P('Hyderabad', 17.385, 78.4867, 'IN'),
  P('Chennai', 13.0827, 80.2707, 'IN'), P('Pune', 18.5204, 73.8567, 'IN'),
  P('Kolkata', 22.5726, 88.3639, 'IN'), P('Ahmedabad', 23.0225, 72.5714, 'IN'),
  P('Jaipur', 26.9124, 75.7873, 'IN'), P('Kochi', 9.9312, 76.2673, 'IN'),
  P('Kozhikode', 11.2588, 75.7804, 'IN'), P('Thiruvananthapuram', 8.5241, 76.9366, 'IN'),
  P('Mangalore', 12.9141, 74.856, 'IN'), P('Mysore', 12.2958, 76.6394, 'IN'),
  P('Goa', 15.2993, 74.124, 'IN'), P('Chandigarh', 30.7333, 76.7794, 'IN'),
  P('Indore', 22.7196, 75.8577, 'IN'), P('Coimbatore', 11.0168, 76.9558, 'IN'),
  // English-speaking, and the cities people move to and from
  P('London', 51.5074, -0.1278, 'GB'), P('Manchester', 53.4808, -2.2426, 'GB'),
  P('Edinburgh', 55.9533, -3.1883, 'GB'), P('Dublin', 53.3498, -6.2603, 'IE'),
  P('New York', 40.7128, -74.006, 'US'), P('San Francisco', 37.7749, -122.4194, 'US'),
  P('Seattle', 47.6062, -122.3321, 'US'), P('Austin', 30.2672, -97.7431, 'US'),
  P('Boston', 42.3601, -71.0589, 'US'), P('Chicago', 41.8781, -87.6298, 'US'),
  P('Los Angeles', 34.0522, -118.2437, 'US'), P('Toronto', 43.6532, -79.3832, 'CA'),
  P('Vancouver', 49.2827, -123.1207, 'CA'), P('Sydney', -33.8688, 151.2093, 'AU'),
  P('Melbourne', -37.8136, 144.9631, 'AU'), P('Auckland', -36.8485, 174.7633, 'NZ'),
  P('Singapore', 1.3521, 103.8198, 'SG'), P('Dubai', 25.2048, 55.2708, 'AE'),
  P('Berlin', 52.52, 13.405, 'DE'), P('Amsterdam', 52.3676, 4.9041, 'NL'),
  P('Lisbon', 38.7223, -9.1393, 'PT'), P('Barcelona', 41.3874, 2.1686, 'ES'),
  P('Paris', 48.8566, 2.3522, 'FR'), P('Tokyo', 35.6762, 139.6503, 'JP'),
];

const BY_KEY = new Map(PLACES.map((p) => [placeKey(p.city), p]));

/**
 * Best effort, and null is a normal answer.
 *
 * Matches the whole string first, then tries the part before a comma, so "Bangalore,
 * India" and "Bangalore, Karnataka" both land without needing every combination in
 * the table.
 */
export function findPlace(raw: string): Place | null {
  const key = placeKey(raw);
  if (!key) return null;
  const direct = BY_KEY.get(key);
  if (direct) return direct;

  const head = key.split(' ,')[0]?.trim() ?? key;
  const beforeComma = placeKey(raw.split(',')[0] ?? '');
  return BY_KEY.get(beforeComma) ?? BY_KEY.get(head) ?? null;
}
