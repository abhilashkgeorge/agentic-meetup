/**
 * The walkable Cubbon Park is the real one, at the real size.
 *
 * WHAT THIS GUARDS. The seeded garden it replaces could be wrong in only one way --
 * ugly -- because nothing in it claimed to be anywhere. A surveyed place can be wrong
 * in ways that do not look wrong: the boundary can be somebody else's park, the scale
 * can be out by a factor, a path can run through a pond, and every one of those draws
 * perfectly happily. So the checks here are about correspondence with the real place
 * and with the ground somebody walks on, not about looks.
 *
 * It reads the shipped asset, not a fixture. Rebuild the park wrongly and this fails.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - set METRES_PER_UNIT to 1 -> "a person can cross it in minutes, not hours" fails.
 *   - drop the water check from `openGround` -> "nothing stands in a pond" fails.
 *   - use the circle outline instead of the survey -> "the edge of the world is the
 *     real boundary" fails.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METRES_PER_UNIT, cubbonFacts, makeCubbon } from '../src/features/world/cubbon';
import { gardenSpots } from '../src/features/world/garden';
import type { Pt } from '../src/features/world/sim';

const ASSET = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'assets', 'venues', 'cubbon-park', 'park.json'), 'utf8'),
) as { meta: { hectares: number; spanM: [number, number]; source: string }; outline: [number, number][] };

const g = makeCubbon();

const inRing = (p: Pt, ring: readonly Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < xj + ((p[1] - zj) * (xi - xj)) / (zi - zj)) inside = !inside;
  }
  return inside;
};

describe('Cubbon Park', () => {
  it('is the real park, from the real survey', () => {
    // 61 hectares and 1.2 km by 1.4 km. The first build of the asset pinned the wrong
    // OSM id and produced a 2.3-hectare courtyard, which drew beautifully.
    expect(ASSET.meta.source).toMatch(/OpenStreetMap/);
    expect(ASSET.meta.hectares).toBeGreaterThan(40);
    expect(ASSET.meta.hectares).toBeLessThan(200);
    expect(ASSET.meta.spanM[0]).toBeGreaterThan(900);
    expect(ASSET.meta.spanM[1]).toBeGreaterThan(900);
    expect(cubbonFacts().paths).toBeGreaterThan(100);
  });

  it('is built at a scale a person can cross in minutes, not hours', () => {
    // The founder asked for full size (2026-09-23), so the number this has to stay
    // honest about is how long it takes to walk. At WALK_SPEED, the long axis should
    // be minutes of walking -- long enough to be a park, short enough to be a game.
    const [x, z] = cubbonFacts().spanUnits;
    expect(Math.max(x, z)).toBeGreaterThan(120);
    expect(Math.max(x, z)).toBeLessThan(260);
    // And the scale is the one derived from how tall a person is drawn.
    expect(METRES_PER_UNIT).toBeGreaterThan(5);
    expect(METRES_PER_UNIT).toBeLessThan(12);
    // A path is two people wide, not four: the seeded garden's 0.95 was a road.
    const width = 0.42;
    expect(width * METRES_PER_UNIT).toBeLessThan(5);
  });

  it('gives the sim the real boundary as the edge of the world', () => {
    const spots = gardenSpots(g);
    const area = spots.areas[g.id]!;
    expect(area.polygon).toBe(g.outline);
    expect(g.outline.length).toBeGreaterThan(20);
    // A circle would pass every other check in this file and be wrong. The real
    // boundary is not round, and this is how that is asserted rather than assumed.
    const rs = g.outline.map(([x, z]) => Math.hypot(x, z));
    const spread = Math.max(...rs) / Math.min(...rs);
    expect(spread, 'the outline is a circle').toBeGreaterThan(1.5);
  });

  it('puts nobody in a pond, in a building or on a path', () => {
    expect(g.spots.length).toBeGreaterThan(40);
    for (const p of g.spots) {
      expect(inRing(p, g.outline), `${p} is outside the park`).toBe(true);
      for (const w of g.ponds) expect(inRing(p, w), `${p} is in the water`).toBe(false);
      for (const b of g.buildings) expect(inRing(p, b.ring), `${p} is indoors`).toBe(false);
    }
  });

  it('plants nothing in the water', () => {
    // The generated half of the park -- trees, bushes, grass -- is placed against the
    // real geometry, and water is the one place where being wrong is obvious.
    const wet = (p: Pt) => g.ponds.some((w) => inRing(p, w));
    for (const t of g.trees) expect(wet([t.x, t.z]), `a tree at ${t.x},${t.z}`).toBe(false);
    for (const b of g.bushes) expect(wet([b.x, b.z]), `a bush at ${b.x},${b.z}`).toBe(false);
    let wetGrass = 0;
    for (const t of g.tufts) if (wet([t.x, t.z])) wetGrass++;
    expect(wetGrass, 'grass growing in a pond').toBe(0);
  });

  it('keeps everything it draws inside the park', () => {
    const out = (xs: { x: number; z: number }[]) => xs.filter((p) => !inRing([p.x, p.z], g.outline)).length;
    // The surveyed trees are OSM's and are inside by construction; everything else is
    // generated against the ring. A handful of edge cases would be a rounding story --
    // any more is a generator that does not know where the park ends.
    expect(out(g.trees)).toBe(0);
    expect(out(g.bushes)).toBe(0);
    expect(out(g.benches)).toBe(0);
  });

  it('brings the real place with it: buildings, statues, water -- and no cage', () => {
    const named = g.buildings.map((b) => b.name);
    expect(named).toContain('State Central Library');
    // The Band Stand was seven metres of thin posts round a ring where you arrive, and
    // read as a cage (the founder, 2026-09-29): it is not built.
    expect(named).not.toContain('Band Stand');
    expect(g.ponds.length).toBeGreaterThan(2);
    const statues = g.landmarks.filter((l) => l.kind === 'statue').map((l) => l.name);
    expect(statues.join(' ')).toMatch(/Cubbon|Seshadri|Chamarajendra/);
    // You arrive BESIDE the bandstand, which is the middle of the real park. Inside
    // it is where the first cut put you, and a building is extruded from its
    // footprint, so the park opened with the camera in a grey box.
    expect(inRing(g.home, g.outline)).toBe(true);
    for (const b of g.buildings) {
      expect(inRing(g.home, b.ring), `you arrive inside ${b.name || 'a building'}`).toBe(false);
    }
    // Where it stood is still the middle of the park: you arrive near it, not on the
    // other side. Measured off the survey itself, since the building is gone.
    const park = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'assets', 'venues', 'cubbon-park', 'park.json'), 'utf8')) as
      { buildings: { name: string; ring: [number, number][] }[] };
    const ring = park.buildings.find((b) => b.name === 'Band Stand')!.ring.map(([x, z]) => [x / METRES_PER_UNIT, z / METRES_PER_UNIT] as Pt);
    const mid: Pt = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    // ...and near it, not on the other side of the park.
    expect(Math.hypot(g.home[0] - mid[0], g.home[1] - mid[1])).toBeLessThan(12);
  });

  it('walls the edge without standing a building behind you', () => {
    // Walking is blocked by any solid at all, so the edge ring needs no height for
    // that -- and height is exactly what breaks the camera. `clearBack` pulls the
    // lens in against anything taller than it (0.95) and then rises to look over the
    // top, so a four-unit wall turned every approach to the boundary into a plan view
    // of your own head.
    const { solids = [] } = gardenSpots(g);
    const LENS = 0.95;
    const tall = solids.filter((s) => s.h > LENS);
    // Trees and buildings SHOULD block the view. Nothing else should.
    const walls = tall.filter((s) => s.h === 4);
    expect(walls, 'the edge is a wall the camera has to climb').toHaveLength(0);

    // AND NOTHING TALL IS WIDE. The camera pulls in against anything over the lens,
    // so a wide tall solid is a building -- fine for the library, absurd for a tree's
    // canopy, which is above the lens and was never in the way. Everything that
    // reaches over the lens is either a trunk or a building corner.
    const onAnyWall = (x: number, z: number) => g.buildings.some((b) =>
      b.ring.some((a, i) => {
        const c = b.ring[(i + 1) % b.ring.length]!;
        const dx = c[0] - a[0];
        const dz = c[1] - a[1];
        const len2 = dx * dx + dz * dz;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
        return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz)) < 0.01;
      }));
    const fat = tall.filter((s) => s.r > 0.2);
    for (const s of fat) {
      expect(onAnyWall(s.x, s.z),
        `a solid ${s.r.toFixed(2)} wide and ${s.h.toFixed(2)} tall is not part of a building`).toBe(true);
    }

    // NOTHING STANDS FURTHER OUT THAN IT LOOKS. Against a person 0.21 units tall, a
    // collider more than about a metre and a half from its own middle is a thing you
    // cannot walk up to -- which is how a park full of trees became a park you could
    // not get near a tree in.
    const FOOT = 0.09;
    const REACH = 0.21;
    for (const s of solids) {
      expect((s.r + FOOT) / REACH,
        `something ${((s.r + FOOT) / REACH).toFixed(1)} body-heights across stops you`)
        .toBeLessThan(2.2);
    }

    // ...and the edge still stops you: it is the outline itself (MapSpots.bounds),
    // which tests/park-roads.test.ts walks all the way round.
    expect(gardenSpots(g).bounds, 'you can walk straight out of the park').toBe(g.outline);
  });

  it('puts the crowd where the crowd is, and still fills the far half', () => {
    // Spread evenly, 32 people over 147 by 171 units is one person every two thousand
    // square units, and walking the park you meet nobody -- which is the one thing it
    // is for. Real crowds cluster at the bandstand and thin toward the edges.
    const away = (p: Pt) => Math.hypot(p[0] - g.home[0], p[1] - g.home[1]);
    const near = g.spots.filter((p) => away(p) <= 45).length;
    expect(near / g.spots.length, 'the crowd is spread thin over the whole park')
      .toBeGreaterThan(0.45);
    // ...and the far half is not empty, or the rest of the park is scenery.
    expect(g.spots.filter((p) => away(p) > 70).length, 'nobody is ever in the far half')
      .toBeGreaterThan(8);
  });

  it('walls a building along its edges, not just at its corners', () => {
    // A surveyed footprint is a handful of corners a long way apart. One solid each
    // leaves the State Central Library with a 3.4-unit hole in its longest wall, and
    // you walk through it and stand inside an extruded box.
    const { solids = [] } = gardenSpots(g);
    for (const b of g.buildings) {
      for (let i = 0; i < b.ring.length; i++) {
        const a = b.ring[i]!;
        const c = b.ring[(i + 1) % b.ring.length]!;
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 0.8) continue;
        // Walk the edge and check something stops you at every step along it.
        for (let t = 0.1; t < 0.95; t += 0.12) {
          const p: Pt = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
          const stopped = solids.some((s) =>
            s.h > 0.5 && Math.hypot(s.x - p[0], s.z - p[1]) < s.r + 0.12);
          expect(stopped, `a hole in ${b.name || 'a building'} at ${t.toFixed(2)} along an edge`).toBe(true);
        }
      }
    }
  });

  it('is one place, and the same one every time', () => {
    expect(makeCubbon()).toBe(g);
    expect(g.id).toBe('cubbon-park');
  });

  it('draws a park, not a forest or a lawn', () => {
    // Blunt sanity on the generated half. These are not art direction; they are the
    // difference between a park and an empty field, and between a park and a wall of
    // trees a person cannot walk through.
    expect(g.trees.length).toBeGreaterThan(300);
    expect(g.trees.length).toBeLessThan(1200);
    expect(g.benches.length).toBeGreaterThan(30);
    expect(g.tufts.length).toBeGreaterThan(5000);
    expect(g.paths.length).toBeGreaterThan(100);
  });
});
