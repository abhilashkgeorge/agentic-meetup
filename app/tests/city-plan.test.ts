/**
 * The city round Cubbon Park: where its road, buildings and lanes are, against the fence.
 *
 * WHAT THE FOUNDER ASKED (2026-09-29): "a see through barricade around the park so that
 * users can know what the end of the park is in all directions. You can add just
 * buildings and traffic like bangalore after the barricade where no user can go to."
 *
 * WHAT IS PINNED, on the plan the phone reads (assets/venues/cubbon-park/city.json):
 *   - it is the plan city-plan.ts makes from the park's outline today -- nobody edits it
 *     by hand and it cannot fall behind the code;
 *   - nothing of the city is in the park: every road, pavement and building point is
 *     outside the fence, and every building beyond the far pavement;
 *   - the lanes run round the whole park on the road, one each way, KEEPING LEFT: in
 *     the lane beside the park the park is on your left, in the far lane the far kerb;
 *   - every building faces the road, and no two stand in each other.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - the park lane not turned round (both lanes one way)  -> "keeps left" fails
 *   - buildings kept without the corner check              -> "nothing in the park" fails
 *   - buildings kept without the overlap check             -> "stand in each other" fails
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '@clone/shared';
import { CITY, cornersOf, fieldAt, planCity, signedField, type CityPlan } from '../src/features/world/city-plan';
import { makeCubbon } from '../src/features/world/cubbon';
import type { Pt } from '../src/features/world/sim';

const plan = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'assets', 'venues', 'cubbon-park', 'city.json'), 'utf8')) as CityPlan;
const outline = makeCubbon().outline;
const field = signedField(outline, 0.1, 20);
const from = (p: Pt) => fieldAt(field, p[0], p[1]);

describe('the city round the park', () => {
  it('is the plan the code makes today', () => {
    expect(planCity(outline)).toEqual(plan);
  }, 60_000);

  it('has nothing in the park: road, pavements and buildings all outside the fence', () => {
    const rings = [...plan.road, ...plan.pavement].flatMap((r) => [r.outer, ...r.holes]);
    const inside = rings.flat().filter((p) => pointInPolygon(p, outline) && from(p) < -0.02);
    expect(inside.length, 'city ground inside the park').toBe(0);
    const bad = plan.buildings.filter((b) => cornersOf(b).some((c) => pointInPolygon(c, outline) || from(c) < CITY.pavementTo));
    expect(bad.length, 'a building in the park, or on the road or the pavement').toBe(0);
    expect(plan.buildings.length).toBeGreaterThan(400);
  });

  it('runs a lane each way round the whole park, on the road', () => {
    const perimeter = outline.reduce((n, p, i) => n + Math.hypot(outline[(i + 1) % outline.length]![0] - p[0], outline[(i + 1) % outline.length]![1] - p[1]), 0);
    for (const { loop, side } of plan.lanes) {
      const level = side === 'park' ? CITY.laneIn : CITY.laneOut;
      const length = loop.reduce((n, p, i) => n + Math.hypot(loop[(i + 1) % loop.length]![0] - p[0], loop[(i + 1) % loop.length]![1] - p[1]), 0);
      // Round the park, not round an island: longer than most of its fence (the lane
      // cuts across the narrowest notches, so it can be the shorter of the two).
      expect(length, `the ${side} lane goes round something small`).toBeGreaterThan(perimeter * 0.6);
      for (const p of loop) {
        expect(Math.abs(from(p) - level), `the ${side} lane leaves its line at ${p}`).toBeLessThan(0.06);
        expect(from(p)).toBeGreaterThan(CITY.roadFrom);
        expect(from(p)).toBeLessThan(CITY.roadTo);
      }
    }
  });

  it('keeps left: the park on your left beside it, the far kerb on your left across the road', () => {
    for (const { loop, side } of plan.lanes) {
      let wrong = 0, n = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        // The sim's left of the way you face: facing (sin f, cos f), left is (cos f, -sin f).
        const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const left: Pt = [m[0] + ((b[1] - a[1]) / len) * 0.15, m[1] - ((b[0] - a[0]) / len) * 0.15];
        const nearerPark = from(left) < from(m);
        n++;
        if (nearerPark !== (side === 'park')) wrong++;
      }
      expect(wrong / n, `the ${side} lane drives on the right`).toBeLessThan(0.02);
    }
  });

  it('faces every building to the road, and stands none in another', () => {
    for (const b of plan.buildings) {
      const ahead: Pt = [b.c[0] + Math.sin(b.a) * 0.5, b.c[1] + Math.cos(b.a) * 0.5];
      expect(from(ahead), 'a building with its back to the road').toBeLessThan(from(b.c));
    }
    // Two footprints overlap if neither has a side that separates them.
    const cs = plan.buildings.map(cornersOf);
    const apart = (p: Pt[], q: Pt[]) => [p, q].some((poly) => poly.some((a, i) => {
      const c = poly[(i + 1) % 4]!;
      const nx = c[1] - a[1], nz = a[0] - c[0];
      const proj = (pts: Pt[]) => pts.map(([x, z]) => x * nx + z * nz);
      const pa = proj(p), pb = proj(q);
      return Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6;
    }));
    let overlapping = 0;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const bi = plan.buildings[i]!, bj = plan.buildings[j]!;
        if (Math.hypot(bi.c[0] - bj.c[0], bi.c[1] - bj.c[1]) > 6) continue;
        if (!apart(cs[i]!, cs[j]!)) overlapping++;
      }
    }
    expect(overlapping, 'buildings standing in each other').toBe(0);
  });
});
