/**
 * The town's choreography, with no renderer in the room.
 *
 * sim.ts imports nothing from react-native or three, on purpose: this is where "your
 * agent walks over, they talk, a verdict shows, they part" is checked, and where a 2D
 * renderer would plug in if the 3D one ever fails on a phone.
 */
import { describe, expect, it } from 'vitest';
import { HOME, WorldSim } from '../src/features/world/sim';

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
});
