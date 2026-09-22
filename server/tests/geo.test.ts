/**
 * The flat geometry the map is cut with. Pure, so no database and no renderer.
 *
 * Negative controls, run by hand and recorded in the commit: in clipHalfPlane, stop
 * emitting the intersection point on a crossing edge -> the area-conservation test
 * fails; in pointInPolygon, replace the ray cast with a bbox test -> the notch test
 * fails.
 */
import { describe, expect, it } from 'vitest';
import {
  AREAS, CENTRAL_AREA, clipHalfPlane, distToRing, findArea, insetRing, insetTowardCentroid, lcg, nearestArea, pieces,
  isSimple, pointInPolygon, polygonArea, project, projection, rdp, rdpRing, unproject, voronoiCells, type Pt,
} from '@clone/shared';

const square = (s: number): Pt[] => [[-s, -s], [s, -s], [s, s], [-s, s]];
/** A U shape: concave, with a notch from the top. */
const notch: Pt[] = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];

describe('projection', () => {
  it('round-trips', () => {
    const p = projection(12.9716, 77.5946, 200);
    const rnd = lcg(3);
    for (let i = 0; i < 50; i++) {
      const lat = 12.8 + rnd() * 0.35; const lon = 77.45 + rnd() * 0.35;
      const [x, z] = project(lat, lon, p);
      const [lat2, lon2] = unproject(x, z, p);
      expect(lat2).toBeCloseTo(lat, 9);
      expect(lon2).toBeCloseTo(lon, 9);
    }
    // North is -z (toward the top of the screen), east is +x.
    const [x, z] = project(13.0, 77.7, p);
    expect(x).toBeGreaterThan(0); expect(z).toBeLessThan(0);
  });
});

describe('simplification', () => {
  it('keeps the endpoints, never adds a point, and eps 0 is identity', () => {
    const line: Pt[] = [[0, 0], [1, 0.01], [2, -0.01], [3, 0.02], [4, 0]];
    const out = rdp(line, 0.1);
    expect(out[0]).toEqual([0, 0]); expect(out[out.length - 1]).toEqual([4, 0]);
    expect(out.length).toBeLessThanOrEqual(line.length);
    expect(out).toEqual([[0, 0], [4, 0]]);
    expect(rdp(line, 0)).toEqual(line);
    expect(rdpRing(square(1), 0.5)).toHaveLength(4);
  });
});

describe('clipping', () => {
  it('conserves area across a half-plane split, convex and concave', () => {
    const rnd = lcg(11);
    for (const poly of [square(5), notch]) {
      for (let i = 0; i < 20; i++) {
        const a: Pt = [rnd() * 12 - 1, rnd() * 12 - 1]; const b: Pt = [rnd() * 12 - 1, rnd() * 12 - 1];
        const near = clipHalfPlane(poly, a, b); const far = clipHalfPlane(poly, b, a);
        const sum = pieces(near).reduce((s, r) => s + polygonArea(r), 0) + pieces(far).reduce((s, r) => s + polygonArea(r), 0);
        expect(sum).toBeCloseTo(polygonArea(poly), 6);
      }
    }
  });

  it('tells inside from outside on a concave ring', () => {
    expect(pointInPolygon([5, 8], notch), 'in the notch').toBe(false);
    expect(pointInPolygon([1.5, 8], notch), 'left arm').toBe(true);
    expect(pointInPolygon([5, 1.5], notch), 'the base').toBe(true);
    expect(pointInPolygon([11, 5], notch)).toBe(false);
  });
});

describe('voronoi tiles', () => {
  it('tile the outline exactly, each around its own centre, none overlapping', () => {
    const outline = notch.map(([x, z]) => [x * 3, z * 3] as Pt);
    // Every centre inside the outline: build-map.ts refuses one outside (its cell would be
    // the far side of the notch, in two pieces, and the smaller piece is dropped).
    const centres: Pt[] = [[3, 3], [24, 3], [13, 5], [4, 24], [26, 24], [7, 15]];
    centres.forEach((c) => expect(pointInPolygon(c, outline)).toBe(true));
    const tiles = voronoiCells(centres, outline);
    expect(tiles).toHaveLength(centres.length);
    const total = tiles.reduce((s, t) => s + polygonArea(t), 0);
    expect(total).toBeCloseTo(polygonArea(outline), 3);
    centres.forEach((c, i) => expect(pointInPolygon(c, tiles[i]!), `centre ${i}`).toBe(true));
    const rnd = lcg(5);
    for (let k = 0; k < 300; k++) {
      const p: Pt = [rnd() * 30, rnd() * 30];
      const hits = tiles.filter((t) => pointInPolygon(p, t)).length;
      expect(hits).toBeLessThanOrEqual(1);
      if (pointInPolygon(p, outline) && hits === 0) {
        // Only allowed on a shared edge, within float tolerance.
        expect(tiles.some((t) => t.some((v, i) => {
          const w = t[(i + 1) % t.length]!;
          const d = Math.abs((w[0] - v[0]) * (p[1] - v[1]) - (w[1] - v[1]) * (p[0] - v[0])) / Math.hypot(w[0] - v[0], w[1] - v[1]);
          return d < 1e-6;
        }))).toBe(true);
      }
    }
    const inset = insetTowardCentroid(tiles[0]!, 0.3);
    expect(polygonArea(inset)).toBeLessThan(polygonArea(tiles[0]!));
  });

  it('never returns a ring that crosses itself, however thin the shape gets', () => {
    // Control: remove the `room` cap and the simplicity retry in insetRing -> the
    // spit in this shape folds over and isSimple fails. Nine of the thirty real tiles
    // were torn that way, and earcut draws a torn ring as overlapping wedges rather
    // than as an error, so it reached the phone looking like a half-finished render.
    const spit: Pt[] = [[0, 0], [10, 0], [10, 6], [6, 6], [6, 5.4], [9, 5.4], [9, 0.6], [1, 0.6], [1, 6], [0, 6]];
    expect(isSimple(spit), 'the fixture itself is simple').toBe(true);
    for (const gap of [0.1, 0.3, 0.6, 1.2, 4]) {
      const out = insetRing(spit, gap);
      expect(isSimple(out), `gap ${gap} folded the ring`).toBe(true);
      expect(out).toHaveLength(spit.length);
      // Either it moved every vertex inward, or it gave the ring back untouched --
      // a vertex left sitting on the original outline would be neither.
      const same = out.every((v, i) => v[0] === spit[i]![0] && v[1] === spit[i]![1]);
      if (!same) for (const v of out) expect(pointInPolygon(v, spit), `gap ${gap} left the shape`).toBe(true);
    }
    // A gap wider than the shape gives the ring back rather than a knot.
    expect(insetRing(spit, 50)).toEqual(spit);
    // And it still insets a shape with room in it.
    expect(polygonArea(insetRing(square(5), 1))).toBeLessThan(polygonArea(square(5)));
  });

  it('inset a concave ring by a gap: every vertex inside, exactly gap from the old edges', () => {
    // Control: insetTowardCentroid on the same ring pushes the notch corners OUT.
    const gap = 0.3;
    for (const ring of [notch, [...notch].reverse()]) {
      const inset = insetRing(ring, gap);
      expect(inset).toHaveLength(ring.length);
      const n = ring.length;
      const lineDist = (p: Pt, a: Pt, b: Pt) =>
        Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      inset.forEach((v, i) => {
        expect(pointInPolygon(v, ring)).toBe(true);
        // Exactly gap from both old edge lines (at a reflex corner the nearest point of
        // the old ring is the corner itself, further away), never nearer than gap.
        expect(lineDist(v, ring[(i + n - 1) % n]!, ring[i]!)).toBeCloseTo(gap, 9);
        expect(lineDist(v, ring[i]!, ring[(i + 1) % n]!)).toBeCloseTo(gap, 9);
        expect(distToRing(v, ring)).toBeGreaterThanOrEqual(gap - 1e-9);
      });
      expect(polygonArea(inset)).toBeLessThan(polygonArea(ring));
    }
    const wrong = insetTowardCentroid(notch, gap);
    expect(wrong.some((v) => !pointInPolygon(v, notch))).toBe(true);
  });
});

describe('areas', () => {
  it('are found by id, name or alias, and only near their own centre', () => {
    expect(findArea('HSR Layout')).toBe(findArea('hsr-layout'));
    expect(findArea('  hsr ')?.id).toBe('hsr-layout');
    expect(findArea('Halasuru')?.id).toBe('ulsoor');
    expect(findArea('Narnia')).toBeNull();
    expect(nearestArea(12.935, 77.625)?.id).toBe('koramangala');
    expect(nearestArea(19.076, 72.877), 'Mumbai is nobody\'s neighbour').toBeNull();
    expect(AREAS.map((a) => a.id)).toContain(CENTRAL_AREA);
    expect(new Set(AREAS.map((a) => a.id)).size).toBe(AREAS.length);
    expect(AREAS.reduce((s, a) => s + a.weight, 0)).toBeCloseTo(1, 1);
  });
});
