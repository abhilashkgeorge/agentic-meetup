/**
 * Walking into the park, and the smoke (the founder, 2026-10-03: "make sure you have a
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
 *   - a puff for somebody appearing or vanishing near you, a pair for somebody jumping
 *     across (a bench too far to walk to), none for the crowd already here as you walk
 *     in, none far off, and none for a flight, which brings its own beams and puff;
 *   - the effects run for their time and go, and never pile up.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - an arrival slot moved onto a tree trunk -> "real places to stand" fails;
 *   - puffsFor ignoring `first` -> "none for the crowd already here" fails.
 */
import { describe, expect, it } from 'vitest';
import { ARRIVAL_GAP, ARRIVAL_HOME, ARRIVAL_SLOTS } from '@clone/shared';
import { CUBBON_PARK, venueGarden } from '../src/features/world/venue';
import { gardenSpots } from '../src/features/world/garden';
import { WorldSim } from '../src/features/world/sim';
import {
  JUMP, MAX_EFFECTS, PUFF_MS, PUFF_NEAR, clearEffects, effectAt, effectsNow, flightEffects, puff, puffsFor,
} from '../src/features/world/park-effects';
import { DROP_MS, LIFT_MS, glideMs } from '../src/features/world/flight';

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

describe('the smoke', () => {
  const me = { x: 0, z: 0 };
  const m = (...people: [string, number, number, unknown?][]) =>
    new Map(people.map(([ref, x, z, fly]) => [ref, { x, z, ...(fly ? { fly } : {}) }]));

  it('puffs where somebody near appears or vanishes', () => {
    expect(puffsFor(m(), m(['a', 1, 1]), me, false)).toEqual([[1, 1]]);
    expect(puffsFor(m(['a', 1, 1]), m(), me, false)).toEqual([[1, 1]]);
    // Somebody still here, walking: nothing.
    expect(puffsFor(m(['a', 1, 1]), m(['a', 1.1, 1]), me, false)).toEqual([]);
  });

  it('none for the crowd already here as you walk in, and none far off', () => {
    expect(puffsFor(m(), m(['a', 1, 1], ['b', 2, 2]), me, true)).toEqual([]);
    expect(puffsFor(m(), m(['far', PUFF_NEAR + 1, 0]), me, false)).toEqual([]);
    expect(puffsFor(m(['far', PUFF_NEAR + 1, 0]), m(), me, false)).toEqual([]);
  });

  it('a jump too far to walk is a vanish there and a puff here', () => {
    expect(puffsFor(m(['a', 1, 0]), m(['a', 1 + JUMP + 0.1, 0]), me, false)).toEqual([[1, 0], [1 + JUMP + 0.1, 0]]);
  });

  it('none for a flight: it brings its own', () => {
    const fly = { fx: 0, fz: 0, tx: 9, tz: 0, t: 100 };
    expect(puffsFor(m(), m(['a', 1, 1, fly]), me, false)).toEqual([]);
    expect(puffsFor(m(['a', 1, 0, fly]), m(['a', 5, 0]), me, false)).toEqual([]);
  });

  it('a flight: a beam up, a beam down lit just before, and a puff as it touches down', () => {
    clearEffects();
    const f = { fx: 0, fz: 0, tx: 20, tz: 0 };
    flightEffects(f, 1_000);
    const all = effectsNow(1_000);
    expect(all.map((e) => e.kind)).toEqual(['beam', 'beam', 'puff']);
    const [up, down, landing] = all;
    expect(up).toMatchObject({ x: 0, z: 0, from: 1_000 });
    const over = 1_000 + LIFT_MS + glideMs(f);
    expect(down!.from).toBeLessThan(over);
    expect(down).toMatchObject({ x: 20, z: 0 });
    expect(landing).toMatchObject({ x: 20, z: 0 });
    expect(landing!.from).toBeGreaterThan(over + DROP_MS - 200);
    clearEffects();
  });

  it('runs for its time and goes, fading in and out, and never piles up', () => {
    clearEffects();
    puff(1, 1, 5_000);
    const e = effectsNow(5_000)[0]!;
    expect(effectAt(e, 4_999)).toBeNull();
    expect(effectAt(e, 5_000 + PUFF_MS * 0.3)!.alpha).toBeGreaterThan(0.5);
    expect(effectAt(e, 5_000 + PUFF_MS * 0.97)!.alpha).toBeLessThan(0.1);
    expect(effectsNow(5_000 + PUFF_MS)).toHaveLength(0);
    for (let i = 0; i < MAX_EFFECTS + 10; i++) puff(i, 0, 9_000);
    expect(effectsNow(9_000)).toHaveLength(MAX_EFFECTS);
    clearEffects();
  });
});
