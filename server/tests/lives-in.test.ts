/**
 * Turning "where do you live" into a point on the map.
 *
 * WHY THIS FILE EXISTS. The app can now fill this field in from the phone, which adds
 * a second source for the same answer -- and two sources for one value is exactly the
 * shape that goes quietly wrong. The specific failure it is here to stop: the field
 * stays editable after the phone fills it in, so somebody auto-fills one city, types
 * another over it and commits. Nothing in the request is malformed, nothing throws,
 * and they are filed under the typed city at the auto-filled city's coordinates. The
 * words on their profile and the point they match from disagree, for ever.
 *
 * The other half is the reason the feature exists at all: shared/places.ts lists 46
 * cities, so before this everybody outside those 46 lost distance matching silently.
 */
import { describe, expect, it } from 'vitest';
import { resolveLivesIn } from '../src/api/dating.js';

const NAGPUR = { city: 'Nagpur', lat: 21.15, lon: 79.09, precisionKm: 2 };

describe('resolveLivesIn', () => {
  it('uses the phone position when it names the city being stored', () => {
    expect(resolveLivesIn('Nagpur', NAGPUR)).toEqual({
      city: 'Nagpur', lat: 21.15, lon: 79.09, precision_km: 2,
    });
  });

  it('places a city we have never listed, which is the whole point', () => {
    // Without a supplied place this is null -- no distance matching, no explanation.
    expect(resolveLivesIn('Nagpur')).toBeNull();
    expect(resolveLivesIn('Nagpur', NAGPUR)).not.toBeNull();
  });

  it('IGNORES a position that no longer matches the typed city', () => {
    // Auto-filled Nagpur, typed Mysore over it. The text wins, and because Mysore is
    // not in the table the honest answer is "not matchable on distance" -- NOT Mysore
    // sitting at Nagpur's coordinates.
    const out = resolveLivesIn('Mysore', NAGPUR);
    expect(out?.lat).not.toBe(NAGPUR.lat);
    expect(out === null || out.city.toLowerCase() === 'mysore').toBe(true);
  });

  it('matches the city case- and space-insensitively', () => {
    expect(resolveLivesIn('  nagpur ', NAGPUR)?.city).toBe('Nagpur');
  });

  it('falls back to the table when the phone was not used', () => {
    const out = resolveLivesIn('Bangalore');
    expect(out).not.toBeNull();
    expect(out!.precision_km).toBe(20);
  });

  it('gives a typed city and an auto-filled one the SAME point', () => {
    // Otherwise two people in one city sit as far apart as their two phones were, and
    // every distance comparison between them is wrong. A listed city resolves to the
    // table's centre whichever way the answer arrived -- the phone's own coordinates
    // are deliberately discarded here, even though they are more accurate, because
    // agreeing matters more than being precise about a thing nobody is shown.
    const typed = resolveLivesIn('Bangalore');
    const auto = resolveLivesIn('Bangalore', {
      city: 'Bangalore', lat: 12.93, lon: 77.61, precisionKm: 2,
    });
    expect(auto).toEqual(typed);
  });
});
