/**
 * A broken city map never reaches a phone.
 *
 * WHY THIS EXISTS. Building one map, by hand, with somebody watching, broke three
 * times. Building a map per city, unattended, for wherever a user turns up, it will
 * break more. So the promise is not that the build works -- it is that a bad build is
 * caught before it is served, and the phone falls back to a generated town.
 *
 * Every fixture below is one of the REAL failures from this project, or its shape:
 *
 *   1. The wrong OSM relation id: a 2.3-hectare courtyard where a 61-hectare park
 *      should have been. Nothing about the file looked wrong. Only the area did.
 *   2. Douglas-Peucker flattening a closed ring to two points, because first == last
 *      is a zero-length chord and the algorithm has nothing to measure from.
 *   3. Overpass answering one query and timing out on another, so the outline arrives
 *      and the streets do not -- which renders as a blank plate and looks deliberate.
 *
 * Negative control, run by hand and recorded in the commit: make `checkMap` return []
 * always -> every test here fails except the one that accepts a good map.
 */
import { describe, expect, it } from 'vitest';
import { checkMap, mapIsServable, type CityAsset } from '@clone/shared';

/** A ring of `n` points on a circle of `r` units, which at k=200 is r * 0.555 km. */
const ring = (r: number, n = 64): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [r * Math.cos(t), r * Math.sin(t)] as [number, number];
  });

/** A city the size of Bengaluru: ~35 km across, plenty of outline, some streets. */
const good = (): CityAsset => ({
  meta: { origin: [12.9716, 77.5946], k: 200, built: '2026-09-23', osm: 'relation/7902476' },
  outline: ring(31),
  roads: { trunk: [[[0, 0], [5, 5]], [[-4, 2], [3, -6]]], primary: [[[1, 1], [2, 8]]] },
  areas: [{ id: 'centre', centre: [0, 0] }],
});

const codes = (a: CityAsset, bytes?: number) => checkMap(a, bytes).map((f) => f.code);

describe('the map gate', () => {
  it('lets a good city through', () => {
    expect(checkMap(good())).toEqual([]);
    expect(mapIsServable(good())).toBe(true);
  });

  it('catches the wrong OSM id: a courtyard wearing a city name', () => {
    // 2.3 hectares. The real bug, and the one no eye would catch in a JSON file.
    const a = good(); a.outline = ring(0.27);
    expect(codes(a)).toContain('outline-too-small');
    expect(mapIsServable(a)).toBe(false);
  });

  it('catches an id that grabbed the whole state instead', () => {
    const a = good(); a.outline = ring(300);
    expect(codes(a)).toContain('outline-too-big');
  });

  it('catches the simplifier eating a closed ring', () => {
    // Douglas-Peucker on a ring whose first point is its last: zero-length chord.
    const a = good(); a.outline = [[0, 0], [10, 10]];
    expect(codes(a)).toContain('outline-too-coarse');
  });

  it('catches half a build: the outline came back and the streets did not', () => {
    const a = good(); a.roads = {};
    expect(codes(a)).toContain('no-roads');
    const b = good(); delete b.roads;
    expect(codes(b)).toContain('no-roads');
  });

  it('catches a NaN before it becomes an invisible city', () => {
    // A NaN in a vertex makes the whole merged geometry vanish, silently.
    const a = good(); a.outline = [...ring(31)]; a.outline[7] = [Number.NaN, 3];
    expect(codes(a)).toContain('outline-not-finite');
    const b = good(); b.roads = { trunk: [[[0, 0], [Number.POSITIVE_INFINITY, 1]]] };
    expect(codes(b)).toContain('road-not-a-line');
  });

  it('catches null island, which is what an unset variable looks like', () => {
    const a = good(); a.meta = { ...a.meta, origin: [0, 0] };
    expect(codes(a)).toContain('origin-null-island');
    const b = good(); b.meta = { ...b.meta, origin: [91, 0] };
    expect(codes(b)).toContain('origin-off-earth');
  });

  it('catches a missing scale, without which nothing can be measured', () => {
    const a = good(); a.meta = { ...a.meta, k: undefined };
    expect(codes(a)).toContain('no-scale');
    // ...and does not then pretend to judge the area it cannot compute.
    expect(codes(a)).not.toContain('outline-too-small');
  });

  it('catches a neighbourhood that fell outside its own city', () => {
    const a = good(); a.areas = [{ id: 'nowhere', centre: [900, 900] }];
    expect(codes(a)).toContain('area-outside');
  });

  it('treats no neighbourhoods as detail we lack, not as a fault', () => {
    // Most cities will ship without them. That is a plainer map, not a broken one.
    const a = good(); delete a.areas;
    expect(checkMap(a)).toEqual([]);
  });

  it('refuses a download that is not free on a phone', () => {
    expect(codes(good(), 500_000)).toContain('too-big');
    expect(codes(good(), 163_000)).toEqual([]);
  });

  it('refuses nothing at all rather than throwing on it', () => {
    // The server runs this on whatever came back from a cache or a build; it must
    // answer "not servable" for rubbish rather than take the request down with it.
    expect(mapIsServable(null)).toBe(false);
    expect(mapIsServable(undefined)).toBe(false);
    expect(checkMap({} as CityAsset).length).toBeGreaterThan(0);
  });
});
