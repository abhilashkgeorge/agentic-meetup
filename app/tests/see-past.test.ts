/**
 * You can see past a tree, and you cannot walk through one.
 *
 * THE BUG THIS EXISTS FOR. The shoulder camera pulls itself in whenever something
 * stands between it and your agent, and rides UP as it comes in -- the right answer
 * for a wall, because the only view left from a corner is over the roofs. It asked
 * `blocked()`, which has always filtered by HEIGHT and never by width.
 *
 * That was harmless only by accident. A tree used to carry a wide knee-high collider
 * that stopped you six and a half metres from the bark, so nobody ever stood close
 * enough to a trunk to find out what the camera did about one. The moment that went --
 * so you could walk up and touch a tree, which was the point -- standing against a
 * trunk swung the lens overhead and turned the park into a view of the top of your own
 * head (on the phone, 2026-09-23).
 *
 * So the feet and the lens now ask different questions of the same solid. A wall stops
 * both. A trunk stops only the feet.
 *
 * Negative control, run by hand and recorded in the commit: drop the
 * `if (!wet && s.seeThrough) continue;` line -> the first test fails, and so does the
 * one that walks the camera in behind a tree.
 */
import { describe, expect, it } from 'vitest';
import { WorldSim } from '../src/features/world/sim';
import { gardenSpots } from '../src/features/world/garden';
import { makeCubbon } from '../src/features/world/cubbon';

/** What the shoulder camera asks, from canvas.tsx: lens height and its own padding. */
const WALK_RISE = 0.95;
const CAM_PAD = 0.16;
const FOOT = 0.09;

function simWith(solids: { x: number; z: number; r: number; h: number; seeThrough?: boolean }[]) {
  const s = new WorldSim();
  s.setMap({ central: 'x', areas: {}, solids });
  return s;
}

describe('the lens and the feet', () => {
  it('sees past a tree trunk that still stops a body', () => {
    const trunk = { x: 0, z: 0, r: 0.08, h: 2.4, seeThrough: true };
    const sim = simWith([trunk]);
    expect(sim.seeThrough(0, 0, WALK_RISE, CAM_PAD), 'a trunk blocked the lens').toBe(true);
    expect(sim.standable(0, 0), 'a trunk let a body through').toBe(false);
  });

  it('stops both at a wall', () => {
    const wall = { x: 0, z: 0, r: 0.12, h: 1.4 };
    const sim = simWith([wall]);
    expect(sim.seeThrough(0, 0, WALK_RISE, CAM_PAD)).toBe(false);
    expect(sim.standable(0, 0)).toBe(false);
  });

  it('still lets the lens over a bench, which is below it', () => {
    const bench = { x: 0, z: 0, r: 0.11, h: 0.13 };
    const sim = simWith([bench]);
    expect(sim.seeThrough(0, 0, WALK_RISE, CAM_PAD)).toBe(true);
    expect(sim.standable(0, 0)).toBe(false);
  });

  it('keeps the camera at full length with your back to a real tree', () => {
    // The scene that produced the overhead shot: standing as close to a trunk as the
    // collision allows, with the trunk directly behind the lens.
    const g = makeCubbon();
    const sim = new WorldSim();
    sim.setMap({ central: 'x', areas: {}, solids: gardenSpots(g).solids });
    const t = g.trees[0]!;
    // Every sample along the line back through the trunk must be clear.
    for (let d = 0.07; d <= 0.7; d += 0.07) {
      expect(sim.seeThrough(t.x, t.z + d, WALK_RISE, CAM_PAD),
        `the lens ${d.toFixed(2)} units behind a trunk was blocked`).toBe(true);
    }
    // ...and you still cannot stand in the trunk itself.
    expect(sim.standable(t.x, t.z)).toBe(false);
    // ...but you can stand a metre and a half from its middle, which is the bark.
    expect(sim.standable(t.x, t.z + 0.06 * t.scale + FOOT + 0.01)).toBe(true);
  });
});
