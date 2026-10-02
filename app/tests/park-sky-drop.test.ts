/**
 * The sky drop: how you get to somebody who said yes to talking (flight.ts).
 *
 * WHAT WAS WRONG (the founder, 2026-10-03): the car that drove you over was drawn on your
 * own phone only -- "in the partner's phone I look like I am sitting in an invisible car"
 * -- it drove through people, and a long drive took seven seconds.
 *
 * WHAT IS GUARDED:
 *   - the flight goes up, across and down, in that order, in about two seconds however
 *     far, and clears the tallest tree in the park on the way;
 *   - your own sim flies you there, off the ground, ignoring the stick, and lands you
 *     facing them, saying so once;
 *   - ANOTHER PHONE, told of the flight by the server, flies you the same way: off the
 *     ground, along the same line, landing in the same place -- and one that first sees
 *     it half-way through picks it up half-way through;
 *   - the crowd draws the lift (aAnim.w carries it above the flags, which still read the
 *     same), and the canvas no longer has a car;
 *   - you land beside them, never inside a tree, a bench or somebody;
 *   - near enough to walk (FLY_MIN, about eight metres), you walk: the park bot did a
 *     "flight" of four centimetres beside the person it asked (2026-10-03).
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - flyStep not setting `lift` -> "lifts you off the ground" fails;
 *   - `live` ignoring `fly` -> "another phone flies them too" fails;
 *   - landingBeside ignoring `clear` -> "never lands inside" fails;
 *   - `flies` always true -> "near enough to walk" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER, type Look } from '@clone/shared';
import { DROP_MS, FLY_MIN, GLIDE_MAX_MS, LIFT_MS, SKY, flies, flightAt, flightMs, landingBeside, type Flight } from '../src/features/world/flight';
import { WorldSim } from '../src/features/world/sim';
import { venueGarden, CUBBON_PARK } from '../src/features/world/venue';
import { gardenSpots } from '../src/features/world/garden';
import { MAX_LIFT, animFlags } from '../src/features/world/crowd-gpu';

const look: Look = { ...STARTER, hat: 2 };
const REF = (n: number) => n.toString(16).padStart(32, '0');
const hop: Flight = { fx: 0, fz: 0, tx: 12, tz: 5 };

describe('the flight', () => {
  it('goes up, across and down, in that order, and lands where it said', () => {
    const seen: string[] = [];
    for (let ms = 0; ms <= flightMs(hop) + 100; ms += 20) {
      const p = flightAt(hop, ms).phase;
      if (seen.at(-1) !== p) seen.push(p);
    }
    expect(seen).toEqual(['lift', 'glide', 'drop', 'landed']);
    expect(flightAt(hop, flightMs(hop))).toMatchObject({ x: 12, z: 5, y: 0, phase: 'landed' });
    // Straight up first: still where you stood, off the ground.
    expect(flightAt(hop, LIFT_MS / 2)).toMatchObject({ x: 0, z: 0 });
    expect(flightAt(hop, LIFT_MS / 2).y).toBeGreaterThan(0);
  });

  it('takes about two seconds however far: never longer than two and a half', () => {
    for (const d of [0.5, 5, 30, 150]) {
      const ms = flightMs({ fx: 0, fz: 0, tx: d, tz: 0 });
      expect(ms, `${d} units`).toBeLessThanOrEqual(LIFT_MS + GLIDE_MAX_MS + DROP_MS);
      expect(ms, `${d} units`).toBeLessThanOrEqual(2_500);
      expect(ms, `${d} units`).toBeGreaterThanOrEqual(1_500);
    }
  });

  it('clears the tallest tree in Cubbon Park all the way across', () => {
    const spots = gardenSpots(venueGarden(CUBBON_PARK));
    const tallest = Math.max(...(spots.solids ?? []).filter((s) => s.kind === 'tree').map((s) => s.h));
    expect(tallest).toBeGreaterThan(2);
    expect(SKY, 'the glide goes through the treetops').toBeGreaterThan(tallest);
    for (let ms = LIFT_MS; ms < flightMs(hop) - DROP_MS; ms += 25) expect(flightAt(hop, ms).y).toBeGreaterThan(tallest);
  });
});

describe('flying in your own sim', () => {
  function sim(): WorldSim {
    const s = new WorldSim(5);
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    s.place('you', 0, 0);
    return s;
  }

  it('lifts you off the ground, takes you there, ignores the stick, and lands you once', () => {
    const s = sim();
    let landed = 0;
    let at: [number, number] = [NaN, NaN];
    expect(s.flyTo('you', 12, 5, () => { landed++; at = [s.get('you')!.x, s.get('you')!.z]; })).toBe(true);
    expect(s.flyTo('you', 1, 1), 'a second flight while one is under way').toBe(false);
    let highest = 0;
    for (let i = 0; i < 60 * 3; i++) {
      s.drive('you', 0.3, 0); // a thumb on the stick the whole way
      s.step(1 / 60);
      highest = Math.max(highest, s.get('you')!.lift ?? 0);
    }
    const me = s.get('you')!;
    expect(highest, 'never left the ground').toBeGreaterThan(SKY * 0.9);
    expect(landed).toBe(1);
    expect(me.fly).toBeUndefined();
    expect(me.lift).toBe(0);
    // Landed where it said, the stick held all the way; it moves you only from there.
    expect(Math.hypot(at[0] - 12, at[1] - 5)).toBeLessThan(1e-9);
    expect(me.x, 'the stick did nothing after landing either').toBeGreaterThan(12);
    expect(s.inFlight('you')).toBe(false);
  });

  it('gets you off a bench and off a bicycle to fly', () => {
    const s = sim();
    s.setRiding('you', true);
    s.sitOn('you', { x: 0.05, z: 0.05, facing: 0 });
    for (let i = 0; i < 120; i++) s.step(1 / 60);
    expect(s.get('you')!.state).toBe('sitting');
    s.flyTo('you', 6, 0);
    expect(s.get('you')!.seat).toBeUndefined();
    expect(s.get('you')!.riding).toBe(false);
  });
});

describe('flying, seen from another phone', () => {
  it('another phone flies them too: off the ground, along the line, down where they land', () => {
    const s = new WorldSim(5);
    s.live(REF(1), look, 0, 0, 0, false);
    s.live(REF(1), look, 0, 0, 0, false, false, false, { ...hop, t: 0 });
    let highest = 0;
    for (let i = 0; i < 60 * 3; i++) {
      // The server keeps saying where they are, mid-air (the flier's own sim position).
      if (i % 15 === 0 && i < 60 * 2) {
        const p = flightAt(hop, (i / 60) * 1000);
        s.live(REF(1), look, p.x, p.z, p.heading, false, false, false, { ...hop, t: (i / 60) * 1000 });
      }
      s.step(1 / 60);
      highest = Math.max(highest, s.get(REF(1))!.lift ?? 0);
    }
    const them = s.get(REF(1))!;
    expect(highest, 'seen sliding across the grass').toBeGreaterThan(SKY * 0.9);
    expect(them.fly).toBeUndefined();
    expect(Math.hypot(them.x - 12, them.z - 5)).toBeLessThan(0.05);
  });

  it('picks a flight up half-way through on a phone that only now sees it', () => {
    const s = new WorldSim(5);
    const mid = LIFT_MS + 300;
    s.live(REF(2), look, 3, 1, 0, false, false, false, { ...hop, t: mid });
    const them = s.get(REF(2))!;
    const want = flightAt(hop, mid);
    expect(them.x).toBeCloseTo(want.x, 5);
    expect(them.lift).toBeCloseTo(want.y, 5);
  });

  it('a late word from the server does not drag a flight backwards', () => {
    const s = new WorldSim(5);
    s.live(REF(3), look, 0, 0, 0, false, false, false, { ...hop, t: 0 });
    for (let i = 0; i < 30; i++) s.step(1 / 60); // half a second here
    s.live(REF(3), look, 0, 0, 0, false, false, false, { ...hop, t: 400 });
    expect(s.get(REF(3))!.fly!.ms, 'jumped back to the server\'s slightly older word').toBeGreaterThan(450);
  });
});

describe('drawing the flight', () => {
  it('carries the lift in aAnim.w above the flags, which read the same', () => {
    for (const [ghost, riding, sitting] of [[false, false, false], [true, false, true], [false, true, false]] as const) {
      const w = animFlags(ghost, riding, sitting, 4.73);
      expect(w % 8).toBe(animFlags(ghost, riding, sitting));
      expect(Math.floor(w / 8) / 100).toBeCloseTo(4.73, 5);
      expect(Math.fround(w), 'not exact in a float').toBe(w);
    }
    expect(Math.floor(animFlags(false, false, false, 99) / 8) / 100).toBe(MAX_LIFT);
    expect(animFlags(false, false, false, -1)).toBe(0);
  });

  it('lifts the body in the shader, and the canvas has no car left (SOURCE SHAPE: it needs GL)', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const crowd = strip(readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'crowd-gpu.ts'), 'utf8'));
    expect(crowd).toContain('float crowdLift = floor(aAnim.w / 8.0) / 100.0;');
    expect(crowd).toContain('aPos.x, crowdLift, aPos.y, 1.0);');
    expect(crowd).toContain('arr[at + 7] = animFlags(a.ghost, a.riding === true, a.state === \'sitting\', a.lift);');
    const canvas = strip(readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8'));
    expect(canvas).not.toMatch(/buildCar|rideAt|car-mesh/);
    expect(canvas).toContain('<primitive object={effects.group} />');
  });
});

describe('where you land', () => {
  it('beside them, a step short on the line from where you were', () => {
    const [x, z] = landingBeside([0, 0], [10, 0], () => true);
    expect(x).toBeCloseTo(9.5, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('never lands inside a tree, a bench or somebody: round them to the nearest clear spot', () => {
    // Straight in is blocked; so is everything on that side of them.
    const blocked = (x: number) => x < 10.2;
    const [x, z] = landingBeside([0, 0], [10, 0], (px) => !blocked(px));
    expect(blocked(x), 'landed inside something').toBe(false);
    expect(Math.hypot(x - 10, z)).toBeLessThanOrEqual(1.0 + 1e-9);
    // In the real park: next to a tree trunk, you land clear of it.
    const g = venueGarden(CUBBON_PARK);
    const s = new WorldSim(1);
    s.setMap(gardenSpots(g));
    const tree = g.trees[0]!;
    const near: [number, number] = [tree.x + 0.3, tree.z];
    const [lx, lz] = landingBeside([tree.x - 5, tree.z], near, (px, pz) => s.standable(px, pz));
    expect(s.standable(lx, lz), 'landed inside a tree').toBe(true);
  });
});

describe('near enough to walk', () => {
  it('walks over instead of lifting off on the spot, and flies only past FLY_MIN', () => {
    expect(flies([0, 0], [0.04, 0.02]), 'a lift on the spot').toBe(false);
    expect(flies([0, 0], [FLY_MIN * 0.9, 0])).toBe(false);
    expect(flies([0, 0], [FLY_MIN, 0])).toBe(true);
    expect(FLY_MIN * 8.1, 'metres').toBeLessThanOrEqual(10);
    const s = new WorldSim(5);
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    s.place('you', 0, 0);
    expect(s.walkTo('you', 0.6, 0)).toBe(true);
    expect(s.get('you')!.state).toBe('walking');
    for (let i = 0; i < 60 * 3; i++) s.step(1 / 60);
    const me = s.get('you')!;
    expect(me.fly).toBeUndefined();
    expect(me.lift ?? 0).toBe(0);
    expect(Math.hypot(me.x - 0.6, me.z), 'stopped short of the spot').toBeLessThan(0.1);
  });

  it('the phone walks when near, and flies when not (SOURCE SHAPE: the hook needs React Native)', () => {
    const presence = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-presence.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(presence).toMatch(/if \(!flies\(\[me\.x, me\.z\], \[lx, lz\]\)\) \{ venueSim\.walkTo\('you', lx, lz\); done\(\); return; \}/);
    expect(presence.indexOf('venueSim.walkTo(')).toBeLessThan(presence.indexOf('venueSim.flyTo('));
  });
});
