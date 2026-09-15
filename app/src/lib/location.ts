/**
 * Filling in the city, once, with permission.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It never keeps a position. The screen it serves
 * promises "nobody sees your exact location", and that has to be true of what is
 * STORED, not just of what is displayed -- so the fix is turned into a city and the
 * coordinates that leave this function are a city centre, never the phone's.
 *
 * Two ways that happens, in order of preference:
 *
 *   the city is one we know   use the table's coordinates. A city centre by
 *                             construction, and matchable on distance like any
 *                             typed answer.
 *   the city is not           round the fix to two decimal places, about a
 *                             kilometre, and say so in `precisionKm`. Better than
 *                             refusing somebody in a city the table has never heard
 *                             of, which is most of them.
 *
 * LOADED LAZILY, like every other native module in this app: a static import is
 * evaluated at startup and takes the whole app down on a build that lacks the native
 * half. See components/error-boundary.tsx.
 */
import { findPlace } from '@clone/shared';

export type LocationResult =
  | { ok: true; city: string; lat: number; lon: number; precisionKm: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'failed' };

/** Coarsen a fix to roughly a kilometre. Two decimal places, no cleverness. */
const coarse = (n: number): number => Math.round(n * 100) / 100;

export async function cityFromDevice(): Promise<LocationResult> {
  let Location;
  try {
    Location = await import('expo-location');
  } catch {
    // The JavaScript is ahead of the native build. The typed field still works.
    return { ok: false, reason: 'unavailable' };
  }

  try {
    // THIS is the line that raises the system dialog. Asking for "when in use" and
    // nothing more: there is no case in this product for knowing where somebody is
    // while they are not using it.
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ok: false, reason: 'denied' };

    // Balanced rather than high: the answer is a city, and asking for metre accuracy
    // would spend battery and seconds to be thrown away two lines below.
    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const [place] = await Location.reverseGeocodeAsync({
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
    });

    const name = place?.city ?? place?.subregion ?? place?.region ?? null;
    if (!name) return { ok: false, reason: 'failed' };

    // A city we already know: use ITS centre, so this answer is indistinguishable
    // from one somebody typed, and lands on the same point on the map.
    const known = findPlace(name);
    if (known) {
      return { ok: true, city: known.city, lat: known.lat, lon: known.lon, precisionKm: 20 };
    }

    return {
      ok: true,
      city: name,
      lat: coarse(fix.coords.latitude),
      lon: coarse(fix.coords.longitude),
      precisionKm: 2,
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
