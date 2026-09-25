/**
 * The town's choreography, with no renderer in the room.
 *
 * sim.ts imports nothing from react-native or three, on purpose: this is where "your
 * agent walks over, they stand together, they part" is checked, and where a 2D
 * renderer would plug in if the 3D one ever fails on a phone. There is no verdict in
 * it any more: parting shows the same mark for every pair.
 */
import { describe, expect, it } from 'vitest';
import { HOME, WorldSim, type MapSpots } from '../src/features/world/sim';
import { lookFor, pointInPolygon } from '@clone/shared';

const town = () => {
  const s = new WorldSim(42);
  s.upsert([{ ref: 'you', kind: 'you', seed: 7 }, { ref: 'a', kind: 'stranger', seed: 1 }, { ref: 'b', kind: 'met', seed: 2 }]);
  return s;
};
const run = (s: WorldSim, seconds: number) => { for (let i = 0; i < seconds * 30; i++) s.step(1 / 30); };
/**
 * Run until something is true, up to a limit, and return how long it took.
 *
 * Most of these tests used to say "run for fifteen seconds, then assert they arrived",
 * which quietly encoded how fast an agent walks -- so slowing everybody from eleven
 * kilometres an hour to five broke seven tests that were not about speed at all.
 * Waiting for the thing itself says what the test means and survives the next change
 * of pace; the limit is there so a genuine failure still fails.
 */
const until = (s: WorldSim, done: () => boolean, limit = 120): number => {
  for (let i = 0; i < limit * 30; i++) { if (done()) return i / 30; s.step(1 / 30); }
  return done() ? limit : Infinity;
};
const dist = (s: WorldSim, a: string, b: string) => {
  const A = s.get(a)!; const B = s.get(b)!; return Math.hypot(A.x - B.x, A.z - B.z);
};

describe('the town', () => {
  it('is the same town for the same seed', () => {
    const a = town(); const b = town();
    run(a, 20); run(b, 20);
    expect(a.agents().map((x) => [x.ref, x.x.toFixed(3), x.z.toFixed(3)]))
      .toEqual(b.agents().map((x) => [x.ref, x.x.toFixed(3), x.z.toFixed(3)]));
  });

  it('keeps your agent at home while strangers wander', () => {
    const s = town();
    run(s, 30);
    const you = s.get('you')!;
    expect([you.x, you.z]).toEqual([HOME[0], HOME[1]]);
    const a = s.get('a')!;
    expect(Math.hypot(a.x - a.tx, a.z - a.tz) < 0.2 || a.state === 'walking').toBe(true);
  });

  it('walks your agent over to them, they stand together, then part with the same mark as anybody', () => {
    const s = town();
    const b0 = { ...s.get('b')! };
    s.meet('you', 'b');
    expect(until(s, () => s.get('you')!.state === 'talking')).toBeLessThan(60);
    // The visited stayed; the visitor came within a metre; both show dots.
    expect(Math.hypot(s.get('b')!.x - b0.x, s.get('b')!.z - b0.z)).toBeLessThan(0.01);
    expect(dist(s, 'you', 'b')).toBeLessThan(1.1);
    expect(s.get('you')!.bubble).toBe('dots');
    s.parted('you', 'b');
    expect(until(s, () => s.get('you')!.bubble === 'met')).toBeLessThan(5);
    expect(s.get('b')!.bubble).toBe('met');
    // ...and your agent went home, which from anywhere in the plaza is a stroll.
    const you = s.get('you')!;
    expect(until(s, () => Math.hypot(you.x - HOME[0], you.z - HOME[1]) < 0.2)).toBeLessThan(90);
    expect(dist(s, 'you', 'b')).toBeGreaterThan(1.5);
  });

  it('sends a passed person off the square', () => {
    const s = town();
    s.pass('a');
    expect(until(s, () => s.get('a')!.state === 'gone')).toBeLessThan(120);
  });

  it('visits three people one at a time, in the order it was told', () => {
    const s = town();
    s.upsert([{ ref: 'c', kind: 'met', seed: 3 }]);
    s.meet('you', 'a'); s.meet('you', 'b'); s.meet('you', 'c');
    const you = s.get('you')!;
    expect(you.partner).toBe('a');
    // b and c wait their turn: nobody is left "approaching" nobody.
    expect(s.get('b')!.state).not.toBe('approaching');
    expect(s.get('c')!.state).not.toBe('approaching');
    expect(until(s, () => you.state === 'talking')).toBeLessThan(60);
    expect(dist(s, 'you', 'a')).toBeLessThan(1.2);
    // Parted from a, then straight on to b -- not home.
    s.parted('you', 'a');
    run(s, 6);
    expect(you.partner).toBe('b');
    expect(s.get('b')!.partner).toBe('you');
    expect(until(s, () => you.state === 'talking')).toBeLessThan(60);
    expect(dist(s, 'you', 'b')).toBeLessThan(1.2);
    // The roster stopped saying b was talking: same thing, on to c.
    s.settle('b');
    expect(you.partner).toBe('c');
    expect(until(s, () => dist(s, 'you', 'c') < 1.2)).toBeLessThan(60);
    // Last one done: home.
    s.parted('you', 'c');
    expect(until(s, () => you.state === 'idle'
      && Math.hypot(you.x - HOME[0], you.z - HOME[1]) < 0.2)).toBeLessThan(90);
  });

  /**
   * A round holds no conversation now (2026-09-23), so its cues land within a second
   * of each other: met, met, met, then a parting for each, then done -- all before
   * your agent has taken a step. The old sim parted on the cue and the recall dropped
   * the queue, so your agent turned round and went home having met nobody.
   *
   * Negative control: put back `recall` as `visits.delete; settle` -> `seen` is empty.
   */
  it('plays out every meeting of a round that finished before your agent arrived', () => {
    const s = town();
    s.upsert([{ ref: 'c', kind: 'met', seed: 3 }]);
    for (const r of ['a', 'b', 'c']) s.meet('you', r);
    for (const r of ['a', 'b', 'c']) s.parted('you', r);
    s.recall('you');
    const you = s.get('you')!;
    const seen: string[] = [];
    const apart: number[] = [];
    until(s, () => {
      if (you.bubble === 'met' && you.partner && seen.at(-1) !== you.partner) {
        seen.push(you.partner);
        apart.push(dist(s, 'you', you.partner));
      }
      return seen.length === 3 && you.state !== 'parting';
    }, 240);
    expect(seen).toEqual(['a', 'b', 'c']);
    // Each parting came after they had actually stood together, not mid-walk.
    for (const d of apart) expect(d).toBeLessThan(1.2);
    expect(until(s, () => you.state === 'idle'
      && Math.hypot(you.x - HOME[0], you.z - HOME[1]) < 0.2)).toBeLessThan(90);
  });

  it('comes home on a recall, visits queued or not, and leaves the other to wander', () => {
    const s = town();
    s.meet('you', 'a'); s.meet('you', 'b');
    expect(until(s, () => s.get('you')!.state === 'talking')).toBeLessThan(60);
    s.recall('you');
    const you = s.get('you')!;
    expect(you.partner).toBeNull();
    expect(you.bubble).toBeNull();
    expect(until(s, () => you.state === 'idle'
      && Math.hypot(you.x - HOME[0], you.z - HOME[1]) < 0.2)).toBeLessThan(90);
    // b was never visited, and a is not stuck talking to nobody.
    expect(s.get('b')!.partner).toBeNull();
    expect(s.get('a')!.state).not.toBe('talking');
  });

  it('does not strand your agent when the person it was walking to leaves the square', () => {
    const s = town();
    s.meet('you', 'a');
    run(s, 1);
    expect(s.get('you')!.state).toBe('approaching');
    s.remove('a');
    const you = s.get('you')!;
    // One step for the sim to notice they have gone, then it heads home.
    s.step(1 / 30);
    expect(you.partner).toBeNull();
    expect(until(s, () => Math.hypot(you.x - HOME[0], you.z - HOME[1]) < 0.2)).toBeLessThan(90);
  });

  it('keeps a practice profile see-through once it has been met', () => {
    const s = town();
    s.upsert([{ ref: 'g', kind: 'practice', seed: 9 }]);
    expect(s.get('g')!.ghost).toBe(true);
    // The roster now lists them as met, and says they are still not a real person.
    s.upsert([{ ref: 'g', kind: 'met', seed: 9, ghost: true }]);
    expect(s.get('g')!.kind).toBe('met');
    expect(s.get('g')!.ghost).toBe(true);
    // Without the flag, the kind decides -- and 'met' is a real person.
    s.upsert([{ ref: 'h', kind: 'met', seed: 10 }]);
    expect(s.get('h')!.ghost).toBe(false);
  });

  it('wears the character it is given, and changes it on a refresh without moving', () => {
    const s = town();
    // Nothing given: a seeded character, stable.
    expect(s.get('a')!.look).toEqual(lookFor(1));
    run(s, 3);
    const before = { x: s.get('a')!.x, z: s.get('a')!.z };
    s.upsert([{ ref: 'a', kind: 'stranger', seed: 1, look: { ...lookFor(1), head: 6 } }]);
    expect(s.get('a')!.look.head).toBe(6);
    expect([s.get('a')!.x, s.get('a')!.z]).toEqual([before.x, before.z]);
  });
});

/**
 * A map of three triangles, far apart, with the spots well inside each. The sim only
 * ever sees spots, homes, centres and radii; the polygons are the test's own check.
 */
const TRI = {
  a: [[0, 0], [8, 0], [4, 7]] as [number, number][],
  b: [[30, 0], [38, 0], [34, 7]] as [number, number][],
  c: [[0, 30], [8, 30], [4, 37]] as [number, number][],
};
const inside = (poly: [number, number][], n = 6): [number, number][] => {
  const [cx, cz] = [(poly[0]![0] + poly[1]![0] + poly[2]![0]) / 3, (poly[0]![1] + poly[1]![1] + poly[2]![1]) / 3];
  return Array.from({ length: n }, (_, i) => [cx + Math.cos(i) * 1.2, cz + Math.sin(i) * 1.2]);
};
const fixture = (): MapSpots => ({
  central: 'a',
  areas: Object.fromEntries(Object.entries(TRI).map(([id, poly]) => {
    const spots = inside(poly);
    const centre = spots[0]!;
    return [id, { home: spots[0]!, centre, radius: 5, spots, polygon: poly }];
  })),
});
const mapped = () => { const s = new WorldSim(9); s.setMap(fixture()); return s; };

describe('on the map', () => {
  it('stands a stranger in the neighbourhood they were given, every time', () => {
    const s = mapped();
    s.upsert(Array.from({ length: 200 }, (_, i) => ({ ref: `p${i}`, kind: 'stranger' as const, seed: i, area: 'b' })));
    for (const a of s.agents()) {
      expect(a.area).toBe('b');
      expect(pointInPolygon([a.x, a.z], TRI.b), `${a.ref} at ${a.x},${a.z}`).toBe(true);
    }
    // ...and wandering keeps them there.
    run(s, 40);
    for (const a of s.agents()) expect(pointInPolygon([a.x, a.z], TRI.b), a.ref).toBe(true);
  });

  it('puts you at your tile\'s home, and in the central tile with no area', () => {
    const s = mapped();
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'c' }, { ref: 'n', kind: 'stranger', seed: 1, area: null }]);
    expect([s.get('you')!.x, s.get('you')!.z]).toEqual(s.home('c'));
    expect(s.homeOf('you')).toEqual(s.home('c'));
    expect(pointInPolygon([s.get('n')!.x, s.get('n')!.z], TRI.a)).toBe(true);
    expect(s.homeOf('nobody')).toEqual(s.home(null));
  });

  it('walks to the new neighbourhood when the area changes, and never mid-visit', () => {
    const s = mapped();
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'a' }, { ref: 'm', kind: 'met', seed: 2, area: 'a' }]);
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'c' }]);
    expect(s.get('you')!.state).toBe('walking');
    const you = s.get('you')!;
    // Thirty units at a stroll is a couple of minutes; it is a walk, not a warp.
    expect(until(s, () => pointInPolygon([you.x, you.z], TRI.c), 240)).toBeLessThan(240);
    // A refresh that says nothing about the area leaves it alone.
    s.upsert([{ ref: 'you', kind: 'you', seed: 7 }]);
    expect(you.area).toBe('c');
    // Mid-visit: the area is remembered, the walk is not interrupted.
    s.meet('m', 'you');
    run(s, 1);
    s.upsert([{ ref: 'm', kind: 'met', seed: 2, area: 'b' }]);
    expect(s.get('m')!.state).toBe('approaching');
    expect(s.get('m')!.area).toBe('b');
  });

  it('hurries a cross-town visit up to a run, and never faster', () => {
    // A visit has a deadline -- the conversation is already happening -- so a long
    // approach speeds up. A WANDER has no deadline, and capping that by distance is
    // what had everyone crossing a park at motorway speed (2026-09-22).
    // Control: drop the RUN_MAX clamp and the speed assertion below fails at ~3 u/s.
    const s = mapped();
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'a' }, { ref: 'far', kind: 'met', seed: 3, area: 'b' }]);
    expect(dist(s, 'you', 'far')).toBeGreaterThan(20);
    s.meet('you', 'far');
    const you = s.get('you')!;
    expect(you.speed, 'hurried, because somebody is waiting').toBeGreaterThan(0.5);
    expect(you.speed, 'but never faster than a run').toBeLessThanOrEqual(0.84);
    expect(until(s, () => you.state === 'talking', 90)).toBeLessThan(90);
    expect(dist(s, 'you', 'far')).toBeLessThan(1.1);

  });

  it('never lets a crowd going nowhere break into a run', () => {
    // The founder's bug, as he saw it: "why are all the agents speedrunning . they
    // are walking at around 200kmph" (2026-09-22). One agent is not enough to catch
    // it -- a wander that happens to pick a spot two units away is slow whatever the
    // rule is -- so watch forty of them for two minutes and keep the worst.
    // Control: pass `hurried` from `wander()` in sim.ts and the max here is ~0.7,
    // three and a half times a stroll. This is the test that edit slipped past before.
    const s = mapped();
    s.upsert(Array.from({ length: 40 }, (_, i) => ({ ref: `p${i}`, kind: 'stranger' as const, seed: i, area: 'b' })));
    let fastest = 0; let walked = 0;
    for (let i = 0; i < 120 * 30; i++) {
      s.step(1 / 30);
      for (const a of s.agents()) {
        if (a.state !== 'walking' || a.partner) continue;
        walked++;
        fastest = Math.max(fastest, a.speed);
      }
    }
    expect(walked, 'nobody moved, so this proved nothing').toBeGreaterThan(10000);
    // 0.2 units a second is about 5 km/h at PERSON scale. Allow a hair for rounding.
    expect(fastest, 'somebody was sprinting across the park').toBeLessThanOrEqual(0.21);
  });

  it('sends a passed person out of their own neighbourhood and marks them gone', () => {
    const s = mapped();
    s.upsert([{ ref: 'p', kind: 'stranger', seed: 4, area: 'c' }]);
    s.pass('p');
    expect(until(s, () => s.get('p')!.state === 'gone', 180)).toBeLessThan(180);
    expect(pointInPolygon([s.get('p')!.x, s.get('p')!.z], TRI.c)).toBe(false);
  });

  it('uses every standing spot before it uses one twice, and stacks nobody', () => {
    // Control: pick a spot at random per person -> some spots go unused and several
    // people share one, which is the crowd crush seen on the phone (2026-09-22).
    const s = mapped();
    const spots = fixture().areas.b!.spots;
    s.upsert(Array.from({ length: spots.length * 2 }, (_, i) => ({ ref: `q${i}`, kind: 'stranger' as const, seed: i, area: 'b' })));
    const people = s.agents();
    const nearest = (p: { x: number; z: number }) => Math.min(...spots.map((t) => Math.hypot(p.x - t[0], p.z - t[1])));
    const used = new Set(people.map((p) => spots.findIndex((t) => Math.hypot(p.x - t[0], p.z - t[1]) === nearest(p))));
    expect(used.size, 'every spot has somebody at it').toBe(spots.length);
    for (const a of people) {
      expect(pointInPolygon([a.x, a.z], TRI.b), `${a.ref} left the tile`).toBe(true);
      for (const b of people) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.ref} on top of ${b.ref}`).toBeGreaterThan(0.01);
    }
  });

  it('walks around a building instead of through it', () => {
    // A wall of solid across the direct line between two spots. Control: return false
    // from Ground.blocked and the walker goes straight through the middle of it.
    const f = fixture();
    const from: [number, number] = [2, 1];
    const to: [number, number] = [6, 1];
    // Solid, with no gap to wedge in: overlapping circles from z -1 to z 2, so the
    // only way to the far side is round one end.
    const wall = Array.from({ length: 13 }, (_, i) => ({ x: 4, z: -1 + i * 0.25, r: 0.3, h: 1 }));
    const s = new WorldSim(3);
    s.setMap({ ...f, solids: wall, areas: { ...f.areas, a: { ...f.areas.a!, spots: [from], home: from } } });
    s.upsert([{ ref: 'w', kind: 'stranger', seed: 1, area: 'a' }]);
    const a = s.get('w')!;
    a.x = from[0]; a.z = from[1]; a.tx = to[0]; a.tz = to[1]; a.state = 'walking'; a.speed = 1;
    const seen: [number, number][] = [];
    for (let i = 0; i < 900; i++) { s.step(1 / 30); seen.push([a.x, a.z]); }
    // Never inside the wall...
    for (const [x, z] of seen) {
      for (const w of wall) expect(Math.hypot(x - w.x, z - w.z), `walked into ${w.x},${w.z}`).toBeGreaterThan(0.3);
    }
    // ...and it got past it rather than stopping dead at the near face.
    expect(Math.max(...seen.map((p) => p[0]))).toBeGreaterThan(4.6);
  });

  it('does not walk on water', () => {
    const f = fixture();
    const lake: [number, number][] = [[3, 0], [5, 0], [5, 2], [3, 2]];
    const s = new WorldSim(4);
    s.setMap({ ...f, lakes: [lake], areas: { ...f.areas, a: { ...f.areas.a!, spots: [[2, 1]], home: [2, 1] } } });
    s.upsert([{ ref: 'w', kind: 'stranger', seed: 1, area: 'a' }]);
    const a = s.get('w')!;
    a.x = 2; a.z = 1; a.tx = 6; a.tz = 1; a.state = 'walking'; a.speed = 1;
    for (let i = 0; i < 400; i++) {
      s.step(1 / 30);
      expect(pointInPolygon([a.x, a.z], lake), `in the lake at ${a.x},${a.z}`).toBe(false);
    }
  });

  it('lets the camera see over a low roof but not through a tower', () => {
    // Control: make seeThrough call blocked() with above 0 and the bungalow stops the
    // lens, which is what pulled the camera in for every building in the city.
    const f = fixture();
    const s = new WorldSim(8);
    s.setMap({ ...f, solids: [{ x: 4, z: 4, r: 0.5, h: 0.3 }, { x: 8, z: 8, r: 0.5, h: 2 }],
      lakes: [[[10, 10], [12, 10], [12, 12], [10, 12]]] });
    // On the ground, both are in the way and so is the lake.
    expect(s.standable(4, 4)).toBe(false);
    expect(s.standable(8, 8)).toBe(false);
    expect(s.standable(11, 11)).toBe(false);
    // A lens at 0.6 rides over the low one, is stopped by the tall one, and can
    // always see across water.
    expect(s.seeThrough(4, 4, 0.6, 0.1)).toBe(true);
    expect(s.seeThrough(8, 8, 0.6, 0.1)).toBe(false);
    expect(s.seeThrough(11, 11, 0.6, 0.1)).toBe(true);
    // Down at ankle height the low one is in the way again.
    expect(s.seeThrough(4, 4, 0.1, 0.1)).toBe(false);
    // A wider lens keeps further off the corners.
    expect(s.seeThrough(8.65, 8, 0.6, 0.02)).toBe(true);
    expect(s.seeThrough(8.65, 8, 0.6, 0.3)).toBe(false);
  });

  it('tells you where a person could stand', () => {
    const f = fixture();
    const s = new WorldSim(5);
    s.setMap({ ...f, solids: [{ x: 4, z: 4, r: 0.5, h: 1 }], lakes: [[[10, 10], [12, 10], [12, 12], [10, 12]]] });
    expect(s.standable(4, 4)).toBe(false);
    expect(s.standable(11, 11)).toBe(false);
    expect(s.standable(0, 0)).toBe(true);
  });

  it('is walked by hand when somebody takes the stick, and slides along walls', () => {
    // Control: drop the per-axis retries in `push` and the walker stops dead at the
    // wall instead of sliding along it, so `z` never changes.
    const f = fixture();
    const wall = Array.from({ length: 17 }, (_, i) => ({ x: 4, z: -2 + i * 0.25, r: 0.3, h: 1 }));
    const s = new WorldSim(6);
    s.setMap({ ...f, solids: wall, areas: { ...f.areas, a: { ...f.areas.a!, spots: [[2, 1]], home: [2, 1] } } });
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'a' }]);
    const you = s.get('you')!;
    expect([you.x, you.z]).toEqual([2, 1]);

    // Pushed into the wall at an angle: it gets close, never through, and keeps
    // moving ALONG it -- which is the whole point of the per-axis retry.
    s.drive('you', 1, 0.6);
    expect(s.driven('you')).toBe(true);
    const startZ = you.z;
    for (let i = 0; i < 200; i++) {
      s.step(1 / 30);
      for (const w of wall) expect(Math.hypot(you.x - w.x, you.z - w.z)).toBeGreaterThan(0.3);
    }
    expect(you.x, 'reached the wall').toBeGreaterThan(3.4);
    expect(you.z - startZ, 'slid along it instead of stopping dead').toBeGreaterThan(1.5);
    expect(you.facing, 'faces the way it is pushed, even when stopped')
      .toBeCloseTo(Math.atan2(1, 0.6), 6);

    // Let go: it stands where it was left rather than walking home.
    s.drive('you', 0, 0);
    expect(s.driven('you')).toBe(false);
    const where: [number, number] = [you.x, you.z];
    for (let i = 0; i < 60; i++) s.step(1 / 30);
    expect([you.x, you.z]).toEqual(where);
    expect(startZ).toBe(1);
  });

  it('is not yanked away by a roster while somebody is walking it', () => {
    const f = fixture();
    const s = new WorldSim(7);
    s.setMap(f);
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'a' }]);
    s.drive('you', 0, 1);
    for (let i = 0; i < 30; i++) s.step(1 / 30);
    const moved: [number, number] = [s.get('you')!.x, s.get('you')!.z];
    // A poll says they are in another neighbourhood now. It must not teleport them
    // mid-step; it is remembered and acted on once the stick is let go.
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'c' }]);
    expect(s.get('you')!.area).toBe('c');
    for (let i = 0; i < 30; i++) s.step(1 / 30);
    // Driving +z, so it is z that keeps moving, and x that stays put.
    expect(s.get('you')!.z).toBeGreaterThan(moved[1]);
    expect(s.get('you')!.x).toBeCloseTo(moved[0], 9);
    expect(s.get('you')!.state, 'still under the thumb, not walking off to tile c').toBe('walking');
  });

  it('spreads the bench over the neighbourhoods, you in the central one', () => {
    const s = mapped();
    s.populateBench(12);
    expect(s.get('you')!.area).toBeNull();
    expect(new Set(s.agents().map((a) => a.area))).toEqual(new Set([null, 'a', 'b', 'c']));
  });
});
