/**
 * The traffic on the road round Cubbon Park: it moves, it keeps its distance, and it
 * stays on the road.
 *
 * WHAT IS PINNED, over two simulated minutes on the real lanes (city.json):
 *   - everybody moves on round their lane, and all the way round in time;
 *   - nobody drives into or through the vehicle in front: no two in a lane ever
 *     overlap, bumper to bumper, at any step;
 *   - nobody goes faster than they like to go, or backwards;
 *   - everybody stays on the road, in their own lane's line;
 *   - it is Bengaluru's mix: two-wheelers the most, buses the fewest.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - no braking for the one in front, and no clamp at its bumper -> "nobody drives
 *     through" fails
 *   - the step moving vehicles backwards along the lane            -> "moves on" fails
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CITY, fieldAt, signedField, type CityPlan } from '../src/features/world/city-plan';
import { makeCubbon } from '../src/features/world/cubbon';
import { Traffic, VEHICLES } from '../src/features/world/traffic';

const plan = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'assets', 'venues', 'cubbon-park', 'city.json'), 'utf8')) as CityPlan;
const field = signedField(makeCubbon().outline, 0.1, 6);

describe('the traffic', () => {
  it('moves on round its lanes, keeps its distance, keeps its pace, keeps to the road', () => {
    const t = new Traffic(plan.lanes.map((l) => l.loop));
    const start = t.vehicles.map((v) => v.s);
    const travelled = t.vehicles.map(() => 0);
    const overlaps: string[] = [];
    let backwards = 0, speeding = 0, offRoad = 0;
    for (let step = 0; step < 120 * 30; step++) {
      const before = t.vehicles.map((v) => v.s);
      t.step(1 / 30);
      t.vehicles.forEach((v, i) => {
        const len = t.laneLength(v.lane);
        let ds = v.s - before[i]!;
        if (ds < -len / 2) ds += len;               // round the end of the loop
        if (ds < -1e-9) backwards++;
        travelled[i]! += ds;
        if (v.v > v.pace * 1.1 + 1e-9) speeding++;
      });
      if (step % 30 === 0) {
        for (let lane = 0; lane < plan.lanes.length; lane++) {
          const list = t.vehicles.filter((v) => v.lane === lane).sort((a, b) => a.s - b.s);
          const len = t.laneLength(lane);
          list.forEach((v, k) => {
            const f = list[(k + 1) % list.length]!;
            let ds = f.s - v.s;
            if (ds <= 0) ds += len;
            const gap = ds - (VEHICLES[f.kind].length + VEHICLES[v.kind].length) / 2;
            if (gap < 0) overlaps.push(`lane ${lane} at ${v.s.toFixed(1)}: ${(gap * 8.1).toFixed(2)} m`);
          });
        }
        for (const v of t.vehicles) {
          const d = fieldAt(field, v.x, v.z);
          if (!(d > CITY.roadFrom && d < CITY.roadTo)) offRoad++;
        }
      }
    }
    expect(overlaps.slice(0, 3), 'drove into the one in front').toEqual([]);
    expect(backwards, 'went backwards').toBe(0);
    expect(speeding, 'faster than it likes to go').toBe(0);
    expect(offRoad, 'off the road').toBe(0);
    // Two minutes at their paces is well over a kilometre each; the slowest, a bus in a
    // queue, still moves.
    expect(Math.min(...travelled), 'somebody never moved').toBeGreaterThan(20);
    expect(start.length).toBe(t.vehicles.length);
  }, 120_000);

  it('is Bengaluru\'s mix: two-wheelers the most, buses the fewest', () => {
    const t = new Traffic(plan.lanes.map((l) => l.loop));
    const n = (k: string) => t.vehicles.filter((v) => v.kind === k).length;
    expect(t.vehicles.length).toBeGreaterThan(150);
    expect(n('bike')).toBeGreaterThan(n('car'));
    expect(n('car')).toBeGreaterThan(n('bus'));
    expect(n('auto')).toBeGreaterThan(n('bus'));
    expect(n('bus')).toBeGreaterThan(0);
  });
});
