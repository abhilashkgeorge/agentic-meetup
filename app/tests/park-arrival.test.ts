/**
 * Walking into the park, and coming and going (the founder, 2026-10-03: "make sure you have a
 * room where people appear and they are not stacked on top of each other. show a smoke
 * magical effect when someone joins and make sure he is not being spawned on the same
 * location as someone else").
 *
 * WHAT WAS WRONG. Everybody arrived on one point, the standing spot nearest the bandstand,
 * so two people walking in were drawn inside each other. Nothing marked anybody coming
 * or going: they were simply there, or not.
 *
 * WHAT IS GUARDED:
 *   - the arrival slots (shared/park-arrival.ts) are real places to stand in the park as
 *     it is built today -- no trunk, bench, hedge or water -- apart from each other, and
 *     round the park's own arrival point (so moving the park breaks this test, not the
 *     people walking in);
 *   - somebody appearing near you comes down by parachute, somebody going is taken up by
 *     a balloon (park-comings.ts; flight.ts drop and away) -- not for the crowd already
 *     here as you walk in, not far off, not for somebody mid-pickup; and no smoke left
 *     anywhere (the founder, 2026-10-03: "doesn't look good").
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - an arrival slot moved onto a tree trunk -> "real places to stand" fails;
 *   - comings ignoring `first` -> "not for the crowd already here" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARRIVAL_GAP, ARRIVAL_HOME, ARRIVAL_SLOTS } from '@clone/shared';
import { CUBBON_PARK, venueGarden } from '../src/features/world/venue';
import { gardenSpots } from '../src/features/world/garden';
import { WorldSim } from '../src/features/world/sim';
import { NEAR, comings } from '../src/features/world/park-comings';

describe('the arrival', () => {
  const g = venueGarden(CUBBON_PARK);
  const sim = new WorldSim(1);
  sim.setMap(gardenSpots(g));

  it('is the park\'s own arrival point', () => {
    expect(g.home[0]).toBeCloseTo(ARRIVAL_HOME[0], 2);
    expect(g.home[1]).toBeCloseTo(ARRIVAL_HOME[1], 2);
  });

  it('has real places to stand, clear of trunks, benches and each other', () => {
    expect(ARRIVAL_SLOTS.length).toBeGreaterThanOrEqual(20);
    for (const [x, z] of ARRIVAL_SLOTS) {
      // Clear all round a person's width, not just underfoot.
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        expect(sim.standable(x + Math.cos(a) * 0.1, z + Math.sin(a) * 0.1), `slot ${x},${z} is inside something`).toBe(true);
      }
      expect(Math.min(...g.benches.map((b) => Math.hypot(b.x - x, b.z - z))), `slot ${x},${z} is on a bench`).toBeGreaterThan(0.45);
      expect(Math.hypot(x - ARRIVAL_HOME[0], z - ARRIVAL_HOME[1]), 'far from the arrival').toBeLessThan(2);
    }
    for (const [i, a] of ARRIVAL_SLOTS.entries()) {
      for (const b of ARRIVAL_SLOTS.slice(i + 1)) expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(ARRIVAL_GAP);
    }
  });
});

describe('coming and going near you', () => {
  const me = { x: 0, z: 0 };
  const m = (...people: [string, number, number, unknown?][]) =>
    new Map(people.map(([ref, x, z, fly]) => [ref, { x, z, ...(fly ? { fly } : {}) }]));

  it('somebody near who appears comes down by parachute; somebody near who goes, by balloon', () => {
    expect(comings(m(), m(['a', 1, 1]), me, false)).toEqual({ came: ['a'], went: [] });
    expect(comings(m(['a', 1, 1]), m(), me, false)).toEqual({ came: [], went: ['a'] });
    // Somebody still here, walking: neither.
    expect(comings(m(['a', 1, 1]), m(['a', 1.1, 1]), me, false)).toEqual({ came: [], went: [] });
  });

  it('not for the crowd already here as you walk in, and not far off', () => {
    expect(comings(m(), m(['a', 1, 1], ['b', 2, 2]), me, true)).toEqual({ came: [], went: [] });
    expect(comings(m(), m(['far', NEAR + 1, 0]), me, false).came).toEqual([]);
    expect(comings(m(['far', NEAR + 1, 0]), m(), me, false).went).toEqual([]);
  });

  it('not for somebody mid-pickup: their flight is already being shown', () => {
    const fly = { fx: 0, fz: 0, tx: 9, tz: 0, t: 100 };
    expect(comings(m(), m(['a', 1, 1, fly]), me, false).came).toEqual([]);
    expect(comings(m(['a', 1, 0, fly]), m(), me, false).went).toEqual([]);
  });

  it('there is no smoke left anywhere in the park (SOURCE SHAPE)', () => {
    const dir = join(import.meta.dirname, '..', 'src', 'features', 'world');
    for (const f of ['park-presence.ts', 'park-live.ts', 'sim.ts', 'canvas.tsx']) {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\bpuff\(|park-effects|flightEffects/);
    }
  });
});
