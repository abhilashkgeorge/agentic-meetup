/**
 * The distance map (features/distance; the founder, 2026-10-01: "show an actual map with
 * radius and a slider ... and anywhere option ... or add a custom location too. It should
 * first detect location and show the default range").
 *
 * WHAT IS PINNED, without a phone: the tile arithmetic (a point lands where it should, the
 * tiles cover the view, a drag moves the centre the right way), the circle is the distance
 * on the ground at the zoom chosen for it, the slider's scale, which named place a point is
 * in, and what moving the circle saves ("move you there": a neighbourhood, or a city).
 * And the screens use it: setup and the editor draw the map for the distance field.
 *
 * Negative controls, run by hand and recorded in the commit: zoomFor without the cos(lat)
 * term -> "the circle is the distance" fails; placeWrites never writing the city for a
 * neighbourhood -> "moving into Bengaluru" fails; fields.ts back on its five chips ->
 * "the screens use it" fails; the search box back under the map -> "a page of its own"
 * fails; the step's old order (place, then slider) and the setup animation back over the
 * map -> "how far right under the map" fails; the box focused on mount ->
 * "once the search page is shown" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CITY_SPOTS, DEFAULT_KM, MAX_KM, MIN_KM, TILE_DP, fromTile, kmAt, mapHeightFor, metresPerDp, nearestSpot, placeWrites,
  positionOf, searchSpots, shifted, spotOf, tilesFor, toTile, zoomFor,
} from '../src/features/distance/geo';

const INDIRANAGAR = { lat: 12.978, lon: 77.641 };

describe('the map', () => {
  it('puts a point back where it came from', () => {
    for (const z of [3, 10, 15]) {
      const t = toTile(INDIRANAGAR.lat, INDIRANAGAR.lon, z);
      const back = fromTile(t.x, t.y, z);
      expect(back.lat).toBeCloseTo(INDIRANAGAR.lat, 9);
      expect(back.lon).toBeCloseTo(INDIRANAGAR.lon, 9);
    }
  });

  it('draws the circle as the distance on the ground, at any latitude', () => {
    for (const lat of [0, 12.97, 51.5]) {
      for (const km of [1, 25, 200]) {
        const zf = zoomFor(km, 114, lat);
        expect(metresPerDp(zf, lat) * 114).toBeCloseTo(km * 1000, -1);
      }
    }
  });

  it('covers the whole view with tiles, centred on the point', () => {
    const W = 340, H = 280;
    const zf = zoomFor(25, 106, INDIRANAGAR.lat);
    const tiles = tilesFor(INDIRANAGAR.lat, INDIRANAGAR.lon, zf, W, H);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.size))).toBeGreaterThanOrEqual(W);
    expect(Math.max(...tiles.map((t) => t.top + t.size))).toBeGreaterThanOrEqual(H);
    // Between two whole zooms the tiles are drawn bigger, never smaller than TILE_DP.
    for (const t of tiles) expect(t.size).toBeGreaterThanOrEqual(TILE_DP);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
  });

  it('moves the centre the right way for a drag: the map left means looking east', () => {
    const zf = 12;
    const east = shifted(INDIRANAGAR.lat, INDIRANAGAR.lon, zf, 100, 0);
    expect(east.lon).toBeGreaterThan(INDIRANAGAR.lon);
    expect(east.lat).toBeCloseTo(INDIRANAGAR.lat, 6);
    const south = shifted(INDIRANAGAR.lat, INDIRANAGAR.lon, zf, 0, 100);
    expect(south.lat).toBeLessThan(INDIRANAGAR.lat);
  });
});

describe('the slider', () => {
  it('runs from 1 km to 200 km on a log scale, in words a person would say', () => {
    expect(kmAt(0)).toBe(MIN_KM);
    expect(kmAt(1)).toBe(MAX_KM);
    expect(kmAt(positionOf(DEFAULT_KM))).toBe(DEFAULT_KM);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const km = kmAt(t);
      expect(km).toBeGreaterThanOrEqual(last);
      last = km;
      if (km >= 10 && km < 50) expect(km % 5).toBe(0);
      if (km >= 100) expect(km % 25).toBe(0);
    }
  });
});

describe('places', () => {
  it('finds the neighbourhood in Bengaluru, the city elsewhere, and nothing at sea', () => {
    expect(nearestSpot(INDIRANAGAR.lat, INDIRANAGAR.lon)).toMatchObject({ kind: 'area', area: 'indiranagar', city: 'Bengaluru' });
    expect(nearestSpot(19.07, 72.88)).toMatchObject({ kind: 'city', name: 'Mumbai' });
    expect(nearestSpot(-40, -30)).toBeNull();
    expect(CITY_SPOTS.filter((s) => s.name === 'Bengaluru' || s.name === 'Bangalore').map((s) => s.name)).toEqual(['Bengaluru']);
  });

  it('reads where the pool has a person', () => {
    expect(spotOf({ city: 'Bengaluru', area: 'indiranagar', lat: 12.978, lon: 77.641 })).toMatchObject({ kind: 'area', name: 'Indiranagar' });
    expect(spotOf({ city: 'Bengaluru', area: null, lat: 12.9716, lon: 77.5946 })).toMatchObject({ kind: 'city', name: 'Bengaluru' });
    // A neighbourhood left from Bengaluru does not count in Mumbai, as in the pool.
    expect(spotOf({ city: 'Mumbai', area: 'indiranagar', lat: 19.076, lon: 72.8777 })).toMatchObject({ kind: 'city', name: 'Mumbai' });
    expect(spotOf({ city: null, area: null, lat: null, lon: null })).toBeNull();
  });

  it('searches neighbourhoods and cities by any of their names', () => {
    expect(searchSpots('kora').map((s) => s.name)).toContain('Koramangala');
    expect(searchSpots('mum').map((s) => s.name)).toContain('Mumbai');
    expect(searchSpots('Indira Nagar').map((s) => s.name)).toContain('Indiranagar');
    expect(searchSpots('  ')).toEqual([]);
  });

  it('moves you there: a neighbourhood is the city and the area, a city is the city, nothing when nothing moved', () => {
    const bengaluru = spotOf({ city: 'Bengaluru', area: null, lat: 12.9716, lon: 77.5946 })!;
    const indiranagar = nearestSpot(INDIRANAGAR.lat, INDIRANAGAR.lon)!;
    const mumbai = nearestSpot(19.07, 72.88)!;
    expect(placeWrites(indiranagar, indiranagar)).toEqual([]);
    expect(placeWrites(bengaluru, indiranagar)).toEqual([{ predicate: 'area', value: 'indiranagar' }]);
    expect(placeWrites(mumbai, indiranagar), 'moving into Bengaluru').toEqual([
      { predicate: 'lives_in', value: 'Bengaluru' }, { predicate: 'area', value: 'indiranagar' }]);
    expect(placeWrites(indiranagar, mumbai)).toEqual([{ predicate: 'lives_in', value: 'Mumbai' }]);
    const fix = { city: 'Tumakuru', lat: 13.34, lon: 77.1, precisionKm: 2 };
    expect(placeWrites(bengaluru, { kind: 'city', name: 'Tumakuru', city: 'Tumakuru', lat: 13.34, lon: 77.1, area: null, fix }))
      .toEqual([{ predicate: 'lives_in', value: 'Tumakuru', fix }]);
  });
});

describe('the screens use it', () => {
  const src = (...p: string[]) => readFileSync(join(import.meta.dirname, '..', 'src', ...p), 'utf8');
  it('draws the map for the distance field, in setup and in the editor, and saves through it', () => {
    const fields = src('features', 'profile', 'fields.ts');
    expect(fields).toMatch(/key: 'max_distance_km', title: 'How far would you travel\?', kind: 'distance'/);
    expect(fields).not.toContain("{ value: '20000', label: 'Anywhere' }");
    const setup = src('features', 'onboarding', 'essentials-screen.tsx');
    expect(setup).toContain("{q.kind === 'distance' && <DistanceStep detect onChange={setDistance} />}");
    expect(setup).toContain('await saveDistance(token, distance)');
    const editor = src('features', 'profile', 'edit-basic.tsx');
    expect(editor).toContain('<DistanceStep detect={false} onChange={setDistance} />');
    expect(src('features', 'profile', 'profile-screen.tsx')).toContain("router.push('/edit/max_distance_km')");
  });

  // The Seeker, 2026-10-01: searching under the map, the keyboard lifted Save over the
  // results and Indiranagar could not be seen. Where a list lands under a keyboard is not
  // something a test can watch without a phone, so this pins the shape that fixed it: the
  // search box, and so its results, exist only on a page of their own.
  it('searches on a page of its own, where the keyboard cannot cover the results', () => {
    const step = stripComments(src('features', 'distance', 'distance-step.tsx'));
    const open = step.indexOf('<Modal visible={searching}');
    const close = step.indexOf('</Modal>', open);
    expect(open).toBeGreaterThan(-1);
    const page = step.slice(open, close);
    expect(page).toContain('<Field');
    expect(page).toContain('onPress={() => pick(s)}');
    expect(step.split('<Field').length - 1, 'the only search box is the one on its page').toBe(1);
  });

  // The Pixel, 2026-10-01, three things a phone showed and a test cannot watch, pinned by
  // shape: the slider sat below Save (the place controls came first, and setup put a 130 dp
  // animation over the map), and the search box was focused before its page was shown, so
  // the keyboard never opened.
  it('puts how far right under the map, before where you are', () => {
    const step = stripComments(src('features', 'distance', 'distance-step.tsx'));
    const at = (s: string) => {
      const i = step.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const slider = at('<Slider');
    expect(at('<DistanceMap')).toBeLessThan(slider);
    expect(at('label="Anywhere"')).toBeLessThan(at('📍'));
    expect(slider).toBeLessThan(at('📍'));
    expect(slider).toBeLessThan(at("'Use my location'"));
    const setup = stripComments(src('features', 'onboarding', 'essentials-screen.tsx'));
    expect(setup).toContain("{q.kind !== 'distance' && <Animation");
  });

  it('opens the keyboard only once the search page is shown', () => {
    const step = stripComments(src('features', 'distance', 'distance-step.tsx'));
    expect(step).toContain('onShow={() => setShown(true)}');
    expect(step).toMatch(/<Field[^>]*autoFocus=\{shown\}/);
  });
});

describe('the map on a short screen', () => {
  it('is 280 tall where there is room and never under 200', () => {
    expect(mapHeightFor(1000)).toBe(280);
    expect(mapHeightFor(835)).toBe(251);
    expect(mapHeightFor(500)).toBe(200);
  });
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
