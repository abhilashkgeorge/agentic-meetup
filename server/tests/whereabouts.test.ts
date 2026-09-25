/**
 * Where somebody is, coarsely enough to be safe to send.
 *
 * TWO THINGS AT ONCE, and they pull against each other.
 *
 * The world has to stop being Bengaluru -- 53% of the crowd lives elsewhere and every
 * one of them was standing in the MG Road tile, because `areaOf` falls back to the
 * central tile for any point it does not recognise. Placing people relative to the
 * VIEWER fixes that everywhere at once and needs no map of anywhere.
 *
 * But `api/world.ts` has a deliberate rule -- a stranger's entry may carry an id from
 * a fixed public list, NEVER a coordinate -- and a true bearing with a true distance
 * from a known viewer IS a coordinate, and a sharper one than a neighbourhood id,
 * because two viewers triangulate it exactly. So the numbers are rounded before they
 * leave, and these tests are mostly about HOW MUCH is thrown away, not how much is kept.
 *
 * Negative control, run by hand and recorded in the commit: return the raw degrees and
 * kilometres instead of the rounded pair -> "blurs a position enough to be worth
 * sending" fails, at metres instead of kilometres.
 */
import { describe, expect, it } from 'vitest';
import {
  BANDS, BEARINGS, bandMidKm, bearingDeg, distanceKm, whereaboutsOf, whereaboutsWords,
} from '@clone/shared';

const MG_ROAD = { lat: 12.9716, lon: 77.5946 };
const WHITEFIELD = { lat: 12.9698, lon: 77.7500 };
const MUMBAI = { lat: 19.0760, lon: 72.8777 };
const REYKJAVIK = { lat: 64.1466, lon: -21.9426 };

describe('distance and bearing', () => {
  it('measures a real city hop', () => {
    // MG Road to Whitefield is about 17 km. Anything near zero means the formula is
    // in degrees, and anything near 1,700 means it is in the wrong unit.
    expect(distanceKm(MG_ROAD.lat, MG_ROAD.lon, WHITEFIELD.lat, WHITEFIELD.lon)).toBeCloseTo(16.9, 0);
    expect(distanceKm(MG_ROAD.lat, MG_ROAD.lon, MUMBAI.lat, MUMBAI.lon)).toBeCloseTo(845, -1);
  });

  it('points the right way', () => {
    // Whitefield is due east of MG Road; Mumbai is north-west.
    expect(bearingDeg(MG_ROAD.lat, MG_ROAD.lon, WHITEFIELD.lat, WHITEFIELD.lon)).toBeCloseTo(90, -1);
    const toMumbai = bearingDeg(MG_ROAD.lat, MG_ROAD.lon, MUMBAI.lat, MUMBAI.lon);
    expect(toMumbai).toBeGreaterThan(300);
    expect(toMumbai).toBeLessThan(345);
  });
});

describe('what actually leaves the server', () => {
  it('blurs a position enough to be worth sending', () => {
    // The point of the whole module. Two people 400 m apart must be indistinguishable
    // once quantised, or this is a coordinate with extra steps.
    const a = whereaboutsOf(MG_ROAD, { lat: 12.9716 + 0.0018, lon: 77.5946 });
    const b = whereaboutsOf(MG_ROAD, { lat: 12.9716 + 0.0022, lon: 77.5946 });
    expect(a).toEqual(b);
  });

  it('is coarser the further out it goes', () => {
    // Being wrong about 1 km vs 2 km matters; about 400 km vs 600 km it does not.
    const near = BANDS[1]! - BANDS[0]!;
    const far = BANDS[BANDS.length - 1]! - BANDS[BANDS.length - 2]!;
    expect(far).toBeGreaterThan(near * 100);
  });

  it('never sends a bearing sharper than a sixteenth of the compass', () => {
    for (let i = 0; i < 360; i += 3) {
      const lat = MG_ROAD.lat + 0.05 * Math.cos((i * Math.PI) / 180);
      const lon = MG_ROAD.lon + 0.05 * Math.sin((i * Math.PI) / 180);
      const w = whereaboutsOf(MG_ROAD, { lat, lon })!;
      expect(Number.isInteger(w.bearing)).toBe(true);
      expect(w.bearing).toBeGreaterThanOrEqual(0);
      expect(w.bearing).toBeLessThan(BEARINGS);
    }
  });

  it('puts a whole other country in the outermost band rather than off the end', () => {
    const w = whereaboutsOf(MG_ROAD, REYKJAVIK)!;
    expect(w.band).toBe(BANDS.length);
    expect(whereaboutsWords(w)).toBe('a long way away');
  });

  it('places the entire crowd that shares one point without dividing by zero', () => {
    // Every synthetic in a city sits on that city's centre. Same point, no bearing.
    const w = whereaboutsOf(MG_ROAD, MG_ROAD)!;
    expect(Number.isFinite(w.bearing)).toBe(true);
    expect(w.band).toBe(0);
  });

  it('says nothing at all when either end has no position', () => {
    // Not a guess, and not the centre of Bengaluru, which is the bug being fixed.
    expect(whereaboutsOf(MG_ROAD, { lat: null, lon: null })).toBeNull();
    expect(whereaboutsOf({ lat: null, lon: null }, MG_ROAD)).toBeNull();
  });

  it('works from anywhere, which is the whole point', () => {
    // Somebody in Reykjavik gets a usable world, not the middle of Bengaluru.
    const w = whereaboutsOf(REYKJAVIK, { lat: 64.15, lon: -21.90 })!;
    expect(w.band).toBeLessThan(4);
    expect(whereaboutsWords(w)).toMatch(/km|minutes/);
  });

  it('gives the renderer a distance to draw at for every band', () => {
    for (let b = 0; b <= BANDS.length; b++) {
      const km = bandMidKm(b);
      expect(Number.isFinite(km)).toBe(true);
      expect(km).toBeGreaterThan(0);
    }
  });
});
