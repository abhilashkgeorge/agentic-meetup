/**
 * A window goes on the OUTSIDE of the building.
 *
 * THE BUG THIS EXISTS FOR, and the one it would have hidden. The park's buildings were
 * bare extruded footprints -- right size, right place, and still read as untextured
 * crates, because nothing on them said how big they were. The founder walked up to the
 * State Central Library and asked why there was a huge box in the middle of the road
 * (2026-09-23). Windows are what give a wall its scale.
 *
 * Which way is out is the whole problem. These rings come from OpenStreetMap by way of
 * a scale and a Douglas-Peucker simplify, and NOTHING along that road promises a
 * winding: a ring that comes back clockwise hangs every window inside the building,
 * where the only way to see one is to stand in a wall. It would look, from outside,
 * exactly like a building with no windows -- which is to say exactly like the bug
 * being fixed, which is why this is asserted and not eyeballed.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - drop the `if (inside(...)) { nx = -nx; nz = -nz; }` flip -> the clockwise case
 *     fails with every pane inside the ring.
 *   - make `outset` return the ring unchanged -> the plinth test fails.
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { inside, outset, paneRow, posts, prism } from '../src/features/world/garden-mesh';
import type { Pt } from '../src/features/world/sim';

/** A plain rectangle, anticlockwise in (x, z). */
const CCW: Pt[] = [[0, 0], [4, 0], [4, 3], [0, 3]];
const CW: Pt[] = [...CCW].reverse();
/** An L, so a concave corner is covered too. */
const L: Pt[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];

/** Every pane's four corners, as flat (x, z) pairs at the storey height. */
function corners(ring: Pt[], y = 0.16): Pt[] {
  return paneRow(ring, y).flatMap((g) => {
    const p = g.getAttribute('position').array as ArrayLike<number>;
    const out: Pt[] = [];
    for (let i = 0; i < p.length; i += 3) out.push([p[i]!, p[i + 2]!]);
    g.dispose();
    return out;
  });
}

describe('building windows', () => {
  it('hangs none of them inside an anticlockwise footprint', () => {
    const pts = corners(CCW);
    expect(pts.length).toBeGreaterThan(8);
    expect(pts.filter(([x, z]) => inside(x, z, CCW))).toHaveLength(0);
  });

  it('hangs none of them inside the SAME footprint wound the other way', () => {
    // The one that would have shipped a windowless building and looked deliberate.
    const pts = corners(CW);
    expect(pts.length).toBeGreaterThan(8);
    expect(pts.filter(([x, z]) => inside(x, z, CW))).toHaveLength(0);
  });

  it('handles a concave corner without turning a wall inside out', () => {
    const pts = corners(L);
    expect(pts.length).toBeGreaterThan(4);
    expect(pts.filter(([x, z]) => inside(x, z, L))).toHaveLength(0);
  });

  it('puts them on the wall, not out in the grass', () => {
    // A hair off the face: far enough not to z-fight, near enough to be the wall.
    for (const [x, z] of corners(CCW)) {
      const gap = Math.min(x, 4 - x, z, 3 - z);
      expect(gap).toBeGreaterThan(-0.02);
      expect(gap).toBeLessThan(0.001);
    }
  });

  it('skips a wall too short to carry one', () => {
    const sliver: Pt[] = [[0, 0], [0.1, 0], [0.1, 3], [0, 3]];
    // The 0.1-unit ends take no pane; the 3-unit sides do.
    expect(paneRow(sliver, 0.16).length).toBe(2 * Math.floor(3 / 0.32));
  });

  it('stacks a storey at a time rather than one band of glass', () => {
    const low = paneRow(CCW, 0.16);
    const high = paneRow(CCW, 0.16 + 0.43);
    expect(low.length).toBe(high.length);
    const yOf = (g: THREE.BufferGeometry) => (g.getAttribute('position').array as ArrayLike<number>)[1]!;
    expect(yOf(high[0]!)).toBeCloseTo(yOf(low[0]!) + 0.43, 5);
    for (const g of [...low, ...high]) g.dispose();
  });
});

describe('the plinth and the cornice', () => {
  it('stand proud of the wall on every side', () => {
    const wider = outset(CCW, 0.035);
    // Every original corner now sits inside the grown ring.
    for (const [x, z] of CCW) expect(inside(x, z, wider)).toBe(true);
    // ...and it grew by about the amount asked for, not by a factor of the size.
    const grew = Math.hypot(wider[0]![0] - 2, wider[0]![1] - 1.5) - Math.hypot(0 - 2, 0 - 1.5);
    expect(grew).toBeCloseTo(0.035, 3);
  });
});

describe('the bandstand', () => {
  it('stands its pillars on the footprint, where the collision already stops you', () => {
    // A roof on pillars is only honest if the pillars are where the wall was: you are
    // blocked at the ring either way, so what you see is what you walk into.
    const ps = posts(CCW, 0.09, 0.9);
    expect(ps.length).toBeGreaterThan(8);
    for (const g of ps) {
      const p = g.getAttribute('position').array as ArrayLike<number>;
      let cx = 0; let cz = 0;
      for (let i = 0; i < p.length; i += 3) { cx += p[i]!; cz += p[i + 2]!; }
      cx /= p.length / 3; cz /= p.length / 3;
      const edge = Math.min(Math.abs(cx), Math.abs(4 - cx), Math.abs(cz), Math.abs(3 - cz));
      expect(edge, `a pillar ${edge.toFixed(2)} units off the ring`).toBeLessThan(0.001);
      g.dispose();
    }
  });

  it('does not double up a pillar where two walls meet', () => {
    // Each edge leaves its far end to the next edge, so a corner carries one post.
    const ps = posts(CCW, 0, 1);
    const keys = new Set(ps.map((g) => {
      const p = g.getAttribute('position').array as ArrayLike<number>;
      return `${p[0]!.toFixed(3)},${p[2]!.toFixed(3)}`;
    }));
    expect(keys.size).toBe(ps.length);
    for (const g of ps) g.dispose();
  });

  it('ignores the repeated closing point that OSM rings carry', () => {
    const closed: Pt[] = [...CCW, CCW[0]!];
    expect(posts(closed, 0, 1).length).toBe(posts(CCW, 0, 1).length);
  });
});

describe('what gets merged together', () => {
  it('agrees about the index, or the whole park draws nothing', () => {
    // `mergeGeometries` wants an index on every input or on none, and answers null
    // otherwise -- which reaches `new Mesh(null)` and throws on `morphAttributes`,
    // taking the entire garden with it. Walls come from ExtrudeGeometry (no index)
    // and pillars from BoxGeometry (indexed), and they go into the same pile.
    const wall = prism(CCW, 0, 1);
    const pillar = posts(CCW, 0, 1)[0]!;
    expect(pillar.getIndex(), 'a pillar carries an index the wall beside it does not')
      .toBe(wall.getIndex());
    wall.dispose(); for (const g of posts(CCW, 0, 1)) g.dispose();
  });
});
