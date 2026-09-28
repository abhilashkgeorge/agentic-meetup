/**
 * People nobody can see are moved less often, and nobody notices.
 *
 * THE BUG THIS EXISTS FOR. With the park's thousand-person test crowd the sim was
 * 7.5 ms of a 35 ms frame on the Seeker (debug build, 2026-09-28): a thousand walkers
 * stepped every frame, most of them behind the mist where nobody can see them. And
 * `agents()` built a fresh thousand-element array on every call, twice a frame.
 *
 * WHAT IS PINNED:
 *   - out of sight, a walker takes one step in FAR_EVERY frames, and in sight every
 *     frame -- as does anybody being driven, wherever they are;
 *   - over twelve seconds a far walker covers the same ground either way (it is the
 *     same walk, in bigger steps);
 *   - `agents()` is one array until somebody arrives or leaves.
 *
 * Negative controls, run 2026-09-28 and restored byte-identical:
 *   - step() ignoring `near`                    -> "one step in FAR_EVERY" fails
 *   - remove() not dropping the cached list     -> "until somebody leaves" fails
 */
import { describe, expect, it } from 'vitest';
import { FAR_EVERY, WorldSim } from '../src/features/world/sim';

/** A plaza of walkers strung out along x, every one of them walking somewhere. */
const town = () => {
  const s = new WorldSim(4);
  s.upsert(Array.from({ length: 40 }, (_, i) => ({ ref: `w${i}`, kind: 'stranger' as const, seed: i })));
  s.upsert([{ ref: 'you', kind: 'you', seed: 7 }]);
  return s;
};

describe('the walkers nobody can see', () => {
  it('take one step in FAR_EVERY frames out of sight, and every frame in sight', () => {
    const s = town();
    for (let i = 0; i < 200; i++) s.step(1 / 30);   // get everybody going
    const far = { x: 1000, z: 1000, r: 5 };           // the camera is a long way off
    const moves = new Map<string, number>();
    for (let f = 0; f < FAR_EVERY * 10; f++) {
      const before = new Map(s.agents().map((a) => [a.ref, `${a.x},${a.z},${a.wait}`]));
      s.step(1 / 30, far);
      for (const a of s.agents()) {
        if (before.get(a.ref) !== `${a.x},${a.z},${a.wait}`) moves.set(a.ref, (moves.get(a.ref) ?? 0) + 1);
      }
    }
    const counts = [...moves.values()];
    expect(counts.length, 'nobody moved at all').toBeGreaterThan(10);
    for (const n of counts) expect(n, 'somebody out of sight stepped every frame').toBeLessThanOrEqual(10);

    // The same town with the camera among them: everybody steps every frame.
    const all = new Map<string, number>();
    const near = { x: 0, z: 0, r: 1e6 };
    for (let f = 0; f < FAR_EVERY * 10; f++) {
      const before = new Map(s.agents().map((a) => [a.ref, `${a.x},${a.z},${a.wait}`]));
      s.step(1 / 30, near);
      for (const a of s.agents()) {
        if (before.get(a.ref) !== `${a.x},${a.z},${a.wait}`) all.set(a.ref, (all.get(a.ref) ?? 0) + 1);
      }
    }
    expect(Math.max(...all.values())).toBe(FAR_EVERY * 10);
  });

  it('always steps somebody being driven, however far away', () => {
    const s = town();
    s.drive('you', 0.2, 0);
    let moved = 0;
    for (let f = 0; f < 8; f++) {
      const x = s.get('you')!.x;
      s.step(1 / 30, { x: 1000, z: 1000, r: 5 });
      if (s.get('you')!.x !== x) moved++;
    }
    expect(moved).toBe(8);
  });

  it('walks them the same distance, in bigger steps', () => {
    // Two identical towns, one stepped as if the camera were miles away.
    const a = town();
    const b = town();
    const far = { x: 1000, z: 1000, r: 5 };
    const walked = (s: WorldSim, near?: typeof far) => {
      let d = 0;
      const last = new Map(s.agents().map((p) => [p.ref, [p.x, p.z] as const]));
      for (let f = 0; f < 30 * 12; f++) {
        s.step(1 / 30, near);
        for (const p of s.agents()) {
          const [x, z] = last.get(p.ref)!;
          d += Math.hypot(p.x - x, p.z - z);
          last.set(p.ref, [p.x, p.z]);
        }
      }
      return d;
    };
    const every = walked(a);
    const lod = walked(b, far);
    expect(lod / every).toBeGreaterThan(0.85);
    expect(lod / every).toBeLessThan(1.15);
  });
});

describe('the list of everybody', () => {
  it('is one array until somebody arrives or leaves', () => {
    const s = town();
    const first = s.agents();
    s.step(1 / 30);
    expect(s.agents()).toBe(first);
    s.upsert([{ ref: 'new', kind: 'stranger', seed: 99 }]);
    const second = s.agents();
    expect(second).not.toBe(first);
    expect(second.map((a) => a.ref)).toContain('new');
    s.remove('new');
    expect(s.agents()).not.toBe(second);
    expect(s.agents().map((a) => a.ref)).not.toContain('new');
    s.addCrowd(5, null);
    expect(s.agents()).toHaveLength(46);
    s.removeCrowd();
    expect(s.agents()).toHaveLength(41);
  });
});
