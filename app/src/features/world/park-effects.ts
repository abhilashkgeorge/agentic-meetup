/**
 * The park's bits of magic: a puff of smoke where somebody appears or vanishes, and a
 * beam of light where somebody takes off or lands (the founder, 2026-10-03: "show a
 * smoke magical effect when someone joins").
 *
 * Anybody can ask for one -- the socket when you arrive, the sim when somebody lands,
 * the park's people when somebody near appears -- and the canvas draws whatever is
 * running, by the wall clock, every frame (canvas.tsx, effects-mesh.ts). Pure apart
 * from that one list (tests/park-effects.test.ts).
 */
import { DROP_MS, LIFT_MS, glideMs, type Flight } from './flight';

export interface Effect {
  kind: 'puff' | 'beam';
  x: number;
  z: number;
  /** When it starts and how long it runs, in ms by Date.now(). */
  from: number;
  ms: number;
}

/** A puff: billows out and fades in under a second. */
export const PUFF_MS = 900;
/** The most running at once: the oldest go first. */
export const MAX_EFFECTS = 24;
/** How far away something may happen for it to be worth a puff: well inside the mist. */
export const PUFF_NEAR = 15;
/** A jump this far between two words from the server is a vanish here and a puff there. */
export const JUMP = 1.5;

const running: Effect[] = [];

function add(e: Effect): void {
  running.push(e);
  if (running.length > MAX_EFFECTS) running.splice(0, running.length - MAX_EFFECTS);
}

export function puff(x: number, z: number, at = Date.now()): void {
  add({ kind: 'puff', x, z, from: at, ms: PUFF_MS });
}

export function beam(x: number, z: number, from: number, ms: number): void {
  add({ kind: 'beam', x, z, from, ms });
}

/**
 * Everything a flight shows, from when it took off: the beam it rises on, the beam it
 * comes down in (lit a moment early, so you see where it will land), and the puff as
 * it touches down. A phone that first sees a flight part-way through passes when it
 * really started, and sees the rest.
 */
export function flightEffects(f: Flight, startedAt: number): void {
  beam(f.fx, f.fz, startedAt, LIFT_MS + 350);
  const over = startedAt + LIFT_MS + glideMs(f);
  beam(f.tx, f.tz, over - 300, 300 + DROP_MS + 450);
  puff(f.tx, f.tz, over + DROP_MS - 100);
}

/** What is running at `now`, the finished ones dropped. Some may not have started yet. */
export function effectsNow(now = Date.now()): readonly Effect[] {
  let keep = 0;
  for (const e of running) if (e.from + e.ms > now) running[keep++] = e;
  running.length = keep;
  return running;
}

/** Walking out of the park: nothing left over for the next visit. */
export function clearEffects(): void {
  running.length = 0;
}

/**
 * How far along an effect is, 0 to 1, and how strongly it shows: in quickly, out slowly.
 * Null before it starts or after it ends.
 */
export function effectAt(e: Effect, now: number): { k: number; alpha: number } | null {
  const t = now - e.from;
  if (t < 0 || t >= e.ms) return null;
  const k = t / e.ms;
  const fadeIn = e.kind === 'beam' ? Math.min(1, t / 150) : Math.min(1, k / 0.12);
  const fadeOut = e.kind === 'beam' ? Math.min(1, (e.ms - t) / 400) : 1 - k * k;
  return { k, alpha: Math.max(0, Math.min(fadeIn, fadeOut)) };
}

/**
 * Who appeared and who vanished since the last frame of people, near enough to see:
 * a puff for each. Not on your first frame in the park -- everybody already here would
 * go off at once -- and not for somebody who simply walked into or out of range, who
 * is further than PUFF_NEAR by then. A jump of more than JUMP is somebody stepping
 * across by magic (a bench too far to walk to): a puff where they were, and one where
 * they are. Flights bring their own (flightEffects).
 */
export function puffsFor(
  before: ReadonlyMap<string, { x: number; z: number; fly?: unknown }>,
  after: ReadonlyMap<string, { x: number; z: number; fly?: unknown }>,
  me: { x: number; z: number } | null,
  first: boolean,
): [number, number][] {
  if (first || !me) return [];
  const near = (p: { x: number; z: number }) => Math.hypot(p.x - me.x, p.z - me.z) <= PUFF_NEAR;
  const out: [number, number][] = [];
  for (const [ref, p] of after) {
    const was = before.get(ref);
    if (p.fly || was?.fly) continue;
    if (!was) { if (near(p)) out.push([p.x, p.z]); continue; }
    if (Math.hypot(p.x - was.x, p.z - was.z) > JUMP) {
      if (near(was)) out.push([was.x, was.z]);
      if (near(p)) out.push([p.x, p.z]);
    }
  }
  for (const [ref, p] of before) if (!after.has(ref) && !p.fly && near(p)) out.push([p.x, p.z]);
  return out;
}
