/**
 * The committed map asset is data the renderer and the sim trust blindly, so its shape
 * is checked here rather than at run time on the phone. Rebuild with
 * `cd server && npx tsx scripts/build-map.ts --offline` after changing shared/areas.ts.
 *
 * Negative control, run by hand: edit one tile vertex in the JSON to lie outside the
 * outline -> "tile vertices inside the outline" fails; drop the 300 KB guard's file ->
 * the size test fails.
 */
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AREAS, dedupeRing, distToRing, pointInPolygon, polygonArea, type Pt } from '@clone/shared';
import { spotsFrom } from '../src/features/world/map';
import { WorldSim } from '../src/features/world/sim';

const FILE = new URL('../assets/map/bangalore.json', import.meta.url);
const asset = JSON.parse(readFileSync(FILE, 'utf8')) as {
  meta: { origin: [number, number]; k: number; cosLat: number; built: string; osm: string };
  outline: Pt[];
  areas: { id: string; name: string; centre: Pt; home: Pt; radius: number; density: number; polygon: Pt[]; spots: Pt[]; blocks: number[][] }[];
  roads: Record<string, Pt[][]>;
  water: { name: string; polygon: Pt[] }[];
  parks: { name: string; polygon: Pt[]; trees: number[][] }[];
  landmarks: { id: string; name: string; area: string; at: Pt; kind: string; rot: number }[];
  lamps: Pt[];
};

const finite = (p: readonly number[]) => p.every((v) => Number.isFinite(v));
const goodRing = (ring: Pt[]) => ring.length >= 3 && ring.every(finite) && dedupeRing(ring).length === ring.length && polygonArea(ring) > 0;

describe('bangalore.json', () => {
  it('is small enough to bundle and says where it came from', () => {
    expect(statSync(FILE).size).toBeLessThanOrEqual(300_000);
    expect(asset.meta.osm).toMatch(/^relation\/\d+$/);
    expect(asset.meta.built).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(readFileSync(new URL('../assets/map/ATTRIBUTION.md', import.meta.url), 'utf8')).toContain('OpenStreetMap contributors');
  });

  it('has one tile per area, in the same order as AREAS', () => {
    expect(asset.areas.map((a) => a.id)).toEqual(AREAS.map((a) => a.id));
    expect(asset.areas.map((a) => a.name)).toEqual(AREAS.map((a) => a.name));
  });

  it('draws only clean rings: three or more finite points, no repeats, some area', () => {
    expect(goodRing(asset.outline)).toBe(true);
    for (const a of asset.areas) expect(goodRing(a.polygon), a.id).toBe(true);
    for (const w of asset.water) expect(goodRing(w.polygon), w.name).toBe(true);
    for (const p of asset.parks) expect(goodRing(p.polygon), p.name).toBe(true);
    for (const [cls, lines] of Object.entries(asset.roads)) {
      expect(lines.length, cls).toBeGreaterThan(0);
      for (const l of lines) { expect(l.length).toBeGreaterThanOrEqual(2); expect(l.every(finite)).toBe(true); }
    }
  });

  it('keeps every tile inside the city and everything of a tile inside the tile', () => {
    for (const a of asset.areas) {
      // Inside, or on the line within the asset's 2-dp rounding.
      for (const v of a.polygon) expect(pointInPolygon(v, asset.outline) || distToRing(v, asset.outline) <= 0.011, `${a.id} vertex ${v}`).toBe(true);
      expect(pointInPolygon(a.home, a.polygon), `${a.id} home`).toBe(true);
      expect(a.spots.length).toBeGreaterThanOrEqual(12);
      for (const s of a.spots) expect(pointInPolygon(s, a.polygon), `${a.id} spot ${s}`).toBe(true);
      for (const b of a.blocks) {
        expect(b).toHaveLength(6);
        expect(pointInPolygon([b[0]!, b[1]!], a.polygon), `${a.id} block`).toBe(true);
        expect(b[4]!).toBeGreaterThan(0);
      }
      expect(a.radius).toBeGreaterThan(0);
      expect(a.density).toBeGreaterThanOrEqual(0); expect(a.density).toBeLessThanOrEqual(1);
    }
    // The build script aims for 500 (blockScale); this is the ceiling it must not
    // drift past. The real budget is triangles, which tests/map-mesh.test.ts holds.
    expect(asset.areas.reduce((s, a) => s + a.blocks.length, 0)).toBeLessThanOrEqual(520);
  });

  it('never puts a standing spot inside something the sim will not let you stand in', () => {
    // THE TWO TESTS HAVE TO AGREE. The build script decides where people stand; the
    // sim decides what they can walk through. The script used an axis-aligned box and
    // the sim a circle, so spots sat outside the box and well inside the circle --
    // agents span into buildings and the walking camera started with nowhere to go.
    // Control: put the box test back in build-map.ts and rebuild; this fails.
    const sim = new WorldSim(1);
    sim.setMap(spotsFrom(asset as never));
    for (const a of asset.areas) {
      expect(sim.standable(a.home[0], a.home[1]), `${a.id} home`).toBe(true);
      for (const p of a.spots) expect(sim.standable(p[0], p[1]), `${a.id} spot ${p}`).toBe(true);
    }
  });

  it('places landmarks, lamps and trees on the map', () => {
    expect(asset.landmarks).toHaveLength(8);
    const ids = new Set(AREAS.map((a) => a.id));
    for (const l of asset.landmarks) {
      expect(ids.has(l.area), l.id).toBe(true);
      expect(pointInPolygon(l.at, asset.outline), l.id).toBe(true);
    }
    expect(asset.lamps.length).toBeGreaterThan(0); expect(asset.lamps.length).toBeLessThanOrEqual(120);
    for (const p of asset.parks) for (const t of p.trees) expect(pointInPolygon([t[0]!, t[1]!], p.polygon), p.name).toBe(true);
  });
});
