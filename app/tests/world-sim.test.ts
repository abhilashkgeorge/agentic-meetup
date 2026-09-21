/**
 * The town's choreography, with no renderer in the room.
 *
 * sim.ts imports nothing from react-native or three, on purpose: this is where "your
 * agent walks over, they talk, a verdict shows, they part" is checked, and where a 2D
 * renderer would plug in if the 3D one ever fails on a phone.
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

  it('walks your agent over to them and talks, then parts them on a verdict', () => {
    const s = town();
    const b0 = { ...s.get('b')! };
    s.meet('you', 'b');
    run(s, 15);
    // The visited stayed; the visitor came within a metre; both show dots.
    expect(Math.hypot(s.get('b')!.x - b0.x, s.get('b')!.z - b0.z)).toBeLessThan(0.01);
    expect(dist(s, 'you', 'b')).toBeLessThan(1.1);
    expect(s.get('you')!.bubble).toBe('dots');
    s.verdict('you', 'did_not_click'); s.verdict('b', 'did_not_click');
    expect(s.get('you')!.bubble).toBe('did_not_click');
    run(s, 12);
    expect(dist(s, 'you', 'b')).toBeGreaterThan(1.5);
    // ...and your agent went home.
    const you = s.get('you')!;
    expect(Math.hypot(you.x - HOME[0], you.z - HOME[1])).toBeLessThan(0.2);
  });

  it('sends a passed person off the square', () => {
    const s = town();
    s.pass('a');
    run(s, 20);
    expect(s.get('a')!.state).toBe('gone');
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
    run(s, 15);
    expect(you.state).toBe('talking');
    expect(dist(s, 'you', 'a')).toBeLessThan(1.2);
    // The verdict on a, then straight on to b -- not home.
    s.verdict('you', 'got_on'); s.verdict('a', 'got_on');
    run(s, 4);
    expect(you.partner).toBe('b');
    expect(s.get('b')!.partner).toBe('you');
    run(s, 15);
    expect(you.state).toBe('talking');
    expect(dist(s, 'you', 'b')).toBeLessThan(1.2);
    // The roster stopped saying b was talking: same thing, on to c.
    s.settle('b');
    expect(you.partner).toBe('c');
    run(s, 15);
    expect(dist(s, 'you', 'c')).toBeLessThan(1.2);
    // Last one done: home.
    s.verdict('you', 'did_not_click'); s.verdict('c', 'did_not_click');
    run(s, 20);
    expect(Math.hypot(you.x - HOME[0], you.z - HOME[1])).toBeLessThan(0.2);
    expect(you.state).toBe('idle');
  });

  it('comes home on a recall, visits queued or not, and leaves the other to wander', () => {
    const s = town();
    s.meet('you', 'a'); s.meet('you', 'b');
    run(s, 15);
    expect(s.get('you')!.state).toBe('talking');
    s.recall('you');
    const you = s.get('you')!;
    expect(you.partner).toBeNull();
    expect(you.bubble).toBeNull();
    run(s, 20);
    expect(Math.hypot(you.x - HOME[0], you.z - HOME[1])).toBeLessThan(0.2);
    expect(you.state).toBe('idle');
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
    run(s, 25);
    const you = s.get('you')!;
    expect(you.partner).toBeNull();
    expect(Math.hypot(you.x - HOME[0], you.z - HOME[1])).toBeLessThan(0.2);
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
    s.upsert([{ ref: 'a', kind: 'stranger', seed: 1, look: { ...lookFor(1), hair: 6 } }]);
    expect(s.get('a')!.look.hair).toBe(6);
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
    return [id, { home: spots[0]!, centre, radius: 5, spots }];
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
    run(s, 10);
    const you = s.get('you')!;
    expect(pointInPolygon([you.x, you.z], TRI.c)).toBe(true);
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

  it('hurries a long trip so a cross-town visit still arrives in about four seconds', () => {
    const s = mapped();
    s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: 'a' }, { ref: 'far', kind: 'met', seed: 3, area: 'b' }]);
    expect(dist(s, 'you', 'far')).toBeGreaterThan(20);
    s.meet('you', 'far');
    run(s, 4.5);
    expect(s.get('you')!.state).toBe('talking');
    expect(dist(s, 'you', 'far')).toBeLessThan(1.1);
  });

  it('sends a passed person out of their own neighbourhood and marks them gone', () => {
    const s = mapped();
    s.upsert([{ ref: 'p', kind: 'stranger', seed: 4, area: 'c' }]);
    s.pass('p');
    run(s, 20);
    expect(s.get('p')!.state).toBe('gone');
    expect(pointInPolygon([s.get('p')!.x, s.get('p')!.z], TRI.c)).toBe(false);
  });

  it('spreads the bench over the neighbourhoods, you in the central one', () => {
    const s = mapped();
    s.populateBench(12);
    expect(s.get('you')!.area).toBeNull();
    expect(new Set(s.agents().map((a) => a.area))).toEqual(new Set([null, 'a', 'b', 'c']));
  });
});
