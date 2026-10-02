/**
 * Getting to a bench, and being seen getting there (the founder, 2026-10-03).
 *
 * WHAT WAS WRONG:
 *   - "the users sometimes sit in an invisible bench": the walk to a bench went out to
 *     the server as standing still (the phone sent `moving` for the stick alone), so the
 *     server -- a person with a bench who is not moving is sitting -- told everybody else
 *     they were sitting, and they were drawn seated in the middle of the path, sliding;
 *   - "make sure it doesn't take them more than 3 secs to get to a bench": a brisk walk
 *     to a bench forty metres off took eleven seconds.
 *
 * WHAT IS GUARDED:
 *   - walking to a bench is moving; sitting on it, or flying, is not (park-live.ts
 *     movingNow, which is what the phone sends);
 *   - a near bench is walked to, faster the further, and sat on inside BENCH_MAX_SECS;
 *   - a bench further than a run in BENCH_SECS is stepped to by magic: on it at once,
 *     with a puff where you stood and one on the bench;
 *   - held up on the way (a hedge, boxed in), you are put on it when the time is up,
 *     never walked off somewhere else;
 *   - another phone draws somebody sitting only once they are on the seat;
 *   - THE BUTTON HOLDS STILL UNDER A FINGER: "Sit on a bench" and "Get up" swapped the
 *     instant the bench changed, so a double tap sat and stood; in the founder's own
 *     session they sat and stood five times in twenty seconds, every time moving both
 *     voices to another room -- the "voice not working" he saw. It says "Sitting down…"
 *     until the server answers and does nothing for BENCH_SWAP_LOCK_MS after a change;
 *     and only a firm push of the stick (half way) gets you up.
 *
 * Negative controls, run by hand and recorded in the commit:
 *   - movingNow as the stick alone -> "walking to a bench is moving" fails;
 *   - sitOn at the old WALK x 1.8 with no magic -> "a far bench in under three seconds" fails;
 *   - no seatWait countdown -> "held up on the way" fails;
 *   - benchPill with no lock -> "holds still under a finger" fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTER, type Look } from '@clone/shared';
import { BENCH_SWAP_LOCK_MS, benchPill, movingNow } from '../src/features/world/park-live';
import { BENCH_MAX_SECS, WorldSim } from '../src/features/world/sim';
import { clearEffects, effectsNow } from '../src/features/world/park-effects';

const look: Look = { ...STARTER };
const REF = (n: number) => n.toString(16).padStart(32, '0');
const seat = { x: 0, z: 0, facing: 0 };

function park(solids: { x: number; z: number; r: number; h: number }[] = []): WorldSim {
  const s = new WorldSim(5);
  s.setMap({ central: 'p', areas: { p: { home: [0, 0], centre: [0, 0], radius: 40, spots: [[0, 0]], polygon: [] } }, solids });
  s.upsert([{ ref: 'you', kind: 'you', seed: 7, area: null }]);
  return s;
}

/** Seconds until seated, stepping at 60 a second, or Infinity. */
function secondsToSit(s: WorldSim): number {
  for (let i = 0; i < 60 * 20; i++) {
    if (s.get('you')!.state === 'sitting') return i / 60;
    s.step(1 / 60);
  }
  return Infinity;
}

describe('getting to a bench', () => {
  it('walking to a bench is moving; sitting on it, or flying, is not', () => {
    const s = park();
    s.place('you', 0, 1);
    s.sitOn('you', seat);
    expect(movingNow(s.get('you')!, s.driven('you')), 'sent as standing still while walking to the bench').toBe(true);
    secondsToSit(s);
    expect(movingNow(s.get('you')!, s.driven('you'))).toBe(false);
    expect(movingNow({ state: 'idle', fly: {} }, true), 'flying is the flight\'s own business').toBe(false);
    expect(movingNow({ state: 'idle' }, true)).toBe(true);
  });

  it('a near bench is walked to, and sat on in under three seconds', () => {
    for (const d of [0.3, 0.8, 1.5, 2.1]) {
      const s = park();
      s.place('you', 0, d + 0.13);
      s.sitOn('you', seat);
      expect(s.get('you')!.state, `${d} units: not walked`).toBe('walking');
      expect(secondsToSit(s), `${d} units`).toBeLessThanOrEqual(BENCH_MAX_SECS);
    }
  });

  it('a far bench in under three seconds: on it at once, in a puff of smoke at each end', () => {
    clearEffects();
    const s = park();
    s.place('you', 0, 30);
    s.sitOn('you', seat);
    expect(secondsToSit(s)).toBe(0);
    const me = s.get('you')!;
    expect([me.x, me.z]).toEqual([0, 0]);
    const puffs = effectsNow().filter((e) => e.kind === 'puff');
    expect(puffs.map((p) => [p.x, p.z])).toEqual([[0, 30], [0, 0]]);
    clearEffects();
  });

  it('held up on the way, you are put on it when the time is up -- never walked off elsewhere', () => {
    // A wall of trunks between you and the bench, too wide to dodge round in time.
    const wall = Array.from({ length: 41 }, (_, i) => ({ x: -2 + i * 0.1, z: 1, r: 0.08, h: 1 }));
    const s = park(wall);
    s.place('you', 0, 1.6);
    s.sitOn('you', seat);
    const t = secondsToSit(s);
    expect(t, 'never got there').toBeLessThanOrEqual(BENCH_MAX_SECS + 1 / 60);
    expect([s.get('you')!.x, s.get('you')!.z]).toEqual([0, 0]);
  });
});

describe('seen from another phone', () => {
  it('sits only once they are on the seat', () => {
    const s = new WorldSim(5);
    // The server's word while they walk over: moving, so not sitting.
    s.live(REF(1), look, 0, 1, 0, true, false);
    s.step(1 / 60);
    expect(s.get(REF(1))!.state).not.toBe('sitting');
    // There, and still: sitting.
    s.live(REF(1), look, 0, 1, 0, false, true);
    for (let i = 0; i < 30; i++) s.step(1 / 60);
    expect(s.get(REF(1))!.state).toBe('sitting');
  });
});

describe('the bench button', () => {
  it('holds still under a finger: nothing for a moment after the bench changes, either way', () => {
    const t = 50_000;
    // Just sat down: the button now says "Get up", and does nothing yet.
    expect(benchPill(4, false, t, t + 100)).toEqual({ label: 'Get up', action: null });
    expect(benchPill(4, false, t, t + BENCH_SWAP_LOCK_MS)).toEqual({ label: 'Get up', action: 'stand' });
    // Just got up: "Sit on a bench", nothing yet.
    expect(benchPill(null, false, t, t + 300)).toEqual({ label: 'Sit on a bench', action: null });
    expect(benchPill(null, false, t, t + BENCH_SWAP_LOCK_MS + 1)).toEqual({ label: 'Sit on a bench', action: 'sit' });
    // Tapped, waiting for the server: says so, and a second tap does nothing.
    expect(benchPill(null, true, 0, t)).toEqual({ label: 'Sitting down…', action: null });
  });

  it('gets you up off a bench only for a firm push of the stick (SOURCE SHAPE: the canvas needs GL)', () => {
    const canvas = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(canvas).toContain("if (push > (you?.seat ? STAND_PUSH : 0.08)) {");
    expect(canvas).toMatch(/const STAND_PUSH = 0\.5;/);
    const hud = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-hud.tsx'), 'utf8');
    expect(hud).toContain('const pill = benchPill(bench, asking, changedAt, Date.now());');
    expect(hud).toMatch(/disabled=\{!pill\.action \|\| !!partner\.rideTo\}/);
  });
});
