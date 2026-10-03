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
 *   - a bench further than a run in BENCH_SECS is reached by the emergency pickup (the
 *     founder chose it over the smoke, 2026-10-03): the plane's cable up, down by
 *     parachute at the bench, and seated -- no smoke. Four and a half seconds at most
 *     since the plane came in (2026-10-04: he asked to see it come and drop its cable);
 *     three and a half before, with the balloon;
 *   - held up on the way (a hedge, boxed in), the pickup takes you when the time is up,
 *     never a walk off somewhere else;
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
import { flightMs } from '../src/features/world/flight';

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

  it('a far bench: taken there by the pickup, and seated as it lands', () => {
    const s = park();
    s.place('you', 0, 30);
    s.sitOn('you', seat);
    const me = s.get('you')!;
    expect(me.fly?.f.kind, 'not taken by the pickup').toBe('pickup');
    const flight = flightMs(me.fly!.f) / 1000;
    let highest = 0;
    let t = 0;
    for (; t < 10 && me.state !== 'sitting'; t += 1 / 60) { s.step(1 / 60); highest = Math.max(highest, me.lift ?? 0); }
    expect(highest, 'never left the ground').toBeGreaterThan(2);
    expect(t, 'slower than the pickup itself').toBeLessThanOrEqual(flight + 0.05);
    expect(t, 'more than the pickup\'s four and a half seconds').toBeLessThanOrEqual(4.5);
    expect([me.x, me.z]).toEqual([0, 0]);
  });

  it('held up on the way, you are put on it when the time is up -- never walked off elsewhere', () => {
    // A wall of trunks between you and the bench, too wide to dodge round in time.
    const wall = Array.from({ length: 41 }, (_, i) => ({ x: -2 + i * 0.1, z: 1, r: 0.08, h: 1 }));
    const s = park(wall);
    s.place('you', 0, 1.6);
    s.sitOn('you', seat);
    const t = secondsToSit(s);
    // Boxed in, the pickup takes over when the time is up (or sooner, stuck), and lands.
    expect(t, 'never got there').toBeLessThanOrEqual(BENCH_MAX_SECS + 4.5);
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
    // Just sat down: the button now says "Get up", and does nothing yet.
    expect(benchPill(4, false, true)).toEqual({ label: 'Get up', action: null });
    expect(benchPill(4, false, false)).toEqual({ label: 'Get up', action: 'stand' });
    // Just got up: "Sit on a bench", nothing yet.
    expect(benchPill(null, false, true)).toEqual({ label: 'Sit on a bench', action: null });
    expect(benchPill(null, false, false)).toEqual({ label: 'Sit on a bench', action: 'sit' });
    // Tapped, waiting for the server: says so, and a second tap does nothing.
    expect(benchPill(null, true, false)).toEqual({ label: 'Sitting down…', action: null });
    expect(BENCH_SWAP_LOCK_MS).toBeLessThanOrEqual(1_500);
  });

  it('comes free again by a timer, not by reading the clock while drawing (SOURCE SHAPE: needs React Native)', () => {
    // The app builds with the React Compiler, which keeps a component's working-out until
    // its inputs change. The clock is not an input: worked out from Date.now() in render,
    // the lock never ended and the button stayed grey on both phones (2026-10-03).
    const hud = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-hud.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const actions = hud.slice(hud.indexOf('export function ParkActions'), hud.indexOf('function Pill('));
    expect(actions).toMatch(/setLocked\(true\);\s*const t = setTimeout\(\(\) => setLocked\(false\), BENCH_SWAP_LOCK_MS\);/);
    expect(actions).toContain('const pill = benchPill(bench, asking, locked);');
    expect(actions, 'the clock read while drawing').not.toMatch(/benchPill\([^)]*Date\.now\(\)/);
  });

  it('gets you up off a bench only for a firm push of the stick (SOURCE SHAPE: the canvas needs GL)', () => {
    const canvas = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'canvas.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(canvas).toContain("if (push > (you?.seat ? STAND_PUSH : 0.08)) {");
    expect(canvas).toMatch(/const STAND_PUSH = 0\.5;/);
    const hud = readFileSync(join(import.meta.dirname, '..', 'src', 'features', 'world', 'park-hud.tsx'), 'utf8');
    expect(hud).toContain('const pill = benchPill(bench, asking, locked);');
    expect(hud).toMatch(/disabled=\{!pill\.action \|\| !!partner\.rideTo\}/);
  });
});
