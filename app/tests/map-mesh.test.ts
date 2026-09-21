/**
 * The map's render budget, counted from the geometry rather than measured on a phone:
 * thirteen draw calls and under sixty thousand triangles on top of the town's, in
 * both themes. three runs in node, so this builds the real meshes from the real asset.
 *
 * Negative control, run by hand: multiply the block list by ten in map-mesh.ts ->
 * the triangle test fails; add a fourteenth mesh -> the draw-call test fails.
 */
import { describe, expect, it } from 'vitest';
import { MAP, spotsFrom } from '../src/features/world/map';
import { buildMap, type MapColors } from '../src/features/world/map-mesh';

const day: MapColors = {
  bg: '#EBEDF2', ground: '#E2E5EB', light: '#FFFFFF', prop: '#C3CBD9', accent: '#6D5DFC',
  success: '#2E9E5B', warning: '#B47B00', night: false,
};
const evening: MapColors = { ...day, bg: '#31353D', ground: '#272B32', light: '#414651', prop: '#181B20', night: true };

describe('the drawn map', () => {
  it('stays within thirteen draw calls and sixty thousand triangles, day and evening', () => {
    for (const colors of [day, evening]) {
      const built = buildMap(MAP, colors);
      const s = built.stats();
      expect(s.meshes, colors.night ? 'evening' : 'day').toBeLessThanOrEqual(13);
      expect(s.triangles).toBeLessThanOrEqual(60_000);
      expect(s.triangles).toBeGreaterThan(10_000);
      built.dispose();
    }
  });

  it('lights windows only in the evening', () => {
    const d = buildMap(MAP, day); const e = buildMap(MAP, evening);
    const windows = (g: ReturnType<typeof buildMap>) => g.group.children.find((c) => c.name === 'windows') as { count: number };
    expect(windows(d).count).toBe(0);
    expect(windows(e).count).toBeGreaterThan(100);
    expect(e.bulbs.emissiveIntensity).toBeGreaterThan(d.bulbs.emissiveIntensity);
    d.dispose(); e.dispose();
  });

  it('lifts one tile out of the merged set as yours, and puts it back', () => {
    const built = buildMap(MAP, day);
    const tris = (name: string) => {
      const m = built.group.children.find((c) => c.name === name) as unknown as { geometry: { index: { count: number } | null; getAttribute(n: string): { count: number } | undefined } };
      const g = m.geometry;
      return (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
    };
    const all = tris('tiles');
    expect(tris('yours')).toBe(0);
    built.setYourTile('koramangala');
    expect(tris('yours')).toBeGreaterThan(0);
    expect(tris('tiles') + tris('yours')).toBe(all);
    built.setYourTile('nowhere');
    expect(tris('yours')).toBe(0);
    expect(tris('tiles')).toBe(all);
    built.dispose();
  });

  it('gives the sim a home and spots for every area', () => {
    const spots = spotsFrom(MAP);
    expect(Object.keys(spots.areas)).toHaveLength(30);
    expect(spots.areas[spots.central]).toBeDefined();
    for (const a of Object.values(spots.areas)) expect(a.spots.length).toBeGreaterThanOrEqual(12);
  });
});
