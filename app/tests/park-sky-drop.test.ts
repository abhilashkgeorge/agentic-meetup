/**
 * The emergency pickup: how you get to somebody who said yes to talking (flight.ts) --
 * and the parachute in, and the plane away, for coming and going.
 *
 * WHAT WAS WRONG (the founder, 2026-10-03): first a car drawn on your own phone only --
 * "in the partner's phone I look like I am sitting in an invisible car" -- then a beam
 * of light and a puff of smoke: "doesn't look good ... like the emergency pickup feature
 * in PUBG". There a balloon rises on its line, a plane snags it and carries whoever
 * hangs on it, and each comes down by parachute.
 *
 * Since 2026-10-04 the balloon is a plane (the founder: "show a good aeroplane on the sky
 * dropping the cable then attaching to the user"): tests/pickup-plane.test.ts.
 *
 * WHAT IS GUARDED:
 *   - the pickup goes approach, cable, yank, carry, chute, settle, in that order, in four
 *     and a half seconds at most however far: the plane in first, its cable down to you,
 *     you off the ground under it, carried over the tallest tree, let go and down by
 *     parachute where it said;
 *   - your own sim flies you there, off the ground, ignoring the stick, and lands you
 *     once; ANOTHER PHONE, told of it by the server, flies you the same way, and one that
 *     first sees it half-way through picks it up half-way through; a late word about a
 *     flight already down does not take off again;
 *   - coming into the park is a parachute down onto your spot, and going is the plane
 *     taking you up and out of sight, after which you are gone from the sim;
 *   - the crowd draws the lift, the canvas draws the gear, and has no car;
 *   - you land beside them, never inside a tree, a bench or somebody; near enough, walk.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - flyStep not setting `lift` -> "lifts you off the ground" fails;
 *   - `live` ignoring `fly` -> "another phone flies them too" fails;
 *   - the carry at ground height -> "clears the tallest tree" fails;
 *   - liftAway without removing at the end -> "taken up and gone" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER, type Look } from '@clone/shared';
import {
  CARRY_MAX_MS, CHUTE_MS, DROP_MS, DROP_Y, FLY_MIN, PASS_Y, SETTLE_MS, SKY, T_CABLE, T_CARRY, T_HOOK,
  flies, flightAt, flightMs, landingBeside, type Flight,
} from '../src/features/world/flight';
import { WorldSim } from '../src/features/world/sim';
import { venueGarden, CUBBON_PARK } from '../src/features/world/venue';
import { gardenSpots } from '../src/features/world/garden';
import { MAX_LIFT, POSE, animFlags } from '../src/features/world/crowd-gpu';

const look: Look = { ...STARTER, hat: 2 };
const REF = (n: number) => n.toString(16).padStart(32, '0');
const hop: Flight = { fx: 0, fz: 0, tx: 12, tz: 5 };
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the pickup', () => {
  it('goes approach, cable, yank, carry, chute, settle -- and lands where it said', () => {
    const seen: string[] = [];
    for (let ms = 0; ms <= flightMs(hop) + 100; ms += 20) {
      const p = flightAt(hop, ms).phase;
      if (seen.at(-1) !== p) seen.push(p);
    }
    expect(seen).toEqual(['approach', 'cable', 'yank', 'carry', 'chute', 'settle', 'landed']);
    expect(flightAt(hop, flightMs(hop))).toMatchObject({ x: 12, z: 5, y: 0, phase: 'landed', chute: 0, plane: null, cable: null });
  });

  it('the plane comes in first, and you are still standing until its cable has you', () => {
    for (const ms of [T_CABLE * 0.3, T_CABLE * 0.9, (T_CABLE + T_HOOK) / 2, T_HOOK - 5]) {
      const p = flightAt(hop, ms);
      expect(p.y, `off the ground at ${ms} ms, before the cable had them`).toBe(0);
      expect(p.roped).toBe(false);
      expect(p.plane, `no plane at ${ms} ms`).not.toBeNull();
      expect(p.plane!.y, 'the plane not up in the sky').toBeGreaterThanOrEqual(PASS_Y);
    }
    expect(flightAt(hop, T_HOOK + 5).roped).toBe(true);
  });

  it('carries you hanging under the plane, over the tallest tree in Cubbon Park', () => {
    const spots = gardenSpots(venueGarden(CUBBON_PARK));
    const tallest = Math.max(...(spots.solids ?? []).filter((s) => s.kind === 'tree').map((s) => s.h));
    expect(tallest).toBeGreaterThan(2);
    for (let ms = T_CARRY; ms < T_CARRY + 500; ms += 25) {
      const p = flightAt(hop, ms);
      expect(p.phase).toBe('carry');
      expect(p.y, 'through the treetops').toBeGreaterThan(tallest);
      expect(p.roped).toBe(true);
      expect(p.plane!.y, 'the plane is not above them').toBeGreaterThan(p.y + 1);
    }
    expect(SKY).toBeGreaterThan(tallest);
  });

  it('lets go over them: the parachute opens, the cable is off them, and they come down', () => {
    const start = flightMs(hop) - SETTLE_MS - CHUTE_MS;
    const mid = flightAt(hop, start + CHUTE_MS / 2);
    expect(mid.phase).toBe('chute');
    expect(mid.roped, 'still on the cable coming down').toBe(false);
    expect(mid.chute, 'no parachute').toBeGreaterThan(0.9);
    expect(Math.hypot(mid.x - 12, mid.z - 5), 'not over where they land').toBeLessThan(0.15);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(SKY);
  });

  it('takes four and a half seconds at most however far', () => {
    for (const d of [FLY_MIN, 5, 30, 150]) {
      const ms = flightMs({ fx: 0, fz: 0, tx: d, tz: 0 });
      expect(ms, `${d} units`).toBeLessThanOrEqual(T_CARRY + CARRY_MAX_MS + CHUTE_MS + SETTLE_MS);
      expect(ms, `${d} units`).toBeLessThanOrEqual(4_500);
      expect(ms, `${d} units`).toBeGreaterThanOrEqual(3_300);
    }
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
    let gear = false;
    for (let i = 0; i < 60 * 5; i++) {
      s.drive('you', 0.3, 0); // a thumb on the stick the whole way
      s.step(1 / 60);
      highest = Math.max(highest, s.get('you')!.lift ?? 0);
      gear ||= !!s.get('you')!.rig?.plane;
    }
    const me = s.get('you')!;
    expect(highest, 'never left the ground').toBeGreaterThan(SKY * 0.9);
    expect(gear, 'flew with no plane to draw').toBe(true);
    expect(landed).toBe(1);
    expect(me.fly).toBeUndefined();
    expect(me.rig).toBeUndefined();
    expect(me.lift).toBe(0);
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

describe('coming and going', () => {
  it('comes into the park by parachute, onto the spot, and the parachute folds away', () => {
    const s = new WorldSim(5);
    s.live(REF(4), look, 3, 2, 0, false);
    expect(s.dropIn(REF(4), 3, 2)).toBe(true);
    const a = s.get(REF(4))!;
    expect(a.lift).toBeCloseTo(DROP_Y, 5);
    expect(a.rig?.chute).toBe(1);
    expect(a.rig?.plane).toBeNull();
    for (let i = 0; i < 60 * 2; i++) s.step(1 / 60);
    expect(a.fly).toBeUndefined();
    expect([a.x, a.z, a.lift]).toEqual([3, 2, 0]);
    expect(DROP_MS + SETTLE_MS).toBeLessThan(2_000);
  });

  it('goes by plane: taken up and gone from the sim', () => {
    const s = new WorldSim(5);
    s.live(REF(6), look, 1, 1, 0, false);
    expect(s.liftAway(REF(6))).toBe(true);
    expect(s.leaving(REF(6))).toBe(true);
    let highest = 0;
    for (let i = 0; i < 60 * 4 && s.get(REF(6)); i++) {
      s.step(1 / 60);
      highest = Math.max(highest, s.get(REF(6))?.lift ?? 0);
    }
    expect(highest, 'never went up').toBeGreaterThan(SKY);
    expect(s.get(REF(6)), 'still in the sim after going').toBeUndefined();
  });
});

describe('flying, seen from another phone', () => {
  it('another phone flies them too: off the ground, along the line, down where they land', () => {
    const s = new WorldSim(5);
    s.live(REF(1), look, 0, 0, 0, false);
    s.live(REF(1), look, 0, 0, 0, false, false, false, { ...hop, t: 0 });
    let highest = 0;
    for (let i = 0; i < 60 * 5; i++) {
      if (i % 15 === 0 && i < 60 * 3) {
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
    const mid = T_CARRY + 300;
    s.live(REF(2), look, 3, 1, 0, false, false, false, { ...hop, t: mid });
    const them = s.get(REF(2))!;
    const want = flightAt(hop, mid);
    expect(them.x).toBeCloseTo(want.x, 5);
    expect(them.lift).toBeCloseTo(want.y, 5);
  });

  it('a late word from the server does not drag a flight backwards', () => {
    const s = new WorldSim(5);
    s.live(REF(3), look, 0, 0, 0, false, false, false, { ...hop, t: 0 });
    for (let i = 0; i < 30; i++) s.step(1 / 60);
    s.live(REF(3), look, 0, 0, 0, false, false, false, { ...hop, t: 400 });
    expect(s.get(REF(3))!.fly!.ms, 'jumped back to the server\'s slightly older word').toBeGreaterThan(450);
  });

  it('a late word about a flight already down does not take off again', () => {
    const s = new WorldSim(5);
    s.live(REF(5), look, 0, 0, 0, false, false, false, { ...hop, t: 0 });
    for (let i = 0; i < 60 * 5; i++) s.step(1 / 60);
    expect(s.get(REF(5))!.fly).toBeUndefined();
    s.live(REF(5), look, 12, 5, 0, false, false, false, { ...hop, t: flightMs(hop) - 400 });
    s.step(1 / 60);
    expect(s.get(REF(5))!.lift ?? 0, 'back up in the air').toBe(0);
  });
});

describe('drawing the flight', () => {
  it('carries the lift in aAnim.w above the flags, which read the same', () => {
    for (const pose of [POSE.stand, POSE.sit, POSE.ride, POSE.rig]) {
      const w = animFlags(false, pose, 4.73);
      expect(w % 16).toBe(animFlags(false, pose));
      expect(Math.floor(w / 16) / 100).toBeCloseTo(4.73, 5);
      expect(Math.fround(w), 'not exact in a float').toBe(w);
    }
    expect(Math.floor(animFlags(false, POSE.stand, 99) / 16) / 100).toBe(MAX_LIFT);
    expect(animFlags(false, POSE.stand, -1)).toBe(0);
  });

  it('lifts the body in the shader, draws the gear, and has no car (SOURCE SHAPE: it needs GL)', () => {
    const crowd = strip(readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'crowd-gpu.ts'), 'utf8'));
    expect(crowd).toContain('float crowdLift = floor(aAnim.w / 16.0) / 100.0;');
    expect(crowd).toContain('aPos.x, crowdLift, aPos.y, 1.0);');
    const canvas = strip(readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8'));
    expect(canvas).not.toMatch(/buildCar|rideAt|car-mesh|effectsNow|buildEffects/);
    expect(canvas).toContain('rigs.update(shown, bodied.current, {');
    expect(crowd).toContain('arr[at + 7] = animFlags(a.ghost, pose, a.lift);');
    expect(canvas).toContain('<primitive object={rigs.group} />');
  });
});

describe('where you land', () => {
  it('not knowing which way they look: beside them, a step short on the line from where you were', () => {
    const [x, z] = landingBeside([0, 0], [10, 0], () => true);
    expect(x).toBeCloseTo(9.5, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('in front of them, where they look -- not behind them, between them and their camera', () => {
    // Arjun flew in from behind Kavya (the two phones, 2026-10-04): she looks along +x,
    // away from him; the line from where he was put him at her back, under her camera.
    const looksAlongX = Math.atan2(1, 0);
    const [x, z] = landingBeside([0, 0], [10, 0], () => true, 0.5, looksAlongX);
    expect(x, 'landed behind her').toBeCloseTo(10.5, 5);
    expect(z).toBeCloseTo(0, 5);
    // Looking back at him: the same spot as the line from where he was.
    const [bx] = landingBeside([0, 0], [10, 0], () => true, 0.5, Math.atan2(-1, 0));
    expect(bx).toBeCloseTo(9.5, 5);
    // In front blocked: round them, still clear, still close.
    const [cx, cz] = landingBeside([0, 0], [10, 0], (px) => px < 10.2, 0.5, looksAlongX);
    expect(cx < 10.2).toBe(true);
    expect(Math.hypot(cx - 10, cz)).toBeLessThanOrEqual(1.0 + 1e-9);
  });

  it('the pickup lands you where your partner looks (SOURCE SHAPE: the park on a phone)', () => {
    const presence = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-presence.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(presence).toContain('const facing = s.people.get(s.partner!.ref)?.facing ?? null;');
    expect(presence).toContain('landingBeside([me.x, me.z], to, clear, undefined, facing);');
  });

  it('never lands inside a tree, a bench or somebody: round them to the nearest clear spot', () => {
    const blocked = (x: number) => x < 10.2;
    const [x, z] = landingBeside([0, 0], [10, 0], (px) => !blocked(px));
    expect(blocked(x), 'landed inside something').toBe(false);
    expect(Math.hypot(x - 10, z)).toBeLessThanOrEqual(1.0 + 1e-9);
    const g = venueGarden(CUBBON_PARK);
    const s = new WorldSim(1);
    s.setMap(gardenSpots(g));
    const tree = g.trees[0]!;
    const near: [number, number] = [tree.x + 0.3, tree.z];
    const [lx, lz] = landingBeside([tree.x - 5, tree.z], near, (px, pz) => s.standable(px, pz));
    expect(s.standable(lx, lz), 'landed inside a tree').toBe(true);
  });

  it('near enough to walk: walks over instead of a pickup on the spot', () => {
    expect(flies([0, 0], [0.04, 0.02]), 'a lift on the spot').toBe(false);
    expect(flies([0, 0], [FLY_MIN * 0.9, 0])).toBe(false);
    expect(flies([0, 0], [FLY_MIN, 0])).toBe(true);
    const s = new WorldSim(5);
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
    s.place('you', 0, 0);
    expect(s.walkTo('you', 0.6, 0)).toBe(true);
    for (let i = 0; i < 60 * 3; i++) s.step(1 / 60);
    const me = s.get('you')!;
    expect(me.fly).toBeUndefined();
    expect(Math.hypot(me.x - 0.6, me.z), 'stopped short of the spot').toBeLessThan(0.1);
    const presence = strip(readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-presence.ts'), 'utf8'));
    expect(presence).toMatch(/if \(!flies\(\[me\.x, me\.z\], \[lx, lz\]\)\) \{ venueSim\.walkTo\('you', lx, lz\); done\(\); return; \}/);
  });
});
