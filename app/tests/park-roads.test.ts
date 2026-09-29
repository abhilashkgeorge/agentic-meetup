/**
 * A bicycle can ride every path in Cubbon Park.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "bicycles should also be used for travel around
 * the park ... also the road to ride the bicycle should be fine". Measured before, down
 * the middle of every path at 5 cm steps -- 51,968 points inside the park -- 1,192
 * could not be stood on:
 *   - the road past the State Central Library ran 37 cm from its wall, half of it
 *     under the building, and a footpath 80 cm from the Fern House's, both inside
 *     the reach of the walls' colliders (63 points);
 *   - 18 surveyed trees stood on the paths (OSM puts an avenue's trees on its line);
 *   - 15 benches and 20 lamps and rocks, set back from one path, stood on another;
 *   - and 1,086 at the park's edge, where paths run along the boundary: the edge was
 *     a ring of circles 1.1 units wide outside the outline, reaching up to a metre
 *     into the park wherever the boundary turned in. It is the outline itself now
 *     (MapSpots.bounds), and stops you at it.
 *
 * WHAT IS PINNED, on the park the app draws and the colliders the sim is given:
 *   - no path's surface runs under a building: every path keeps its half-width
 *     clear of every wall;
 *   - nothing solid stands on any path's surface: no trunk, lamp, rock, bench or bush
 *     reaches onto one;
 *   - down the middle of every path nothing stops you: every point 5 cm apart can be
 *     stood on, all the way to the last few centimetres before the park's edge;
 *   - the edge stops you there and nowhere short of it: a step outside is refused all
 *     the way round, and a step 10 cm inside is allowed wherever nothing else stands.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - paths not moved off the walls (clearOf returning the line) -> "under a building"
 *     and "ride" fail
 *   - surveyed trees not moved off the paths                  -> "nothing solid" and "ride" fail
 *   - benches and lamps not checked against every path         -> "nothing solid" fails
 *   - the old ring of edge circles instead of the bound         -> "ride" and "the edge" fail
 */
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '@clone/shared';
import { gardenSpots, pathSurface } from '../src/features/world/garden';
import { BOUND_INSET, FOOT, WorldSim, type Pt } from '../src/features/world/sim';
import { CUBBON_PARK, venueGarden } from '../src/features/world/venue';

const park = venueGarden(CUBBON_PARK);
const spots = gardenSpots(park);
const sim = new WorldSim(1);
sim.setMap(spots);
const surface = pathSurface(park.paths);

/** Every path, down its middle, a point every 5 cm. */
function* along(): Generator<{ p: Pt; path: number }> {
  for (const [path, { line }] of park.paths.entries()) {
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k]!, b = line[k + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
      for (let s = 0; s < n; s++) yield { p: [a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n], path };
    }
  }
}

/** How far a point is from a ring's edges. */
function toRing(p: Pt, ring: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const l2 = ex * ex + ez * ez;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t));
  }
  return best;
}

describe('the paths of Cubbon Park', () => {
  it('never run under a building: each keeps its own half-width clear of every wall', () => {
    const under: string[] = [];
    for (const { p, path } of along()) {
      const half = park.paths[path]!.width / 2;
      for (const b of park.buildings) {
        if (pointInPolygon(p, b.ring) || toRing(p, b.ring) < half) under.push(`path ${path} at ${b.name}`);
      }
    }
    expect([...new Set(under)], 'a path runs under a building').toEqual([]);
  });

  it('have nothing solid standing on them', () => {
    const on: string[] = [];
    for (const s of spots.solids ?? []) {
      if (s.kind !== 'tree' && s.kind !== 'prop' && s.kind !== 'bench' && s.kind !== 'bush') continue;
      const edge = surface([s.x, s.z]).edge;
      if (edge < s.r) on.push(`a ${s.kind} ${((s.r - edge) * 8.1).toFixed(2)} m onto a path at ${s.x.toFixed(1)},${s.z.toFixed(1)}`);
    }
    expect(on.length, on.slice(0, 5).join('; ')).toBe(0);
  });

  it('can be ridden end to end: nothing stops you down the middle of any of them', () => {
    let tried = 0;
    const stopped: string[] = [];
    for (const { p, path } of along()) {
      // At the fence itself you stop: your own width and a hair short of it.
      if (!pointInPolygon(p, park.outline) || toRing(p, park.outline) < FOOT + BOUND_INSET + 0.005) continue;
      tried++;
      if (!sim.standable(p[0], p[1])) stopped.push(`path ${path} at ${p[0].toFixed(2)},${p[1].toFixed(2)}`);
    }
    expect(tried, 'no path to ride, so this proves nothing').toBeGreaterThan(40_000);
    expect(stopped.length, `stopped at ${stopped.slice(0, 5).join('; ')}`).toBe(0);
  });

  it('end at the park\'s edge, which stops you at the line and not before it', () => {
    const ring = park.outline;
    const solids = spots.solids ?? [];
    const clear = (p: Pt) => !solids.some((s) => Math.hypot(s.x - p[0], s.z - p[1]) < s.r + FOOT + 0.02)
      && !(spots.lakes ?? []).some((l) => pointInPolygon(p, l));
    let inside = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      // Across the edge at its middle: which way is in is whichever side is the park.
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      const side = pointInPolygon([m[0] + nx * 0.2, m[1] + nz * 0.2], ring) ? 1 : -1;
      const at = (d: number): Pt => [m[0] + nx * side * d, m[1] + nz * side * d];
      expect(sim.standable(...at(-0.05)), `a step outside the edge at ${m[0].toFixed(1)},${m[1].toFixed(1)}`).toBe(false);
      // Deep in a notch, the far side of the notch is near: only where it is not.
      if (toRing(at(0.1), ring) < 0.09 || !clear(at(0.1))) continue;
      inside++;
      expect(sim.standable(...at(0.1)), `stopped short of the edge at ${m[0].toFixed(1)},${m[1].toFixed(1)}`).toBe(true);
    }
    expect(inside, 'no edge to walk up to, so this proves nothing').toBeGreaterThan(30);
  });
});
